/**
 * process-withdrawal Edge Function
 *
 * Creates a pending withdrawal request from a vault or savings goal.
 * Server-side KYC and balance checks happen in the RPC.
 * Actual payout only occurs after admin approval (approve-withdrawal).
 */

import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getAuthUser, createUserClient, isKycVerified } from '../_shared/auth.ts';

const SUPPORTED_PROVIDERS = ['orange_money', 'afrimoney', 'qmoney', 'bank_transfer'] as const;
type Provider = typeof SUPPORTED_PROVIDERS[number];

interface RequestBody {
  savings_goal_id?:      string | null;
  amount:                number;
  currency?:             string;
  destination_provider:  Provider;
  destination_number:    string;
  idempotency_key?:      string | null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonError('Method not allowed.', 405);

  const authHeader = req.headers.get('Authorization');
  const user = await getAuthUser(authHeader);
  if (!user) return jsonError('Not authenticated.', 401);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return jsonError('amount must be a positive number.', 400);
  }
  if (!body.destination_provider || !SUPPORTED_PROVIDERS.includes(body.destination_provider)) {
    return jsonError('Invalid destination_provider.', 400);
  }
  if (!body.destination_number?.trim()) {
    return jsonError('destination_number is required.', 400);
  }

  // KYC check (belt-and-suspenders — RPC also checks)
  const kycOk = await isKycVerified(user.id);
  if (!kycOk) return jsonError('KYC verification required before withdrawal.', 403);

  const userClient = createUserClient(authHeader);
  const iKey       = body.idempotency_key ?? crypto.randomUUID();

  const { data: rpcResult, error: rpcErr } = await userClient.rpc('process_withdrawal_request', {
    p_amount:               body.amount,
    p_destination_provider: body.destination_provider,
    p_destination_number:   body.destination_number.trim(),
    p_currency:             body.currency ?? 'NLe',
    p_savings_goal_id:      body.savings_goal_id ?? null,
    p_idempotency_key:      iKey,
  });

  if (rpcErr) return jsonError(rpcErr.message, 500);
  const result = rpcResult as Record<string, unknown>;
  if (result?.error) return jsonError(result.error as string, 400);

  return jsonOk({
    success:       true,
    withdrawal_id: result.withdrawal_id,
    idempotent:    result.idempotent ?? false,
    message:       'Withdrawal request submitted and is pending admin approval.',
  });
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
