import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Shield } from 'lucide-react-native';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { normalizeProfileName } from '../../lib/profileName';
import { logLegalAcceptance, upsertBasicProfile } from '../../lib/profileService';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { SafeAreaView } from 'react-native-safe-area-context';

const COOLDOWN_SEC = 60;

const decodeParam = (value: unknown): string => {
  if (value == null) return '';
  const raw = String(value);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    phone?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    legalAcceptedAt?: string;
  }>();
  const { setSession, setUser } = useAuthStore();
  const { initializeForUser, updateProfile } = useAppDataStore();
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const phoneE164 = decodeParam(params.phone);
  const firstName = decodeParam(params.firstName);
  const lastName = decodeParam(params.lastName);
  const email = decodeParam(params.email).toLowerCase();
  const legalAcceptedAt = decodeParam(params.legalAcceptedAt);

  useEffect(() => {
    if (!phoneE164) {
      setErrorMessage('Missing phone number. Go back and send a code again.');
    }
  }, [phoneE164]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendOtp = useCallback(async () => {
    if (!supabaseConfigured || !phoneE164) return;
    setIsResending(true);
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneE164,
      options: { shouldCreateUser: true },
    });
    setIsResending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setCooldown(COOLDOWN_SEC);
  }, [phoneE164]);

  const handleVerify = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured.');
      return;
    }
    if (!phoneE164) {
      setErrorMessage('Missing phone number.');
      return;
    }
    const token = code.trim().replace(/\s/g, '');
    if (token.length < 6) {
      setErrorMessage('Enter the 6-digit code from your SMS.');
      return;
    }

    setIsVerifying(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: phoneE164,
        token,
        type: 'sms',
      });

      if (error) {
        setIsVerifying(false);
        setErrorMessage(error.message);
        return;
      }

      if (!data.session) {
        setIsVerifying(false);
        setErrorMessage('Session was not created. Please retry verification.');
        return;
      }

      setSession(data.session);
      setUser(data.session.user);
      initializeForUser(data.session.user);

      const fullName = normalizeProfileName(`${firstName} ${lastName}`.trim());
      if (fullName || email || phoneE164) {
        updateProfile({
          fullName: fullName || undefined,
          email: email || undefined,
          phone: phoneE164 || undefined,
        });
      }

      if (data.session.user?.id) {
        const { error: profileError } = await upsertBasicProfile({
          userId: data.session.user.id,
          firstName,
          lastName,
          email,
          phone: phoneE164,
        });
        if (profileError && __DEV__) {
          console.warn('[OTP] Could not upsert profile basics:', profileError.message);
        }

        if (legalAcceptedAt) {
          const { error: legalError } = await logLegalAcceptance({
            userId: data.session.user.id,
            acceptedAt: legalAcceptedAt,
          });
          if (legalError && __DEV__) {
            console.warn('[OTP] Could not log legal acceptance:', legalError.message);
          }
        }
      }

      setIsVerifying(false);
      router.replace('/(main)/home');
    } catch (e) {
      setIsVerifying(false);
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          <View style={styles.headerWrap}>
            <View style={styles.iconBadge}>
              <Shield size={32} color="#F97316" strokeWidth={1.7} />
            </View>
            <Text style={styles.title}>Verify phone</Text>
            <Text style={styles.subtitle}>
              Enter the code sent to {phoneE164 || 'your number'}
            </Text>
          </View>

          <View style={styles.card}>
            <TextInput
              style={styles.codeInput}
              placeholder="------"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              onChangeText={(t) => {
                setCode(t.replace(/[^\d]/g, ''));
                if (errorMessage) setErrorMessage(null);
              }}
            />

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleVerify} disabled={isVerifying}>
              {isVerifying ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Verify & continue</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkBtn}
              onPress={sendOtp}
              disabled={isResending || cooldown > 0 || !phoneE164}
            >
              {isResending ? (
                <ActivityIndicator color="#6B7280" />
              ) : (
                <Text style={[styles.linkText, cooldown > 0 && styles.linkTextDisabled]}>
                  {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryLink} onPress={() => router.back()}>
              <Text style={styles.secondaryLinkText}>Change number</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  headerWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  subtitle: {
    marginTop: 4,
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    padding: 18,
  },
  codeInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    textAlign: 'center',
    fontSize: 28,
    letterSpacing: 8,
    color: '#1E2B5A',
    fontWeight: '700',
    paddingVertical: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#F97316',
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  linkBtn: {
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  linkText: {
    color: '#F97316',
    fontWeight: '700',
    fontSize: 13,
  },
  linkTextDisabled: {
    color: '#9CA3AF',
  },
  secondaryLink: {
    marginTop: 8,
    alignItems: 'center',
  },
  secondaryLinkText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
});
