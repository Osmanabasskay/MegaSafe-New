import './global.css';
import { useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../src/store/authStore';
import { useComplianceStore } from '../src/store/complianceStore';
import { supabase, supabaseConfigured } from '../src/services/supabase';
import SplashAnimation from './components/SplashAnimation';

const queryClient = new QueryClient();

export default function RootLayout() {
  const { session, isLoading, setSession, setUser, setLoading } = useAuthStore();
  const termsAcceptedAt = useComplianceStore((s) => s.termsAcceptedAt);
  const privacyAcceptedAt = useComplianceStore((s) => s.privacyAcceptedAt);
  // The animated splash is a native intro only. On web it would otherwise sit on
  // top of the whole app for 5s on every load/reload, blanking first paint and
  // blocking automated testing — so skip it on web.
  const [showSplash, setShowSplash] = useState(Platform.OS !== 'web');
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    // Read the stored session once on mount (may trigger a silent token refresh).
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Mirror every auth state change (sign-in, sign-out, background token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const currentPath = segments.join('/');
    const inAuthGroup = currentPath.startsWith('(auth)');
    const inPublicWelcome = currentPath === 'welcome' || currentPath === '';
    const inPublicLegalScreen =
      currentPath === '(settings)/terms' || currentPath === '(settings)/privacy';

    if (session) {
      // Authenticated — nothing to redirect (router stays in main app).
      return;
    }

    // Unauthenticated routing.
    if (inAuthGroup || inPublicLegalScreen) return; // let auth screens render freely

    const hasCompletedOnboarding = !!(termsAcceptedAt && privacyAcceptedAt);

    if (hasCompletedOnboarding) {
      // Returning user — skip welcome, go straight to login.
      if (!inAuthGroup) router.replace('/(auth)/login');
    } else {
      // New user — show the welcome / auth-landing screen.
      if (!inPublicWelcome) router.replace('/welcome');
    }
  }, [session, isLoading, segments, termsAcceptedAt, privacyAcceptedAt]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
        {showSplash && <SplashAnimation onDone={() => setShowSplash(false)} />}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
