/**
 * verify-vault-topup-status Edge Function
 *
 * Safe read-only poll for vault topup status.
 * Called by the frontend after user dials the USSD code to check progress.
 *
 * IMPORTANT: This response is display-only.
 * vault-webhook (and only vault-webhook) is the authority on vault credits.
 * Never use this response to consider a topup complete in the frontend.
 */

import { corsHeaders, handleCors }       from '../_shared/cors.ts';
import { getAuthUser, createUserClient } from '../_shared/auth.ts';
import { getPaymentCode }                from '../_shared/monime.ts';

interface RequestBody {
  topup_id?:              string;
  monime_payment_code_id?: string;
  monime_session_id?:     string;  // backward compat for older records
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return err('Method not allowed.', 405);

  const authHeader = req.headers.get('Authorization');
  const user       = await getAuthUser(authHeader);
  if (!user) return err('Not authenticated.', 401);

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return err('Invalid JSON body.', 400); }

  if (!body.topup_id && !body.monime_payment_code_id && !body.monime_session_id)
    return err('topup_id, monime_payment_code_id, or monime_session_id is required.', 400);

  const userClient = createUserClient(authHeader);

  // ── 1. Fetch topup record from DB (authoritative source) ──────────────────
  let query = userClient
    .from('vault_topups')
    .select('id, amount, currency, status, monime_payment_code_id, monime_session_id, ussd_code, created_at, completed_at, failed_at')
    .eq('user_id', user.id);

  if (body.topup_id) {
    query = query.eq('id', body.topup_id);
  } else if (body.monime_payment_code_id) {
    query = query.eq('monime_payment_code_id', body.monime_payment_code_id);
  } else {
    query = query.eq('monime_session_id', body.monime_session_id!);
  }

  const { data: topup, error: dbErr } = await query.maybeSingle();

  if (dbErr) {
    console.error('vault_topups lookup error:', dbErr.message);
    return err('Failed to look up topup status.', 500);
  }
  if (!topup) return err('Topup not found.', 404);

  const t = topup as Record<string, unknown>;

  // ── 2. Terminal DB states — no need to poll Monime ───────────────────────
  if ((t.status as string) === 'completed') {
    return ok({
      topup_id:         t.id,
      db_status:        'completed',
      effective_status: 'completed',
      amount:           t.amount,
      currency:         t.currency,
      completed_at:     t.completed_at,
    });
  }

  if ((t.status as string) in { failed: 1, expired: 1, cancelled: 1 }) {
    return ok({
      topup_id:         t.id,
      db_status:        t.status,
      effective_status: t.status,
      amount:           t.amount,
      currency:         t.currency,
      failed_at:        t.failed_at,
    });
  }

  // ── 3. Still pending/processing — poll Monime for live status (display only) ──
  let monimeStatus: string | null = null;
  const paymentCodeId = (t.monime_payment_code_id ?? t.monime_session_id) as string | null;

  if (paymentCodeId) {
    try {
      const code = await getPaymentCode(paymentCodeId);
      monimeStatus = code.status;
    } catch (e) {
      console.warn('Monime getPaymentCode poll failed:', e instanceof Error ? e.message : e);
    }
  }

  return ok({
    topup_id:               t.id,
    db_status:              t.status,
    monime_status:          monimeStatus,
    effective_status:       t.status,
    amount:                 t.amount,
    currency:               t.currency,
    ussd_code:              t.ussd_code,
    monime_payment_code_id: t.monime_payment_code_id,
    created_at:             t.created_at,
  });
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
