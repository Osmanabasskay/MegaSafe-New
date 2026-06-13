/**
 * confirm-payment Edge Function
 *
 * Called after a provider redirect returns the user to the app.
 * Polls the provider API to get the definitive payment status
 * and reconciles contribution_payments accordingly.
 *
 * The client cannot be trusted to self-report success — this
 * function fetches status directly from the provider.
 */

import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';
import { getAuthUser, createServiceClient, createUserClient } from '../_shared/auth.ts';

interface RequestBody {
  contribution_id?: string | null;
  mm_txn_id?:       string | null;
  provider_ref?:    string | null;
  provider?:        string | null;
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

  if (!body.mm_txn_id && !body.provider_ref) {
    return jsonError('mm_txn_id or provider_ref is required.', 400);
  }

  const svc = createServiceClient();

  // ── Look up the mobile_money_transaction ────────────────────
  let query = svc
    .from('mobile_money_transactions')
    .select('id, user_id, payment_id, provider, provider_reference, status, amount');

  if (body.mm_txn_id) {
    query = query.eq('id', body.mm_txn_id);
  } else {
    query = query.eq('provider_reference', body.provider_ref!);
  }

  const { data: mmTxn, error: mmErr } = await query.maybeSingle();
  if (mmErr) {
    console.error('mobile_money_transactions lookup error:', mmErr.message);
    return jsonError('Could not look up transaction.', 500);
  }
  if (!mmTxn) return jsonError('Transaction not found.', 404);

  // Ensure caller owns this transaction
  if ((mmTxn as Record<string, unknown>).user_id !== user.id) {
    return jsonError('Not authorized.', 403);
  }

  const txn = mmTxn as Record<string, unknown>;
  const currentStatus = txn.status as string;

  // Already final
  if (currentStatus === 'completed') {
    return jsonOk({ status: 'completed', contribution_id: txn.payment_id });
  }
  if (currentStatus === 'failed') {
    return jsonOk({ status: 'failed', contribution_id: txn.payment_id });
  }

  // ── Poll provider for status ─────────────────────────────────
  const providerRef = txn.provider_reference as string | null;
  // Always use the DB-stored provider — never trust a client-supplied value.
  const provider    = txn.provider as string;

  if (!providerRef) {
    return jsonOk({ status: 'pending', contribution_id: txn.payment_id });
  }

  let providerStatus = 'pending';
  try {
    providerStatus = await pollProviderStatus(provider, providerRef);
  } catch (err) {
    console.warn('Provider poll failed:', err instanceof Error ? err.message : err);
  }

  if (providerStatus === 'completed' || providerStatus === 'successful') {
    const { data: finalResult, error: finalErr } = await svc.rpc('finalize_verified_payment', {
      p_mm_txn_id:      txn.id,
      p_webhook_payload: null,
    });
    if (finalErr) console.error('finalize error:', finalErr.message);
    const fr = finalResult as Record<string, unknown> | null;
    if (fr?.error) console.error('finalize RPC error:', fr.error);

    return jsonOk({ status: 'completed', contribution_id: txn.payment_id });
  }

  if (providerStatus === 'failed' || providerStatus === 'cancelled') {
    await svc.rpc('fail_payment_by_reference', { p_provider_reference: providerRef })
      .then(({ error }) => { if (error) console.warn('fail_payment error:', error.message); });
    return jsonOk({ status: 'failed', contribution_id: txn.payment_id });
  }

  return jsonOk({ status: 'pending', contribution_id: txn.payment_id });
});

// ── Provider polling ─────────────────────────────────────────

async function pollProviderStatus(provider: string, providerRef: string): Promise<string> {
  switch (provider) {
    case 'orange_money': {
      const apiKey  = Deno.env.get('ORANGE_MONEY_API_KEY');
      const baseUrl = Deno.env.get('ORANGE_MONEY_BASE_URL') ?? 'https://api.orange.com/orange-money-webpay/sl/v1';
      if (!apiKey) return 'pending';
      const resp = await fetch(`${baseUrl}/webpayment/${encodeURIComponent(providerRef)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return 'pending';
      const data = await resp.json() as Record<string, unknown>;
      const s = String(data.status ?? '');
      if (s === '60000' || s === 'SUCCESS') return 'completed';
      if (s === 'FAILED' || s === 'CANCELLED') return 'failed';
      return 'pending';
    }

    case 'afrimoney': {
      const apiKey  = Deno.env.get('AFRIMONEY_API_KEY');
      const baseUrl = Deno.env.get('AFRIMONEY_BASE_URL') ?? 'https://api.afrimoney.sl/v1';
      if (!apiKey) return 'pending';
      const resp = await fetch(`${baseUrl}/payments/${encodeURIComponent(providerRef)}`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!resp.ok) return 'pending';
      const data = await resp.json() as Record<string, unknown>;
      if (data.status === 'SUCCESSFUL' || data.status === 'success') return 'completed';
      if (data.status === 'FAILED' || data.status === 'failed') return 'failed';
      return 'pending';
    }

    case 'qmoney': {
      const apiKey  = Deno.env.get('QMONEY_API_KEY');
      const baseUrl = Deno.env.get('QMONEY_BASE_URL') ?? 'https://api.qmoney.sl/v1';
      if (!apiKey) return 'pending';
      const resp = await fetch(`${baseUrl}/status/${encodeURIComponent(providerRef)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return 'pending';
      const data = await resp.json() as Record<string, unknown>;
      if (data.status === 'success' || data.status === 'PAID') return 'completed';
      if (data.status === 'failed' || data.status === 'FAILED') return 'failed';
      return 'pending';
    }

    case 'flutterwave':
    case 'bank_transfer':
    case 'card': {
      const secretKey = Deno.env.get('FLUTTERWAVE_SECRET_KEY');
      if (!secretKey) return 'pending';
      const resp = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerRef)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (!resp.ok) return 'pending';
      const data = await resp.json() as Record<string, unknown>;
      const d    = (data.data as Record<string, unknown> | undefined);
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
