/**
 * payout-webhook Edge Function
 *
 * Receives Monime Payout webhook events (payout.completed / payout.failed /
 * payout.cancelled / payout.processing) and drives the withdrawal lifecycle:
 * processing → completed | failed. Without this endpoint approved withdrawals
 * would be stuck in 'processing' forever.
 *
 * Register in the Monime dashboard:
 *   https://<project-ref>.supabase.co/functions/v1/payout-webhook
 *   Events: payout.*
 *
 * Security contract (identical to the payment-code webhooks):
 *   - ALWAYS returns HTTP 200 — Monime retries on non-200.
 *   - HMAC-SHA256 signature verified using MONIME_PAYOUT_WEBHOOK_SECRET
 *     (falls back to MONIME_WEBHOOK_SECRET when the dedicated secret is not
 *     set — document which one your dashboard endpoint uses).
 *   - Timestamp freshness ≤ 5 minutes (Monime-Timestamp header).
 *   - Re-fetches the payout from the Monime API before any state change —
 *     the webhook body is never trusted.
 *   - Validates amount + currency against the stored withdrawal_requests row;
 *     a mismatch NEVER completes the withdrawal.
 *   - Deduplication via payment_webhook_events UNIQUE(provider, session_id,
 *     event_type) with provider='monime_payout'.
 *   - State transitions only via the record_monime_payout_result
 *     SECURITY DEFINER RPC (idempotent; never downgrades completed).
 *   - Audit logs: payout_completed/payout_failed (inside the RPC),
 *     payout_duplicate_ignored, payout_amount_mismatch, payout_unknown,
 *     webhook_signature_invalid.
 */

import { createServiceClient } from '../_shared/auth.ts';
import { readBoundedBody }      from '../_shared/cors.ts';
import {
  verifyMonimeSignature,
  getMonimePayout,
  isPayoutEvent,
  type MonimeWebhookPayload,
} from '../_shared/monime.ts';
import {
  mapPayoutStatus,
  amountMatchesMinor,
  isSupportedCurrency,
} from '../_shared/paymentValidation.ts';

type Svc = ReturnType<typeof createServiceClient>;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return ok({ status: 'method_not_allowed' });

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req, 256 * 1024);
  if (sizeErr) { console.warn('payout-webhook: oversized body'); return ok({ status: 'too_large' }); }

  // ── 1. Parse ───────────────────────────────────────────────────────────────
  let payload: MonimeWebhookPayload;
  try { payload = JSON.parse(rawBody) as MonimeWebhookPayload; }
  catch {
    console.warn('payout-webhook: invalid JSON body');
    return ok({ status: 'bad_json' });
  }

  const eventType = payload.event;
  const data      = payload.data as Record<string, unknown>;
  const payoutId  = typeof data?.id === 'string' ? data.id : '';

  if (!eventType || !payoutId) {
    console.warn('payout-webhook: missing event or data.id');
    return ok({ status: 'missing_fields' });
  }
  if (!isPayoutEvent(eventType)) {
    console.log(`payout-webhook: non-payout event ${eventType} — ignoring`);
    return ok({ status: 'ignored', event: eventType });
  }

  const svc = createServiceClient();

  // ── 2. Verify signature + timestamp freshness ─────────────────────────────
  const sig      = req.headers.get('Monime-Signature');
  const ts       = req.headers.get('Monime-Timestamp');
  const sigValid = await verifyMonimeSignature(rawBody, sig, ts, 'MONIME_PAYOUT_WEBHOOK_SECRET');
  if (!sigValid) {
    console.warn(`payout-webhook: invalid signature for payout ${payoutId} — ignoring`);
    await auditEvent(svc, 'webhook_signature_invalid', null, {
      endpoint: 'payout-webhook',
      payout_id: payoutId,
      event: eventType,
    });
    return ok({ status: 'invalid_signature' });
  }

  console.log(`payout-webhook: ${eventType} | payout=${payoutId}`);

  // ── 3. Deduplicate ─────────────────────────────────────────────────────────
  const { error: dedupErr } = await svc.from('payment_webhook_events').insert({
    provider:        'monime_payout',
    event_type:      eventType,
    session_id:      payoutId,
    reference:       extractReference(data),
    payload:         payload as unknown as Record<string, unknown>,
    signature_valid: true,
  });

  if (dedupErr?.code === '23505') {
    console.log(`payout-webhook: duplicate — ${payoutId}/${eventType}`);
    await auditEvent(svc, 'payout_duplicate_ignored', null, {
      endpoint: 'payout-webhook',
      payout_id: payoutId,
      event: eventType,
    });
    return ok({ status: 'already_processed' });
  }
  if (dedupErr) {
    console.error('payout-webhook: dedup insert error — aborting:', dedupErr.message);
    return ok({ status: 'dedup_error' });
  }

  // ── 4. Re-fetch the payout from the Monime API (authoritative) ─────────────
  let payout: Awaited<ReturnType<typeof getMonimePayout>>;
  try {
    payout = await getMonimePayout(payoutId);
  } catch (e) {
    console.error(`payout-webhook: Monime API re-verification failed for ${payoutId}:`, e);
    return ok({ status: 'reverify_failed', payout_id: payoutId });
  }

  const mapped = mapPayoutStatus(payout.status);

  // ── 5. Locate the withdrawal: monime_payout_id → reference/metadata ────────
  const withdrawal = await findWithdrawal(svc, payoutId, payout, payload);
  if (!withdrawal) {
    console.warn(`payout-webhook: no withdrawal found for payout ${payoutId}`);
    await auditEvent(svc, 'payout_unknown', null, {
      endpoint: 'payout-webhook',
      payout_id: payoutId,
      monime_status: payout.status,
      reference: payout.reference || null,
    });
    return ok({ status: 'unknown_payout', payout_id: payoutId });
  }

  const wd = withdrawal as Record<string, unknown>;
  const withdrawalId = String(wd.id);

  // ── 6. Validate amount + currency before any completion ────────────────────
  const amountOk   = amountMatchesMinor(Number(wd.amount), payout.amount);
  const currencyOk = isSupportedCurrency(payout.currency);
  if (mapped.recordStatus === 'completed' && (!amountOk || !currencyOk)) {
    console.error(`payout-webhook: amount/currency mismatch for payout ${payoutId} (withdrawal ${withdrawalId})`);
    await auditEvent(svc, 'payout_amount_mismatch', withdrawalId, {
      endpoint: 'payout-webhook',
      payout_id: payoutId,
      withdrawal_id: withdrawalId,
      expected_amount: wd.amount,
      verified_minor: payout.amount,
      verified_currency: payout.currency,
    });
    // Do NOT complete the withdrawal on mismatch — leave it for investigation.
    return ok({ status: 'amount_or_currency_mismatch', payout_id: payoutId });
  }

  // ── 7. Record via SECURITY DEFINER RPC (idempotent) ────────────────────────
  const failureMsg = mapped.recordStatus === 'failed' || mapped.recordStatus === 'cancelled'
    ? sanitizeFailureMessage(payout.failureMsg, payout.status)
    : null;

  const { data: result, error: rpcErr } = await svc.rpc('record_monime_payout_result', {
    p_withdrawal_id:    withdrawalId,
    p_monime_payout_id: payoutId,
    p_status:           mapped.recordStatus,
    p_failure_code:     payout.failureCode ?? null,
    p_failure_msg:      failureMsg,
  });

  if (rpcErr) {
    console.error(`payout-webhook: record_monime_payout_result error for ${payoutId}:`, rpcErr.message);
    return ok({ status: 'rpc_error' });
  }
  const res = (result ?? {}) as Record<string, unknown>;
  if (res?.error) {
    console.error(`payout-webhook: record_monime_payout_result app error for ${payoutId}:`, res.error);
    return ok({ status: 'rpc_app_error', error: res.error });
  }

  // ── 8. Update the outbound provider transaction (best-effort) ──────────────
  await updateOutboundMmTxn(svc, payoutId, mapped.recordStatus).catch((e) =>
    console.warn('payout-webhook: outbound mm txn update failed:', e instanceof Error ? e.message : e));

  // ── 9. Notify the user on terminal states (best-effort) ────────────────────
  if (mapped.terminal) {
    dispatchPayoutNotification(svc, wd, mapped.recordStatus).catch(console.warn);
  }

  console.log(`payout-webhook: recorded | payout=${payoutId} | withdrawal=${withdrawalId} | status=${mapped.recordStatus}`);
  return ok({
    status: res.idempotent ? 'already_processed' : 'recorded',
    payout_status: mapped.recordStatus,
    withdrawal_id: withdrawalId,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findWithdrawal(
  svc: Svc,
  payoutId: string,
  payout: { reference: string; metadata?: Record<string, unknown> | null },
  payload: MonimeWebhookPayload,
) {
  const select = 'id, user_id, amount, currency, status, payout_status';

  // Primary: the payout id stored at initiation time (approve-withdrawal).
  const { data: byPayoutId } = await svc
    .from('withdrawal_requests')
    .select(select)
    .eq('monime_payout_id', payoutId)
    .maybeSingle();
  if (byPayoutId) return byPayoutId;

  // Fallback: approve-withdrawal sets metadata.reference = withdrawal id (uuid).
  // Prefer the re-fetched payout's metadata over the webhook body.
  const candidates = [
    payout.metadata?.withdrawal_id,
    payout.metadata?.reference,
    payout.reference,
    extractReference(payload.data as Record<string, unknown>),
  ];
  for (const candidate of candidates) {
    const id = extractUuid(candidate);
    if (!id) continue;
    const { data: byReference } = await svc
      .from('withdrawal_requests')
      .select(select)
      .eq('id', id)
      .maybeSingle();
    if (byReference) return byReference;
  }

  return null;
}

function extractReference(data: Record<string, unknown>): string | null {
  const metadata = data?.metadata && typeof data.metadata === 'object'
    ? data.metadata as Record<string, unknown>
    : null;
  return stringOrNull(data?.reference)
    ?? stringOrNull(metadata?.reference)
    ?? stringOrNull(metadata?.withdrawal_id);
}

function extractUuid(value: unknown): string | null {
  const text = stringOrNull(value);
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Keep stored failure reasons short and free of identity data. */
function sanitizeFailureMessage(msg: string | null | undefined, status: string): string {
  const safe = String(msg ?? '').replace(/\+?\d{6,}/g, '[redacted]').slice(0, 300);
  return safe || `Monime payout ${status}`;
}

async function updateOutboundMmTxn(svc: Svc, payoutId: string, status: string): Promise<void> {
  const mmStatus = status === 'completed' ? 'completed'
    : status === 'cancelled' ? 'cancelled'
    : status === 'failed' ? 'failed'
    : 'processing';
  await svc
    .from('mobile_money_transactions')
    .update({ status: mmStatus, status_updated_at: new Date().toISOString() })
    .eq('monime_payment_code_id', payoutId)
    .eq('direction', 'outbound');
}

async function auditEvent(
  svc: Svc,
  action: string,
  withdrawalId: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await svc.from('audit_logs').insert({
      actor_id:   null,
      action,
      table_name: 'withdrawal_requests',
      record_id:  withdrawalId,
      new_data:   data,
    });
  } catch (e) {
    console.warn('payout-webhook: audit insert failed:', e instanceof Error ? e.message : e);
  }
}

async function dispatchPayoutNotification(
  svc: Svc,
  withdrawal: Record<string, unknown>,
  status: string,
): Promise<void> {
  const notifUrl   = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!notifUrl || !serviceKey || !withdrawal.user_id) return;

  const completed = status === 'completed';
  fetch(notifUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      user_id: withdrawal.user_id,
      type:    completed ? 'withdrawal_completed' : 'withdrawal_failed',
      title:   completed ? 'Withdrawal Sent' : 'Withdrawal Issue',
      body:    completed
        ? 'Your withdrawal has been sent to your mobile money account.'
        : 'Your withdrawal could not be completed. Our team has been notified.',
      data:    { amount: withdrawal.amount ?? null, withdrawal_id: withdrawal.id },
    }),
  }).catch((e) => console.warn('payout-webhook: notification failed:', e));
}

function ok(body: unknown): Response {
  const data = body != null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { value: body };
  return new Response(JSON.stringify({ ...data, success: true, data }), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}
