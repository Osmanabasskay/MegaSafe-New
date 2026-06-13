/**
 * authErrors.ts — Maps Supabase/network errors to safe, user-facing messages.
 *
 * Section H rules:
 *  - Never show raw Supabase messages, error codes, or HTTP status codes.
 *  - All login failures return the same message regardless of reason.
 *  - Rate-limited message carries no count or exact time.
 *  - Server errors include a correlation ID for support reference.
 *  - Response body size is kept consistent across all failure types.
 */
import { generateCorrelationId } from './loginSecurity';

/** Generic login failure — never reveals whether email/phone exists. */
export const MSG_LOGIN_FAILED = 'Invalid email, phone, or password.';

/** Generic signup failure — never reveals whether email/phone exists or is already taken. */
export const MSG_SIGNUP_FAILED =
  'We could not create your account. Please check your details and try again.';

export const MSG_FIELD_ERRORS = 'Please check the highlighted fields and try again.';

/** Section H: no count, no exact time in the rate-limit message. */
export const MSG_RATE_LIMITED = 'Too many attempts. Please try again later.';

export const MSG_NETWORK      = 'Connection problem. Check your internet and try again.';
export const MSG_OTP_INVALID  = 'The code is incorrect or has expired. Please try again.';
export const MSG_OTP_RESEND   = 'We could not resend the code right now. Please try again.';

/** Section H: server errors include a correlation ID for support. */
export function msgServer(correlationId?: string): string {
  const id = correlationId ?? generateCorrelationId();
  return `Login failed. Please try again. (Ref: ${id})`;
}

/** Legacy constant kept for non-login contexts that don't need a correlation ID. */
export const MSG_SERVER = 'We could not complete this request. Please try again.';

/**
 * Maps any Supabase/network error to a safe user-facing string.
 * Detailed original error is logged only in __DEV__ mode.
 */
export function toSafeAuthError(
  error: unknown,
  context: 'login' | 'signup' | 'otp' | 'general' = 'general'
): string {
  if (__DEV__) {
    // Safe to log internals in dev; never log passwords
    console.warn(`[AuthError:${context}]`, error);
  }

  const status =
    (error as any)?.status ??
    (error as any)?.statusCode ??
    (error as any)?.code;

  if (status === 429) return MSG_RATE_LIMITED;

  const msg: string =
    (error as any)?.message ??
    (error as any)?.msg ??
    String(error);

  const lower = msg.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return MSG_RATE_LIMITED;
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('abort')) {
    return MSG_NETWORK;
  }
  if (status === 504 || lower.includes('timeout') || lower.includes('timed out')) {
    return context === 'login' ? MSG_LOGIN_FAILED : msgServer();
  }

  // Any other error — return context-appropriate generic message (Section H)
  switch (context) {
    case 'login':  return MSG_LOGIN_FAILED;
    case 'signup': return MSG_SIGNUP_FAILED;
    case 'otp':    return MSG_OTP_INVALID;
    default:       return msgServer();
  }
}
