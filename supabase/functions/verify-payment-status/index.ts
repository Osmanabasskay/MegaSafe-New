/**
 * verify-payment-status Edge Function
 *
 * Polls the payment provider for the current status of a transaction.
 * Used by the app when the user is waiting for a payment to settle.
 * The provider API keys are never sent to the client.
 */

import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getAuthUser, createServiceClient } from '../_shared/auth.ts';

interface RequestBody {
  mm_txn_id?:    string | null;
  provider_ref?: string | null;
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

  if (!body.mm_txn_id && !body.provider_ref) {
    return jsonError('mm_txn_id or provider_ref is required.', 400);
  }

  const svc = createServiceClient();

  // ── Fetch transaction (verify caller owns it) ────────────────
  let query = svc
    .from('mobile_money_transactions')
    .select('id, user_id, payment_id, provider, provider_reference, status, amount');

  if (body.mm_txn_id) {
    query = query.eq('id', body.mm_txn_id);
  } else {
    query = query.eq('provider_reference', body.provider_ref!);
  }

  const { data: mmTxn, error: mmErr } = await query.maybeSingle();
  if (mmErr) return jsonError('Lookup failed: ' + mmErr.message, 500);
  if (!mmTxn) return jsonError('Transaction not found.', 404);

  const txn = mmTxn as Record<string, unknown>;
  if (txn.user_id !== user.id) return jsonError('Not authorized.', 403);

  const currentStatus = txn.status as string;
  const providerRef   = txn.provider_reference as string | null;
  const provider      = txn.provider as string;

  // Return cached status if already final
  if (currentStatus === 'completed' || currentStatus === 'failed') {
    return jsonOk({
      status:          currentStatus,
      contribution_id: txn.payment_id,
      amount:          txn.amount,
    });
  }

  if (!providerRef) {
    return jsonOk({ status: 'pending', contribution_id: txn.payment_id, amount: txn.amount });
  }

  // ── Poll provider ────────────────────────────────────────────
  let liveStatus = 'pending';
  try {
    liveStatus = await pollProvider(provider, providerRef);
  } catch (err) {
    console.warn('Provider poll error:', err instanceof Error ? err.message : err);
  }

  if (liveStatus === 'completed' || liveStatus === 'successful') {
    await svc.rpc('finalize_verified_payment', {
      p_mm_txn_id: txn.id,
      p_webhook_payload: null,
    }).then(({ error }) => { if (error) console.warn('finalize error:', error.message); });

    return jsonOk({ status: 'completed', contribution_id: txn.payment_id, amount: txn.amount });
  }

  if (liveStatus === 'failed' || liveStatus === 'cancelled') {
    await svc.rpc('fail_payment_by_reference', { p_provider_reference: providerRef })
      .then(({ error }) => { if (error) console.warn('fail_payment error:', error.message); });

    return jsonOk({ status: 'failed', contribution_id: txn.payment_id, amount: txn.amount });
  }

  return jsonOk({ status: 'pending', contribution_id: txn.payment_id, amount: txn.amount });
});

async function pollProvider(provider: string, ref: string): Promise<string> {
  switch (provider) {
    case 'orange_money': {
      const key     = Deno.env.get('ORANGE_MONEY_API_KEY');
      const baseUrl = Deno.env.get('ORANGE_MONEY_BASE_URL') ?? 'https://api.orange.com/orange-money-webpay/sl/v1';
      if (!key) return 'pending';
      const r = await fetch(`${baseUrl}/webpayment/${encodeURIComponent(ref)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) return 'pending';
      const d = await r.json() as Record<string, unknown>;
      if (d.status === '60000' || d.status === 'SUCCESS') return 'completed';
      if (d.status === 'FAILED') return 'failed';
      return 'pending';
    }

    case 'afrimoney': {
      const key     = Deno.env.get('AFRIMONEY_API_KEY');
      const baseUrl = Deno.env.get('AFRIMONEY_BASE_URL') ?? 'https://api.afrimoney.sl/v1';
      if (!key) return 'pending';
      const r = await fetch(`${baseUrl}/payments/${encodeURIComponent(ref)}`, {
        headers: { 'X-API-Key': key },
      });
      if (!r.ok) return 'pending';
      const d = await r.json() as Record<string, unknown>;
      if (d.status === 'SUCCESSFUL' || d.status === 'success') return 'completed';
      if (d.status === 'FAILED') return 'failed';
      return 'pending';
    }

    case 'qmoney': {
      const key     = Deno.env.get('QMONEY_API_KEY');
      const baseUrl = Deno.env.get('QMONEY_BASE_URL') ?? 'https://api.qmoney.sl/v1';
      if (!key) return 'pending';
      const r = await fetch(`${baseUrl}/status/${encodeURIComponent(ref)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) return 'pending';
      const d = await r.json() as Record<string, unknown>;
      if (d.status === 'success' || d.status === 'PAID') return 'completed';
      if (d.status === 'failed') return 'failed';
      return 'pending';
    }

    case 'bank_transfer':
    case 'flutterwave': {
      const key = Deno.env.get('FLUTTERWAVE_SECRET_KEY');
      if (!key) return 'pending';
      const r = await fetch(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`,
        { headers: { Authorization: `Bearer ${key}` } }
      );
      if (!r.ok) return 'pending';
      const d = (await r.json() as Record<string, unknown>).data as Record<string, unknown> | undefined;
      if ((d?.status as string)?.toLowerCase() === 'successful') return 'completed';
      if ((d?.status as string)?.toLowerCase() === 'failed') return 'failed';
      return 'pending';
    }

    default:
      return 'pending';
  }
}

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
