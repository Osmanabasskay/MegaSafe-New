/**
 * loginSecurity.ts — Client-side security primitives for login hardening.
 *
 * Sections covered:
 *   A  — SHA-256 identifier hashing (never log raw identifier)
 *   C  — Exponential backoff delay table (0, 0, 1s, 2s, 5s, 10s, 20s, 30s…)
 *   E  — Cryptographically random hex for OAuth state / nonce
 *   H  — Correlation ID generation for server-error support references
 *
 * All functions are pure / side-effect-free except generateCorrelationId().
 */

/**
 * SHA-256 of a string, returned as lowercase hex.
 * Returns null if SubtleCrypto is unavailable (Hermes < 0.73, test env).
 * NEVER pass a password to this function — for identifiers only.
 */
export async function sha256Hex(input: string): Promise<string | null> {
  try {
    if (typeof globalThis?.crypto?.subtle?.digest !== 'function') return null;
    const buf = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(input),
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/**
 * Cryptographically random hex string of the requested byte length.
 * 32 bytes → 64-char hex  (for OAuth state parameter)
 * 16 bytes → 32-char hex  (for nonces)
 */
export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Support correlation ID: 8-char time prefix + 8-char random.
 * Shown to users for support reference — NOT a secret.
 */
export function generateCorrelationId(): string {
  const ts   = (Date.now() & 0xffffffff).toString(16).padStart(8, '0');
  const rand = randomHex(4);
  return `${ts}${rand}`.toUpperCase();
}

/**
 * Exponential backoff delays by attempt index (0-based), per Section C spec:
 *   attempt 0: 0s, attempt 1: 0s, attempt 2: 1s, attempt 3: 2s,
 *   attempt 4: 5s, attempt 5: 10s, attempt 6: 20s, attempt 7+: 30s+10s per step
 *
 * Applied CLIENT-SIDE as a UI delay before enabling the submit button.
 * Server enforces the hard block via the login-security edge function.
 */
const BACKOFF_DELAYS_MS = [0, 0, 1000, 2000, 5000, 10000, 20000, 30000];

export function getBackoffDelayMs(attemptIndex: number): number {
  if (attemptIndex <= 0) return 0;
  if (attemptIndex < BACKOFF_DELAYS_MS.length) return BACKOFF_DELAYS_MS[attemptIndex]!;
  return 30000 + (attemptIndex - 7) * 10000;
}

/**
 * Lightweight device fingerprint: stable 16-char hex derived from
 * platform + locale + app version.  Supplementary signal only —
 * NOT a reliable unique ID.  Never used as the sole auth factor.
 */
export async function getDeviceFingerprint(
  platform: string,
  locale: string,
  appVersion: string,
): Promise<string> {
  const full = await sha256Hex(`${platform}|${locale}|${appVersion}`);
  return (full ?? 'unknown').slice(0, 16);
}
