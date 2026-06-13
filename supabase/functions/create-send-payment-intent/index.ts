import { handleCors, readBoundedBody, getCorsHeaders } from '../_shared/cors.ts';
import { createServiceClient, getAuthUser, isKycVerified } from '../_shared/auth.ts';

const SUPPORTED_METHODS = new Set(['orange_money', 'afrimoney']);
const TARGET_TYPES = new Set(['group', 'savings']);
const INTENT_TTL_MINUTES = 15;

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

  const action = typeof body.action === 'string' ? body.action : 'create';
  const svc = createServiceClient();

  if (action === 'preview') {
    const intentId = typeof body.payment_intent_id === 'string' ? body.payment_intent_id : '';
    if (!isUuid(intentId)) return jsonError(req, 'Invalid payment_intent_id.', 400);

    const { data: intent, error } = await svc
      .from('payment_intents')
      .select('id,user_id,target_type,target_id,target_name,amount,currency,method,masked_account,status,expires_at')
      .eq('id', intentId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) return jsonError(req, 'Could not load payment intent.', 500);
    if (!intent) return jsonError(req, 'Payment intent not found.', 404);
    return jsonOk(req, preview(intent));
  }

  const targetType = typeof body.target_type === 'string' ? body.target_type : '';
  const targetId = typeof body.target_id === 'string' ? body.target_id : '';
  const method = typeof body.method === 'string' ? body.method : '';
  const requestedAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);

  if (!TARGET_TYPES.has(targetType)) return jsonError(req, 'Invalid target type.', 400);
  if (!isUuid(targetId)) return jsonError(req, 'Invalid target ID.', 400);
  if (!SUPPORTED_METHODS.has(method)) return jsonError(req, 'Unsupported payment method.', 400);
  if (targetType === 'savings' && (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 1_000_000)) {
    return jsonError(req, 'Invalid savings amount.', 400);
  }

  const profile = await loadActiveProfile(svc, user.id);
  if (!profile.ok) {
    await audit(svc, user.id, 'payment_intent_create_rejected', null, { reason: profile.reason });
    return jsonError(req, profile.reason, profile.status);
  }

  const rateLimited = await isRateLimited(svc, user.id, 'create_send_payment_intent', 8, 60);
  if (rateLimited) {
    await audit(svc, user.id, 'payment_intent_rate_limited', null, { target_type: targetType });
    return jsonError(req, 'Too many payment attempts. Please wait and try again.', 429);
  }

  const methodRow = await loadPaymentMethod(svc, user.id, method);
  if (!methodRow) {
    await audit(svc, user.id, 'payment_intent_unlinked_method', null, { method });
    return jsonError(req, 'Payment method is not linked or verified.', 403);
  }

  const target = targetType === 'group'
    ? await resolveGroupTarget(svc, user.id, targetId)
    : await resolveSavingsTarget(svc, user.id, targetId, requestedAmount);

  if (!target.ok) {
    await audit(svc, user.id, 'payment_intent_unauthorized_target', null, { target_type: targetType, target_id: targetId, reason: target.reason });
    return jsonError(req, target.reason, target.status);
  }

  const reference = `SND-${crypto.randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`;
  const idempotencyKey = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60 * 1000).toISOString();

  const { data: intent, error: insertError } = await svc
    .from('payment_intents')
    .insert({
      user_id: user.id,
      target_type: targetType,
      target_id: targetId,
      target_name: target.name,
      amount: target.amount,
      currency: 'NLe',
      method,
      payment_method_id: methodRow.id,
      masked_account: methodRow.masked_number,
      status: 'pending',
      reference,
      idempotency_key: idempotencyKey,
      expires_at: expiresAt,
      metadata: { source: 'send_flow' },
    })
    .select('id,user_id,target_type,target_id,target_name,amount,currency,method,masked_account,status,expires_at')
    .single();

  if (insertError) {
    console.error('payment_intents insert failed:', insertError.message);
    return jsonError(req, 'Could not create payment intent.', 500);
  }

  await audit(svc, user.id, 'payment_intent_created', intent.id, {
    target_type: targetType,
    target_id: targetId,
    amount: target.amount,
    method,
  });

  return jsonOk(req, preview(intent));
  } catch (error) {
    console.error('create-send-payment-intent unhandled error:', error instanceof Error ? error.message : String(error));
    return jsonError(req, 'We could not prepare your payment. Please try again shortly.', 500, 'UNEXPECTED_ERROR');
  }
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function loadPaymentMethod(svc: ReturnType<typeof createServiceClient>, userId: string, provider: string) {
  const { data, error } = await svc
    .from('linked_payment_methods')
    .select('id,masked_number')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('is_verified', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) console.error('linked_payment_methods lookup failed:', error.message);
  return data as { id: string; masked_number: string } | null;
}

async function resolveGroupTarget(svc: ReturnType<typeof createServiceClient>, userId: string, groupId: string) {
  const { data: membership, error: memberError } = await svc
    .from('osusu_group_members')
    .select('group_id,is_active')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  if (memberError || !membership) return { ok: false, reason: 'You are not authorized for this group.', status: 403 };

  const { data: group, error } = await svc
    .from('osusu_groups')
    .select('id,name,contribution_amount,status')
    .eq('id', groupId)
    .maybeSingle();
  if (error || !group) return { ok: false, reason: 'Group not found.', status: 404 };
  if (String(group.status) !== 'active') return { ok: false, reason: 'Group is not accepting payments.', status: 400 };

  const amount = Number(group.contribution_amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Group contribution amount is invalid.', status: 500 };
  return { ok: true, name: String(group.name), amount };
}

async function resolveSavingsTarget(svc: ReturnType<typeof createServiceClient>, userId: string, goalId: string, amount: number) {
  const { data: goal, error } = await svc
    .from('savings_goals')
    .select('id,title,status,is_active,user_id')
    .eq('id', goalId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !goal) return { ok: false, reason: 'You are not authorized for this savings goal.', status: 403 };
  if (String(goal.status) !== 'active' && goal.is_active !== true) return { ok: false, reason: 'Savings goal is not active.', status: 400 };
  return { ok: true, name: String(goal.title), amount };
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

function preview(intent: Record<string, unknown>) {
  return {
    paymentIntentId: intent.id,
    status: intent.status,
    targetType: intent.target_type,
    targetId: intent.target_id,
    targetName: intent.target_name,
    amount: Number(intent.amount),
    currency: intent.currency ?? 'NLe',
    method: intent.method,
    maskedAccount: intent.masked_account,
    expiresAt: intent.expires_at,
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
