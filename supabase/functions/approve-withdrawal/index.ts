/**
 * approve-withdrawal Edge Function
 *
 * Admin-only endpoint. Verifies super_admin or org_admin role server-side,
 * calls approve_withdrawal_request RPC (debits vault, marks approved),
 * then initiates the provider payout disbursement via Monime Payouts API.
 *
 * Provider routing:
 *   orange_money  → Monime Payouts API (POST /v1/payouts, providerId=m17)
 *   afrimoney     → Monime Payouts API (POST /v1/payouts, providerId=m18)
 *   qmoney        → NOT confirmed in Monime docs — returns error, requires manual disbursement
 *   bank_transfer → Flutterwave Transfer API (fallback, separate credentials)
 *
 * Security guarantees:
 *   - Admin role verified from DB, never trusted from client.
 *   - withdrawal_id is the only input; all amounts/destinations come from the DB record.
 *   - Provider secrets only in Deno.env — never returned to client.
 *   - Payout result recorded via record_monime_payout_result SECURITY DEFINER RPC.
 */

import { corsHeaders, handleCors }                    from '../_shared/cors.ts';
import { getAuthUser, createServiceClient, createUserClient } from '../_shared/auth.ts';
import {
  MONIME_PROVIDER_IDS,
  createMonimePayout,
  getMonimePayout,
} from '../_shared/monime.ts';

interface RequestBody {
  withdrawal_id: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return err('Method not allowed.', 405);

  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  const user       = await getAuthUser(authHeader);
  if (!user) return err('Not authenticated.', 401);

  // ── 2. Admin role check (from DB — never trust client) ───────────────────────
  const svc  = createServiceClient();
  const role = await getDbRole(svc, user.id);
  if (role !== 'super_admin' && role !== 'org_admin') return err('Admin access required.', 403);

  // ── 3. Parse body ─────────────────────────────────────────────────────────────
  let body: RequestBody;
  try { body = await req.json(); }
  catch { return err('Invalid JSON body.', 400); }
  if (!body.withdrawal_id) return err('withdrawal_id is required.', 400);

  // ── 4. Approve via SECURITY DEFINER RPC ──────────────────────────────────────
  const { data: approveResult, error: approveErr } = await svc.rpc('approve_withdrawal_request', {
    p_withdrawal_id: body.withdrawal_id,
    p_reviewer_id:   user.id,
  });

  if (approveErr) return err(approveErr.message, 500);
  const result = approveResult as Record<string, unknown>;
  if (result?.error) return err(result.error as string, 400);

  const destProvider  = result.destination_provider as string;
  const destPhone     = result.destination_number   as string;
  const amount        = result.amount as number;
  const withdrawalUserId = result.user_id as string;
  const iKey          = body.withdrawal_id; // use withdrawal_id as stable idempotency key

  // ── 5. Initiate payout via Monime or Flutterwave ──────────────────────────────
  let monimePayoutId: string | null = null;
  let payoutStatus:   string        = 'pending';
  let payoutError:    string | null = null;

  try {
    const payoutResult = await initiateProviderPayout({
      provider: destProvider,
      phone:    destPhone,
      amount,
      ref:      iKey,
    });
    monimePayoutId = payoutResult.payoutId;
    payoutStatus   = payoutResult.status;
  } catch (e) {
    payoutError = e instanceof Error ? e.message : 'Payout provider error';
    console.error(`approve-withdrawal: payout error for ${body.withdrawal_id}:`, payoutError);
  }

  // ── 6. Record payout result via SECURITY DEFINER RPC ─────────────────────────
  if (monimePayoutId || payoutError) {
    const { error: recordErr } = await svc.rpc('record_monime_payout_result', {
      p_withdrawal_id:   body.withdrawal_id,
      p_monime_payout_id: monimePayoutId,
      p_status:          payoutError ? 'failed' : payoutStatus,
      p_failure_code:    null,
      p_failure_msg:     payoutError,
    });
    if (recordErr) console.error('record_monime_payout_result error:', recordErr.message);
  }

  // ── 7. Record outbound mobile_money_transaction for audit ─────────────────────
  if (monimePayoutId) {
    await svc.from('mobile_money_transactions').insert({
      user_id:            withdrawalUserId,
      withdrawal_id:      body.withdrawal_id,
      provider:           destProvider,
      direction:          'outbound',
      amount,
      currency:           'NLe',
      status:             payoutStatus === 'completed' ? 'completed' : 'processing',
      monime_payment_code_id: monimePayoutId,
    }).then(({ error: e }) => { if (e) console.warn('mm_txn outbound insert:', e.message); });
  }

  // ── 8. Notify user (non-blocking) ────────────────────────────────────────────
  const notifUrl   = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (notifUrl && serviceKey && withdrawalUserId) {
    fetch(notifUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: withdrawalUserId,
        type:    'withdrawal_approved',
        title:   'Withdrawal Approved',
        body:    `Your withdrawal of NLe ${Number(amount).toFixed(2)} has been approved and is being processed.`,
        data:    { withdrawal_id: body.withdrawal_id },
      }),
    }).catch((e) => console.warn('Notification dispatch failed:', e));
  }

  return ok({
    success:          true,
    monime_payout_id: monimePayoutId,
    payout_status:    monimePayoutId ? payoutStatus : 'manual_required',
    message:          monimePayoutId
      ? 'Withdrawal approved and payout initiated.'
      : `Withdrawal approved. Payout must be completed manually via provider dashboard. Error: ${payoutError ?? 'unknown'}`,
  });
});

// ── Provider routing ──────────────────────────────────────────────────────────

async function initiateProviderPayout(params: {
  provider: string;
  phone:    string;
  amount:   number;
  ref:      string;
}): Promise<{ payoutId: string; status: string }> {
  const { provider, phone, amount, ref } = params;

  if (provider === 'orange_money' || provider === 'afrimoney') {
    const providerId = MONIME_PROVIDER_IDS[provider];
    if (!providerId) throw new Error(`No Monime provider ID for ${provider}`);

    const payout = await createMonimePayout({
      amount,
      providerId,
      phoneNumber:    phone,
      reference:      ref,
      description:    'Mi Osusu withdrawal payout',
      idempotencyKey: ref,
    });

    return { payoutId: payout.id, status: payout.status };
  }

  if (provider === 'qmoney') {
    // QMoney (m13) is NOT confirmed in the Monime API docs.
    // Disbursement must be handled manually via the provider's dashboard.
    throw new Error('QMoney payouts are not currently supported via Monime. Please disburse manually.');
  }

  if (provider === 'bank_transfer') {
    return initFlutterwaveTransfer({ phone, amount, ref });
  }

  throw new Error(`Unsupported payout provider: ${provider}`);
}

async function initFlutterwaveTransfer(params: {
  phone:  string;
  amount: number;
  ref:    string;
}): Promise<{ payoutId: string; status: string }> {
  const secretKey = Deno.env.get('FLUTTERWAVE_SECRET_KEY');
  if (!secretKey) throw new Error('Flutterwave secret key not configured.');

  const resp = await fetch('https://api.flutterwave.com/v3/transfers', {
    method:  'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_bank:   '999',
      account_number: params.phone,
      amount:         params.amount,
      currency:       'SLL',
      reference:      params.ref,
      narration:      'Mi Osusu withdrawal',
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Flutterwave transfer error (HTTP ${resp.status}): ${errText}`);
  }

  const data = await resp.json() as Record<string, unknown>;
  const d    = data.data as Record<string, unknown> | undefined;
  return {
    payoutId: (d?.reference as string) ?? params.ref,
    status:   (d?.status as string) ?? 'processing',
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getDbRole(
  svc:    ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<string | null> {
  const [roleResult, profileResult] = await Promise.all([
    svc.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    svc.from('profiles').select('is_active').eq('id', userId).maybeSingle(),
  ]);
  if (!roleResult.data) return null;
  if (profileResult.data?.is_active === false) return null;
  return roleResult.data.role as string;
}

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
