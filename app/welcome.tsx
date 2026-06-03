import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, ShieldCheck, Users } from 'lucide-react-native';
import { useState } from 'react';
import { useAuthStore } from '../src/store/authStore';

export default function WelcomeScreen() {
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);
  const hasSession = useAuthStore((state) => Boolean(state.session));
  const [routingTo, setRoutingTo] = useState<'login' | 'intro' | null>(null);

  const routeToAuth = async (path: '/(auth)/intro' | '/(auth)/login', key: 'login' | 'intro') => {
    if (routingTo) return;
    setRoutingTo(key);
    try {
      if (hasSession) await logout();
      router.replace(path);
    } finally {
      setRoutingTo(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.backgroundMark} pointerEvents="none" />
      <View style={styles.dots} pointerEvents="none">
        {Array.from({ length: 12 }).map((_, i) => <View key={i} style={styles.dotMark} />)}
      </View>

      <View style={styles.brandBlock}>
        <View style={styles.logoShell}>
          <Image
            source={require('../assets/logos/mi-osusu/mi-osusu-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.appName}>Mi Osusu</Text>
        <Text style={styles.tagline}>Secure community savings for Sierra Leone.</Text>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroIconRow}>
          <View style={styles.heroIcon}>
            <Users size={24} color="#F97316" />
          </View>
          <View style={styles.heroIcon}>
            <ShieldCheck size={24} color="#1E2B5A" />
          </View>
        </View>
        <Text style={styles.heroTitle}>Save together. Grow with confidence.</Text>
        <Text style={styles.heroCopy}>
          Sign in to continue, or create an account to see the guided photo introduction first.
        </Text>
      </View>

      <View style={styles.buttonStack}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => void routeToAuth('/(auth)/login', 'login')}
          disabled={!!routingTo}
          activeOpacity={0.86}
        >
          {routingTo === 'login' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => void routeToAuth('/(auth)/intro', 'intro')}
          disabled={!!routingTo}
          activeOpacity={0.86}
        >
          {routingTo === 'intro' ? (
            <ActivityIndicator color="#F97316" />
          ) : (
            <>
              <Text style={styles.secondaryButtonText}>Create Account</Text>
              <ArrowRight size={18} color="#F97316" strokeWidth={2.4} />
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.footerText}>
          The introduction screens are shown only when creating a new account.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 34,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  backgroundMark: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(249,115,22,0.12)',
  },
  dots: {
    position: 'absolute',
    left: 24,
    top: 78,
    width: 76,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  dotMark: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(249,115,22,0.55)',
  },
  brandBlock: {
    alignItems: 'center',
    paddingTop: 18,
  },
  logoShell: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
    marginBottom: 14,
  },
  logo: {
    width: 64,
    height: 64,
  },
  appName: {
    fontSize: 30,
    fontWeight: '800',
    color: '#F97316',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: '#64748B',
    textAlign: 'center',
  },
  heroCard: {
    borderRadius: 26,
    backgroundColor: '#FFF7ED',
    padding: 22,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  heroIconRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 30,
    lineHeight: 37,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  heroCopy: {
    fontSize: 15,
    lineHeight: 23,
    color: '#64748B',
  },
  buttonStack: {
    gap: 12,
  },
  button: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#F97316',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F97316',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#F97316',
    fontSize: 16,
    fontWeight: '800',
  },
  footerText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
    marginTop: 4,
  },
});
