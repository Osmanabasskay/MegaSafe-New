/**
 * Google sign-in via Supabase OAuth.
 *
 * Supabase dashboard: Authentication → Providers → Google (enable + Web client ID / secret).
 * Authentication → URL Configuration → Redirect URLs must include the URI from getGoogleOAuthRedirectUri()
 * (e.g. megasafe://auth/callback, plus Expo Go URLs from makeRedirectUri in dev).
 */
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export function getGoogleOAuthRedirectUri(): string {
  return makeRedirectUri({
    scheme: 'megasafe',
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

export async function signInWithGoogle(): Promise<{
  session: Session | null;
  error: Error | null;
  cancelled: boolean;
}> {
  if (Platform.OS === 'web') {
    const { error } = await signInWithGoogleWeb();
    return { session: null, error, cancelled: false };
  }
  return signInWithGoogleNative();
}
