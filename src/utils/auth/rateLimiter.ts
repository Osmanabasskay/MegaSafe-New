/**
 * rateLimiter.ts — In-memory sliding-window rate limiter for login/signup.
 *
 * Frontend guard: adds UX friction and prevents accidental double-submits.
 * Does NOT replace server-side rate limiting (login-security edge function).
 *
 * Behaviour (Section C spec):
 *  - 5 attempts in 15-min window → 15-min hard lockout.
 *  - Per-attempt exponential backoff delays: 0, 0, 1s, 2s, 5s, 10s, 20s, 30s…
 *    (implemented as a UI delay before the submit button re-enables)
 *  - Progressive lockout doubles on each block.
 *  - State is in-memory only — cleared when the app is killed.
 */

import { getBackoffDelayMs } from './loginSecurity';

interface BucketEntry {
  attempts:     number[];  // timestamps of recent attempts (ms)
  totalAttempts: number;   // cumulative count since last success (for backoff)
  blocks:       number;    // how many times this key has been locked
  lockedUntil:  number;    // epoch ms when lock expires (0 = not locked)
}

const MAX_ATTEMPTS    = 5;
const WINDOW_MS       = 15 * 60 * 1000;  // 15-minute sliding window
const LOCKOUT_MS      = 15 * 60 * 1000;  // 15-minute lockout (Section C: block for 15 min)

const buckets = new Map<string, BucketEntry>();

function getBucket(key: string): BucketEntry {
  if (!buckets.has(key)) {
    buckets.set(key, { attempts: [], totalAttempts: 0, blocks: 0, lockedUntil: 0 });
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
  if (bucket.lockedUntil > 0) bucket.lockedUntil = 0;
  return false;
}

/** Returns remaining lockout seconds (0 if not locked). */
export function getRemainingSeconds(key: string): number {
  const bucket = getBucket(key);
  const remaining = bucket.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * How many ms the UI should delay before enabling submit after a failed attempt.
 * Index is the cumulative attempt count for this key since last success.
 */
export function getAttemptBackoffMs(key: string): number {
  const bucket = getBucket(key);
  return getBackoffDelayMs(bucket.totalAttempts);
}

/**
 * Record a new attempt. Call this BEFORE making the network request.
 * Returns `{ blocked, remainingSeconds, backoffMs }`.
 */
export function recordAttempt(key: string): {
  blocked: boolean;
  remainingSeconds: number;
  backoffMs: number;
} {
  const bucket = getBucket(key);

  if (isBlocked(key)) {
    return { blocked: true, remainingSeconds: getRemainingSeconds(key), backoffMs: 0 };
  }

  pruneOldAttempts(bucket);
  bucket.attempts.push(Date.now());
  bucket.totalAttempts += 1;

  if (bucket.attempts.length > MAX_ATTEMPTS) {
    bucket.blocks += 1;
    // Progressive: first block = 15 min, subsequent blocks double
    const lockout = LOCKOUT_MS * Math.pow(2, bucket.blocks - 1);
    bucket.lockedUntil = Date.now() + lockout;
    bucket.attempts = [];
    return { blocked: true, remainingSeconds: Math.ceil(lockout / 1000), backoffMs: 0 };
  }

  const backoffMs = getBackoffDelayMs(bucket.totalAttempts - 1);
  return { blocked: false, remainingSeconds: 0, backoffMs };
}

/**
 * Record a successful auth — resets attempt counter so next failure starts fresh.
 */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}

/** Reset a bucket entirely (e.g. after verified OTP). */
export function resetBucket(key: string): void {
  buckets.delete(key);
}
