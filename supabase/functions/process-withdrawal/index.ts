/**
 * process-withdrawal Edge Function
 *
 * Creates a pending withdrawal request from a vault or savings goal.
 * Server-side KYC and balance checks happen in the RPC.
 * Actual payout only occurs after admin approval (approve-withdrawal).
 */

import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';
import { getAuthUser, createUserClient, isKycVerified } from '../_shared/auth.ts';

interface RequestBody {
  savings_goal_id?:      string | null;
  amount:                number;
  currency?:             string;
  payment_method_id?:    string | null;
  idempotency_key?:      string | null;
  transaction_pin?:      string | null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonError('Method not allowed.', 405);

  const authHeader = req.headers.get('Authorization');
  const user = await getAuthUser(authHeader);
  if (!user) return jsonError('Not authenticated.', 401);

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req);
  if (sizeErr) return jsonError(sizeErr, 413);

  let body: RequestBody;
  try {
    body = JSON.parse(rawBody) as RequestBody;
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!Number.isFinite(body.amount) || body.amount <= 0) {
    return jsonError('amount must be a positive number.', 400);
  }
  if (!body.payment_method_id?.trim()) {
    return jsonError('payment_method_id is required.', 400);
  }

  // KYC check (belt-and-suspenders — RPC also checks)
  const kycOk = await isKycVerified(user.id);
  if (!kycOk) return jsonError('KYC verification required before withdrawal.', 403);

  const userClient = createUserClient(authHeader);
  const iKey       = body.idempotency_key ?? crypto.randomUUID();

  const { data: rpcResult, error: rpcErr } = await userClient.rpc('process_withdrawal_request_with_method', {
    p_amount:               body.amount,
    p_payment_method_id:    body.payment_method_id.trim(),
    p_currency:             body.currency ?? 'NLe',
    p_savings_goal_id:      body.savings_goal_id ?? null,
    p_idempotency_key:      iKey,
    p_transaction_pin:      body.transaction_pin,
  });

  if (rpcErr) {
    console.error('process_withdrawal_request_with_method RPC error:', rpcErr.message);
    return jsonError('Could not submit withdrawal request. Please try again.', 500);
  }
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
  const data = body != null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { value: body };
  return new Response(JSON.stringify({ ...data, success: true, data }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonError(msg: string, status = 400, code = 'PAYMENT_ERROR'): Response {
  return new Response(JSON.stringify({ success: false, error: msg, code }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
