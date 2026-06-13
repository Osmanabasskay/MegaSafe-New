/**
 * reject-withdrawal Edge Function
 *
 * Admin-only. Rejects a pending withdrawal request.
 * No funds are moved — the balance was never debited until approval.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';

function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

function createUserClient(authHeader: string | null) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader ?? '' } },
      auth: { persistSession: false },
    }
  );
}

async function getAuthUser(authHeader: string | null) {
  if (!authHeader) return null;
  const client = createUserClient(authHeader);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function getDbRole(userId: string): Promise<string | null> {
  const svc = createServiceClient();
  const [roleResult, profileResult] = await Promise.all([
    svc.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    svc.from('profiles').select('is_active').eq('id', userId).maybeSingle(),
  ]);
  if (!roleResult.data) return null;
  if (profileResult.data?.is_active === false) return null;
  return roleResult.data.role as string;
}

// ── Main handler ──────────────────────────────────────────────

interface RequestBody {
  withdrawal_id: string;
  reason?:       string | null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonError('Method not allowed.', 405);

  const authHeader = req.headers.get('Authorization');
  const user = await getAuthUser(authHeader);
  if (!user) return jsonError('Not authenticated.', 401);

  const role = await getDbRole(user.id);
  if (role !== 'super_admin' && role !== 'org_admin') {
    return jsonError('Admin access required.', 403);
  }

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req);
  if (sizeErr) return jsonError(sizeErr, 413);

  let body: RequestBody;
  try {
    body = JSON.parse(rawBody) as RequestBody;
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!body.withdrawal_id) return jsonError('withdrawal_id is required.', 400);

  const svc = createServiceClient();
  const { data: result, error: rpcErr } = await svc.rpc('reject_withdrawal_request', {
    p_withdrawal_id: body.withdrawal_id,
    p_reviewer_id:   user.id,
    p_reason:        body.reason?.trim() ?? null,
  });

  if (rpcErr) {
    console.error('reject_withdrawal_request RPC error:', rpcErr.message);
    return jsonError('Could not reject withdrawal request. Please try again.', 500);
  }
  const r = result as Record<string, unknown>;
  if (r?.error) return jsonError(r.error as string, 400);

  // Notify the user their withdrawal was rejected
  const notifUrl   = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (notifUrl && serviceKey) {
    const { data: wr } = await svc
      .from('withdrawal_requests')
      .select('user_id, amount')
      .eq('id', body.withdrawal_id)
      .maybeSingle();

    if (wr) {
      const wrData = wr as Record<string, unknown>;
      fetch(notifUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body:    JSON.stringify({
          user_id: wrData.user_id,
          type:    'withdrawal_rejected',
          title:   'Withdrawal Request Rejected',
          body:    body.reason
            ? `Your withdrawal request was rejected: ${body.reason}`
            : 'Your withdrawal request was rejected. Please contact support.',
          data:    { withdrawal_id: body.withdrawal_id },
        }),
      }).catch((err) => console.warn('Notification dispatch failed:', err));
    }
  }

  return jsonOk({ success: true, message: 'Withdrawal request rejected.' });
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
