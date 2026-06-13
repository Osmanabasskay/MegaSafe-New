/**
 * login-security Edge Function — MegaSafe 2.1 hardened.
 *
 * POST body actions:
 *
 *   action: 'pre_check'
 *     Body: { action, identifier, identifier_type, device_fingerprint? }
 *     Auth: anon (called before sign-in)
 *     Returns: { allowed: boolean }
 *
 *   action: 'record_attempt'
 *     Body: { action, identifier, identifier_type, device_fingerprint?,
 *             success, failure_reason? }
 *     Auth: anon for failures; Bearer JWT required for success:true
 *     Returns: { ok: true }
 *
 * Breaking change from v1:
 *   - Clients must send raw `identifier` (email or phone string) instead of
 *     `identifier_hash`.  The hash is computed server-side with HMAC-SHA256.
 *
 * Security properties enforced here:
 *   - HMAC-SHA256 (LOGIN_HASH_SECRET) for identifier, IP, and device hashes.
 *   - JWT required for success:true; user_id derived from token only.
 *   - Verified user email/phone from JWT overrides client identifier on success.
 *   - hard_locked is one-way — never cleared by this function.
 *   - pre_check fails closed on any DB error (deny, don't allow).
 *   - All counter increments are atomic via PostgreSQL RPC (no race conditions).
 *   - Rate-limit thresholds read from environment variables.
 *   - Client responses are generic — no account-existence or lock-type leakage.
 *   - Geo-velocity (device-switch) detection runs after every successful login.
 *     LOGIN_GEO_VELOCITY_MODE=audit  (default) — alert row only.
 *     LOGIN_GEO_VELOCITY_MODE=block           — alert + 30-min soft lock.
 *     LOGIN_GEO_VELOCITY_BLOCK_SECS           — override soft-lock duration.
 */

import { corsHeaders, handleCors, readBoundedBody } from '../_shared/cors.ts';
import { createServiceClient, getAuthUser }         from '../_shared/auth.ts';

// ── Rate-limit thresholds (env-configurable; safe defaults) ──────────────────

function envInt(key: string, fallback: number): number {
  const v = Deno.env.get(key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const IP_MAX_ATTEMPTS       = envInt('LOGIN_IP_MAX_ATTEMPTS',           5);
const IP_WINDOW_SECS        = envInt('LOGIN_IP_WINDOW_SECS',            900);    // 15 min
const ACCOUNT_SOFT_MAX      = envInt('LOGIN_ACCOUNT_SOFT_MAX',          10);
const ACCOUNT_HARD_MAX      = envInt('LOGIN_ACCOUNT_HARD_MAX',          20);
const ACCOUNT_SOFT_WINDOW   = envInt('LOGIN_ACCOUNT_SOFT_WINDOW_SECS',  3600);   // 1 hr
const ACCOUNT_HARD_WINDOW   = envInt('LOGIN_ACCOUNT_HARD_WINDOW_SECS',  86400);  // 24 hr
const ACCOUNT_SOFT_LOCK     = envInt('LOGIN_ACCOUNT_SOFT_LOCK_SECS',    1800);   // 30 min
const DEVICE_MAX_ATTEMPTS   = envInt('LOGIN_DEVICE_MAX_ATTEMPTS',       10);
const DEVICE_WINDOW_SECS    = envInt('LOGIN_DEVICE_WINDOW_SECS',        3600);   // 1 hr
// Geo-velocity: flag (or optionally block) rapid device switching on the same account.
const GEO_VELOCITY_WINDOW   = envInt('LOGIN_GEO_VELOCITY_WINDOW_SECS',  600);    // 10 min
// LOGIN_GEO_VELOCITY_MODE:
//   'audit'  (default) — write alert row only; login proceeds normally.
//   'block'            — additionally apply a soft lock so the NEXT login from
//                        any device is held for GEO_VELOCITY_BLOCK_SECS.
//                        Use 'block' once monitoring confirms low false-positive rate.
const GEO_VELOCITY_MODE     = (Deno.env.get('LOGIN_GEO_VELOCITY_MODE') ?? 'audit') === 'block'
  ? 'block' : 'audit';
const GEO_VELOCITY_BLOCK_SECS = envInt('LOGIN_GEO_VELOCITY_BLOCK_SECS', 1800);   // 30 min

// ── Input allowlists ──────────────────────────────────────────────────────────

const ALLOWED_ACTIONS          = new Set(['pre_check', 'record_attempt']);
const ALLOWED_IDENTIFIER_TYPES = new Set<string>(['email', 'phone']);
const ALLOWED_FAILURE_REASONS  = new Set<string>([
  'invalid_credentials',
  'otp_invalid',
  'otp_expired',
  'account_disabled',
  'network_error',
  'unknown',
]);

// ── Crypto helpers ────────────────────────────────────────────────────────────

function requireHashSecret(): string {
  const s = Deno.env.get('LOGIN_HASH_SECRET') ?? '';
  if (!s) throw new Error('[login-security] LOGIN_HASH_SECRET is required but not set');
  return s;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Request helpers ───────────────────────────────────────────────────────────

function extractIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0]?.trim() || 'unknown';
}

function normalizeIdentifier(raw: string, type: 'email' | 'phone'): string {
  if (type === 'email') return raw.toLowerCase().trim();
  return raw.replace(/\s+/g, '').trim(); // phone: strip whitespace, preserve + prefix
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Pre-check (read-only; fail-closed on any DB error) ───────────────────────

async function preCheck(
  svc: ReturnType<typeof createServiceClient>,
  identifierHash: string,
  deviceHash: string | null,
  ipHash: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);

  // 1. IP limit
  const { data: ipRow, error: ipErr } = await svc
    .from('login_ip_limits')
    .select('attempt_count, window_start, blocked_until')
    .eq('ip_hash', ipHash)
    .maybeSingle();

  if (ipErr) {
    console.error('[login-security] pre_check IP read error:', ipErr.message);
    return false; // fail closed — deny, don't allow
  }
  if (ipRow) {
    if (ipRow.blocked_until && now < Number(ipRow.blocked_until)) return false;
    const inWindow = (now - Number(ipRow.window_start ?? 0)) < IP_WINDOW_SECS;
    if (inWindow && Number(ipRow.attempt_count ?? 0) >= IP_MAX_ATTEMPTS) return false;
  }

  // 2. Account limit
  const { data: acctRow, error: acctErr } = await svc
    .from('login_account_limits')
    .select('soft_locked_until, hard_locked')
    .eq('identifier_hash', identifierHash)
    .maybeSingle();

  if (acctErr) {
    console.error('[login-security] pre_check account read error:', acctErr.message);
    return false; // fail closed
  }
  if (acctRow) {
    if (acctRow.hard_locked) return false;
    if (acctRow.soft_locked_until && now < Number(acctRow.soft_locked_until)) return false;
  }

  // 3. Device limit (weak signal; client-supplied but HMAC'd)
  if (deviceHash) {
    const { data: devRow, error: devErr } = await svc
      .from('login_device_limits')
      .select('attempt_count, window_start, blocked_until')
      .eq('device_hash', deviceHash)
      .maybeSingle();

    if (devErr) {
      console.error('[login-security] pre_check device read error:', devErr.message);
      return false; // fail closed
    }
    if (devRow) {
      if (devRow.blocked_until && now < Number(devRow.blocked_until)) return false;
      const inWindow = (now - Number(devRow.window_start ?? 0)) < DEVICE_WINDOW_SECS;
      if (inWindow && Number(devRow.attempt_count ?? 0) >= DEVICE_MAX_ATTEMPTS) return false;
    }
  }

  return true;
}

// ── Geo-velocity detector ─────────────────────────────────────────────────────
//
// On a successful login, check whether a different device fingerprint logged in
// successfully for the same account within the velocity window.  If so, write a
// separate alert row — the login itself is NOT blocked, but the event is flagged
// so operations / security tooling can investigate.
//
// Security properties:
//  - Only runs on successful logins (not failures, which could be noise).
//  - Alert rows use source='device_velocity_alert' so they can be queried
//    independently without polluting failure-rate metrics.
//  - The incoming device hash is null-safe — if the client omits it, we cannot
//    compare and simply skip the check (no false-positive alerts).

/**
 * detectDeviceVelocity — returns true when a rapid-device-change anomaly is found.
 *
 * Looks up the most recent successful login for this identifier within
 * GEO_VELOCITY_WINDOW seconds.  If a *different* device fingerprint is found,
 * writes a device_velocity_alert audit row and returns true so the caller can
 * decide whether to block (GEO_VELOCITY_MODE === 'block') or just audit.
 *
 * Never throws — errors are logged and return false (safe default).
 */
async function detectDeviceVelocity(
  svc:            ReturnType<typeof createServiceClient>,
  identifierHash: string,
  identifierType: string,
  currentDevice:  string | null,
  userId:         string | null,
  ipHash:         string,
): Promise<boolean> {
  if (!currentDevice) return false; // no device signal → cannot compare

  const cutoff = new Date(Date.now() - GEO_VELOCITY_WINDOW * 1000).toISOString();

  try {
    const { data, error } = await svc
      .from('login_audit_log')
      .select('device_fingerprint')
      .eq('identifier_hash', identifierHash)
      .eq('success', true)
      .neq('source', 'device_velocity_alert')  // exclude our own alert rows
      .gt('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[login-security] velocity check error:', error.message);
      return false;
    }
    if (!data) return false; // no prior login in window — first login, not suspicious

    const priorDevice = data.device_fingerprint as string | null;
    if (!priorDevice || priorDevice === currentDevice) return false; // same device, no anomaly

    // Anomaly detected — write the alert row
    const { error: alertErr } = await svc.from('login_audit_log').insert({
      user_id:            userId,
      identifier_hash:    identifierHash,
      identifier_type:    identifierType,
      success:            true,
      ip_hash:            ipHash,
      device_fingerprint: currentDevice,
      failure_reason:     'rapid_device_change',
      source:             'device_velocity_alert',
      created_at:         new Date().toISOString(),
    });
    if (alertErr) {
      console.error('[login-security] velocity alert insert error:', alertErr.message);
    } else {
      console.warn(
        '[login-security] VELOCITY ALERT — different device within window.',
        'identifier_hash=', identifierHash.slice(0, 8) + '…',
        'mode=', GEO_VELOCITY_MODE,
      );
    }
    return true;

  } catch (err) {
    console.error('[login-security] velocity detection threw:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * applyVelocitySoftLock — when GEO_VELOCITY_MODE==='block', write a soft lock
 * on the account so the NEXT login attempt is held for GEO_VELOCITY_BLOCK_SECS.
 *
 * Uses an upsert on login_account_limits.soft_locked_until so that:
 *  - Existing soft locks are extended if already shorter than the new expiry.
 *  - Hard locks are never cleared (hard_locked is omitted from the upsert).
 *  - The current authenticated session is NOT revoked.
 */
async function applyVelocitySoftLock(
  svc:            ReturnType<typeof createServiceClient>,
  identifierHash: string,
): Promise<void> {
  const lockedUntil = Math.floor(Date.now() / 1000) + GEO_VELOCITY_BLOCK_SECS;
  try {
    const { error } = await svc
      .from('login_account_limits')
      .upsert(
        { identifier_hash: identifierHash, soft_locked_until: lockedUntil },
        { onConflict: 'identifier_hash', ignoreDuplicates: false }
      );
    if (error) {
      console.error('[login-security] velocity soft-lock upsert error:', error.message);
    } else {
      console.warn(
        '[login-security] velocity soft-lock applied until',
        new Date(lockedUntil * 1000).toISOString(),
        '— identifier_hash=', identifierHash.slice(0, 8) + '…',
      );
    }
  } catch (err) {
    console.error('[login-security] velocity soft-lock threw:', err instanceof Error ? err.message : err);
  }
}

// ── Record attempt (atomic increments + audit log) ────────────────────────────

async function recordAttempt(
  svc: ReturnType<typeof createServiceClient>,
  identifierHash: string,
  identifierType: string,
  deviceHash: string | null,
  ipHash: string,
  success: boolean,
  userId: string | null,
  failureReason: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  if (!success) {
    // Atomic IP counter — single upsert, no TOCTOU race
    const { error: ipErr } = await svc.rpc('login_increment_ip', {
      p_ip_hash:      ipHash,
      p_now:          now,
      p_window_secs:  IP_WINDOW_SECS,
      p_max_attempts: IP_MAX_ATTEMPTS,
    });
    if (ipErr) console.error('[login-security] login_increment_ip error:', ipErr.message);

    // Atomic account counter — hard_locked preserved inside the RPC
    const { error: acctErr } = await svc.rpc('login_increment_account', {
      p_identifier_hash:  identifierHash,
      p_now:              now,
      p_soft_window_secs: ACCOUNT_SOFT_WINDOW,
      p_hard_window_secs: ACCOUNT_HARD_WINDOW,
      p_soft_max:         ACCOUNT_SOFT_MAX,
      p_hard_max:         ACCOUNT_HARD_MAX,
      p_soft_lock_secs:   ACCOUNT_SOFT_LOCK,
    });
    if (acctErr) console.error('[login-security] login_increment_account error:', acctErr.message);

    // Atomic device counter (weak signal)
    if (deviceHash) {
      const { error: devErr } = await svc.rpc('login_increment_device', {
        p_device_hash:  deviceHash,
        p_now:          now,
        p_window_secs:  DEVICE_WINDOW_SECS,
        p_max_attempts: DEVICE_MAX_ATTEMPTS,
      });
      if (devErr) console.error('[login-security] login_increment_device error:', devErr.message);
    }
  } else {
    // Successful login: reset soft-lock counters only.
    // hard_locked is intentionally NOT touched — admin-only unlock required.
    const { error: resetErr } = await svc.rpc('login_reset_account_on_success', {
      p_identifier_hash: identifierHash,
      p_now:             now,
    });
    if (resetErr) console.error('[login-security] login_reset_account_on_success error:', resetErr.message);
  }

  // Audit log — append-only; uses only server-derived values
  const { error: auditErr } = await svc.from('login_audit_log').insert({
    user_id:            userId,
    identifier_hash:    identifierHash,
    identifier_type:    identifierType,
    success,
    ip_hash:            ipHash,
    device_fingerprint: deviceHash,
    failure_reason:     failureReason,
    source:             'login-security-edge-function',
    created_at:         new Date().toISOString(),
  });
  if (auditErr) console.error('[login-security] audit log insert error:', auditErr.message);

  // Geo-velocity check — only meaningful after a successful login.
  // Awaited so that blocking mode can apply the soft lock before the response
  // is returned.  In audit mode this adds ~10ms (one indexed DB read).
  if (success && deviceHash) {
    const anomaly = await detectDeviceVelocity(
      svc, identifierHash, identifierType, deviceHash, userId, ipHash,
    );
    if (anomaly && GEO_VELOCITY_MODE === 'block') {
      await applyVelocitySoftLock(svc, identifierHash);
    }
  }
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

  // Validate action
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ALLOWED_ACTIONS.has(action)) return jsonResp({ error: 'Request error.' }, 400);

  // Validate identifier_type
  const identifierType = typeof body.identifier_type === 'string' ? body.identifier_type : '';
  if (!ALLOWED_IDENTIFIER_TYPES.has(identifierType)) return jsonResp({ error: 'Request error.' }, 400);

  // Accept raw identifier only — never identifier_hash from the client
  const rawId = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  if (!rawId || rawId.length > 320) return jsonResp({ error: 'Request error.' }, 400);

  // Device fingerprint: weak client signal — sanitize length only
  const rawDevice = typeof body.device_fingerprint === 'string'
    ? body.device_fingerprint.slice(0, 128).trim()
    : null;

  // Hash secret must be configured; misconfiguration = 503, not 400
  let hashSecret: string;
  try { hashSecret = requireHashSecret(); }
  catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return jsonResp({ error: 'Service unavailable.' }, 503);
  }

  // All hashes computed server-side with HMAC-SHA256
  const normalized     = normalizeIdentifier(rawId, identifierType as 'email' | 'phone');
  let   identifierHash = await hmacSha256(hashSecret, `id:${identifierType}:${normalized}`);
  const rawIp          = extractIp(req);
  const ipHash         = await hmacSha256(hashSecret, `ip:${rawIp}`);
  const deviceHash     = rawDevice ? await hmacSha256(hashSecret, `dev:${rawDevice}`) : null;

  const svc = createServiceClient();

  // ── pre_check ──────────────────────────────────────────────────────────────
  if (action === 'pre_check') {
    const allowed = await preCheck(svc, identifierHash, deviceHash, ipHash);
    return jsonResp({ allowed });
  }

  // ── record_attempt ─────────────────────────────────────────────────────────
  const success = body.success === true;

  // Validate failure_reason against allowlist; unknown values become 'unknown'
  let failureReason: string | null = null;
  if (!success) {
    const raw = typeof body.failure_reason === 'string' ? body.failure_reason : 'unknown';
    failureReason = ALLOWED_FAILURE_REASONS.has(raw) ? raw : 'unknown';
  }

  // Successful logins require a valid Bearer JWT — user_id is NEVER trusted from body
  let userId: string | null = null;
  if (success) {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return jsonResp({ error: 'Unauthorized.' }, 401);

    const user = await getAuthUser(authHeader);
    if (!user) return jsonResp({ error: 'Unauthorized.' }, 401);

    userId = user.id;

    // Override identifier hash with the verified identity from the JWT.
    // Prevents a client from resetting a different account's rate-limit counters.
    if (identifierType === 'email' && user.email) {
      identifierHash = await hmacSha256(
        hashSecret,
        `id:email:${normalizeIdentifier(user.email, 'email')}`,
      );
    } else if (identifierType === 'phone' && user.phone) {
      identifierHash = await hmacSha256(
        hashSecret,
        `id:phone:${normalizeIdentifier(user.phone, 'phone')}`,
      );
    }
  }

  await recordAttempt(
    svc,
    identifierHash,
    identifierType,
    deviceHash,
    ipHash,
    success,
    userId,
    failureReason,
  );
  return jsonResp({ ok: true });
});
