import { Stack, Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../../src/store/authStore';
import { fetchProfile } from '../../src/services/profileService';

export default function KYCLayout() {
  const { session, isLoading } = useAuthStore();
  const router = useRouter();

  // Track whether the one-time KYC-status guard check has completed.
  // We start as false so the spinner shows while auth + profile are resolving.
  const [statusChecked, setStatusChecked] = useState(false);

  useEffect(() => {
    // No session yet — auth is still loading or user is unauthenticated.
    // Either way the <Redirect> below will handle it; unblock the check.
    if (!session?.user.id) {
      setStatusChecked(true);
      return;
    }

    // Reset check whenever the logged-in user changes (e.g. account switch).
    setStatusChecked(false);

    fetchProfile(session.user.id)
      .then(({ profile }) => {
        // Approved users have no reason to re-enter the KYC flow.
        // The backend RPC also blocks re-submission, but redirecting here
        // gives instant feedback and avoids loading the whole form flow.
        if (profile?.kyc_status === 'approved') {
          router.replace('/(main)/home');
        }
      })
      .catch(() => {
        // Profile fetch failed (network, expired token, etc.).
        // Don't block the flow — let individual screens handle their own errors.
      })
      .finally(() => setStatusChecked(true));
  }, [session?.user.id]);

  // Show spinner while auth state is resolving OR while KYC status is being checked.
  if (isLoading || !statusChecked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="id-photos" />
      <Stack.Screen name="selfie" />
      <Stack.Screen name="details" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="guarantor" />
    </Stack>
  );
}
