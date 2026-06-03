/**
 * Deep-link landing page for miosusu://auth/callback
 *
 * This route is only reached when the OAuth redirect arrives outside the
 * in-app WebBrowser flow (e.g. the user opens a link from an email client).
 * The Supabase onAuthStateChange listener in _layout.tsx picks up the session;
 * this screen just shows a spinner while that completes.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuthStore } from '../../src/store/authStore';

export default function AuthCallback() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    // Signal expo-web-browser to close if it is still open.
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (session) {
      router.replace('/(main)/home');
    }
  }, [session]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#F97316" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
});
