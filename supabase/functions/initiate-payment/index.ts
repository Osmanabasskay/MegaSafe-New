/**
 * initiate-payment Edge Function
 *
 * Handles all contribution payment initiation server-side.
 *
 * Flow:
 *   1. Verify caller JWT (Supabase Auth).
 *   2. Enforce KYC — server reads profiles, never trusts the client.
 *   3. For mobile money: validate provider (m17/m18 only) + Provider KYC
 *      (24 h cache) BEFORE creating any records — unregistered numbers and
 *      QMoney never reach Monime.
 *   4. Resolve the active payment_period for the group (if period_id not supplied).
 *   5. Call initiate_group_payment RPC — creates contribution_payments record.
 *   6. Insert mobile_money_transactions with status='pending'.
 *   7. Create a Monime Payment Code (POST /v1/payment-codes).
 *   8. Return ussd_code — user dials it on their phone via USSD.
 *
 * Security guarantees:
 *   - Amount is taken from the RPC result (server-calculated), NOT the request body.
 *   - Provider credentials are in Deno.env only.
 *   - KYC is verified against the profiles table, not the JWT claim.
 *   - Idempotency keys prevent duplicate contributions on retry.
 *   - QMoney (m13) is NOT supported — clear user-facing rejection.
 *   - Completion is webhook-only (mobile-money-webhook); this function never
 *     marks anything completed.
 */

import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';
import { getAuthUser, createServiceClient, createUserClient, isKycVerified } from '../_shared/auth.ts';
import {
  createPaymentCode,
  type MonimePaymentCode,
} from '../_shared/monime.ts';
import { validateMonimeMethod, QMONEY_UNSUPPORTED_MESSAGE } from '../_shared/paymentValidation.ts';
import { ensureProviderKyc } from '../_shared/providerKyc.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

const MONIME_METHODS = new Set(['orange_money', 'afrimoney']); // qmoney not confirmed in Monime docs

const SUPPORTED_METHODS = [
  'orange_money',
  'afrimoney',
  // qmoney intentionally excluded — not confirmed in Monime docs
  'bank_transfer',
  'card',
  'cash_collected',
] as const;

type Method = typeof SUPPORTED_METHODS[number];

interface RequestBody {
  group_id:         string;
  amount:           number;
  method:           Method;
  period_id?:       string | null;
  idempotency_key?: string | null;
  notes?:           string | null;
  /** Optional: phone number pre-fills the Monime checkout form */
  phone_number?:    string | null;
  transaction_pin?: string | null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return jsonError('Method not allowed.', 405);
  }

  // ── 1. Authentication ────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const user       = await getAuthUser(authHeader);
  if (!user) return jsonError('Not authenticated.', 401);

  // ── 2. Parse + validate request ─────────────────────────────
  const { text: rawBody, error: sizeErr } = await readBoundedBody(req);
  if (sizeErr) return jsonError(sizeErr, 413);

  let body: RequestBody;
  try {
    body = JSON.parse(rawBody) as RequestBody;
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!body.group_id || typeof body.group_id !== 'string') {
    return jsonError('group_id is required.', 400);
  }
  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return jsonError('amount must be a positive number.', 400);
  }
  if (String(body.method).toLowerCase() === 'qmoney') {
    return jsonError(QMONEY_UNSUPPORTED_MESSAGE, 400);
  }
  if (!body.method || !(SUPPORTED_METHODS as readonly string[]).includes(body.method)) {
    return jsonError(QMONEY_UNSUPPORTED_MESSAGE, 400);
  }

  // ── 3. KYC check (server-side) ──────────────────────────────
  const kycOk = await isKycVerified(user.id);
  if (!kycOk) {
    return jsonError('KYC verification is required before making contributions.', 403);
  }

  const svc        = createServiceClient();
  const userClient = createUserClient(authHeader);

  // ── 4. Mobile-money pre-flight: linked method + Provider KYC ──
  //    Runs BEFORE any record is created so blocked numbers leave no
  //    dangling pending contributions.
  let linkedPhone: string | null = null;
  let monimeProviderId: string | null = null;
  if (MONIME_METHODS.has(body.method)) {
    const provider = validateMonimeMethod(body.method);
    if (!provider.ok) return jsonError(provider.message, 400);
    monimeProviderId = provider.providerId;

    const linkedMethod = await loadVerifiedLinkedMethod(svc, user.id, body.method);
    if (!linkedMethod?.phone_number) {
      return jsonError('A verified linked payment method is required before creating a payment code.', 403);
    }
    linkedPhone = linkedMethod.phone_number;

    const kycGate = await ensureProviderKyc(svc, {
      userId: user.id,
      method: provider.method,
      phoneNumber: linkedPhone,
      flow: 'initiate_payment',
    });
    if (!kycGate.ok) {
      console.warn(`initiate-payment: provider KYC blocked | user=${user.id} | provider=${body.method} | status=${kycGate.status}`);
      return jsonError(kycGate.message, kycGate.statusCode);
    }
  }

  // ── 5. Resolve payment period ────────────────────────────────
  let periodId = body.period_id ?? null;
  if (!periodId) {
    const { data: period, error: periodErr } = await svc
      .from('payment_periods')
      .select('id')
      .eq('group_id', body.group_id)
      // period_status enum: upcoming | open | paid | overdue | locked | skipped.
      .eq('status', 'open')
      .order('due_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (periodErr) {
      console.error('payment_periods lookup error:', periodErr.message);
      return jsonError('Could not load payment periods.', 500);
    }
    if (!period) {
      return jsonError(
        'No open payment period found for this group. Contact your group admin.',
        400,
      );
    }
    periodId = period.id as string;
  }

  // ── 6. Initiate via SECURITY DEFINER RPC ────────────────────
  //    Amount validation happens inside the RPC — the frontend amount
  //    is passed here but the RPC re-validates against the group's
  //    expected contribution amount.
  const iKey = body.idempotency_key ?? crypto.randomUUID();

  const { data: rpcResult, error: rpcErr } = await userClient.rpc('initiate_group_payment', {
    p_group_id:        body.group_id,
    p_member_id:       user.id,
    p_period_id:       periodId,
    p_amount:          body.amount,
    p_payment_method:  body.method === 'cash_collected' ? 'cash' : body.method,
    p_idempotency_key: iKey,
    p_notes:           body.notes ?? null,
    p_transaction_pin: body.transaction_pin ?? null,
  });

  if (rpcErr) {
    console.error('initiate_group_payment RPC error:', rpcErr.message);
    return jsonError('Could not process payment. Please try again.', 500);
  }

  const rpc = rpcResult as Record<string, unknown>;
  if (rpc?.error) return jsonError(rpc.error as string, 400);

  const contributionId = (rpc.contribution_id ?? rpc.payment_id) as string | undefined;
  const receiptNumber  = rpc.receipt_number as string | undefined;

  // Amount MUST come from the RPC result (server-authoritative). If the RPC does not
  // return an amount it means the group amount could not be validated — fail the request
  // rather than fall back to the client-supplied value, which is untrusted input.
  if (rpc.amount == null) {
    console.error('initiate-payment: RPC did not return amount — cannot proceed with server-authoritative amount');
    return jsonError('Payment could not be verified. Please try again.', 500);
  }
  const confirmedAmount = Number(rpc.amount);

  // ── 7. Insert mobile_money_transactions ──────────────────────
  const mmProvider = methodToProvider(body.method);
  let mmTxnId: string | undefined;
  const { data: mmTxn, error: mmErr } = await svc
    .from('mobile_money_transactions')
    .insert({
      user_id:            user.id,
      payment_id:         contributionId ?? null,
      provider:           mmProvider,
      direction:          'inbound',
      amount:             confirmedAmount,
      currency:           'NLe',
      status:             'pending',
      phone_number:       linkedPhone,
      internal_reference: iKey,
      provider_reference: `PEND-${iKey}`,
    })
    .select('id')
    .single();

  if (mmErr?.code === '23505') {
    // Retry with the same idempotency key — reuse the existing transaction row.
    const { data: existing } = await svc
      .from('mobile_money_transactions')
      .select('id')
      .eq('internal_reference', iKey)
      .maybeSingle();
    mmTxnId = existing?.id as string | undefined;
  } else if (mmErr) {
    console.warn('mobile_money_transactions insert failed:', mmErr.message);
  } else {
    mmTxnId = mmTxn?.id as string | undefined;
  }

  // ── 8a. Cash collected — no provider API needed ──────────────
  if (body.method === 'cash_collected') {
    return jsonOk({
      success:         true,
      contribution_id: contributionId,
      mm_txn_id:       mmTxnId,
      receipt_number:  receiptNumber,
      status:          'pending',
    });
  }

  // ── 8b. Monime mobile money ──────────────────────────────────
  if (MONIME_METHODS.has(body.method) && monimeProviderId && linkedPhone) {
    const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
    const webhookUrl   = `${supabaseUrl}/functions/v1/mobile-money-webhook`;
    // No returnUrl — Payment Codes use USSD dial strings, not browser redirects.

    let paymentCode: MonimePaymentCode;
    try {
      paymentCode = await createPaymentCode({
        amount:         confirmedAmount,
        providerId:     monimeProviderId,
        phoneNumber:    linkedPhone,
        reference:      iKey,
        description:    'Mi Osusu Osusu Contribution',
        webhookUrl,
        idempotencyKey: iKey,
        durationSeconds: 600,
        metadata: {
          payment_type: 'osusu_contribution',
          contribution_id: contributionId ?? '',
          mm_txn_id: mmTxnId ?? '',
          user_id: user.id,
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Monime unavailable';
      console.error('Monime createPaymentCode error:', errMsg);

      if (mmTxnId) {
        await svc.from('mobile_money_transactions')
          .update({ status: 'failed', status_updated_at: new Date().toISOString() })
          .eq('id', mmTxnId);
      }
      if (contributionId) {
        await svc.from('contribution_payments')
          .update({ status: 'failed' })
          .eq('id', contributionId);
      }

      return jsonError('Payment provider unavailable. Please try again.', 502);
    }

    // Store the payment code ID for webhook lookups
    if (mmTxnId) {
      await svc.from('mobile_money_transactions')
        .update({
          monime_payment_code_id: paymentCode.id,
          provider_reference:     paymentCode.id,
          ussd_code:              paymentCode.ussdCode || null,
          status:                 'processing',
          status_updated_at:      new Date().toISOString(),
        })
        .eq('id', mmTxnId);
    }

    return jsonOk({
      success:                true,
      contribution_id:        contributionId,
      mm_txn_id:              mmTxnId,
      monime_payment_code_id: paymentCode.id,
      ussd_code:              paymentCode.ussdCode,
      expires_at:             paymentCode.expiresAt,
      receipt_number:         receiptNumber,
      status:                 'processing',
    });
  }

  // ── 8c. Bank transfer / card (future) ────────────────────────
  // Placeholder — extend with Flutterwave or similar when needed.
  return jsonError(`Payment method ${body.method} is not yet supported for online payments.`, 400);
  } catch (error) {
    console.error('initiate-payment unhandled error:', error instanceof Error ? error.message : String(error));
    return jsonError('Payment could not be prepared. Please try again.', 500, 'UNEXPECTED_ERROR');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function methodToProvider(method: Method): string {
  switch (method) {
    case 'orange_money':   return 'orange_money';
    case 'afrimoney':      return 'afrimoney';
    case 'cash_collected': return 'cash';
    case 'bank_transfer':
    case 'card':           return 'bank_transfer';
    default:               return method;
  }
}

async function loadVerifiedLinkedMethod(
  svc: ReturnType<typeof createServiceClient>,
  userId: string,
  provider: string,
): Promise<{ phone_number: string } | null> {
  const { data, error } = await svc
    .from('linked_payment_methods')
    .select('phone_number')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_verified', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('linked_payment_methods lookup failed:', error.message);
    return null;
  }
  return data as { phone_number: string } | null;
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
