/**
 * Google sign-in via Supabase OAuth.
 *
 * Supabase dashboard: Authentication → Providers → Google (enable + Web client ID / secret).
 * Authentication → URL Configuration → Redirect URLs must include the URI from getGoogleOAuthRedirectUri()
 * (e.g. miosusu://auth/callback, plus Expo Go URLs from makeRedirectUri in dev).
 *
 * Security model:
 *  - No service_role key or Google client secrets in this file.
 *  - Tokens are never logged, even in __DEV__.
 *  - Audit log written via SECURITY DEFINER RPC (actor_id = auth.uid() server-side).
 *  - Profile creation is handled by the on_auth_user_created DB trigger.
 *  - Role is always 'member'; never injected from OAuth metadata.
 */
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

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

async function signInWithGoogleNative(): Promise<{
  session: Session | null;
  error: Error | null;
  cancelled: boolean;
}> {
  const redirectTo = getGoogleOAuthRedirectUri();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) return { session: null, error: new Error(error.message), cancelled: false };
  if (!data?.url) return { session: null, error: new Error('No OAuth URL returned'), cancelled: false };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel') {
    return { session: null, error: null, cancelled: true };
  }
  if (result.type !== 'success' || !result.url) {
    return { session: null, error: new Error('Sign-in was not completed'), cancelled: false };
  }

  const url = result.url;
  if (url.includes('code=')) {
    const { data: exchangeData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(url);
    if (exchangeError) return { session: null, error: new Error(exchangeError.message), cancelled: false };
    return { session: exchangeData.session, error: null, cancelled: false };
  }

  const tokens = parseTokensFromUrl(url);
  if (tokens) {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession(tokens);
    if (sessionError) return { session: null, error: new Error(sessionError.message), cancelled: false };
    return { session: sessionData.session, error: null, cancelled: false };
  }

  return {
    session: null,
    error: new Error('Could not complete sign-in from redirect URL'),
    cancelled: false,
  };
}

async function signInWithGoogleWeb(): Promise<{ error: Error | null }> {
  if (typeof window === 'undefined') return { error: new Error('Web only') };
  const redirectTo = `${window.location.origin}/`;
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
  } catch {
    // Audit log failure must never interrupt the auth flow
    if (__DEV__) console.warn('[googleOAuth] audit log write failed');
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
