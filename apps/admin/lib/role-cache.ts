/**
 * Short-lived, HMAC-signed role cache stored in an httpOnly cookie.
 *
 * The cookie value is:  `<userId>:<expiryUnixSec>:<hmac-sha256-hex>`
 * The HMAC covers both fields, so neither can be tampered independently.
 * The signature key comes from ADMIN_ROLE_CACHE_SECRET (server-only env var).
 *
 * TTL is deliberately short (30 s) so a revoked admin is locked out within
 * one cache window without requiring a database query on every navigation.
 *
 * All crypto uses the Web Crypto API, which is available in both the Edge
 * runtime (middleware) and Node 18+ (route handlers / server components).
 */

export const ROLE_CACHE_COOKIE = 'sb-admin-role-cache';
export const ROLE_CACHE_TTL_SECONDS = 30;

// ─── Internal helpers ─────────────────────────────────────────────────────────

const enc = new TextEncoder();

const importKey = (secret: string, usage: KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// Returns the underlying ArrayBuffer so crypto.subtle.verify receives the
// concrete ArrayBuffer type it requires (not the wider ArrayBufferLike).
const fromHex = (hex: string): ArrayBuffer =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16))).buffer as ArrayBuffer;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a signed cookie value for the given userId.
 * Returns null if ADMIN_ROLE_CACHE_SECRET is not configured (cache disabled).
 */
export const buildRoleCacheCookie = async (userId: string): Promise<string | null> => {
  const secret = process.env.ADMIN_ROLE_CACHE_SECRET;
  if (!secret) return null;
  const expiry = Math.floor(Date.now() / 1000) + ROLE_CACHE_TTL_SECONDS;
  const payload = `${userId}:${expiry}`;
  const key = await importKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}:${toHex(sig)}`;
};

/**
 * Verify a cookie value produced by buildRoleCacheCookie.
 * Returns true only when:
 *   - secret is configured
 *   - HMAC is valid (constant-time verify via crypto.subtle)
 *   - userId matches the one embedded in the payload
 *   - the cache entry has not expired
 */
export const verifyRoleCacheCookie = async (
  cookieValue: string,
  userId: string
): Promise<boolean> => {
  const secret = process.env.ADMIN_ROLE_CACHE_SECRET;
  if (!secret) return false;

  try {
    // The last colon separates payload from HMAC hex.
    const lastColon = cookieValue.lastIndexOf(':');
    if (lastColon < 0) return false;
    const payload = cookieValue.slice(0, lastColon);
    const sigHex = cookieValue.slice(lastColon + 1);

    // Payload must be exactly `<userId>:<expiry>` — two colon-separated parts.
    const firstColon = payload.indexOf(':');
    if (firstColon < 0) return false;
    const cachedUserId = payload.slice(0, firstColon);
    const expiryStr = payload.slice(firstColon + 1);
    if (cachedUserId !== userId) return false;

    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry) || Math.floor(Date.now() / 1000) >= expiry) return false;

    // crypto.subtle.verify is constant-time — safe against timing attacks.
    const key = await importKey(secret, ['verify']);
    return crypto.subtle.verify('HMAC', key, fromHex(sigHex), enc.encode(payload));
  } catch {
    return false;
  }
};
