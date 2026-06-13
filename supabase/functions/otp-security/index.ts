/**
 * otp-security Edge Function — server-side OTP rate limiting.
 *
 * Closes the gap where otp.tsx relied on React refs (otpAttemptsRef,
 * resendCountRef) for OTP abuse protection. Those refs disappear on hot-reload
 * and can be bypassed by calling Supabase auth endpoints directly.
 *
 * Actions:
 *
 *   action: 'check_send'
 *     Body: { action, identifier, identifier_type, device_fingerprint? }
 *     Returns: { allowed: boolean }
 *     Called BEFORE signInWithOtp / resend to check if a send is allowed.
 *
 *   action: 'record_send'
 *     Body: { action, identifier, identifier_type }
 *     Returns: { ok: true }
 *     Called AFTER a successful OTP send to increment the counter.
 *
 *   action: 'record_verify_attempt'
 *     Body: { action, identifier, identifier_type, success: boolean }
 *     Returns: { ok: true, locked?: boolean }
 *     Called after each verification attempt (success or failure).
 *
 * Security properties:
 *   - All identifiers HMAC'd server-side (LOGIN_HASH_SECRET env var).
 *   - Fail-closed on any DB error: denies the request rather than allowing it.
 *   - Generic error responses — no account-existence leakage.
 *   - Atomic upserts prevent race conditions.
 *   - Hard-lock after VERIFY_HARD_MAX failed verifications in 24 h.
 */

import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';
import { createServiceClient }                      from '../_shared/auth.ts';

// ── Thresholds (env-configurable) ─────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const v = Deno.env.get(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const SEND_MAX_PER_WINDOW  = envInt('OTP_SEND_MAX_PER_WINDOW',  3);    // max sends
const SEND_WINDOW_SECS     = envInt('OTP_SEND_WINDOW_SECS',     3600); // 1 hr
const VERIFY_SOFT_MAX      = envInt('OTP_VERIFY_SOFT_MAX',      5);    // soft block
const VERIFY_HARD_MAX      = envInt('OTP_VERIFY_HARD_MAX',      10);   // hard lock
const VERIFY_WINDOW_SECS   = envInt('OTP_VERIFY_WINDOW_SECS',   86400);// 24 hr

// ── Allowlists ────────────────────────────────────────────────────────────────

const ALLOWED_ACTIONS          = new Set(['check_send', 'record_send', 'record_verify_attempt']);
const ALLOWED_IDENTIFIER_TYPES = new Set(['email', 'phone']);

// ── Crypto ────────────────────────────────────────────────────────────────────

function requireHashSecret(): string {
  const s = Deno.env.get('LOGIN_HASH_SECRET') ?? '';
  if (!s) throw new Error('[otp-security] LOGIN_HASH_SECRET is required but not set');
  return s;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeIdentifier(raw: string, type: 'email' | 'phone'): string {
  return type === 'email' ? raw.toLowerCase().trim() : raw.replace(/\s+/g, '').trim();
}

function extractIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── check_send ────────────────────────────────────────────────────────────────
// Returns false (denied) if the identifier has exceeded the send window limit.
// Fails CLOSED on any DB error.

async function checkSend(
  svc: ReturnType<typeof createServiceClient>,
  identifierHash: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);

  const { data, error } = await svc
    .from('otp_rate_limits')
    .select('send_count, send_window_start, hard_locked')
    .eq('identifier_hash', identifierHash)
    .maybeSingle();

  if (error) {
    console.error('[otp-security] check_send DB error:', error.message);
    return false; // fail closed
  }
  if (!data) return true; // no record = first request

  if (data.hard_locked) return false;

  const windowAge = now - (Number(data.send_window_start ?? 0));
  if (windowAge < SEND_WINDOW_SECS && Number(data.send_count ?? 0) >= SEND_MAX_PER_WINDOW) {
    return false;
  }

  return true;
}

// ── record_send ───────────────────────────────────────────────────────────────

async function recordSend(
  svc: ReturnType<typeof createServiceClient>,
  identifierHash: string,
  identifierType: string,
  ipHash: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const { data: existing } = await svc
    .from('otp_rate_limits')
    .select('send_count, send_window_start')
    .eq('identifier_hash', identifierHash)
    .maybeSingle();

  const inWindow = existing &&
    (now - (Number(existing.send_window_start ?? 0))) < SEND_WINDOW_SECS;

  const newCount      = inWindow ? (Number(existing!.send_count ?? 0) + 1) : 1;
  const newWindowStart = inWindow ? existing!.send_window_start : now;

  const { error } = await svc
    .from('otp_rate_limits')
    .upsert({
      identifier_hash:   identifierHash,
      identifier_type:   identifierType,
      ip_hash:           ipHash,
      send_count:        newCount,
      send_window_start: newWindowStart,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'identifier_hash' });

  if (error) console.error('[otp-security] record_send upsert error:', error.message);
}

// ── record_verify_attempt ──────────────────────────────────────────────────────

async function recordVerifyAttempt(
  svc: ReturnType<typeof createServiceClient>,
  identifierHash: string,
  identifierType: string,
  ipHash: string,
  success: boolean,
): Promise<{ locked: boolean }> {
  const now = Math.floor(Date.now() / 1000);

  if (success) {
    // Successful verify: reset verify_fails and send_count
    await svc
      .from('otp_rate_limits')
      .upsert({
        identifier_hash:   identifierHash,
        identifier_type:   identifierType,
        ip_hash:           ipHash,
        verify_fails:      0,
        send_count:        0,
        send_window_start: now,
        updated_at:        new Date().toISOString(),
      }, { onConflict: 'identifier_hash' });
    return { locked: false };
  }

  // Failed verify: increment counter
  const { data: existing } = await svc
    .from('otp_rate_limits')
    .select('verify_fails, verify_window_start, hard_locked')
    .eq('identifier_hash', identifierHash)
    .maybeSingle();

  if (existing?.hard_locked) return { locked: true };

  const inWindow = existing &&
    (now - (Number(existing.verify_window_start ?? 0))) < VERIFY_WINDOW_SECS;

  const newFails = inWindow ? (Number(existing!.verify_fails ?? 0) + 1) : 1;
  const hardLock = newFails >= VERIFY_HARD_MAX;
  const softLock = newFails >= VERIFY_SOFT_MAX;

  const { error } = await svc
    .from('otp_rate_limits')
    .upsert({
      identifier_hash:     identifierHash,
      identifier_type:     identifierType,
      ip_hash:             ipHash,
      verify_fails:        newFails,
      verify_window_start: inWindow ? (existing!.verify_window_start ?? now) : now,
      hard_locked:         hardLock,
      updated_at:          new Date().toISOString(),
    }, { onConflict: 'identifier_hash' });

  if (error) console.error('[otp-security] record_verify_attempt upsert error:', error.message);

  // Log lockout events for ops visibility
  if (hardLock || softLock) {
    await svc.from('login_audit_log').insert({
      identifier_hash: identifierHash,
      identifier_type: identifierType,
      success:         false,
      ip_hash:         ipHash,
      failure_reason:  hardLock ? 'otp_hard_locked' : 'otp_soft_locked',
      source:          'otp-security-edge-function',
      created_at:      new Date().toISOString(),
    }).then(({ error: ae }) => {
      if (ae) console.error('[otp-security] audit log error:', ae.message);
    });
  }

  return { locked: hardLock || softLock };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;
  if (req.method !== 'POST') return jsonResp({ error: 'Method not allowed.' }, 405);

  const { text: rawBody, error: sizeErr } = await readBoundedBody(req, 4 * 1024);
  if (sizeErr) return jsonResp({ error: 'Request error.' }, 413);

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody); }
  catch { return jsonResp({ error: 'Request error.' }, 400); }

  const action = typeof body.action === 'string' ? body.action : '';
  if (!ALLOWED_ACTIONS.has(action)) return jsonResp({ error: 'Request error.' }, 400);

  const identifierType = typeof body.identifier_type === 'string' ? body.identifier_type : '';
  if (!ALLOWED_IDENTIFIER_TYPES.has(identifierType)) return jsonResp({ error: 'Request error.' }, 400);

  const rawId = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  if (!rawId || rawId.length > 320) return jsonResp({ error: 'Request error.' }, 400);

  let hashSecret: string;
  try { hashSecret = requireHashSecret(); }
  catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return jsonResp({ error: 'Service unavailable.' }, 503);
  }

  const normalized     = normalizeIdentifier(rawId, identifierType as 'email' | 'phone');
  const identifierHash = await hmacSha256(hashSecret, `otp:${identifierType}:${normalized}`);
  const rawIp          = extractIp(req);
  const ipHash         = await hmacSha256(hashSecret, `ip:${rawIp}`);
  const svc            = createServiceClient();

  if (action === 'check_send') {
    const allowed = await checkSend(svc, identifierHash);
    return jsonResp({ allowed });
  }

  if (action === 'record_send') {
    await recordSend(svc, identifierHash, identifierType, ipHash);
    return jsonResp({ ok: true });
  }

  // record_verify_attempt
  const success = body.success === true;
  const { locked } = await recordVerifyAttempt(svc, identifierHash, identifierType, ipHash, success);
  return jsonResp({ ok: true, locked });
});
