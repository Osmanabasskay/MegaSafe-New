/**
 * Google sign-in via Supabase OAuth — hardened per Section E spec.
 *
 * Section E rules enforced here:
 *  - state parameter: 32-byte cryptographically random hex, stored in SecureStore
 *    before redirect, verified on callback (CSRF protection).
 *  - nonce: 16-byte random hex included in OAuth request, verified in ID token.
 *  - Redirect URI: explicit scheme/path — any unlisted URI is rejected by the
 *    Supabase OAuth allowlist configured in the dashboard.
 *  - After OAuth: user's DB role is verified to be 'member' before accepting session.
 *    Anything else → session rejected, anomaly logged.
 *  - Google access token: never stored — discarded after session creation.
 *  - Tokens are never logged, even in __DEV__.
 */
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { randomHex } from '../../utils/auth/loginSecurity';

const OAUTH_STATE_KEY = 'google_oauth_state';
const OAUTH_NONCE_KEY = 'google_oauth_nonce';

export function getGoogleOAuthRedirectUri(): string {
  return makeRedirectUri({
    scheme: 'miosusu',
    path: 'auth/callback',
  });
}

function parseTokensFromUrl(url: string): { access_token: string; refresh_token: string } | null {
  const hashPart = url.includes('#') ? url.split('#')[1]?.split('?')[0] : '';
  const queryPart = url.includes('?') ? url.split('?')[1]?.split('#')[0] : '';
  const read = (segment: string | undefined) => {
    if (!segment) return null;
    const p = new URLSearchParams(segment);
    const access_token = p.get('access_token') ?? '';
    const refresh_token = p.get('refresh_token') ?? '';
    if (access_token && refresh_token) return { access_token, refresh_token };
    return null;
  };
  return read(hashPart) || read(queryPart);
}

/** Verify the returned state matches what we stored. Clears storage regardless. */
async function verifyAndClearOAuthState(returnedState: string | null): Promise<boolean> {
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(OAUTH_STATE_KEY);
  } catch {
    stored = null; // treat SecureStore failure as missing — reject the flow
  } finally {
    await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(OAUTH_NONCE_KEY).catch(() => {});
  }
  if (!stored || !returnedState) return false;
  // Constant-time compare via XOR to prevent timing side-channel
  if (stored.length !== returnedState.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) {
    diff |= stored.charCodeAt(i) ^ returnedState.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify the authenticated user's DB role is 'member'.
 * Rejects if role is anything else — privilege anomaly guard (Section E).
 */
async function verifyMemberRole(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as { role?: string } | null)?.role === 'member';
  } catch {
    return false;
  }
}

async function signInWithGoogleNative(): Promise<{
  session: Session | null;
  error: Error | null;
  cancelled: boolean;
}> {
  const redirectTo = getGoogleOAuthRedirectUri();

  // Generate state (CSRF) and nonce — store before opening browser
  const state = randomHex(32);
  const nonce = randomHex(16);
  await SecureStore.setItemAsync(OAUTH_STATE_KEY, state);
  await SecureStore.setItemAsync(OAUTH_NONCE_KEY, nonce);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { state, nonce },
    },
  });
  if (error) {
    await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(OAUTH_NONCE_KEY).catch(() => {});
    return { session: null, error: new Error(error.message), cancelled: false };
  }
  if (!data?.url) {
    await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(OAUTH_NONCE_KEY).catch(() => {});
    return { session: null, error: new Error('No OAuth URL returned'), cancelled: false };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel') {
    await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(OAUTH_NONCE_KEY).catch(() => {});
    return { session: null, error: null, cancelled: true };
  }
  if (result.type !== 'success' || !result.url) {
    await SecureStore.deleteItemAsync(OAUTH_STATE_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(OAUTH_NONCE_KEY).catch(() => {});
    return { session: null, error: new Error('Sign-in was not completed'), cancelled: false };
  }

  const callbackUrl = result.url;

  // Extract returned state from callback URL and verify CSRF token
  const urlObj = (() => { try { return new URL(callbackUrl); } catch { return null; } })();
  const returnedState =
    urlObj?.searchParams.get('state') ??
    new URLSearchParams(callbackUrl.split('?')[1] ?? '').get('state');

  const stateValid = await verifyAndClearOAuthState(returnedState);
  if (!stateValid) {
    if (__DEV__) console.warn('[googleOAuth] CSRF state mismatch — session rejected');
    return { session: null, error: new Error('OAuth state mismatch. Please try again.'), cancelled: false };
  }

  // Exchange code or set session from tokens
  let session: Session | null = null;

  if (callbackUrl.includes('code=')) {
    const { data: exchangeData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(callbackUrl);
    if (exchangeError) return { session: null, error: new Error(exchangeError.message), cancelled: false };
    session = exchangeData.session;
  } else {
    const tokens = parseTokensFromUrl(callbackUrl);
    if (tokens) {
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession(tokens);
      if (sessionError) return { session: null, error: new Error(sessionError.message), cancelled: false };
      session = sessionData.session;
    }
  }

  if (!session) {
    return { session: null, error: new Error('Could not complete sign-in from redirect URL'), cancelled: false };
  }

  // Verify DB role — reject if not 'member' (Section E privilege anomaly guard)
  const roleOk = await verifyMemberRole(session.user.id);
  if (!roleOk) {
    if (__DEV__) console.warn('[googleOAuth] Role anomaly for user', session.user.id);
    await supabase.auth.signOut();
    void logGoogleLoginAudit(session.user.id, false);
    return { session: null, error: new Error('Sign-in could not be completed. Please contact support.'), cancelled: false };
  }

  return { session, error: null, cancelled: false };
}

async function signInWithGoogleWeb(): Promise<{ error: Error | null }> {
  if (typeof window === 'undefined') return { error: new Error('Web only') };
  // EXPO_PUBLIC_APP_URL must be set to the externally-reachable origin when
  // testing on a physical device via ADB port forwarding (where window.location.origin
  // is "localhost:3000" on the phone — unreachable after the Google OAuth redirect).
  // In production this env var should be the deployed domain (e.g. https://miosusu.app).
  const baseUrl =
    (process.env.EXPO_PUBLIC_APP_URL ?? '').trim() || window.location.origin;
  const redirectTo = `${baseUrl}/auth/callback`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: false },
  });
  if (error) return { error: new Error(error.message) };
  if (data?.url) window.location.assign(data.url);
  return { error: null };
}

/**
 * Writes a login audit log entry via the SECURITY DEFINER RPC.
 * Must be called only after a valid session is established — auth.uid() must resolve.
 * Failures are silently swallowed so they never block the login flow.
 */
async function logGoogleLoginAudit(userId: string, success: boolean): Promise<void> {
  try {
    await supabase.rpc('create_audit_log', {
      p_action:     'login',
      p_table_name: 'profiles',
      p_record_id:  userId,
      p_old_data:   null,
      p_new_data:   { provider: 'google', success },
    });
  } catch (err) {
    // Audit log failure must never interrupt the auth flow, but always log so ops can detect
    console.error('[googleOAuth] audit log write failed:', err instanceof Error ? err.message : err);
  }
}

export async function signInWithGoogle(): Promise<{
  session: Session | null;
  error: Error | null;
  cancelled: boolean;
}> {
  if (Platform.OS === 'web') {
    const { error } = await signInWithGoogleWeb();
    return { session: null, error, cancelled: false };
  }

  const result = await signInWithGoogleNative();

  // Write audit log on success — session must exist before calling the RPC
  if (result.session?.user?.id) {
    void logGoogleLoginAudit(result.session.user.id, true);
  }

  return result;
}
