/**
 * verify-payment Edge Function
 *
 * Allows the frontend to poll the status of a Monime Payment Code and the
 * corresponding mobile_money_transactions record after the user dials the
 * USSD code on their phone.
 *
 * IMPORTANT SECURITY NOTE:
 *   This function is READ-ONLY. It never finalises a payment.
 *   Finalisation only happens inside mobile-money-webhook (server ← Monime).
 *   Even if the frontend receives status="completed" from this endpoint it
 *   cannot manufacture a completed contribution — the webhook must arrive
 *   independently from Monime's servers.
 *
 * Flow:
 *   1. Verify caller JWT.
 *   2. Verify the caller owns the mobile_money_transaction (via user_id).
 *   3. Fetch live status from Monime Payment Codes API (display-only).
 *   4. Return combined status: local DB status + Monime API status.
 *
 * Request body (one of):
 *   { monime_payment_code_id: "pmc-xxxx" }  ← preferred
 *   { mm_txn_id: "uuid" }
 */

import { corsHeaders, handleCors, readBoundedBody }              from '../_shared/cors.ts';
import { getAuthUser, createServiceClient }     from '../_shared/auth.ts';
import { getPaymentCode }                        from '../_shared/monime.ts';

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonError('Method not allowed.', 405);
  }

  // ── 1. Authenticate ──────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const user       = await getAuthUser(authHeader);
  if (!user) return jsonError('Not authenticated.', 401);

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req);
  if (sizeErr) return jsonError(sizeErr, 413);

  let body: { monime_payment_code_id?: string; mm_txn_id?: string };
  try {
    body = JSON.parse(rawBody) as { monime_payment_code_id?: string; mm_txn_id?: string };
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!body.monime_payment_code_id && !body.mm_txn_id) {
    return jsonError('Provide monime_payment_code_id or mm_txn_id.', 400);
  }

  const svc = createServiceClient();

  // ── 2. Fetch local transaction record ────────────────────────
  let localQuery = svc
    .from('mobile_money_transactions')
    .select('id, user_id, status, monime_payment_code_id, provider_reference, amount, payment_id, created_at')
    .eq('user_id', user.id);   // ownership check — cannot query another user's record

  if (body.monime_payment_code_id) {
    localQuery = localQuery.eq('monime_payment_code_id', body.monime_payment_code_id);
  } else {
    localQuery = localQuery.eq('id', body.mm_txn_id!);
  }

  const { data: mmTxn, error: dbErr } = await localQuery.maybeSingle();

  if (dbErr) {
    console.error('mobile_money_transactions lookup error:', dbErr.message);
    return jsonError('Internal error.', 500);
  }

  if (!mmTxn) {
    return jsonOk({ status: 'not_found', local_status: null, monime_status: null });
  }

  const txn = mmTxn as Record<string, unknown>;
  // monime_payment_code_id is the primary key; fall back to provider_reference for older records
  const paymentCodeId = (txn.monime_payment_code_id ?? txn.provider_reference) as string | null;

  // ── 3. Fetch live status from Monime (display only, not authoritative) ────────
  let monimeStatus: string | null = null;
  let monimeData:   Record<string, unknown> | null = null;

  if (paymentCodeId) {
    try {
      const code   = await getPaymentCode(paymentCodeId);
      monimeStatus = code.status;
      monimeData   = {
        id:           code.id,
        status:       code.status,
        amount:       code.amount,
        currency:     code.currency,
        provider_id:  code.providerId,
        completed_at: code.completedAt ?? null,
      };
    } catch (err) {
      console.warn('Monime getPaymentCode error:', err instanceof Error ? err.message : err);
    }
  }

  // ── 4. Return combined status ────────────────────────────────
  return jsonOk({
    mm_txn_id:              txn.id,
    payment_id:             txn.payment_id ?? null,
    local_status:           txn.status,
    monime_status:          monimeStatus,
    monime_payment_code:    monimeData,
    amount:                 txn.amount,
    created_at:             txn.created_at,
    effective_status:       deriveEffectiveStatus(txn.status as string, monimeStatus),
  });
});

/**
 * Combines the local DB status and the live Monime status into a single
 * displayable value. Local DB is the source of truth for finalization
 * (set by the webhook); Monime status is used only when the local record
 * is still pending/processing.
 */
function deriveEffectiveStatus(
  localStatus:  string,
  monimeStatus: string | null,
): string {
  // If local is terminal, always trust it
  if (localStatus === 'completed') return 'completed';
  if (localStatus === 'failed')    return 'failed';

  // While pending/processing, reflect Monime's status
  if (monimeStatus === 'completed')  return 'processing';  // webhook hasn't landed yet
  if (monimeStatus === 'expired')    return 'expired';
  if (monimeStatus === 'cancelled')  return 'cancelled';

  return localStatus; // 'pending' | 'processing'
}

function jsonOk(body: unknown): Response {
  const data = body != null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { value: body };
  return new Response(JSON.stringify({ ...data, success: true, data }), {
    status:  200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(msg: string, status = 400, code = 'PAYMENT_ERROR'): Response {
  return new Response(JSON.stringify({ success: false, error: msg, code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
