/**
 * Tests for Google OAuth flow (Vitest).
 *
 * Coverage:
 *  - getGoogleOAuthRedirectUri returns miosusu scheme
 *  - returns session via code exchange path
 *  - returns session via token fragment path
 *  - returns cancelled=true when user dismisses browser
 *  - returns error when OAuth URL not returned by Supabase
 *  - returns error when signInWithOAuth itself errors
 *  - returns error when code exchange fails
 *  - returns error when browser type is not success/cancel
 *  - audit log is written on successful login
 *  - audit log failure does not propagate or block the result
 *  - no audit log written on cancellation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(() => 'miosusu://auth/callback'),
}));

vi.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth:        vi.fn(),
      exchangeCodeForSession: vi.fn(),
      setSession:             vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

import * as WebBrowser from 'expo-web-browser';
import * as supabaseMock from '../../src/services/supabase';
import { signInWithGoogle, getGoogleOAuthRedirectUri } from '../../src/services/auth/googleOAuth';

const mockOpenAuthSession  = vi.mocked(WebBrowser.openAuthSessionAsync);
const mockSignInWithOAuth  = vi.mocked((supabaseMock.supabase.auth as any).signInWithOAuth);
const mockExchangeCode     = vi.mocked((supabaseMock.supabase.auth as any).exchangeCodeForSession);
const mockSetSession       = vi.mocked((supabaseMock.supabase.auth as any).setSession);
const mockRpc              = vi.mocked((supabaseMock.supabase as any).rpc);

const FAKE_SESSION = {
  access_token:  'at_abc',
  refresh_token: 'rt_abc',
  user: {
    id:    'user-uuid-123',
    email: 'test@gmail.com',
    user_metadata: { full_name: 'Test User', name: 'Test User' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSignInWithOAuth.mockResolvedValue({
    data: { url: 'https://accounts.google.com/o/oauth2/auth?state=x' },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

// ── Redirect URI ──────────────────────────────────────────────────────────────

describe('getGoogleOAuthRedirectUri', () => {
  it('returns miosusu scheme URI', () => {
    expect(getGoogleOAuthRedirectUri()).toBe('miosusu://auth/callback');
  });
});

// ── Code exchange path ────────────────────────────────────────────────────────

describe('signInWithGoogle — code exchange path', () => {
  it('returns session when browser redirects with code= param', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?code=abc123',
    });
    mockExchangeCode.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    const result = await signInWithGoogle();

    expect(result.cancelled).toBe(false);
    expect(result.error).toBeNull();
    expect(result.session).toEqual(FAKE_SESSION);
    expect(mockExchangeCode).toHaveBeenCalledWith('miosusu://auth/callback?code=abc123');
  });

  it('returns error when code exchange fails', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?code=badcode',
    });
    mockExchangeCode.mockResolvedValue({ data: null, error: { message: 'invalid_grant' } });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.cancelled).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('invalid_grant');
  });
});

// ── Token fragment path ───────────────────────────────────────────────────────

describe('signInWithGoogle — token fragment path', () => {
  it('returns session from access_token hash fragment', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback#access_token=at_abc&refresh_token=rt_abc',
    });
    mockSetSession.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    const result = await signInWithGoogle();

    expect(result.session).toEqual(FAKE_SESSION);
    expect(result.error).toBeNull();
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at_abc', refresh_token: 'rt_abc' });
  });

  it('returns error when setSession fails', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback#access_token=at&refresh_token=rt',
    });
    mockSetSession.mockResolvedValue({ data: null, error: { message: 'session_error' } });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error?.message).toBe('session_error');
  });
});

// ── Cancellation & failure paths ──────────────────────────────────────────────

describe('signInWithGoogle — cancellation and failure', () => {
  it('returns cancelled=true when user dismisses the browser', async () => {
    mockOpenAuthSession.mockResolvedValue({ type: 'cancel' });

    const result = await signInWithGoogle();

    expect(result.cancelled).toBe(true);
    expect(result.session).toBeNull();
    expect(result.error).toBeNull();
  });

  it('returns error when browser returns a non-success type', async () => {
    mockOpenAuthSession.mockResolvedValue({ type: 'dismiss' });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.cancelled).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns error when Supabase does not return an OAuth URL', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });

  it('returns error when signInWithOAuth itself errors', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: null,
      error: { message: 'provider_disabled' },
    });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error?.message).toBe('provider_disabled');
  });

  it('returns error when callback URL has no code and no tokens', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?state=xyz',
    });

    const result = await signInWithGoogle();

    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('signInWithGoogle — audit log', () => {
  it('writes login audit entry after successful code exchange', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?code=abc',
    });
    mockExchangeCode.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    await signInWithGoogle();
    await Promise.resolve(); // flush void promise

    expect(mockRpc).toHaveBeenCalledWith('create_audit_log', expect.objectContaining({
      p_action:     'login',
      p_table_name: 'profiles',
      p_record_id:  FAKE_SESSION.user.id,
      p_new_data:   { provider: 'google', success: true },
    }));
  });

  it('does not write audit log when login is cancelled', async () => {
    mockOpenAuthSession.mockResolvedValue({ type: 'cancel' });

    await signInWithGoogle();
    await Promise.resolve();

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('audit log failure does not block session result', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url:  'miosusu://auth/callback?code=abc',
    });
    mockExchangeCode.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });
    mockRpc.mockRejectedValue(new Error('db_unreachable'));

    const result = await signInWithGoogle();
    await Promise.resolve();

    expect(result.session).toEqual(FAKE_SESSION);
    expect(result.error).toBeNull();
  });
});
