/**
 * vault-webhook Edge Function
 *
 * Receives Monime webhook events for vault top-up operations.
 * Distinct from mobile-money-webhook which handles Osusu contributions.
 *
 * Security contract:
 *   - ALWAYS returns HTTP 200 — Monime retries on non-200, so we must absorb errors.
 *   - HMAC-SHA256 signature verified (Monime-Signature header); bad sig skips processing.
 *   - Re-verifies payment status via Monime API before crediting — never trusts webhook body alone.
 *   - Deduplication via payment_webhook_events UNIQUE(provider, session_id, event_type).
 *   - All state transitions via SECURITY DEFINER RPCs (finalize_vault_topup, fail_vault_topup).
 *   - Runs as service_role — no user JWT accepted.
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
    console.warn('vault-webhook: invalid JSON body');
    return ok({ status: 'bad_json' });
  }

  const eventType     = payload.event;
  const data          = payload.data as Record<string, unknown>;
  const paymentCodeId = data?.id as string | undefined;

  if (!eventType || !paymentCodeId) {
    console.warn('vault-webhook: missing event or data.id');
    return ok({ status: 'missing_fields' });
  }

  // ── 2. Verify signature — ALWAYS return 200, just skip processing on bad sig ──
  const sig      = req.headers.get('Monime-Signature');
  const sigValid = await verifyMonimeSignature(rawBody, sig);
  if (!sigValid) {
    console.warn(`vault-webhook: invalid signature for payment_code ${paymentCodeId} — ignoring`);
    return ok({ status: 'invalid_signature' });
  }

  const orderNumber = (
    (data?.processedPaymentData as Record<string, unknown> | null)?.orderNumber as string | undefined
  ) ?? null;

  console.log(`vault-webhook: ${eventType} | code=${paymentCodeId} | order=${orderNumber ?? 'n/a'}`);

  const svc = createServiceClient();

  // ── 3. Deduplicate ─────────────────────────────────────────────────────────
  const { error: dedupErr } = await svc.from('payment_webhook_events').insert({
    provider:        'monime_vault',
    event_type:      eventType,
    session_id:      paymentCodeId,
    reference:       (data?.reference as string | null) ?? null,
    payload:         payload as unknown as Record<string, unknown>,
    signature_valid: true,
  });

  if (dedupErr?.code === '23505') {
    console.log(`vault-webhook: duplicate — ${paymentCodeId}/${eventType}`);
    return ok({ status: 'already_processed' });
  }
  if (dedupErr) {
    console.error('vault-webhook: dedup insert error:', dedupErr.message);
    // Do not halt — processing is more important than dedup tracking here
  }

  // ── 4. Route by event ──────────────────────────────────────────────────────
  if (isCompletedEvent(eventType) || isProcessedEvent(eventType)) {
    return handleSuccess(svc, paymentCodeId, orderNumber, payload);
  }
  if (isFailedEvent(eventType)) {
    const reason = eventType.split('.').pop() ?? 'unknown';
    return handleFailed(svc, paymentCodeId, reason);
  }

  console.log(`vault-webhook: unhandled event ${eventType} — ignoring`);
  return ok({ status: 'ignored', event: eventType });
});

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleSuccess(
  svc:            ReturnType<typeof createServiceClient>,
  paymentCodeId:  string,
  orderNumber:    string | null,
  webhookPayload: MonimeWebhookPayload,
): Promise<Response> {
  // Re-verify via Monime API — never trust the webhook body alone
  let verified: Awaited<ReturnType<typeof getPaymentCode>>;
  try {
    verified = await getPaymentCode(paymentCodeId);
  } catch (e) {
    console.error(`vault-webhook: Monime API re-verification failed for ${paymentCodeId}:`, e);
    // Return 200 so Monime doesn't retry, but do not credit
    return ok({ status: 'reverify_failed', payment_code_id: paymentCodeId });
  }

  if (verified.status !== 'completed' && verified.status !== 'processed') {
    console.warn(`vault-webhook: API returned status="${verified.status}" for ${paymentCodeId} — not crediting`);
    return ok({ status: 'not_confirmed', api_status: verified.status });
  }

  const resolvedOrderNumber = orderNumber ?? verified.processedPaymentData?.orderNumber ?? null;

  const { data: result, error: rpcErr } = await svc.rpc('finalize_vault_topup', {
    p_monime_session_id: paymentCodeId,
    p_webhook_payload:   webhookPayload as unknown as Record<string, unknown>,
    p_order_number:      resolvedOrderNumber,
  });

  if (rpcErr) {
    console.error(`vault-webhook: finalize_vault_topup error for ${paymentCodeId}:`, rpcErr.message);
    return ok({ status: 'rpc_error', detail: rpcErr.message });
  }

  const res = result as Record<string, unknown>;
  if (res?.error) {
    console.error(`vault-webhook: finalize_vault_topup application error for ${paymentCodeId}:`, res.error);
    return ok({ status: 'rpc_app_error', error: res.error });
  }

  console.log(`vault-webhook: vault credited | code=${paymentCodeId} | topup_id=${res.topup_id ?? 'n/a'}`);
  dispatchTopupNotification(svc, paymentCodeId, res).catch(console.warn);

  return ok({ status: 'completed', topup_id: res.topup_id ?? null, idempotent: res.idempotent ?? false });
}

async function handleFailed(
  svc:           ReturnType<typeof createServiceClient>,
  paymentCodeId: string,
  reason:        string,
): Promise<Response> {
  const { data: result, error: rpcErr } = await svc.rpc('fail_vault_topup', {
    p_monime_session_id: paymentCodeId,
    p_reason:            reason,
  });

  if (rpcErr) {
    console.error(`vault-webhook: fail_vault_topup error for ${paymentCodeId}:`, rpcErr.message);
    return ok({ status: 'rpc_error', detail: rpcErr.message });
  }

  const res = result as Record<string, unknown>;
  console.log(`vault-webhook: topup failed | code=${paymentCodeId} | reason=${reason}`, JSON.stringify(res));
  return ok({ status: 'failed', reason });
}

// ── Notification (non-blocking, best-effort) ──────────────────────────────────

async function dispatchTopupNotification(
  svc:           ReturnType<typeof createServiceClient>,
  paymentCodeId: string,
  rpcResult:     Record<string, unknown>,
): Promise<void> {
  try {
    const { data: topup } = await svc
      .from('vault_topups')
      .select('user_id, amount')
      .or(`monime_payment_code_id.eq.${paymentCodeId},monime_session_id.eq.${paymentCodeId}`)
      .maybeSingle();

    if (!topup) return;

    const t          = topup as Record<string, unknown>;
    const notifUrl   = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!notifUrl || !serviceKey) return;

    fetch(notifUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: t.user_id,
        type:    'vault_topup_completed',
        title:   'Vault Funded',
        body:    `NLe ${Number(t.amount ?? 0).toFixed(2)} has been added to your vault.`,
        data:    { topup_id: rpcResult.topup_id ?? null },
      }),
    }).catch((e) => console.warn('Notification fetch failed:', e));
  } catch (e) {
    console.warn('dispatchTopupNotification error:', e instanceof Error ? e.message : e);
  }
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}
