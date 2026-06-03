/**
 * provider-kyc-check Edge Function
 *
 * Backend-only KYC lookup via Monime Provider KYC API.
 * Stores result in provider_kyc_checks table (RLS prevents any frontend writes).
 *
 * Security guarantees:
 *   - JWT required — anonymous calls rejected.
 *   - Monime API credentials only in Deno.env — never returned to frontend.
 *   - Raw KYC data (name, ID numbers) NEVER returned to frontend.
 *   - Frontend receives only: verified (bool), status, checked_at.
 *   - KYC result stored server-side via SECURITY DEFINER or service_role insert.
 *   - Frontend CANNOT insert/update/delete provider_kyc_checks (RLS blocks it).
 */

import { corsHeaders, handleCors }       from '../_shared/cors.ts';
import { getAuthUser, createServiceClient } from '../_shared/auth.ts';
import { MONIME_PROVIDER_IDS, getProviderKyc } from '../_shared/monime.ts';

interface RequestBody {
  method:       string;   // "orange_money" or "afrimoney"
  phone_number: string;   // MSISDN to check
}

const SUPPORTED_METHODS = new Set(['orange_money', 'afrimoney']);

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

  if (!body.method) return err('method is required.', 400);
  if (body.method === 'qmoney') return err('QMoney Provider KYC is not supported via Monime. Use orange_money or afrimoney.', 400);
  if (!SUPPORTED_METHODS.has(body.method)) return err(`Unsupported method: ${body.method}. Use orange_money or afrimoney.`, 400);
  if (!body.phone_number || body.phone_number.trim().length < 8) return err('phone_number is required and must be a valid MSISDN.', 400);

  const providerId = MONIME_PROVIDER_IDS[body.method];
  if (!providerId) return err(`No Monime provider ID for method: ${body.method}`, 500);

  const phone = body.phone_number.trim();

  // ── 3. Check for a recent cached result (< 24h) ───────────────────────────────
  const svc = createServiceClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Table columns: provider_id (m17/m18), account_id (MSISDN), status, created_at
  const { data: cached } = await svc
    .from('provider_kyc_checks')
    .select('id, status, created_at')
    .eq('user_id', user.id)
    .eq('provider_id', providerId)   // m17 or m18 — NOT method name
    .eq('account_id', phone)          // MSISDN stored as account_id
    .gte('created_at', cutoff)        // created_at is the timestamp column
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    const c = cached as Record<string, unknown>;
    console.log(`provider-kyc-check: returning cached result for user=${user.id} method=${body.method}`);
    return ok({
      verified:   (c.status as string) === 'verified',   // derived — no 'verified' column
      status:     c.status,
      checked_at: c.created_at,                           // alias for client API compat
      cached:     true,
    });
  }

  // ── 4. Call Monime Provider KYC API ──────────────────────────────────────────
  let kycResult: Awaited<ReturnType<typeof getProviderKyc>>;
  try {
    kycResult = await getProviderKyc(providerId, phone);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Monime KYC API unavailable';
    console.error(`provider-kyc-check: Monime error for user=${user.id}:`, msg);
    return err('KYC verification service temporarily unavailable. Please try again.', 502);
  }

  // Map Monime status to DB enum: 'pending'|'verified'|'failed'|'not_found'
  const dbStatus: string = kycResult.verified          ? 'verified'
                         : kycResult.status === 'not_found' ? 'not_found'
                         : 'failed';

  // ── 5. Store full result server-side (RLS prevents frontend writes) ───────────
  //    Raw name/ID data stored in raw_response; only safe summary returned to client.
  const { error: insertErr } = await svc.from('provider_kyc_checks').insert({
    user_id:       user.id,
    provider_id:   providerId,           // m17 or m18
    provider_type: 'momo',               // required NOT NULL — all Monime providers are momo
    provider_name: body.method,          // 'orange_money' | 'afrimoney' for readability
    account_id:    phone,                // MSISDN — required NOT NULL
    account_name:  kycResult.name ?? null,
    status:        dbStatus,
    raw_response:  kycResult as unknown as Record<string, unknown>,
    // created_at / updated_at auto-filled by DEFAULT now()
  });

  if (insertErr) {
    console.error('provider_kyc_checks insert error:', insertErr.message);
    // Do not expose DB error; still return result to caller
  }

  console.log(`provider-kyc-check: completed | user=${user.id} | method=${body.method} | verified=${kycResult.verified}`);

  // ── 6. Return sanitized result — NEVER return raw_response or identity data ───
  return ok({
    verified:   kycResult.verified,
    status:     dbStatus,
    checked_at: new Date().toISOString(),
    cached:     false,
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
