/**
 * rateLimiter.ts — In-memory sliding-window rate limiter for login/signup.
 *
 * This is a frontend guard that adds UX friction and prevents accidental
 * multi-tap double-submits. It does NOT replace server-side rate limiting.
 *
 * Behaviour:
 *  - Tracks attempts per key (e.g. 'login', 'signup') with a sliding window.
 *  - After MAX_ATTEMPTS in WINDOW_MS the key is locked for LOCKOUT_MS.
 *  - Each subsequent block doubles the lockout (progressive backoff).
 *  - State is in-memory only; cleared when the app is killed.
 */

interface BucketEntry {
  attempts:  number[];   // timestamps of recent attempts (ms)
  blocks:    number;     // how many times this key has been locked so far
  lockedUntil: number;   // epoch ms when the lock expires (0 = not locked)
}

const MAX_ATTEMPTS   = 5;
const WINDOW_MS      = 15 * 60 * 1000;   // 15-minute sliding window
const BASE_LOCKOUT_MS = 30 * 1000;       // 30-second base lockout

const buckets = new Map<string, BucketEntry>();

function getBucket(key: string): BucketEntry {
  if (!buckets.has(key)) {
    buckets.set(key, { attempts: [], blocks: 0, lockedUntil: 0 });
  }
  return buckets.get(key)!;
}

function pruneOldAttempts(bucket: BucketEntry): void {
  const cutoff = Date.now() - WINDOW_MS;
  bucket.attempts = bucket.attempts.filter(t => t > cutoff);
}

/** Returns true if the key is currently locked out. */
export function isBlocked(key: string): boolean {
  const bucket = getBucket(key);
  if (Date.now() < bucket.lockedUntil) return true;
  // Lock expired — reset if still flagged
  if (bucket.lockedUntil > 0) {
    bucket.lockedUntil = 0;
  }
  return false;
}

/** Returns remaining lockout seconds (0 if not locked). */
export function getRemainingSeconds(key: string): number {
  const bucket = getBucket(key);
  const remaining = bucket.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Record a new attempt. Call this BEFORE making the network request.
 * Returns `{ blocked: true, remainingSeconds }` if the action should be prevented.
 * Returns `{ blocked: false }` if the attempt is allowed.
 */
export function recordAttempt(key: string): { blocked: boolean; remainingSeconds: number } {
  const bucket = getBucket(key);

  // Already locked?
  if (isBlocked(key)) {
    return { blocked: true, remainingSeconds: getRemainingSeconds(key) };
  }

  pruneOldAttempts(bucket);
  bucket.attempts.push(Date.now());

  if (bucket.attempts.length > MAX_ATTEMPTS) {
    bucket.blocks += 1;
    const lockout = BASE_LOCKOUT_MS * Math.pow(2, bucket.blocks - 1);
    bucket.lockedUntil = Date.now() + lockout;
    bucket.attempts = [];
    return { blocked: true, remainingSeconds: Math.ceil(lockout / 1000) };
  }

  return { blocked: false, remainingSeconds: 0 };
}

/**
 * Record a successful authentication — resets the attempt counter for the key
 * so that the next legitimate failure starts fresh.
 */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}

/** Reset a bucket entirely (e.g. after verified OTP). */
export function resetBucket(key: string): void {
  buckets.delete(key);
}
