/**
 * hibp.ts — HaveIBeenPwned k-anonymity password breach check.
 *
 * The password never leaves the device. Only the first 5 hex chars of its
 * SHA-1 hash are sent to the API; the response is checked locally.
 *
 * Reference: https://haveibeenpwned.com/API/v3#PwnedPasswords
 *
 * Fail-open policy: if SHA-1 is unavailable or the network request fails,
 * the check is skipped and signup is NOT blocked. HIBP is a UX safety net,
 * not a hard gate — the server-side policy enforces final password rules.
 */

async function sha1Hex(text: string): Promise<string | null> {
  try {
    if (typeof globalThis?.crypto?.subtle?.digest !== 'function') {
      return null; // Hermes < 0.73 or test environment
    }
    const encoder = new TextEncoder();
    const buf = await globalThis.crypto.subtle.digest('SHA-1', encoder.encode(text));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  } catch {
    return null;
  }
}

export interface HibpResult {
  /** True if the password appears in any known breach. */
  pwned: boolean;
  /** Number of times this password has appeared across breaches. */
  count: number;
  /** Non-null only when the check itself failed (network, API error). */
  error: Error | null;
}

/**
 * Checks a password against the Pwned Passwords database using k-anonymity.
 * Always resolves — never rejects. Callers must handle `error` to decide
 * whether to block or warn the user.
 */
export async function checkHaveIBeenPwned(password: string): Promise<HibpResult> {
  const hash = await sha1Hex(password);
  if (!hash) {
    return { pwned: false, count: 0, error: new Error('SHA-1 unavailable — HIBP check skipped') };
  }

  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        signal: controller.signal,
        headers: {
          'Add-Padding': 'true', // Prevents timing-based enumeration of prefix popularity
          'User-Agent': 'MiOsusu-App',
        },
      },
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { pwned: false, count: 0, error: new Error(`HIBP API ${response.status}`) };
    }

    const text = await response.text();
    for (const line of text.split('\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      if (line.slice(0, colon).trim().toUpperCase() === suffix) {
        const count = parseInt(line.slice(colon + 1).trim(), 10);
        return { pwned: true, count: isNaN(count) ? 1 : count, error: null };
      }
    }

    return { pwned: false, count: 0, error: null };
  } catch (e) {
    clearTimeout(timeoutId);
    return {
      pwned: false,
      count: 0,
      error: e instanceof Error ? e : new Error('HIBP network error'),
    };
  }
}
