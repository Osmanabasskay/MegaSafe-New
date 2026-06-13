/**
 * mobile-money-webhook Edge Function
 *
 * Receives Monime Payment Code webhook events for Osusu contributions and
 * send-payments (group + savings). Vault top-ups use the separate
 * vault-webhook endpoint and are explicitly rejected here.
 *
 * Security contract:
 *   - ALWAYS returns HTTP 200 — Monime retries on non-200.
 *   - HMAC-SHA256 signature verified (Monime-Signature header) + timestamp
 *     freshness (Monime-Timestamp ≤ 5 min); invalid → audit + skip + 200.
 *   - Re-verifies the payment code via the Monime API before finalizing —
 *     the webhook body is never trusted for money movement.
 *   - Amount + currency are validated against server-stored records before
 *     any credit (inside the finalizer RPCs for send payments; here for
 *     contributions).
 *   - Deduplication via payment_webhook_events UNIQUE(provider, session_id,
 *     event_type).
 *   - All state transitions via SECURITY DEFINER RPCs; runs as service_role.
 *
 * Explicit routing (metadata.payment_type / metadata.target_type, set
 * server-side at payment-code creation; DB fallback for legacy codes):
 *   osusu_contribution           → finalize_monime_checkout
 *   send_payment + group         → finalize_send_payment
 *   send_payment + savings       → finalize_savings_deposit
 *   vault_topup                  → audit + reject (belongs to vault-webhook)
 *   unknown                      → audit warning, nothing finalized
 */

import { createServiceClient }   from '../_shared/auth.ts';
import { readBoundedBody }        from '../_shared/cors.ts';
import {
  verifyMonimeSignature,
  getPaymentCode,
  isCompletedEvent,
  isFailedEvent,
  isProcessedEvent,
  type MonimeWebhookPayload,
} from '../_shared/monime.ts';
import {
  resolveWebhookRoute,
  mapFailureStatus,
  amountMatchesMinor,
  isSupportedCurrency,
  type WebhookRouteFallback,
} from '../_shared/paymentValidation.ts';

type Svc = ReturnType<typeof createServiceClient>;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return ok({ status: 'method_not_allowed' });

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req, 256 * 1024);
  if (sizeErr) { console.warn('mobile-money-webhook: oversized body'); return ok({ status: 'too_large' }); }

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

  const svc = createServiceClient();

  // ── 2. Verify signature + timestamp freshness ─────────────────────────────
  const sig      = req.headers.get('Monime-Signature');
  const ts       = req.headers.get('Monime-Timestamp');
  const sigValid = await verifyMonimeSignature(rawBody, sig, ts);
  if (!sigValid) {
    console.warn(`mobile-money-webhook: invalid signature for payment_code ${paymentCodeId} — ignoring`);
    await auditEvent(svc, 'webhook_signature_invalid', null, {
      endpoint: 'mobile-money-webhook',
      payment_code: paymentCodeId,
      event: eventType,
    });
    return ok({ status: 'invalid_signature' });
  }

  const orderNumber = (
    (data?.processedPaymentData as Record<string, unknown> | null)?.orderNumber as string | undefined
  ) ?? null;

  console.log(`mobile-money-webhook: ${eventType} | code=${paymentCodeId} | order=${orderNumber ?? 'n/a'}`);

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
    // Any non-duplicate DB error halts processing — never risk double-credit.
    console.error('mobile-money-webhook: dedup insert error — aborting to prevent double-credit:', dedupErr.message);
    return ok({ status: 'dedup_error' });
  }

  // ── 4. Route by event ──────────────────────────────────────────────────────
  if (isCompletedEvent(eventType) || isProcessedEvent(eventType)) {
    return handleSuccess(svc, paymentCodeId, orderNumber, payload);
  }
  if (isFailedEvent(eventType)) {
    const reason = eventType.split('.').pop() ?? 'unknown';
    return handleFailed(svc, paymentCodeId, reason, payload);
  }

  console.log(`mobile-money-webhook: unhandled event ${eventType} — ignoring`);
  return ok({ status: 'ignored', event: eventType });
});

// ── Route resolution ──────────────────────────────────────────────────────────

async function buildRouteFallback(svc: Svc, paymentCodeId: string): Promise<WebhookRouteFallback> {
  const fallback: WebhookRouteFallback = { intentTargetType: null, hasContribution: false };

  const { data: intent } = await svc
    .from('payment_intents')
    .select('target_type')
    .eq('provider_reference', paymentCodeId)
    .maybeSingle();
  if (intent?.target_type === 'group' || intent?.target_type === 'savings') {
    fallback.intentTargetType = intent.target_type;
  }

  const { data: mmTxn } = await svc
    .from('mobile_money_transactions')
    .select('payment_id')
    .eq('monime_payment_code_id', paymentCodeId)
    .maybeSingle();
  fallback.hasContribution = Boolean(mmTxn?.payment_id);

  return fallback;
}

// ── Success handler ───────────────────────────────────────────────────────────

async function handleSuccess(
  svc:            Svc,
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

  // Trusted metadata: the Monime API echoes back what WE attached at creation.
  const meta = (verified.metadata ?? (webhookPayload.data?.metadata as Record<string, unknown> | undefined) ?? null) as
    | { payment_type?: string; target_type?: string }
    | null;
  const fallback = await buildRouteFallback(svc, paymentCodeId);
  const routing = resolveWebhookRoute(meta, fallback);

  switch (routing.route) {
    case 'send_payment_group': {
      const { data: result, error: rpcErr } = await svc.rpc('finalize_send_payment', {
        p_monime_payment_code_id: paymentCodeId,
        p_verified_amount_minor:  verified.amount,
        p_verified_currency:      verified.currency,
        p_order_number:           resolvedOrderNumber,
        p_webhook_payload:        webhookPayload as unknown as Record<string, unknown>,
      });
      return finishFinalizer(svc, 'finalize_send_payment', paymentCodeId, result, rpcErr);
    }

    case 'send_payment_savings': {
      const { data: result, error: rpcErr } = await svc.rpc('finalize_savings_deposit', {
        p_monime_payment_code_id: paymentCodeId,
        p_verified_amount_minor:  verified.amount,
        p_verified_currency:      verified.currency,
        p_order_number:           resolvedOrderNumber,
        p_webhook_payload:        webhookPayload as unknown as Record<string, unknown>,
      });
      return finishFinalizer(svc, 'finalize_savings_deposit', paymentCodeId, result, rpcErr);
    }

    case 'osusu_contribution': {
      // Amount/currency validation against the server-stored transaction.
      const { data: mmTxn } = await svc
        .from('mobile_money_transactions')
        .select('id, amount, currency')
        .eq('monime_payment_code_id', paymentCodeId)
        .maybeSingle();

      if (mmTxn) {
        const amountOk   = amountMatchesMinor(Number((mmTxn as Record<string, unknown>).amount), verified.amount);
        const currencyOk = isSupportedCurrency(verified.currency);
        if (!amountOk || !currencyOk) {
          console.error(`mobile-money-webhook: amount/currency mismatch for ${paymentCodeId}`);
          await auditEvent(svc, 'webhook_misrouted_payment', null, {
            endpoint: 'mobile-money-webhook',
            payment_code: paymentCodeId,
            reason: 'amount_or_currency_mismatch',
            expected_amount: (mmTxn as Record<string, unknown>).amount,
            verified_minor: verified.amount,
            verified_currency: verified.currency,
          });
          return ok({ status: 'amount_or_currency_mismatch', payment_code_id: paymentCodeId });
        }
      }

      const { data: result, error: rpcErr } = await svc.rpc('finalize_monime_checkout', {
        p_monime_session_id: paymentCodeId,
        p_webhook_payload:   webhookPayload as unknown as Record<string, unknown>,
        p_order_number:      resolvedOrderNumber,
      });
      const response = await finishFinalizer(svc, 'finalize_monime_checkout', paymentCodeId, result, rpcErr);
      dispatchNotification(svc, paymentCodeId, (result ?? {}) as Record<string, unknown>).catch(console.warn);
      return response;
    }

    case 'vault_topup_misrouted': {
      console.warn(`mobile-money-webhook: vault_topup payment code ${paymentCodeId} hit the wrong endpoint`);
      await auditEvent(svc, 'webhook_misrouted_payment', null, {
        endpoint: 'mobile-money-webhook',
        payment_code: paymentCodeId,
        payment_type: 'vault_topup',
        expected_endpoint: 'vault-webhook',
      });
      return ok({ status: 'misrouted_vault_topup', payment_code_id: paymentCodeId });
    }

    default: {
      console.warn(`mobile-money-webhook: unknown payment_type for ${paymentCodeId} — nothing finalized`);
      await auditEvent(svc, 'webhook_unknown_payment_type', null, {
        endpoint: 'mobile-money-webhook',
        payment_code: paymentCodeId,
        metadata: meta,
      });
      return ok({ status: 'unknown_payment_type', payment_code_id: paymentCodeId });
    }
  }
}

async function finishFinalizer(
  svc:           Svc,
  rpcName:       string,
  paymentCodeId: string,
  result:        unknown,
  rpcErr:        { message: string } | null,
): Promise<Response> {
  if (rpcErr) {
    console.error(`mobile-money-webhook: ${rpcName} error for ${paymentCodeId}:`, rpcErr.message);
    return ok({ status: 'rpc_error', rpc: rpcName });
  }
  const res = (result ?? {}) as Record<string, unknown>;
  if (res?.error) {
    console.error(`mobile-money-webhook: ${rpcName} app error for ${paymentCodeId}:`, res.error);
    return ok({ status: 'rpc_app_error', rpc: rpcName, error: res.error });
  }
  console.log(`mobile-money-webhook: finalized via ${rpcName} | code=${paymentCodeId}`, JSON.stringify(res));
  return ok({
    status: 'completed',
    rpc: rpcName,
    idempotent: res.idempotent ?? false,
    receipt_number: res.receipt_number ?? null,
    contribution_id: res.contribution_id ?? null,
  });
}

// ── Failure handler ───────────────────────────────────────────────────────────

async function handleFailed(
  svc:            Svc,
  paymentCodeId:  string,
  reason:         string,
  webhookPayload: MonimeWebhookPayload,
): Promise<Response> {
  const status = mapFailureStatus(reason);
  const meta = (webhookPayload.data?.metadata as Record<string, unknown> | undefined) ?? null;
  const fallback = await buildRouteFallback(svc, paymentCodeId);
  const routing = resolveWebhookRoute(meta as { payment_type?: string; target_type?: string } | null, fallback);

  const results: Record<string, unknown> = {};

  // Contribution record exists (osusu contribution OR send→group): fail it first
  // so the contribution row is marked before the mm txn reaches a terminal state.
  if (routing.route === 'osusu_contribution' || routing.route === 'send_payment_group' || fallback.hasContribution) {
    const { data: result, error: rpcErr } = await svc.rpc('fail_monime_checkout', {
      p_monime_session_id: paymentCodeId,
      p_reason:            reason,
    });
    if (rpcErr) console.error(`mobile-money-webhook: fail_monime_checkout error for ${paymentCodeId}:`, rpcErr.message);
    results.contribution = rpcErr ? 'rpc_error' : (result as Record<string, unknown>)?.status ?? 'ok';
  }

  // Send-payment intent exists (group or savings): mark the intent + mm txn.
  if (fallback.intentTargetType) {
    const { data: result, error: rpcErr } = await svc.rpc('fail_send_payment_intent', {
      p_monime_payment_code_id: paymentCodeId,
      p_status:                 status,
      p_reason:                 reason,
    });
    if (rpcErr) console.error(`mobile-money-webhook: fail_send_payment_intent error for ${paymentCodeId}:`, rpcErr.message);
    results.intent = rpcErr ? 'rpc_error' : (result as Record<string, unknown>)?.status ?? 'ok';
  }

  if (!fallback.intentTargetType && routing.route !== 'osusu_contribution' && !fallback.hasContribution) {
    console.warn(`mobile-money-webhook: failure event for unknown payment ${paymentCodeId}`);
    await auditEvent(svc, 'webhook_unknown_payment_type', null, {
      endpoint: 'mobile-money-webhook',
      payment_code: paymentCodeId,
      event_reason: reason,
    });
    return ok({ status: 'unknown_payment', reason });
  }

  console.log(`mobile-money-webhook: failed | code=${paymentCodeId} | status=${status}`, JSON.stringify(results));
  return ok({ status, reason, results });
}

// ── Audit + notification helpers ──────────────────────────────────────────────

async function auditEvent(
  svc:      Svc,
  action:   string,
  actorId:  string | null,
  data:     Record<string, unknown>,
): Promise<void> {
  try {
    await svc.from('audit_logs').insert({
      actor_id:   actorId,
      action,
      table_name: 'payment_webhook_events',
      record_id:  null,
      new_data:   data,
    });
  } catch (e) {
    console.warn('mobile-money-webhook: audit insert failed:', e instanceof Error ? e.message : e);
  }
}

async function dispatchNotification(
  svc:           Svc,
  paymentCodeId: string,
  rpcResult:     Record<string, unknown>,
): Promise<void> {
  try {
    const { data: mmTxnByCode } = await svc
      .from('mobile_money_transactions')
      .select('user_id, amount, payment_id')
      .eq('monime_payment_code_id', paymentCodeId)
      .maybeSingle();
    const mmTxn = mmTxnByCode ?? (await svc
      .from('mobile_money_transactions')
      .select('user_id, amount, payment_id')
      .eq('provider_reference', paymentCodeId)
      .maybeSingle()
    ).data;

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
        body:    'Your payment has been confirmed.',
        data:    {
          amount:          txn.amount ?? null,
          contribution_id: txn.payment_id ?? rpcResult.contribution_id ?? null,
        },
      }),
    }).catch((e) => console.warn('Notification fetch failed:', e));
  } catch (e) {
    console.warn('dispatchNotification error:', e instanceof Error ? e.message : e);
  }
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
