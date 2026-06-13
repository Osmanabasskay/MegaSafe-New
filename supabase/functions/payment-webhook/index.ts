/**
 * payment-webhook Edge Function
 *
 * Receives payment provider callbacks, validates HMAC signatures,
 * deduplicates via webhook_events, then finalizes payments using
 * the finalize_verified_payment() SECURITY DEFINER RPC.
 *
 * All status transitions happen inside the RPC — this function only
 * verifies authenticity and orchestrates the call.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/auth.ts';

const PROVIDER_SECRETS: Record<string, string | undefined> = {
  orange_money: Deno.env.get('ORANGE_MONEY_WEBHOOK_SECRET'),
  afrimoney:    Deno.env.get('AFRIMONEY_WEBHOOK_SECRET'),
  qmoney:       Deno.env.get('QMONEY_WEBHOOK_SECRET'),
  flutterwave:  Deno.env.get('FLUTTERWAVE_WEBHOOK_SECRET'),
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonErr('Method not allowed', 405, 'METHOD_NOT_ALLOWED');

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonErr('Invalid JSON', 400, 'INVALID_JSON');
  }

  const provider = detectProvider(req.headers, payload);
  if (!provider) {
    console.warn('Unknown provider in webhook');
    return jsonErr('Unknown provider', 400, 'UNKNOWN_PROVIDER');
  }

  // ── HMAC Signature Validation ───────────────────────────────
  const secret = PROVIDER_SECRETS[provider];
  if (!secret) {
    console.error(`No webhook secret configured for: ${provider}`);
    return jsonErr('Provider not configured', 500, 'PROVIDER_NOT_CONFIGURED');
  }

  const sigHeader  = getSignatureHeader(req.headers, provider);
  const sigValid   = await verifySignature(rawBody, sigHeader, secret, provider);
  if (!sigValid) {
    console.warn(`Invalid signature for provider: ${provider}`);
    return jsonErr('Invalid signature', 401, 'INVALID_SIGNATURE');
  }

  // ── Extract IDs ─────────────────────────────────────────────
  const eventId     = extractEventId(payload, provider);
  const providerRef = extractProviderReference(payload, provider);
  const isSuccess   = extractIsSuccess(payload, provider);

  if (!eventId || !providerRef) {
    return jsonErr('Missing event_id or provider_reference', 400, 'MISSING_WEBHOOK_REFERENCE');
  }

  const svc = createServiceClient();

  // ── Deduplicate via webhook_events ──────────────────────────
  const { error: dedupErr } = await svc
    .from('webhook_events')
    .insert({ provider, event_id: eventId, payload });

  if (dedupErr?.code === '23505') {
    console.log(`Duplicate webhook ignored: ${provider}/${eventId}`);
    return jsonOk({ status: 'already_processed' });
  }
  if (dedupErr) {
    console.error('webhook_events insert error:', dedupErr.message);
    return jsonErr('Internal error', 500, 'WEBHOOK_DEDUP_FAILED');
  }

  // ── Look up mobile_money_transaction by provider_reference ──
  const { data: mmTxn, error: mmErr } = await svc
    .from('mobile_money_transactions')
    .select('id, status, user_id, payment_id, amount')
    .eq('provider_reference', providerRef)
    .maybeSingle();

  if (mmErr) {
    console.error('mobile_money_transactions lookup error:', mmErr.message);
    return jsonErr('Internal error', 500, 'MOBILE_MONEY_LOOKUP_FAILED');
  }

  if (!mmTxn) {
    // Check by internal_reference as fallback (when provider_ref not yet set at initiation)
    const { data: mmTxnFallback } = await svc
      .from('mobile_money_transactions')
      .select('id, status, user_id, payment_id, amount')
      .eq('internal_reference', providerRef)
      .maybeSingle();

    if (!mmTxnFallback) {
      console.warn(`No mm_transaction found for provider_reference: ${providerRef}`);
      return jsonOk({ status: 'transaction_not_found' });
    }

    // Set the provider_reference now that we know it
    await svc
      .from('mobile_money_transactions')
      .update({ provider_reference: providerRef })
      .eq('id', mmTxnFallback.id);

    Object.assign(mmTxn ?? {}, mmTxnFallback);
  }

  if (!isSuccess) {
    // Provider reported failure — call fail_payment_by_reference RPC
    const { error: failErr } = await svc.rpc('fail_payment_by_reference', {
      p_provider_reference: providerRef,
    });
    if (failErr) console.error('fail_payment_by_reference error:', failErr.message);
    return jsonOk({ status: 'recorded_failure' });
  }

  // ── Already completed ────────────────────────────────────────
  if ((mmTxn as Record<string, unknown>)?.status === 'completed') {
    return jsonOk({ status: 'already_completed' });
  }

  // ── Finalize via SECURITY DEFINER RPC ───────────────────────
  const txnId = (mmTxn as Record<string, unknown>)?.id as string;
  const { data: finalResult, error: finalErr } = await svc.rpc('finalize_verified_payment', {
    p_mm_txn_id:       txnId,
    p_webhook_payload: payload,
  });

  if (finalErr) {
    console.error('finalize_verified_payment error:', finalErr.message);
    return jsonErr('Internal error during finalization', 500, 'PAYMENT_FINALIZATION_FAILED');
  }

  const result = finalResult as Record<string, unknown>;
  if (result?.error) {
    console.error('finalize_verified_payment returned error:', result.error);
    return jsonErr(String(result.error), 500, 'PAYMENT_FINALIZATION_REJECTED');
  }

  // ── Commission ───────────────────────────────────────────────
  const contributionId = (mmTxn as Record<string, unknown>)?.payment_id as string | undefined;
  if (contributionId) {
    await svc.rpc('calculate_and_record_commission', { p_payment_id: contributionId })
      .then(({ error }) => { if (error) console.warn('Commission error:', error.message); });
  }

  // ── Push notification (fire-and-forget) ─────────────────────
  const userId = (mmTxn as Record<string, unknown>)?.user_id as string | undefined;
  const amount = (mmTxn as Record<string, unknown>)?.amount as number | undefined;
  if (userId && amount) {
    const notifUrl    = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (notifUrl && serviceKey) {
      fetch(notifUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body:    JSON.stringify({
          user_id: userId,
          type:    'payment_received',
          title:   'Payment Confirmed',
          body:    `Your payment of NLe ${Number(amount).toFixed(2)} has been confirmed.`,
          data:    { contribution_id: contributionId },
        }),
      }).catch((err) => console.warn('Notification dispatch failed:', err));
    }
  }

  return jsonOk({ status: 'completed' });
});

// ── Provider detection ───────────────────────────────────────

function detectProvider(headers: Headers, payload: Record<string, unknown>): string | null {
  if (headers.get('x-orange-verif-code'))   return 'orange_money';
  if (headers.get('verif-hash'))             return 'flutterwave';
  if (headers.get('x-afrimoney-signature')) return 'afrimoney';
  if (headers.get('x-qmoney-signature'))    return 'qmoney';
  if ('flw_ref' in payload || 'data' in payload) return 'flutterwave';
  if ('orange_money_id' in payload)         return 'orange_money';
  return null;
}

function getSignatureHeader(headers: Headers, provider: string): string | null {
  switch (provider) {
    case 'orange_money': return headers.get('x-orange-verif-code');
    case 'flutterwave':  return headers.get('verif-hash');
    case 'afrimoney':    return headers.get('x-afrimoney-signature');
    case 'qmoney':       return headers.get('x-qmoney-signature');
    default:             return null;
  }
}

async function verifySignature(rawBody: string, signature: string | null, secret: string, provider: string): Promise<boolean> {
  if (!signature) return false;

  // Flutterwave: secret hash compared directly
  if (provider === 'flutterwave') return signature === secret;

  // Orange Money, Afrimoney, QMoney: HMAC-SHA256 hex with constant-time compare
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf    = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(rawBody));
  const expected  = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

function extractEventId(payload: Record<string, unknown>, provider: string): string | null {
  switch (provider) {
    case 'flutterwave': {
      const d = payload.data as Record<string, unknown> | undefined;
      return d?.flw_ref as string ?? payload.id as string ?? null;
    }
    case 'orange_money': return payload.pay_token as string ?? null;
    case 'afrimoney':    return payload.transaction_id as string ?? null;
    case 'qmoney':       return payload.ref as string ?? null;
    default:             return payload.id as string ?? null;
  }
}

function extractProviderReference(payload: Record<string, unknown>, provider: string): string | null {
  switch (provider) {
    case 'flutterwave': {
      const d = payload.data as Record<string, unknown> | undefined;
      return d?.tx_ref as string ?? null;
    }
    case 'orange_money': return payload.order_id as string ?? payload.pay_token as string ?? null;
    case 'afrimoney':    return payload.reference as string ?? payload.transaction_id as string ?? null;
    case 'qmoney':       return payload.order_ref as string ?? payload.ref as string ?? null;
    default:             return payload.reference as string ?? null;
  }
}

function extractIsSuccess(payload: Record<string, unknown>, provider: string): boolean {
  switch (provider) {
    case 'flutterwave': {
      const d = payload.data as Record<string, unknown> | undefined;
      return (d?.status as string)?.toLowerCase() === 'successful';
    }
    case 'orange_money': return payload.status === '60000' || payload.status === 'SUCCESS';
    case 'afrimoney':    return payload.status === 'SUCCESSFUL' || payload.status === 'success';
    case 'qmoney':       return payload.status === 'success' || payload.status === 'PAID';
    default:             return false;
  }
}

function jsonOk(body: unknown): Response {
  const data = body != null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : { value: body };
  return new Response(JSON.stringify({ ...data, success: true, data }), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonErr(error: string, status: number, code = 'PAYMENT_WEBHOOK_ERROR'): Response {
  return new Response(JSON.stringify({ success: false, error, code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
