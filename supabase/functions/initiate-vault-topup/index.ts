/**
 * initiate-vault-topup Edge Function
 *
 * Flow:
 *   1. Verify caller JWT.
 *   2. Validate method — reject QMoney (not confirmed in Monime docs).
 *   3. Call initiate_vault_topup_record RPC (KYC + rate-limit + idempotency checks happen there).
 *   4. Create a Monime Payment Code via POST /v1/payment-codes.
 *   5. Store payment_code_id + ussd_code on the topup record.
 *   6. Return ussdCode to frontend — user dials it; frontend NEVER decides on completion.
 *
 * Security guarantees:
 *   - KYC enforced server-side in RPC.
 *   - Amount validated server-side (never trusted from client).
 *   - Provider credentials only in Deno.env — never returned to frontend.
 *   - Idempotency prevents duplicate payment codes on retry.
 *   - vault-webhook (and only vault-webhook) is the authority on completion.
 */

import { corsHeaders, handleCors }                    from '../_shared/cors.ts';
import { getAuthUser, createServiceClient, createUserClient } from '../_shared/auth.ts';
import {
  MONIME_PROVIDER_IDS,
  MONIME_SUPPORTED_METHODS,
  createPaymentCode,
} from '../_shared/monime.ts';

const SUPPORTED_METHODS = new Set<string>(MONIME_SUPPORTED_METHODS);

interface RequestBody {
  amount:           number;
  method:           string;
  idempotency_key?: string;
  description?:     string | null;
  duration_seconds?: number | null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return err('Method not allowed.', 405);

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const user       = await getAuthUser(authHeader);
  if (!user) return err('Not authenticated.', 401);

  // ── 2. Parse + validate ───────────────────────────────────────────────────────
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return err('Invalid JSON body.', 400); }

  if (!Number.isFinite(body.amount) || body.amount <= 0)
    return err('amount must be a positive number.', 400);

  if (!body.method) return err('method is required.', 400);
  if (body.method === 'qmoney') return err('QMoney is not currently supported. Use orange_money or afrimoney.', 400);
  if (!SUPPORTED_METHODS.has(body.method))
    return err(`Unsupported method: ${body.method}. Use orange_money or afrimoney.`, 400);

  const providerId = MONIME_PROVIDER_IDS[body.method];
  if (!providerId) return err(`No Monime provider ID for method: ${body.method}`, 500);

  const iKey = body.idempotency_key ?? crypto.randomUUID();

  // ── 3. RPC — creates pending topup record, enforces KYC + rate-limit + idempotency ──
  const userClient = createUserClient(authHeader);
  const { data: rpcData, error: rpcErr } = await userClient.rpc('initiate_vault_topup_record', {
    p_amount:          body.amount,
    p_idempotency_key: iKey,
    p_provider_method: body.method,
    p_description:     body.description ?? null,
  });

  if (rpcErr) {
    console.error('initiate_vault_topup_record error:', rpcErr.message);
    return err(rpcErr.message, 500);
  }

  const rpc = rpcData as Record<string, unknown>;
  if (rpc?.error) return err(rpc.error as string, 400);

  const topupId = rpc.topup_id as string;

  // ── 4. If idempotent hit and already has a USSD code, return it ───────────────
  if (rpc.idempotent) {
    const existingUssdCode = rpc.ussd_code as string | null;
    if (existingUssdCode) {
      return ok({
        success:                true,
        topup_id:               topupId,
        monime_payment_code_id: rpc.monime_payment_code_id as string | null,
        ussd_code:              existingUssdCode,
        amount:                 body.amount,
        status:                 rpc.status,
        idempotent:             true,
      });
    }
  }

  // ── 5. Create Monime Payment Code ────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const webhookUrl  = `${supabaseUrl}/functions/v1/vault-webhook`;

  let paymentCode: Awaited<ReturnType<typeof createPaymentCode>>;
  try {
    paymentCode = await createPaymentCode({
      amount:          body.amount,
      providerId,
      reference:       iKey,
      description:     body.description ?? 'Mi Osusu Vault Top-Up',
      webhookUrl,
      idempotencyKey:  iKey,
      durationSeconds: body.duration_seconds ?? 600,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Monime unavailable';
    console.error('Monime createPaymentCode error:', msg);

    const svc = createServiceClient();
    await svc.from('vault_topups')
      .update({ status: 'failed', failed_at: new Date().toISOString() })
      .eq('id', topupId);

    return err('Payment provider unavailable. Please try again.', 502);
  }

  // ── 6. Store payment code ID + USSD code on the topup record ─────────────────
  const svc = createServiceClient();
  await svc.from('vault_topups')
    .update({
      monime_payment_code_id: paymentCode.id,
      ussd_code:              paymentCode.ussdCode,
      status:                 'processing',
    })
    .eq('id', topupId);

  console.log(`initiate-vault-topup: payment code created | topup=${topupId} | code=${paymentCode.id}`);

  return ok({
    success:                true,
    topup_id:               topupId,
    monime_payment_code_id: paymentCode.id,
    ussd_code:              paymentCode.ussdCode,
    expires_at:             paymentCode.expiresAt,
    amount:                 body.amount,
    status:                 'processing',
    idempotent:             false,
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
