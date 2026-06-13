/**
 * initiate-vault-topup Edge Function
 *
 * Flow:
 *   1. Verify caller JWT.
 *   2. Require a verified linked payment method ID.
 *   3. Call initiate_vault_topup_record RPC (KYC, ownership, limits, and idempotency happen there).
 *   4. Create a Monime Payment Code via POST /v1/payment-codes.
 *   5. Store payment_code_id + ussd_code on the topup record.
 *   6. Return ussdCode to frontend; the frontend never decides completion.
 *
 * Security guarantees:
 *   - KYC enforced server-side in RPC.
 *   - Amount validated server-side (never trusted from client).
 *   - Provider credentials only in Deno.env — never returned to frontend.
 *   - Idempotency prevents duplicate payment codes on retry.
 *   - vault-webhook (and only vault-webhook) is the authority on completion.
 */

import { corsHeaders, handleCors, readBoundedBody }    from '../_shared/cors.ts';
import { getAuthUser, createServiceClient, createUserClient } from '../_shared/auth.ts';
import {
  MONIME_PROVIDER_IDS,
  MONIME_SUPPORTED_METHODS,
  createPaymentCode,
} from '../_shared/monime.ts';
import { QMONEY_UNSUPPORTED_MESSAGE } from '../_shared/paymentValidation.ts';
import { ensureProviderKyc } from '../_shared/providerKyc.ts';

const SUPPORTED_METHODS = new Set<string>(MONIME_SUPPORTED_METHODS);

interface RequestBody {
  amount:           number;
  payment_method_id?: string;
  idempotency_key?: string;
  description?:     string | null;
  duration_seconds?: number | null;
  transaction_pin?: string | null;
}

Deno.serve(async (req: Request) => {
  try {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return err('Method not allowed.', 405);

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const user       = await getAuthUser(authHeader);
  if (!user) return err('Not authenticated.', 401);

  // ── 2. Parse + validate ───────────────────────────────────────────────────────
  const { text: rawBody, error: sizeErr } = await readBoundedBody(req);
  if (sizeErr) return err(sizeErr, 413);

  let body: RequestBody;
  try { body = JSON.parse(rawBody) as RequestBody; }
  catch { return err('Invalid JSON body.', 400); }

  if (!Number.isFinite(body.amount) || body.amount <= 0)
    return err('amount must be a positive number.', 400);

  if (!body.payment_method_id) return err('payment_method_id is required.', 400);

  const iKey = body.idempotency_key ?? crypto.randomUUID();

  // ── 3. RPC — creates pending topup record, enforces KYC + rate-limit + idempotency ──
  const userClient = createUserClient(authHeader);
  const { data: rpcData, error: rpcErr } = await userClient.rpc('initiate_vault_topup_record', {
    p_amount:          body.amount,
    p_idempotency_key: iKey,
    p_payment_method_id: body.payment_method_id,
    p_description:     body.description ?? null,
    p_transaction_pin:  body.transaction_pin ?? null,
  });

  if (rpcErr) {
    console.error('initiate_vault_topup_record error:', rpcErr.message);
    return err(rpcErr.message, 500);
  }

  const rpc = rpcData as Record<string, unknown>;
  if (rpc?.error) return err(rpc.error as string, 400);

  const topupId = rpc.topup_id as string;
  const providerMethod = rpc.provider as string;
  if (!SUPPORTED_METHODS.has(providerMethod))
    return err(QMONEY_UNSUPPORTED_MESSAGE, 400);

  const providerId = MONIME_PROVIDER_IDS[providerMethod];
  if (!providerId) return err('No Monime provider ID for linked payment method.', 500);

  const svc = createServiceClient();
  const { data: linkedMethod, error: linkedMethodError } = await svc
    .from('linked_payment_methods')
    .select('phone_number')
    .eq('id', body.payment_method_id)
    .eq('user_id', user.id)
    .eq('provider', providerMethod)
    .eq('is_verified', true)
    .eq('is_active', true)
    .maybeSingle();

  if (linkedMethodError) {
    console.error('linked_payment_methods lookup error:', linkedMethodError.message);
    return err('Linked payment method could not be verified.', 500);
  }
  if (!linkedMethod?.phone_number) {
    return err('Linked payment method could not be verified.', 403);
  }

  // Provider KYC gate (24 h cache, audited, fail-closed). The number must be
  // registered with Orange Money / AfriMoney before a payment code is created.
  const kycGate = await ensureProviderKyc(svc, {
    userId: user.id,
    method: providerMethod,
    phoneNumber: linkedMethod.phone_number,
    flow: 'vault_topup',
  });
  if (!kycGate.ok) {
    console.warn(`initiate-vault-topup: provider KYC blocked | user=${user.id} | provider=${providerMethod} | status=${kycGate.status}`);
    await svc.from('vault_topups')
      .update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: 'provider_kyc_blocked' })
      .eq('id', topupId);
    return err(kycGate.message, kycGate.statusCode);
  }

  // ── 4. If idempotent hit and already has a USSD code, return it ───────────────
  if (rpc.idempotent) {
    const existingUssdCode = rpc.ussd_code as string | null;
    if (existingUssdCode) {
      return ok({
        success:                true,
        topup_id:               topupId,
        monime_payment_code_id: rpc.monime_payment_code_id as string | null,
        ussd_code:              existingUssdCode,
        amount:                 rpc.amount,
        fee:                    rpc.fee,
        total_amount:           rpc.total_amount,
        currency:               rpc.currency,
        provider:               providerMethod,
        masked_phone:           rpc.masked_phone,
        expires_at:             rpc.expires_at,
        status:                 rpc.status,
        idempotent:             true,
      });
    }
  }

  // ── 5. Create Monime Payment Code ────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const webhookUrl  = `${supabaseUrl}/functions/v1/vault-webhook`;

  // Server-authoritative amount: the RPC validated and returned it.
  const confirmedAmount = Number(rpc.amount ?? body.amount);

  let paymentCode: Awaited<ReturnType<typeof createPaymentCode>>;
  try {
    paymentCode = await createPaymentCode({
      amount:          confirmedAmount,
      providerId,
      phoneNumber:     linkedMethod.phone_number,
      reference:       iKey,
      description:     body.description ?? 'Mi Osusu Vault Top-Up',
      webhookUrl,
      idempotencyKey:  iKey,
      durationSeconds: body.duration_seconds ?? 600,
      metadata: {
        payment_type: 'vault_topup',
        topup_id: topupId,
        user_id: user.id,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Monime unavailable';
    console.error('Monime createPaymentCode error:', msg);

    await svc.from('vault_topups')
      .update({ status: 'failed', failed_at: new Date().toISOString() })
      .eq('id', topupId);

    return err('Payment provider unavailable. Please try again.', 502);
  }

  // ── 6. Store payment code ID + USSD code on the topup record ─────────────────
  await svc.from('vault_topups')
    .update({
      monime_payment_code_id: paymentCode.id,
      ussd_code:              paymentCode.ussdCode,
      status:                 'processing',
      expires_at:             paymentCode.expiresAt ?? rpc.expires_at ?? null,
    })
    .eq('id', topupId);

  console.log(`initiate-vault-topup: payment code created | topup=${topupId} | code=${paymentCode.id}`);

  return ok({
    success:                true,
    topup_id:               topupId,
    monime_payment_code_id: paymentCode.id,
    ussd_code:              paymentCode.ussdCode,
    expires_at:             paymentCode.expiresAt,
    amount:                 rpc.amount,
    fee:                    rpc.fee,
    total_amount:           rpc.total_amount,
    currency:               rpc.currency,
    provider:               providerMethod,
    masked_phone:           rpc.masked_phone,
    status:                 'processing',
    idempotent:             false,
  });
  } catch (error) {
    console.error('initiate-vault-topup unhandled error:', error instanceof Error ? error.message : String(error));
    return err('Payment could not be prepared. Please try again.', 500, 'UNEXPECTED_ERROR');
  }
});

function ok(body: unknown): Response {
  const data = body != null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { value: body };
  return new Response(JSON.stringify({ ...data, success: true, data }), {
    status:  200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(msg: string, status = 400, code = 'PAYMENT_ERROR'): Response {
  return new Response(JSON.stringify({ success: false, error: msg, code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
