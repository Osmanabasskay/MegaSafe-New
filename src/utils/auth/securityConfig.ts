import Constants from 'expo-constants';

/**
 * securityConfig.ts — Centralized client-side security UI constants.
 *
 * IMPORTANT: These constants control UI hints only (countdown timers, button
 * labels, retry messages). The BACKEND is the source of truth for all security
 * enforcement. These values must never be used to skip or gate server calls.
 *
 * Server-side equivalents are set via Supabase Edge Function environment
 * variables (LOGIN_IP_MAX_ATTEMPTS, OTP_SEND_MAX_PER_WINDOW, etc.).
 */

// ── OTP ───────────────────────────────────────────────────────────────────────

type ExpoExtra = {
  supabaseOtpLength?: string | number;
};

function readNumericEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseOtpLength(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 4 || parsed > 12) return null;
  return parsed;
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

/** Digits in the OTP code. Must match the Supabase Auth OTP length setting. */
export const OTP_LENGTH =
  parseOtpLength(extra.supabaseOtpLength) ??
  parseOtpLength(readNumericEnv('EXPO_PUBLIC_SUPABASE_OTP_LENGTH')) ??
  8;

/** Seconds to wait between resend attempts (UI cooldown hint). */
export const OTP_COOLDOWN_SECS = 60;

/**
 * Max wrong-code attempts before the frontend shows "request a new code"
 * (soft UI gate). The server enforces hard limits independently.
 */
export const OTP_MAX_VERIFY_ATTEMPTS = 3;

/**
 * Max resend requests the frontend allows per session (soft UI gate).
 * The otp-security Edge Function enforces the hard limit.
 */
export const OTP_MAX_RESENDS = 3;

// ── Password policy ───────────────────────────────────────────────────────────

/** Minimum password length. Must match passwordSchema in auth.ts. */
export const PASSWORD_MIN_LENGTH = 8;

/** Maximum password length (bcrypt limit). Must match passwordSchema. */
export const PASSWORD_MAX_LENGTH = 72;

// ── Legal versions ────────────────────────────────────────────────────────────

/** Current terms-of-service version. Must match log_legal_acceptance RPC. */
export const TERMS_VERSION = '2024-11-01';

/** Current privacy-policy version. Must match log_legal_acceptance RPC. */
export const PRIVACY_VERSION = '2024-11-01';

// ── Rate limiter (client-side UI hints) ───────────────────────────────────────

/** Attempts within RATE_WINDOW_MS before the client-side rate limiter fires. */
export const CLIENT_RATE_MAX_ATTEMPTS = 5;

/** Window for the client-side rate limiter (ms). */
export const CLIENT_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 min

// ── Edge Function names ───────────────────────────────────────────────────────

export const EF_LOGIN_SECURITY = 'login-security';
export const EF_OTP_SECURITY   = 'otp-security';

// ── Bot detection ────────────────────────────────────────────────────────────

/** Form fill time below this threshold (ms) is flagged as potential bot activity. */
export const BOT_FORM_FILL_THRESHOLD_MS = 800;
