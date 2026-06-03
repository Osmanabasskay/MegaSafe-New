import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ChevronLeft } from 'lucide-react-native';
import { supabase, supabaseConfigured } from '../../src/services/supabase';
import { normalizeProfileName } from '../../src/utils/profileName';
import { logLegalAcceptance, upsertBasicProfile } from '../../src/services/profileService';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MSG_OTP_INVALID, MSG_OTP_RESEND, toSafeAuthError } from '../../src/utils/auth/authErrors';
import { recordSuccess } from '../../src/utils/auth/rateLimiter';

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg: '#0F1419',
  orange: '#FFA504',
  orangeText: '#5C3400',
  text: '#DFE2EA',
  muted: '#C6C5D4',
  inputBg: 'rgba(255,255,255,0.07)',
  inputBorder: 'rgba(255,255,255,0.14)',
  inputActive: '#FFA504',
  inputFilled: 'rgba(255,255,255,0.22)',
  error: '#FF7878',
};

const COOLDOWN_SEC = 60;
const OTP_LENGTH = 6;

const decodeParam = (value: unknown): string => {
  if (value == null) return '';
  const raw = String(value);
  try { return decodeURIComponent(raw); } catch { return raw; }
};

export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    phone?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    address?: string;
    dateOfBirth?: string;
    legalAcceptedAt?: string;
    type?: string;
  }>();
  const { setSession, setUser } = useAuthStore();
  const { initializeForUser, updateProfile } = useAppDataStore();

  const phoneE164      = decodeParam(params.phone);
  const firstName      = decodeParam(params.firstName);
  const lastName       = decodeParam(params.lastName);
  const email          = decodeParam(params.email).toLowerCase();
  const address        = decodeParam(params.address);
  const dateOfBirth    = decodeParam(params.dateOfBirth);  // ISO YYYY-MM-DD
  const legalAcceptedAt = decodeParam(params.legalAcceptedAt);
  const type           = decodeParam(params.type);

  // Registration sends email OTP; legacy flows use phone SMS
  const isEmailFlow = type === 'register' && !!email;

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const autoSubmitRef = useRef(false);

  const refs = useRef<(TextInput | null)[]>(Array(OTP_LENGTH).fill(null));

  // Auto-focus first box on mount
  useEffect(() => {
    const t = setTimeout(() => refs.current[0]?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isEmailFlow && !phoneE164) {
      setErrorMessage('Missing verification target. Go back and try again.');
    }
  }, [isEmailFlow, phoneE164]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const sendOtp = useCallback(async () => {
    if (!supabaseConfigured) return;
    setIsResending(true);
    setErrorMessage(null);
    if (isEmailFlow) {
      const { error } = type === 'register'
        ? await supabase.auth.resend({ type: 'signup', email })
        : await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      setIsResending(false);
      // Use generic message — don't reveal whether email exists
      if (error) { setErrorMessage(MSG_OTP_RESEND); return; }
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneE164,
        options: { shouldCreateUser: false }, // login only; registration done via email flow
      });
      setIsResending(false);
      if (error) { setErrorMessage(MSG_OTP_RESEND); return; }
    }
    setCooldown(COOLDOWN_SEC);
  }, [isEmailFlow, type, email, phoneE164]);

  const onChangeDigit = (text: string, idx: number) => {
    setErrorMessage(null);
    autoSubmitRef.current = false;
    const stripped = text.replace(/[^\d]/g, '');

    // ── Full code pasted or autofilled (iOS/Android OTP suggestion) ──
    if (stripped.length >= OTP_LENGTH) {
      const newDigits = stripped.slice(0, OTP_LENGTH).split('');
      setDigits(newDigits);
      refs.current[OTP_LENGTH - 1]?.focus();
      return;
    }

    // ── Partial paste (2-5 chars from current position) ──
    if (stripped.length > 1) {
      const newDigits = [...digits];
      for (let i = 0; i < stripped.length && idx + i < OTP_LENGTH; i++) {
        newDigits[idx + i] = stripped[i]!;
      }
      setDigits(newDigits);
      const nextFocus = Math.min(idx + stripped.length, OTP_LENGTH - 1);
      refs.current[nextFocus]?.focus();
      return;
    }

    // ── Single digit typed ──
    const single = stripped.slice(-1);
    const newDigits = [...digits];
    newDigits[idx] = single;
    setDigits(newDigits);
    if (single && idx < OTP_LENGTH - 1) {
      refs.current[idx + 1]?.focus();
    }
  };

  const onKeyPress = (e: { nativeEvent: { key: string } }, idx: number) => {
    if (e.nativeEvent.key === 'Backspace') {
      autoSubmitRef.current = false;
      if (digits[idx]) {
        const newDigits = [...digits];
        newDigits[idx] = '';
        setDigits(newDigits);
      } else if (idx > 0) {
        const newDigits = [...digits];
        newDigits[idx - 1] = '';
        setDigits(newDigits);
        refs.current[idx - 1]?.focus();
      }
    }
  };

  const handleVerify = useCallback(async (overrideDigits?: string[]) => {
    const token = (overrideDigits ?? digits).join('').trim();
    if (token.length < OTP_LENGTH) {
      setErrorMessage('Enter the full 6-digit code.');
      autoSubmitRef.current = false;
      return;
    }
    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured.');
      autoSubmitRef.current = false;
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);
    try {
      let verifyResult: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;

      if (isEmailFlow) {
        // 'signup' matches accounts created via signUp(); 'email' matches signInWithOtp()
        verifyResult = await supabase.auth.verifyOtp({
          email,
          token,
          type: type === 'register' ? 'signup' : 'email',
        });
      } else {
        verifyResult = await supabase.auth.verifyOtp({
          phone: phoneE164,
          token,
          type: 'sms',
        });
      }

      const { data, error } = verifyResult;

      if (error) {
        setIsVerifying(false);
        setErrorMessage(MSG_OTP_INVALID);
        if (__DEV__) console.warn('[OTP] verify error:', error.message);
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
        // Write all profile fields including address + DOB (collected during registration)
        const { error: profileError } = await upsertBasicProfile({
          userId:      data.session.user.id,
          firstName,
          lastName,
          email,
          phone:       phoneE164,
          address:     address || undefined,
          dateOfBirth: dateOfBirth || undefined,
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

      recordSuccess('login');
      recordSuccess('signup');
      setIsVerifying(false);
      autoSubmitRef.current = false;
      router.replace('/(main)/home');
    } catch (e) {
      setIsVerifying(false);
      autoSubmitRef.current = false;
      setErrorMessage(toSafeAuthError(e, 'otp'));
    }
  }, [digits, isEmailFlow, email, phoneE164, firstName, lastName, address, dateOfBirth, legalAcceptedAt,
      setSession, setUser, initializeForUser, updateProfile, router]);

  // ── Auto-submit when all 6 digits are present ─────────────────
  useEffect(() => {
    const allFilled = digits.every(d => d !== '');
    if (!allFilled) {
      autoSubmitRef.current = false;
      return;
    }
    if (autoSubmitRef.current || isVerifying) return;
    autoSubmitRef.current = true;
    const timer = setTimeout(() => { void handleVerify(digits); }, 150);
    return () => clearTimeout(timer);
  // Intentionally using digits as the trigger; handleVerify is stable via useCallback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  const displayTarget = isEmailFlow
    ? email.replace(/(.{2}).*(@.*)/, '$1***$2')
    : phoneE164 || 'your number';

  const timerLabel = (() => {
    const m = Math.floor(cooldown / 60);
    const sec = String(cooldown % 60).padStart(2, '0');
    return `${m}:${sec}`;
  })();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ChevronLeft size={24} color="#BBC3FF" />
          </TouchableOpacity>
          <Text style={styles.wordmark}>Mi Osusu</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.content}>
          {/* Title */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Verify your email</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={styles.highlight}>{displayTarget}</Text>
            </Text>
          </View>

          {/* 6 digit boxes */}
          <View style={styles.otpRow}>
            {Array(OTP_LENGTH).fill(null).map((_, idx) => (
              <TextInput
                key={idx}
                ref={r => { refs.current[idx] = r; }}
                style={[
                  styles.digitBox,
                  focusedIdx === idx && styles.digitBoxFocused,
                  digits[idx] ? styles.digitBoxFilled : undefined,
                ]}
                value={digits[idx]}
                onChangeText={t => onChangeDigit(t, idx)}
                onKeyPress={e => onKeyPress(e, idx)}
                onFocus={() => setFocusedIdx(idx)}
                onBlur={() => setFocusedIdx(-1)}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                selectTextOnFocus
                textAlign="center"
                // iOS autofill from email/notification
                textContentType="oneTimeCode"
                // Android autofill
                autoComplete="one-time-code"
              />
            ))}
          </View>

          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          {/* Resend section */}
          <View style={styles.resendSection}>
            <Text style={styles.resendLabel}>Didn't receive the code?</Text>
            <TouchableOpacity
              onPress={sendOtp}
              disabled={isResending || cooldown > 0}
              activeOpacity={0.7}
            >
              {isResending ? (
                <ActivityIndicator size="small" color={C.orange} />
              ) : (
                <Text style={[styles.resendBtn, cooldown > 0 && styles.resendBtnDisabled]}>
                  {cooldown > 0 ? `Resend in ${timerLabel}` : 'Resend code'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Verify button */}
          <TouchableOpacity
            style={[
              styles.verifyBtn,
              (isVerifying || digits.some(d => !d)) && styles.verifyBtnDisabled,
            ]}
            onPress={() => void handleVerify()}
            disabled={isVerifying || digits.some(d => !d)}
            activeOpacity={0.85}
          >
            {isVerifying ? (
              <ActivityIndicator color={C.orangeText} />
            ) : (
              <Text style={styles.verifyBtnText}>Verify & Continue</Text>
            )}
          </TouchableOpacity>

          {/* Try another way */}
          <TouchableOpacity style={styles.secondaryLink} onPress={() => router.back()}>
            <Text style={styles.secondaryLinkText}>Try another way</Text>
          </TouchableOpacity>
        </View>

        {/* Background glows */}
        <View style={styles.glowTR} pointerEvents="none" />
        <View style={styles.glowBL} pointerEvents="none" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 56,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  wordmark: { fontSize: 20, fontWeight: '800', color: C.orange, letterSpacing: -0.4 },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: 'center',
  },
  titleSection: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: C.text, marginBottom: 10 },
  subtitle: { fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 22 },
  highlight: { color: C.orange, fontWeight: '700' },
  otpRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  digitBox: {
    width: 50,
    height: 62,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: C.inputBg,
    borderColor: C.inputBorder,
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
  },
  digitBoxFocused: {
    borderColor: C.orange,
    backgroundColor: 'rgba(255,165,4,0.08)',
  },
  digitBoxFilled: { borderColor: C.inputFilled },
  errorText: {
    color: C.error,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  resendSection: { alignItems: 'center', marginBottom: 32, gap: 6 },
  resendLabel: { fontSize: 13, color: C.muted },
  resendBtn: { fontSize: 14, fontWeight: '700', color: C.orange },
  resendBtnDisabled: { color: C.muted },
  verifyBtn: {
    width: '100%',
    height: 56,
    borderRadius: 14,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: C.orange,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  verifyBtnDisabled: { opacity: 0.6 },
  verifyBtnText: { fontSize: 16, fontWeight: '700', color: C.orangeText },
  secondaryLink: { alignItems: 'center', paddingVertical: 8 },
  secondaryLinkText: {
    fontSize: 14,
    color: C.muted,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  glowTR: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(0,21,127,0.14)',
    zIndex: -1,
  },
  glowBL: {
    position: 'absolute',
    bottom: -60,
    left: -60,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(255,165,4,0.06)',
    zIndex: -1,
  },
});
