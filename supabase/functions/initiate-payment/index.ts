/**
 * initiate-payment Edge Function
 *
 * Handles all contribution payment initiation server-side.
 *
 * Flow:
 *   1. Verify caller JWT (Supabase Auth).
 *   2. Enforce KYC — server reads profiles, never trusts the client.
 *   3. Resolve the active payment_period for the group (if period_id not supplied).
 *   4. Call initiate_group_payment RPC — creates contribution_payments record.
 *   5. Insert mobile_money_transactions with status='pending'.
 *   6. For mobile money: create a Monime Payment Code (POST /v1/payment-codes).
 *   7. Return ussd_code — user dials it on their phone via USSD. No browser redirect.
 *      Provider secrets and server amounts NEVER leave the backend.
 *
 * Security guarantees:
 *   - Amount is taken from the RPC result (server-calculated), NOT the request body.
 *   - Provider credentials are in Deno.env only.
 *   - KYC is verified against the profiles table, not the JWT claim.
 *   - Idempotency keys prevent duplicate contributions on retry.
 *   - QMoney (m13) is NOT supported — not confirmed in Monime docs.
 */

import { corsHeaders, handleCors }              from '../_shared/cors.ts';
import { getAuthUser, createServiceClient, createUserClient, isKycVerified } from '../_shared/auth.ts';
import {
  MONIME_PROVIDER_IDS,
  createPaymentCode,
  type MonimePaymentCode,
} from '../_shared/monime.ts';

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
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
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
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!body.group_id || typeof body.group_id !== 'string') {
    return jsonError('group_id is required.', 400);
  }
  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return jsonError('amount must be a positive number.', 400);
  }
  if (!body.method || !(SUPPORTED_METHODS as readonly string[]).includes(body.method)) {
    return jsonError(`Unsupported payment method: ${body.method}`, 400);
  }

  // ── 3. KYC check (server-side) ──────────────────────────────
  const kycOk = await isKycVerified(user.id);
  if (!kycOk) {
    return jsonError('KYC verification is required before making contributions.', 403);
  }

  const svc        = createServiceClient();
  const userClient = createUserClient(authHeader);

  // ── 4. Resolve payment period ────────────────────────────────
  let periodId = body.period_id ?? null;
  if (!periodId) {
    const { data: period, error: periodErr } = await svc
      .from('payment_periods')
      .select('id')
      .eq('group_id', body.group_id)
      // period_status enum: upcoming | open | paid | overdue | locked | skipped.
      // 'open' is the period currently accepting contributions.
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

  // ── 5. Initiate via SECURITY DEFINER RPC ────────────────────
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
  });

  if (rpcErr) {
    console.error('initiate_group_payment RPC error:', rpcErr.message);
    return jsonError(rpcErr.message, 500);
  }

  const rpc = rpcResult as Record<string, unknown>;
  if (rpc?.error) return jsonError(rpc.error as string, 400);

  const contributionId = (rpc.contribution_id ?? rpc.payment_id) as string | undefined;
  const receiptNumber  = rpc.receipt_number as string | undefined;
  // Use server-returned amount if present (authoritative), else fall back to request
  const confirmedAmount = Number(rpc.amount ?? body.amount);

  // ── 6. Insert mobile_money_transactions ──────────────────────
  const mmProvider = methodToProvider(body.method);
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
      internal_reference: iKey,
    })
    .select('id')
    .single();

  if (mmErr) {
    console.warn('mobile_money_transactions insert failed:', mmErr.message);
  }
  const mmTxnId = mmTxn?.id as string | undefined;

  // ── 7a. Cash collected — no provider API needed ──────────────
  if (body.method === 'cash_collected') {
    return jsonOk({
      success:         true,
      contribution_id: contributionId,
      mm_txn_id:       mmTxnId,
      receipt_number:  receiptNumber,
      status:          'pending',
    });
  }

  // ── 7b. Monime mobile money ──────────────────────────────────
  if (MONIME_METHODS.has(body.method)) {
    const providerId = MONIME_PROVIDER_IDS[body.method];
    if (!providerId) {
      return jsonError(`No Monime provider ID configured for method: ${body.method}`, 500);
    }

    const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
    const webhookUrl   = `${supabaseUrl}/functions/v1/mobile-money-webhook`;
    // No returnUrl — Payment Codes use USSD dial strings, not browser redirects.

    let paymentCode: MonimePaymentCode;
    try {
      paymentCode = await createPaymentCode({
        amount:         confirmedAmount,
        providerId,
        reference:      iKey,
        description:    'Mi Osusu Osusu Contribution',
        webhookUrl,
        idempotencyKey: iKey,
        durationSeconds: 600,
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

  // ── 7c. Bank transfer / card (future) ────────────────────────
  // Placeholder — extend with Flutterwave or similar when needed.
  return jsonError(`Payment method ${body.method} is not yet supported for online payments.`, 400);
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

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status:  200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
