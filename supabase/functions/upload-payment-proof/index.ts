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

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const BUCKET    = 'payment-proofs';

/**
 * Detect MIME type from magic bytes — never trust Content-Type / file name.
 * Returns null if the file is not a recognised safe type.
 */
function detectMimeFromBytes(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf);
  // JPEG: FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  // PDF: 25 50 44 46 (‍%PDF)
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
  return null;
}

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
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return jsonError('File exceeds the 5 MB size limit.', 400);
  }

  // Magic byte check — never trust client-supplied Content-Type or file name.
  const detectedMime = detectMimeFromBytes(bytes);
  if (!detectedMime) {
    return jsonError('Only JPEG, PNG, and PDF files are allowed.', 400);
  }

  // Derive extension from actual content, not the filename
  const extMap: Record<string, string> = {
    'image/jpeg':      'jpg',
    'image/png':       'png',
    'application/pdf': 'pdf',
  };

  // ── Upload to private storage bucket ────────────────────────
  const svc         = createServiceClient();
  const ext         = extMap[detectedMime] ?? 'bin';
  const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await svc.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType:  detectedMime,
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
      file_type:     detectedMime,
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
