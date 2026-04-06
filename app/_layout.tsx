import './global.css';
import { useEffect } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

const queryClient = new QueryClient();

export default function RootLayout() {
  const { session, isLoading, refreshSession } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    refreshSession();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const currentPath = segments.join('/');
    const inAuthGroup = currentPath.startsWith('(auth)');
    const inPublicWelcome = currentPath === 'welcome' || currentPath === '';
    const inPublicLegalScreen =
      currentPath === '(settings)/terms' || currentPath === '(settings)/privacy';

    // Keep auth screens accessible even if a stale session appears briefly.
    if (!session && !inAuthGroup && !inPublicLegalScreen && !inPublicWelcome) {
      router.replace('/(auth)/login');
    }
  }, [session, isLoading, segments]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
