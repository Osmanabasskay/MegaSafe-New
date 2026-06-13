/**
 * Tests for Google OAuth flow (Vitest) — updated for Section E hardening.
 *
 * Section E changes that require test updates:
 *  - CSRF state param: randomHex(32) stored in SecureStore, verified on callback.
 *  - Nonce: randomHex(16) stored and cleared.
 *  - Role check: supabase.from('user_roles') queried after session established.
 *  - Callback URLs must include ?state=<stored_value> to pass CSRF verification.
 *
 * Coverage:
 *  - getGoogleOAuthRedirectUri returns miosusu scheme
 *  - returns session via code exchange path (state present)
 *  - returns session via token fragment path (state present)
 *  - CSRF state mismatch returns error
 *  - returns cancelled=true when user dismisses browser
 *  - returns error when OAuth URL not returned by Supabase
 *  - returns error when signInWithOAuth itself errors
 *  - returns error when code exchange fails
 *  - returns error when browser type is not success/cancel
 *  - role anomaly (non-member) → session rejected
 *  - audit log is written on successful login
 *  - audit log failure does not propagate or block the result
 *  - no audit log written on cancellation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── SecureStore mock — in-memory, simulates iOS/Android Keychain ──────────────
// Must be declared before vi.mock calls that reference it.
const _secureStore = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  setItemAsync:    vi.fn((k: string, v: string)  => { _secureStore.set(k, v); return Promise.resolve(); }),
  getItemAsync:    vi.fn((k: string)              => Promise.resolve(_secureStore.get(k) ?? null)),
  deleteItemAsync: vi.fn((k: string)              => { _secureStore.delete(k); return Promise.resolve(); }),
}));

// ── loginSecurity mock — deterministic state + nonce ─────────────────────────
// 32-byte state → 64 hex chars; 16-byte nonce → 32 hex chars.
export const FIXED_STATE = 'aabb00112233445566778899ccddee00aabb00112233445566778899ccddee00';
export const FIXED_NONCE = 'aabb00112233445566778899ccddee00';

vi.mock('../../src/utils/auth/loginSecurity', () => ({
  randomHex: vi.fn((bytes: number) => bytes === 32 ? FIXED_STATE : FIXED_NONCE),
}));

// ── expo-web-browser mock ─────────────────────────────────────────────────────
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(() => 'miosusu://auth/callback'),
}));

// ── Supabase mock — includes from() for user_roles role check ─────────────────
vi.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth:        vi.fn(),
      exchangeCodeForSession: vi.fn(),
      setSession:             vi.fn(),
      signOut:                vi.fn().mockResolvedValue({ error: null }),
    },
    rpc:  vi.fn(),
    from: vi.fn().mockReturnValue({
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'member' }, error: null }),
    }),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import * as WebBrowser  from 'expo-web-browser';
import * as supabaseMod from '../../src/services/supabase';
import { signInWithGoogle, getGoogleOAuthRedirectUri } from '../../src/services/auth/googleOAuth';

const mockOpenAuth   = vi.mocked(WebBrowser.openAuthSessionAsync);
const mockOAuth      = vi.mocked(((supabaseMod.supabase.auth as unknown) as Record<string, unknown>).signInWithOAuth as ReturnType<typeof vi.fn>);
const mockExchange   = vi.mocked(((supabaseMod.supabase.auth as unknown) as Record<string, unknown>).exchangeCodeForSession as ReturnType<typeof vi.fn>);
const mockSetSession = vi.mocked(((supabaseMod.supabase.auth as unknown) as Record<string, unknown>).setSession as ReturnType<typeof vi.fn>);
const mockRpc        = vi.mocked(((supabaseMod.supabase as unknown) as Record<string, unknown>).rpc as ReturnType<typeof vi.fn>);
const mockFrom       = vi.mocked(((supabaseMod.supabase as unknown) as Record<string, unknown>).from as ReturnType<typeof vi.fn>);

const FAKE_SESSION = {
  access_token:  'at_abc',
  refresh_token: 'rt_abc',
  user: {
    id:    'user-uuid-123',
    email: 'test@gmail.com',
    user_metadata: { full_name: 'Test User', name: 'Test User' },
  },
};

// Callback URL that includes the CSRF state so verifyAndClearOAuthState passes.
const SUCCESS_URL_CODE    = `miosusu://auth/callback?code=abc123&state=${FIXED_STATE}`;
const SUCCESS_URL_TOKENS  = `miosusu://auth/callback?state=${FIXED_STATE}#access_token=at_abc&refresh_token=rt_abc`;

beforeEach(() => {
  vi.clearAllMocks();
  _secureStore.clear();

  // Default: OAuth URL provided, RPC succeeds, from() returns member role
  mockOAuth.mockResolvedValue({
    data: { url: 'https://accounts.google.com/o/oauth2/auth' },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: null, error: null });

  // Reset the from() chain mock to return role: 'member' by default
  const chainMock = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'member' }, error: null }),
  };
  mockFrom.mockReturnValue(chainMock);
});

// ── Redirect URI ──────────────────────────────────────────────────────────────

describe('getGoogleOAuthRedirectUri', () => {
  it('returns miosusu scheme URI', () => {
    expect(getGoogleOAuthRedirectUri()).toBe('miosusu://auth/callback');
  });
});

// ── Code exchange path ────────────────────────────────────────────────────────

describe('signInWithGoogle — code exchange path', () => {
  it('returns session when browser redirects with code= and matching state', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_CODE });
    mockExchange.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    const result = await signInWithGoogle();

    expect(result.cancelled).toBe(false);
    expect(result.error).toBeNull();
    expect(result.session).toEqual(FAKE_SESSION);
    expect(mockExchange).toHaveBeenCalledWith(SUCCESS_URL_CODE);
  });

  it('returns error when code exchange fails', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_CODE });
    mockExchange.mockResolvedValue({ data: null, error: { message: 'invalid_grant' } });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.cancelled).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('invalid_grant');
  });
});

// ── Token fragment path ───────────────────────────────────────────────────────

describe('signInWithGoogle — token fragment path', () => {
  it('returns session from access_token hash fragment (state in query)', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_TOKENS });
    mockSetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    const result = await signInWithGoogle();

    expect(result.session).toEqual(FAKE_SESSION);
    expect(result.error).toBeNull();
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at_abc', refresh_token: 'rt_abc' });
  });

  it('returns error when setSession fails', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_TOKENS });
    mockSetSession.mockResolvedValue({ data: null, error: { message: 'session_error' } });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error?.message).toBe('session_error');
  });
});

// ── CSRF state verification ───────────────────────────────────────────────────

describe('signInWithGoogle — CSRF state verification', () => {
  it('returns error when callback URL has wrong state (CSRF mismatch)', async () => {
    mockOpenAuth.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?code=abc&state=WRONG_STATE_VALUE',
    });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/state mismatch|try again/i);
  });

  it('returns error when callback URL has no state param', async () => {
    mockOpenAuth.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?code=abc123',
    });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ── Role anomaly guard ────────────────────────────────────────────────────────

describe('signInWithGoogle — role anomaly guard', () => {
  it('rejects session when DB role is not member', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_CODE });
    mockExchange.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    // Override from() to return role: 'admin' — privilege anomaly
    const anomalyChain = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'super_admin' }, error: null }),
    };
    mockFrom.mockReturnValue(anomalyChain);

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('rejects session when user_roles query errors', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_CODE });
    mockExchange.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    const errorChain = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'db_error' } }),
    };
    mockFrom.mockReturnValue(errorChain);

    const result = await signInWithGoogle();

    // Role check failure → session rejected
    expect(result.session).toBeNull();
  });
});

// ── Cancellation & failure paths ──────────────────────────────────────────────

describe('signInWithGoogle — cancellation and failure', () => {
  it('returns cancelled=true when user dismisses the browser', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'cancel' } as Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>);

    const result = await signInWithGoogle();

    expect(result.cancelled).toBe(true);
    expect(result.session).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns error when browser returns a non-success type', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'dismiss' } as Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>);

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.cancelled).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns error when Supabase does not return an OAuth URL', async () => {
    mockOAuth.mockResolvedValue({ data: { url: null }, error: null });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it('returns error when signInWithOAuth itself errors', async () => {
    mockOAuth.mockResolvedValue({ data: null, error: { message: 'provider_disabled' } });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error?.message).toBe('provider_disabled');
  });

  it('returns error when callback URL has no code and no tokens (and state matches)', async () => {
    mockOpenAuth.mockResolvedValue({
      type: 'success',
      url:  `miosusu://auth/callback?state=${FIXED_STATE}`,
    });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('signInWithGoogle — audit log', () => {
  it('writes login audit entry after successful code exchange', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_CODE });
    mockExchange.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    await signInWithGoogle();
    // The audit log is written via `void logGoogleLoginAudit(...)` — flush the microtask queue
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRpc).toHaveBeenCalledWith('create_audit_log', expect.objectContaining({
      p_action:     'login',
      p_table_name: 'profiles',
      p_record_id:  FAKE_SESSION.user.id,
      p_new_data:   { provider: 'google', success: true },
    }));
  });

  it('does not write audit log when login is cancelled', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'cancel' } as Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>);

    await signInWithGoogle();
    await Promise.resolve();

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('audit log failure does not block session result', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'success', url: SUCCESS_URL_CODE });
    mockExchange.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });
    mockRpc.mockRejectedValue(new Error('db_unreachable'));

    const result = await signInWithGoogle();
    await Promise.resolve();
    await Promise.resolve();

    expect(result.session).toEqual(FAKE_SESSION);
    expect(result.error).toBeNull();
  });
});
