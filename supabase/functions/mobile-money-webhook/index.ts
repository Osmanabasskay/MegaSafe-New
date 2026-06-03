/**
 * mobile-money-webhook Edge Function
 *
 * Receives Monime Payment Code webhook events for Osusu contributions
 * and other mobile-money payments (distinct from vault-webhook).
 *
 * Security contract:
 *   - ALWAYS returns HTTP 200 — Monime retries on non-200.
 *   - HMAC-SHA256 signature verified (Monime-Signature header); invalid sig → skip + 200.
 *   - Re-verifies payment code via Monime API before crediting.
 *   - Deduplication via payment_webhook_events UNIQUE(provider, session_id, event_type).
 *   - All state transitions via SECURITY DEFINER RPCs.
 *   - Runs as service_role — no user JWT accepted.
 *
 * Events handled:
 *   payment_code.processed  → re-verify + finalize_monime_checkout RPC
 *   payment_code.completed  → re-verify + finalize_monime_checkout RPC
 *   payment_code.expired    → fail_monime_checkout RPC
 *   payment_code.cancelled  → fail_monime_checkout RPC
 */

import { createServiceClient }   from '../_shared/auth.ts';
import {
  verifyMonimeSignature,
  getPaymentCode,
  isCompletedEvent,
  isFailedEvent,
  isProcessedEvent,
  type MonimeWebhookPayload,
} from '../_shared/monime.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return ok({ status: 'method_not_allowed' });

  const rawBody = await req.text();

  // ── 1. Parse ───────────────────────────────────────────────────────────────
  let payload: MonimeWebhookPayload;
  try { payload = JSON.parse(rawBody) as MonimeWebhookPayload; }
  catch {
    console.warn('mobile-money-webhook: invalid JSON body');
    return ok({ status: 'bad_json' });
  }

  const eventType     = payload.event;
  const data          = payload.data as Record<string, unknown>;
  const paymentCodeId = data?.id as string | undefined;

  if (!eventType || !paymentCodeId) {
    console.warn('mobile-money-webhook: missing event or data.id');
    return ok({ status: 'missing_fields' });
  }

  // ── 2. Verify signature — ALWAYS return 200, skip processing on bad sig ────
  const sig      = req.headers.get('Monime-Signature');
  const sigValid = await verifyMonimeSignature(rawBody, sig);
  if (!sigValid) {
    console.warn(`mobile-money-webhook: invalid signature for payment_code ${paymentCodeId} — ignoring`);
    return ok({ status: 'invalid_signature' });
  }

  const orderNumber = (
    (data?.processedPaymentData as Record<string, unknown> | null)?.orderNumber as string | undefined
  ) ?? null;

  console.log(`mobile-money-webhook: ${eventType} | code=${paymentCodeId} | order=${orderNumber ?? 'n/a'}`);

  const svc = createServiceClient();

  // ── 3. Deduplicate ─────────────────────────────────────────────────────────
  const { error: dedupErr } = await svc.from('payment_webhook_events').insert({
    provider:        'monime',
    event_type:      eventType,
    session_id:      paymentCodeId,
    reference:       (data?.reference as string | null) ?? null,
    payload:         payload as unknown as Record<string, unknown>,
    signature_valid: true,
  });

  if (dedupErr?.code === '23505') {
    console.log(`mobile-money-webhook: duplicate — ${paymentCodeId}/${eventType}`);
    return ok({ status: 'already_processed' });
  }
  if (dedupErr) {
    console.error('mobile-money-webhook: dedup insert error:', dedupErr.message);
    // Continue — processing is more important than dedup tracking
  }

  // ── 4. Route by event ──────────────────────────────────────────────────────
  if (isCompletedEvent(eventType) || isProcessedEvent(eventType)) {
    return handleSuccess(svc, paymentCodeId, orderNumber, payload);
  }
  if (isFailedEvent(eventType)) {
    const reason = eventType.split('.').pop() ?? 'unknown';
    return handleFailed(svc, paymentCodeId, reason);
  }

  console.log(`mobile-money-webhook: unhandled event ${eventType} — ignoring`);
  return ok({ status: 'ignored', event: eventType });
});

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleSuccess(
  svc:            ReturnType<typeof createServiceClient>,
  paymentCodeId:  string,
  orderNumber:    string | null,
  webhookPayload: MonimeWebhookPayload,
): Promise<Response> {
  // Re-verify via Monime API — never trust webhook body alone
  let verified: Awaited<ReturnType<typeof getPaymentCode>>;
  try {
    verified = await getPaymentCode(paymentCodeId);
  } catch (e) {
    console.error(`mobile-money-webhook: Monime API re-verification failed for ${paymentCodeId}:`, e);
    return ok({ status: 'reverify_failed', payment_code_id: paymentCodeId });
  }

  if (verified.status !== 'completed' && verified.status !== 'processed') {
    console.warn(`mobile-money-webhook: API returned status="${verified.status}" for ${paymentCodeId} — not processing`);
    return ok({ status: 'not_confirmed', api_status: verified.status });
  }

  const resolvedOrderNumber = orderNumber ?? verified.processedPaymentData?.orderNumber ?? null;

  const { data: result, error: rpcErr } = await svc.rpc('finalize_monime_checkout', {
    p_monime_session_id: paymentCodeId,
    p_webhook_payload:   webhookPayload as unknown as Record<string, unknown>,
    p_order_number:      resolvedOrderNumber,
  });

  if (rpcErr) {
    console.error(`mobile-money-webhook: finalize_monime_checkout error for ${paymentCodeId}:`, rpcErr.message);
    return ok({ status: 'rpc_error', detail: rpcErr.message });
  }

  const res = result as Record<string, unknown>;
  if (res?.error) {
    console.error(`mobile-money-webhook: finalize_monime_checkout app error for ${paymentCodeId}:`, res.error);
    return ok({ status: 'rpc_app_error', error: res.error });
  }

  console.log(`mobile-money-webhook: finalized | code=${paymentCodeId} | contrib=${res.contribution_id ?? 'n/a'}`);
  dispatchNotification(svc, paymentCodeId, res).catch(console.warn);

  return ok({ status: 'completed', contribution_id: res.contribution_id ?? null, idempotent: res.idempotent ?? false });
}

async function handleFailed(
  svc:           ReturnType<typeof createServiceClient>,
  paymentCodeId: string,
  reason:        string,
): Promise<Response> {
  const { data: result, error: rpcErr } = await svc.rpc('fail_monime_checkout', {
    p_monime_session_id: paymentCodeId,
    p_reason:            reason,
  });

  if (rpcErr) {
    console.error(`mobile-money-webhook: fail_monime_checkout error for ${paymentCodeId}:`, rpcErr.message);
    return ok({ status: 'rpc_error', detail: rpcErr.message });
  }

  const res = result as Record<string, unknown>;
  console.log(`mobile-money-webhook: failed | code=${paymentCodeId} | reason=${reason}`, JSON.stringify(res));
  return ok({ status: 'failed', reason });
}

// ── Notification (non-blocking, best-effort) ──────────────────────────────────

async function dispatchNotification(
  svc:           ReturnType<typeof createServiceClient>,
  paymentCodeId: string,
  rpcResult:     Record<string, unknown>,
): Promise<void> {
  try {
    const { data: mmTxn } = await svc
      .from('mobile_money_transactions')
      .select('user_id, amount, payment_id')
      .or(`monime_payment_code_id.eq.${paymentCodeId},provider_reference.eq.${paymentCodeId}`)
      .maybeSingle();

    if (!mmTxn) return;

    const txn        = mmTxn as Record<string, unknown>;
    const notifUrl   = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!notifUrl || !serviceKey) return;

    fetch(notifUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: txn.user_id,
        type:    'payment_confirmed',
        title:   'Payment Confirmed',
        body:    `Your payment of NLe ${Number(txn.amount ?? 0).toFixed(2)} has been confirmed.`,
        data:    { contribution_id: txn.payment_id ?? rpcResult.contribution_id ?? null },
      }),
    }).catch((e) => console.warn('Notification fetch failed:', e));
  } catch (e) {
    console.warn('dispatchNotification error:', e instanceof Error ? e.message : e);
  }
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}
