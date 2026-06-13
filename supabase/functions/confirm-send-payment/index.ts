/**
 * confirm-send-payment Edge Function
 *
 * Confirms a send-payment intent (group contribution or savings deposit) and
 * creates the Monime Payment Code the user must dial via USSD.
 *
 * CRITICAL CONTRACT (real money):
 *   - This function NEVER marks a payment completed. Both branches end in
 *     status='processing'. Completion happens exclusively in
 *     mobile-money-webhook after Monime confirms the payment
 *     (finalize_send_payment / finalize_savings_deposit RPCs).
 *   - Receipts and ledger entries are written by the webhook finalizers, not
 *     here. The duplicate-receipt check below only serves idempotent replays
 *     after the webhook has landed.
 *   - Provider KYC is verified (with a 24 h cache) before any payment code is
 *     created. QMoney and unknown providers are rejected with clear copy.
 *   - Amounts/providers come from the stored payment intent, never the client.
 */

import { handleCors, readBoundedBody, getCorsHeaders } from '../_shared/cors.ts';
import { createServiceClient, createUserClient, getAuthUser, isKycVerified } from '../_shared/auth.ts';
import {
  createPaymentCode,
  type MonimePaymentCode,
} from '../_shared/monime.ts';
import { validateMonimeMethod } from '../_shared/paymentValidation.ts';
import { ensureProviderKyc } from '../_shared/providerKyc.ts';

Deno.serve(async (req: Request) => {
  try {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonError(req, 'Method not allowed.', 405);

  const authHeader = req.headers.get('Authorization');
  const user = await getAuthUser(authHeader);
  if (!user) return jsonError(req, 'Not authenticated.', 401);

  const { text, error: bodyError } = await readBoundedBody(req, 8192);
  if (bodyError) return jsonError(req, bodyError, 413);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return jsonError(req, 'Invalid JSON body.', 400);
  }

  const intentId = typeof body.payment_intent_id === 'string' ? body.payment_intent_id : '';
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  const localAuthMethod = typeof body.local_auth_method === 'string' ? body.local_auth_method : '';
  const transactionPin = typeof body.transaction_pin === 'string' ? body.transaction_pin : null;

  if (!isUuid(intentId)) return jsonError(req, 'Invalid payment_intent_id.', 400);
  if (!isUuid(idempotencyKey)) return jsonError(req, 'Invalid idempotency_key.', 400);
  if (localAuthMethod !== 'biometric') return jsonError(req, 'Secure local confirmation is required.', 403);

  const svc = createServiceClient();
  const rateLimited = await isRateLimited(svc, user.id, 'confirm_send_payment', 5, 60);
  if (rateLimited) {
    await audit(svc, user.id, 'payment_confirmation_rate_limited', intentId, {});
    return jsonError(req, 'Too many confirmation attempts. Please wait and try again.', 429);
  }

  // Idempotent replay AFTER webhook completion → return the existing receipt.
  const { data: existingReceipt } = await svc
    .from('receipts')
    .select('receipt_number,transaction_id,payment_intent_id,status,issued_at,amount,currency,masked_account,provider_reference')
    .eq('idempotency_key', idempotencyKey)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existingReceipt) {
    await audit(svc, user.id, 'payment_duplicate_idempotency_attempt', intentId, {});
    return jsonOk(req, { status: existingReceipt.status, receipt: receiptPayload(existingReceipt) });
  }

  const { data: intent, error: intentError } = await svc
    .from('payment_intents')
    .select('*')
    .eq('id', intentId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (intentError) return jsonError(req, 'Could not load payment intent.', 500);
  if (!intent) return jsonError(req, 'Payment intent not found.', 404);

  // Idempotent replay WHILE processing → return the stored USSD code again.
  if (intent.status === 'processing' && String(intent.confirmation_idempotency_key ?? '') === idempotencyKey) {
    const replay = await loadProcessingReplay(svc, intent as Record<string, unknown>);
    if (replay) return jsonOk(req, replay);
  }

  if (intent.status !== 'pending') return jsonError(req, `Payment intent is ${intent.status}.`, 409);
  if (new Date(String(intent.expires_at)).getTime() < Date.now()) {
    await markIntentStatus(svc, intentId, 'expired');
    await audit(svc, user.id, 'payment_intent_expired', intentId, {});
    return jsonError(req, 'Payment intent has expired.', 410);
  }

  const profileOk = await loadActiveProfile(svc, user.id);
  if (!profileOk.ok) return jsonError(req, profileOk.reason, profileOk.status);

  // Provider must be supported (QMoney / unknown → clear rejection before anything else).
  const provider = validateMonimeMethod(String(intent.method));
  if (!provider.ok) {
    await audit(svc, user.id, 'payment_intent_create_rejected', intentId, { reason: provider.code });
    return jsonError(req, provider.message, 400);
  }

  const methodRow = await loadPaymentMethod(svc, user.id, String(intent.method), String(intent.payment_method_id));
  if (!methodRow) {
    await audit(svc, user.id, 'payment_confirmation_unlinked_method', intentId, { method: intent.method });
    return jsonError(req, 'Payment method is no longer active.', 403);
  }

  // Provider KYC gate — the number must be registered with the provider.
  const kycGate = await ensureProviderKyc(svc, {
    userId: user.id,
    method: provider.method,
    phoneNumber: methodRow.phone_number,
    flow: 'send_payment',
  });
  if (!kycGate.ok) {
    return jsonError(req, kycGate.message, kycGate.statusCode);
  }

  await audit(svc, user.id, 'payment_confirmation_attempted', intentId, {
    target_type: intent.target_type,
    amount: intent.amount,
    method: intent.method,
  });

  const userClient = createUserClient(authHeader);
  const serverIdempotencyKey = String(intent.idempotency_key);
  let transactionId: string | null = null;

  try {
    if (intent.target_type === 'group') {
      // 1. Create the pending contribution record (RPC verifies PIN, membership,
      //    amount, duplicate prevention server-side).
      const { data: period } = await svc
        .from('payment_periods')
        .select('id')
        .eq('group_id', intent.target_id)
        .eq('status', 'open')
        .order('due_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: rpcResult, error: rpcError } = await userClient.rpc('initiate_group_payment', {
        p_group_id: intent.target_id,
        p_member_id: user.id,
        p_period_id: period?.id ?? null,
        p_amount: Number(intent.amount),
        p_payment_method: intent.method,
        p_idempotency_key: serverIdempotencyKey,
        p_notes: 'send_flow_confirm',
        p_transaction_pin: transactionPin,
      });
      if (rpcError) throw rpcError;
      const rpc = rpcResult as Record<string, unknown>;
      if (rpc?.error) throw new Error(String(rpc.error));
      transactionId = String(rpc.contribution_id ?? rpc.payment_id ?? '') || null;
    } else if (intent.target_type === 'savings') {
      // 1. PIN check (the group branch gets this inside initiate_group_payment;
      //    savings has no upfront RPC anymore, so verify explicitly).
      const { data: pinResult, error: pinError } = await userClient.rpc('verify_transaction_pin', {
        p_pin: transactionPin,
        p_purpose: 'confirm_send_payment',
        p_transaction_context: { payment_intent_id: intentId, target_type: 'savings', amount: Number(intent.amount) },
      });
      if (pinError) throw pinError;
      const pin = pinResult as Record<string, unknown>;
      if (pin?.error) return jsonError(req, String(pin.error), 403);

      // 2. Re-validate the savings goal server-side (exists, owned, active).
      const { data: goal } = await svc
        .from('savings_goals')
        .select('id,user_id,status,is_active')
        .eq('id', intent.target_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!goal || (String(goal.status) !== 'active' && goal.is_active !== true)) {
        await audit(svc, user.id, 'payment_intent_unauthorized_target', intentId, { target_type: 'savings' });
        return jsonError(req, 'Savings goal is not available for deposits.', 403);
      }
      // No money movement here — the goal is credited ONLY by
      // finalize_savings_deposit after Monime confirms the payment.
      transactionId = null;
    } else {
      return jsonError(req, 'Unsupported payment target.', 400);
    }
  } catch (error) {
    console.error('confirm-send-payment failed:', error instanceof Error ? error.message : String(error));
    await markIntentStatus(svc, intentId, 'failed');
    await audit(svc, user.id, 'payment_failed', intentId, {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return jsonError(req, 'Payment could not be processed. Please try again.', 500);
  }

  // 2. Create the Monime payment code (both branches).
  let providerResult: { paymentCode: MonimePaymentCode; mmTxnId: string | null };
  try {
    providerResult = await createProviderPaymentCode(svc, {
      userId: user.id,
      intentId,
      targetType: String(intent.target_type),
      targetId: String(intent.target_id),
      contributionId: transactionId,
      amount: Number(intent.amount),
      method: provider.method,
      providerId: provider.providerId,
      phoneNumber: methodRow.phone_number,
      idempotencyKey: serverIdempotencyKey,
      targetName: String(intent.target_name ?? (intent.target_type === 'savings' ? 'Savings deposit' : 'Osusu contribution')),
    });
  } catch (error) {
    console.error('confirm-send-payment provider error:', error instanceof Error ? error.message : String(error));
    await markIntentStatus(svc, intentId, 'failed');
    await audit(svc, user.id, 'payment_failed', intentId, {
      reason: 'provider_payment_code_failed',
    });
    return jsonError(req, 'Payment provider unavailable. Please try again.', 502);
  }

  const paymentCode = providerResult.paymentCode;

  // 3. Move the intent to processing; the webhook is the only path to completed.
  await svc
    .from('payment_intents')
    .update({
      status: 'processing',
      confirmed_at: new Date().toISOString(),
      confirmation_idempotency_key: idempotencyKey,
      transaction_id: transactionId,
      provider_reference: paymentCode.id,
    })
    .eq('id', intentId);

  const initiatedAction = intent.target_type === 'savings'
    ? 'savings_deposit_initiated'
    : 'payment_provider_confirmation_started';
  await audit(svc, user.id, initiatedAction, intentId, {
    status: 'processing',
    transaction_id: transactionId,
    provider_reference: paymentCode.id,
    mm_txn_id: providerResult.mmTxnId,
  });

  return jsonOk(req, {
    status: 'processing',
    receipt: null,
    providerReference: paymentCode.id,
    monimePaymentCodeId: paymentCode.id,
    ussdCode: paymentCode.ussdCode || null,
    expiresAt: paymentCode.expiresAt || null,
    mmTxnId: providerResult.mmTxnId,
    paymentType: intent.target_type === 'savings' ? 'savings_deposit' : 'osusu_contribution',
  });
  } catch (error) {
    console.error('confirm-send-payment unhandled error:', error instanceof Error ? error.message : String(error));
    return jsonError(req, 'Payment could not be processed. Please try again.', 500, 'UNEXPECTED_ERROR');
  }
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createProviderPaymentCode(
  svc: ReturnType<typeof createServiceClient>,
  input: {
    userId: string;
    intentId: string;
    targetType: string;
    targetId: string;
    contributionId: string | null;
    amount: number;
    method: string;
    providerId: string;
    phoneNumber: string;
    idempotencyKey: string;
    targetName: string;
  }
): Promise<{ paymentCode: MonimePaymentCode; mmTxnId: string | null }> {
  // Provider transaction row first (status=pending). internal_reference is
  // UNIQUE — a retry with the same intent reuses the existing row.
  let mmTxnId: string | null = null;
  const { data: mmTxn, error: mmErr } = await svc
    .from('mobile_money_transactions')
    .insert({
      user_id: input.userId,
      payment_id: input.contributionId,
      provider: input.method,
      direction: 'inbound',
      amount: input.amount,
      currency: 'NLe',
      status: 'pending',
      phone_number: input.phoneNumber,
      internal_reference: input.idempotencyKey,
      provider_reference: `PEND-${input.idempotencyKey}`,
    })
    .select('id')
    .single();

  if (mmErr) {
    if (mmErr.code === '23505') {
      const { data: existing } = await svc
        .from('mobile_money_transactions')
        .select('id')
        .eq('internal_reference', input.idempotencyKey)
        .maybeSingle();
      mmTxnId = existing ? String(existing.id) : null;
    } else {
      throw new Error(`Could not create provider transaction: ${mmErr.message}`);
    }
  } else {
    mmTxnId = String(mmTxn.id);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const webhookUrl = `${supabaseUrl}/functions/v1/mobile-money-webhook`;

  let paymentCode: MonimePaymentCode;
  try {
    paymentCode = await createPaymentCode({
      amount: input.amount,
      providerId: input.providerId,
      phoneNumber: input.phoneNumber,
      reference: input.idempotencyKey,
      description: input.targetType === 'savings'
        ? `Mi Osusu savings deposit: ${input.targetName}`
        : `Mi Osusu send payment: ${input.targetName}`,
      webhookUrl,
      idempotencyKey: input.idempotencyKey,
      durationSeconds: 600,
      metadata: {
        payment_type: 'send_payment',
        target_type: input.targetType,
        target_id: input.targetId,
        payment_intent_id: input.intentId,
        user_id: input.userId,
      },
    });
  } catch (error) {
    if (mmTxnId) {
      await svc
        .from('mobile_money_transactions')
        .update({ status: 'failed', status_updated_at: new Date().toISOString() })
        .eq('id', mmTxnId);
    }
    throw error;
  }

  if (mmTxnId) {
    await svc
      .from('mobile_money_transactions')
      .update({
        monime_payment_code_id: paymentCode.id,
        provider_reference: paymentCode.id,
        ussd_code: paymentCode.ussdCode || null,
        status: 'processing',
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', mmTxnId);
  }

  return { paymentCode, mmTxnId };
}

/** Replay support: same confirmation key while processing → re-serve the USSD code. */
async function loadProcessingReplay(
  svc: ReturnType<typeof createServiceClient>,
  intent: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const providerReference = intent.provider_reference ? String(intent.provider_reference) : null;
  if (!providerReference) return null;

  const { data: mmTxn } = await svc
    .from('mobile_money_transactions')
    .select('id,ussd_code')
    .eq('monime_payment_code_id', providerReference)
    .maybeSingle();

  return {
    status: 'processing',
    receipt: null,
    providerReference,
    monimePaymentCodeId: providerReference,
    ussdCode: mmTxn?.ussd_code ?? null,
    expiresAt: intent.expires_at ?? null,
    mmTxnId: mmTxn ? String(mmTxn.id) : null,
    paymentType: intent.target_type === 'savings' ? 'savings_deposit' : 'osusu_contribution',
  };
}

async function loadActiveProfile(svc: ReturnType<typeof createServiceClient>, userId: string) {
  const { data, error } = await svc
    .from('profiles')
    .select('id,status,is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return { ok: false, reason: 'Profile not found.', status: 403 };
  if (data.is_active === false || ['suspended', 'banned', 'locked'].includes(String(data.status))) {
    return { ok: false, reason: 'Account is not active.', status: 403 };
  }
  if (!await isKycVerified(userId)) {
    return { ok: false, reason: 'KYC verification is required.', status: 403 };
  }
  return { ok: true, reason: '', status: 200 };
}

async function loadPaymentMethod(svc: ReturnType<typeof createServiceClient>, userId: string, provider: string, methodId: string) {
  const { data, error } = await svc
    .from('linked_payment_methods')
    .select('id,phone_number')
    .eq('id', methodId)
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_verified', true)
    .eq('is_active', true)
    .maybeSingle();
  if (error) console.error('linked_payment_methods lookup failed:', error.message);
  return data as { id: string; phone_number: string } | null;
}

async function markIntentStatus(svc: ReturnType<typeof createServiceClient>, intentId: string, status: string) {
  await svc.from('payment_intents').update({ status, failed_at: new Date().toISOString() }).eq('id', intentId);
}

async function isRateLimited(svc: ReturnType<typeof createServiceClient>, userId: string, action: string, limit: number, seconds: number) {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const { count } = await svc
    .from('rate_limit_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('action', action)
    .gte('created_at', since);

  try {
    const { error: insertError } = await svc.from('rate_limit_log').insert({ user_id: userId, action });
    if (insertError) console.warn('rate_limit_log insert failed:', insertError.message);
  } catch (error) {
    console.warn('rate_limit_log insert threw:', error instanceof Error ? error.message : String(error));
  }
  return (count ?? 0) >= limit;
}

async function audit(svc: ReturnType<typeof createServiceClient>, userId: string, action: string, recordId: string | null, data: Record<string, unknown>) {
  try {
    const { error } = await svc.from('audit_logs').insert({
      actor_id: userId,
      action,
      table_name: 'payment_intents',
      record_id: recordId,
      new_data: data,
    });
    if (error) console.warn('audit_logs insert failed:', error.message);
  } catch (error) {
    console.warn('audit_logs insert threw:', error instanceof Error ? error.message : String(error));
  }
}

function receiptPayload(receipt: Record<string, unknown>) {
  return {
    receiptNumber: receipt.receipt_number,
    transactionId: receipt.transaction_id ?? null,
    paymentIntentId: receipt.payment_intent_id,
    status: receipt.status,
    timestamp: receipt.issued_at,
    amount: Number(receipt.amount),
    currency: receipt.currency ?? 'NLe',
    maskedAccount: receipt.masked_account,
    providerReference: receipt.provider_reference ?? null,
  };
}

function jsonOk(req: Request, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ ...body, success: true, data: body }), {
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function jsonError(req: Request, error: string, status: number, code = 'PAYMENT_ERROR') {
  return new Response(JSON.stringify({ success: false, error, code }), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}
