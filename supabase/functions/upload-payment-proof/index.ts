/**
 * upload-payment-proof Edge Function
 *
 * Accepts a multipart upload of a payment receipt image or PDF,
 * validates type and size server-side, stores it in the private
 * 'payment-proofs' bucket, and creates a payment_proofs record.
 *
 * File content never reaches the client after upload — only a
 * signed URL valid for 60 minutes is returned.
 */

import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getAuthUser, createServiceClient } from '../_shared/auth.ts';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
const MAX_BYTES     = 5 * 1024 * 1024; // 5 MB
const BUCKET        = 'payment-proofs';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonError('Method not allowed.', 405);

  const authHeader = req.headers.get('Authorization');
  const user = await getAuthUser(authHeader);
  if (!user) return jsonError('Not authenticated.', 401);

  // ── Parse multipart form data ────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError('Expected multipart/form-data body.', 400);
  }

  const file           = formData.get('file');
  const contribution_id = formData.get('contribution_id');
  const withdrawal_id  = formData.get('withdrawal_id');

  if (!(file instanceof File)) return jsonError('file field is required.', 400);
  if (!contribution_id && !withdrawal_id) {
    return jsonError('contribution_id or withdrawal_id is required.', 400);
  }

  // ── Validate file ────────────────────────────────────────────
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonError('Only JPEG, PNG, and PDF files are allowed.', 400);
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return jsonError('File exceeds the 5 MB size limit.', 400);
  }

  // ── Upload to private storage bucket ────────────────────────
  const svc       = createServiceClient();
  const ext       = file.name.split('.').pop() ?? 'bin';
  const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await svc.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType:  file.type,
      cacheControl: '3600',
      upsert:       false,
    });

  if (uploadErr) {
    console.error('Storage upload error:', uploadErr.message);
    return jsonError('Upload failed. Please try again.', 500);
  }

  // ── Create payment_proofs record ─────────────────────────────
  const { data: proof, error: proofErr } = await svc
    .from('payment_proofs')
    .insert({
      payment_id:    contribution_id ? String(contribution_id) : null,
      uploaded_by:   user.id,
      storage_path:  storagePath,
      file_type:     file.type,
    })
    .select('id')
    .single();

  if (proofErr) {
    console.error('payment_proofs insert error:', proofErr.message);
    // Best-effort cleanup of the uploaded file
    await svc.storage.from(BUCKET).remove([storagePath]);
    return jsonError('Could not record proof. Please try again.', 500);
  }

  // ── Issue short-lived signed URL ─────────────────────────────
  const { data: signedUrl, error: signErr } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60); // 60 minutes

  if (signErr) {
    console.warn('Signed URL generation failed:', signErr.message);
  }

  return jsonOk({
    success:      true,
    proof_id:     (proof as Record<string, unknown>).id,
    signed_url:   signedUrl?.signedUrl ?? null,
    expires_in:   3600,
  });
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
