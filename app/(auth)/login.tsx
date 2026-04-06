import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { signInWithGoogle } from '../../lib/auth/googleOAuth';
import { normalizePhoneE164, isValidE164 } from '../../lib/auth/phone';
import { fetchProfile } from '../../lib/profileService';
import {
  getCredentialDisplayName,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../lib/profileName';
import { Shield, Mail, Lock, ChevronRight, Smartphone, Eye, EyeOff } from 'lucide-react-native';

export default function LoginScreen() {
  const router = useRouter();
  const { setSession, setUser } = useAuthStore();
  const { initializeForUser, updateProfile } = useAppDataStore();
  const [authMode, setAuthMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const clearErrorOnChange = () => {
    if (errorMessage) setErrorMessage(null);
  };

  const syncProfileFromSession = async (session: Session) => {
    initializeForUser(session.user);

    const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
    const metadataName = normalizeProfileName(
      (typeof metadata.full_name === 'string' && metadata.full_name) ||
        (typeof metadata.name === 'string' && metadata.name) ||
        [metadata.first_name, metadata.last_name]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join(' ')
    );
    const credentialName = getCredentialDisplayName(session.user.email, session.user.phone);

    updateProfile({
      fullName: !isPlaceholderProfileName(metadataName) ? metadataName : credentialName,
      email: session.user.email ?? undefined,
      phone: session.user.phone ?? undefined,
    });

    const { profile } = await fetchProfile(session.user.id);
    if (!profile) return;

    const remoteName = normalizeProfileName(
      [profile.first_name, profile.last_name]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
    );
    const resolvedName = !isPlaceholderProfileName(remoteName)
      ? remoteName
      : !isPlaceholderProfileName(metadataName)
        ? metadataName
        : credentialName;

    updateProfile({
      fullName: resolvedName,
      email: profile.email ?? session.user.email ?? undefined,
      phone: profile.phone ?? session.user.phone ?? undefined,
      verificationStatus: profile.kyc_status === 'approved' ? 'Verified' : 'Pending',
    });
  };

  const handleEmailLogin = async () => {
    setErrorMessage(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }

    if (!supabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo with: npx expo start -c'
      );
      return;
    }

    setIsLoading(true);
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['data'];
    let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>['error'];
    try {
      const result = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      data = result.data;
      error = result.error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|failed|fetch/i.test(msg)) {
        setErrorMessage(
          'Cannot reach Supabase. Check your internet connection, VPN/firewall, and EXPO_PUBLIC_SUPABASE_URL in .env.'
        );
      } else {
        setErrorMessage(msg);
      }
      setIsLoading(false);
      return;
    }
    setIsLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);
      await syncProfileFromSession(data.session);
      router.replace('/(main)/home');
    }
  };

  const handleSendPhoneOtp = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo with: npx expo start -c'
      );
      return;
    }

    const normalized = normalizePhoneE164(phone);
    if (!isValidE164(normalized)) {
      setErrorMessage('Enter a valid number with country code (e.g. +233201234567).');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: true },
      });
      setIsLoading(false);
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: encodeURIComponent(normalized) },
      });
    } catch (e) {
      setIsLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|failed|fetch/i.test(msg)) {
        setErrorMessage(
          'Cannot reach Supabase. Check connectivity and Phone provider settings in the Supabase dashboard.'
        );
      } else {
        setErrorMessage(msg);
      }
    }
  };

  const handleGoogle = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo with: npx expo start -c'
      );
      return;
    }

    setIsGoogleLoading(true);
    try {
      const { session, error, cancelled } = await signInWithGoogle();
      if (cancelled) {
        setIsGoogleLoading(false);
        return;
      }
      if (error) {
        setErrorMessage(error.message);
        setIsGoogleLoading(false);
        return;
      }
      if (session) {
        setSession(session);
        setUser(session.user);
        await syncProfileFromSession(session);
        router.replace('/(main)/home');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
    }
    setIsGoogleLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoWrap}>
            <View style={styles.logoBadge}>
              <Image
                source={require('../../assets/MegaSafe Logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.title}>MegaSafe</Text>
            <Text style={styles.subtitle}>Save Together, Grow Together</Text>
          </View>

          <View style={styles.formCard}>
            <View style={styles.modeWrap}>
              <TouchableOpacity
                onPress={() => {
                  setAuthMode('email');
                  clearErrorOnChange();
                }}
                style={[styles.modeBtn, authMode === 'email' && styles.modeBtnActive]}
              >
                <Text style={[styles.modeText, authMode === 'email' && styles.modeTextActive]}>Email</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setAuthMode('phone');
                  clearErrorOnChange();
                }}
                style={[styles.modeBtn, authMode === 'phone' && styles.modeBtnActive]}
              >
                <Text style={[styles.modeText, authMode === 'phone' && styles.modeTextActive]}>Phone</Text>
              </TouchableOpacity>
            </View>

            {authMode === 'email' ? (
              <>
                <Text style={styles.inputLabel}>Email Address</Text>
                <View style={styles.inputWrap}>
                  <Mail size={18} color="#9CA3AF" />
                  <TextInput
                    style={styles.input}
                    placeholder="Secure email"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      clearErrorOnChange();
                    }}
                  />
                </View>

                <Text style={styles.inputLabel}>Passphrase</Text>
                <View style={styles.inputWrap}>
                  <Lock size={18} color="#9CA3AF" />
                  <TextInput
                    style={styles.input}
                    placeholder="********"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      clearErrorOnChange();
                    }}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={18} color="#9CA3AF" /> : <Eye size={18} color="#9CA3AF" />}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.forgotRow} onPress={() => router.push('/(auth)/forgot-password')}>
                  <Text style={styles.forgotText}>Forgot Access Key?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleEmailLogin}
                  disabled={isLoading || isGoogleLoading}
                  style={styles.primaryButton}
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Sign In</Text>
                      <ChevronRight size={18} color="white" />
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.inputLabel}>Mobile Number</Text>
                <View style={styles.inputWrap}>
                  <Smartphone size={18} color="#9CA3AF" />
                  <TextInput
                    style={styles.input}
                    placeholder="+233201234567"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    value={phone}
                    onChangeText={(t) => {
                      setPhone(t);
                      clearErrorOnChange();
                    }}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSendPhoneOtp}
                  disabled={isLoading || isGoogleLoading}
                  style={styles.primaryButton}
                >
                  {isLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Send verification code</Text>
                      <ChevronRight size={18} color="white" />
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <View style={styles.separatorRow}>
              <View style={styles.separatorLine} />
              <Text style={styles.separatorText}>or continue with</Text>
              <View style={styles.separatorLine} />
            </View>

            <TouchableOpacity onPress={handleGoogle} disabled={isLoading || isGoogleLoading} style={styles.googleBtn}>
              {isGoogleLoading ? (
                <ActivityIndicator color="#1f2937" />
              ) : (
                <>
                  <Shield size={16} color="#1f2937" />
                  <Text style={styles.googleText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.bottomRow}>
            <Text style={styles.bottomText}>Unregistered entity? </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text style={styles.bottomLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  logo: {
    width: 54,
    height: 54,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6B7280',
  },
  formCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    padding: 18,
  },
  modeWrap: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
  },
  modeBtnActive: {
    backgroundColor: '#F97316',
  },
  modeText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 52,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: '#111827',
  },
  forgotRow: {
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  forgotText: {
    color: '#F97316',
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    marginTop: 10,
    color: '#DC2626',
    fontSize: 13,
  },
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  separatorText: {
    marginHorizontal: 8,
    color: '#9CA3AF',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  googleBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  googleText: {
    color: '#1f2937',
    fontWeight: '700',
    fontSize: 14,
  },
  bottomRow: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  bottomText: {
    color: '#6B7280',
    fontSize: 13,
  },
  bottomLink: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '700',
  },
});
