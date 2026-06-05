/**
 * Login screen — secured, rate-limited, generic error messages.
 *
 * Security model:
 *  • All errors map to MSG_LOGIN_FAILED — never reveals whether account exists.
 *  • In-memory rate limiter: 5 attempts / 15 min → progressive lockout.
 *  • Submit button disabled until inputs pass client-side validation.
 *  • No raw Supabase messages shown in production.
 *  • Passwords are never logged anywhere.
 */
import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft } from 'lucide-react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Svg, { Path } from 'react-native-svg';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { supabase, supabaseConfigured } from '../../src/services/supabase';
import { signInWithGoogle } from '../../src/services/auth/googleOAuth';
import { normalizeToSierraLeone, isValidSierraLeonePhone } from '../../src/services/auth/phone';
import { fetchProfile } from '../../src/services/profileService';
import {
  getCredentialDisplayName,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../src/utils/profileName';
import {
  emailSchema,
  isValidSierraLeonePhone as isValidPhone,
} from '../../src/utils/validation/auth';
import {
  recordAttempt,
  recordSuccess,
  isBlocked,
  getRemainingSeconds,
} from '../../src/utils/auth/rateLimiter';
import {
  MSG_LOGIN_FAILED,
  MSG_RATE_LIMITED,
  MSG_NETWORK,
  toSafeAuthError,
} from '../../src/utils/auth/authErrors';

const RATE_KEY = 'login';

function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </Svg>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { setSession, setUser } = useAuthStore();
  const { initializeForUser, updateProfile, preferences } = useAppDataStore();
  const isDark = preferences.darkMode;

  const C = {
    bg:           isDark ? darkColors.bg : '#FAF7F2',
    orange:       '#F97316',
    navy:         '#1E2B5A',
    text:         isDark ? darkColors.text : '#111827',
    sub:          isDark ? darkColors.textSub : '#6B7280',
    inputBg:      'transparent' as const,
    border:       isDark ? darkColors.borderStrong : lightColors.borderStrong,
    card:         isDark ? darkColors.card : '#FFFFFF',
    modeToggleBg: isDark ? darkColors.iconBg : '#F3F4F6',
    placeholder:  isDark ? darkColors.textMuted : '#9CA3AF',
    white:        isDark ? darkColors.card : '#FFFFFF',
  };

  const [authMode,       setAuthMode]       = useState<'email' | 'phone'>('email');
  // Email mode state
  const [email,          setEmail]          = useState('');
  const [password,       setPassword]       = useState('');
  // Phone mode state — user enters only the 8 local digits
  const [localDigits,    setLocalDigits]    = useState('');
  // Common state
  const [isLoading,      setIsLoading]      = useState(false);
  const [isGoogleLoading,setIsGoogleLoading]= useState(false);
  const [errorMessage,   setErrorMessage]   = useState<string | null>(null);
  const [showPassword,   setShowPassword]   = useState(false);
  const [lockedSecs,     setLockedSecs]     = useState(0);

  const clearError = () => { if (errorMessage) setErrorMessage(null); };

  // ── Input validation (determines if submit is enabled) ───────────────────
  const emailValid = authMode === 'email'
    ? emailSchema.safeParse(email.trim()).success && password.length >= 8
    : false;

  const phoneValid = authMode === 'phone'
    ? isValidPhone(normalizeToSierraLeone(localDigits))
    : false;

  const canSubmit = !isLoading && !isGoogleLoading && lockedSecs === 0
    && (authMode === 'email' ? emailValid : phoneValid);

  // ── Phone input handler — numeric only, max 8 digits ────────────────────
  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    setLocalDigits(digits);
    clearError();
  };

  // ── Lockout countdown ticker ─────────────────────────────────────────────
  const startLockoutTicker = useCallback((initialSecs: number) => {
    setLockedSecs(initialSecs);
    const tick = setInterval(() => {
      setLockedSecs(prev => {
        if (prev <= 1) { clearInterval(tick); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── Pre-request rate-limit check ─────────────────────────────────────────
  const checkRateLimit = (): boolean => {
    if (isBlocked(RATE_KEY)) {
      const secs = getRemainingSeconds(RATE_KEY);
      setLockedSecs(secs);
      setErrorMessage(`${MSG_RATE_LIMITED} (${secs}s)`);
      startLockoutTicker(secs);
      return false;
    }
    const { blocked, remainingSeconds } = recordAttempt(RATE_KEY);
    if (blocked) {
      setErrorMessage(`${MSG_RATE_LIMITED} (${remainingSeconds}s)`);
      startLockoutTicker(remainingSeconds);
      return false;
    }
    return true;
  };

  // ── Profile sync after successful auth ───────────────────────────────────
  const syncProfileFromSession = async (session: Session) => {
    initializeForUser(session.user);
    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
    const metaName = normalizeProfileName(
      (typeof meta.full_name === 'string' && meta.full_name) ||
        (typeof meta.name === 'string' && meta.name) ||
        [meta.first_name, meta.last_name]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join(' ')
    );
    const credName = getCredentialDisplayName(session.user.email, session.user.phone);
    updateProfile({
      fullName: !isPlaceholderProfileName(metaName) ? metaName : credName,
      email:    session.user.email ?? undefined,
      phone:    session.user.phone ?? undefined,
    });
    const { profile } = await fetchProfile(session.user.id);
    if (!profile) return;
    const remoteName = normalizeProfileName(
      [profile.first_name, profile.last_name]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .join(' ')
    );
    updateProfile({
      fullName: !isPlaceholderProfileName(remoteName)
        ? remoteName
        : !isPlaceholderProfileName(metaName)
          ? metaName
          : credName,
      email:              profile.email ?? session.user.email ?? undefined,
      phone:              profile.phone ?? session.user.phone ?? undefined,
      verificationStatus: profile.kyc_status === 'approved' ? 'Verified' : 'Pending',
    });
  };

  // ── Email / password login ───────────────────────────────────────────────
  const handleEmailLogin = async () => {
    setErrorMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setErrorMessage('Please enter your email and password.');
      return;
    }
    if (!emailSchema.safeParse(trimmedEmail).success) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured. Add keys to .env and restart.');
      return;
    }
    if (!checkRateLimit()) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      setIsLoading(false);

      if (error) {
        setErrorMessage(toSafeAuthError(error, 'login'));
        return;
      }
      if (data.session) {
        recordSuccess(RATE_KEY);
        setSession(data.session);
        setUser(data.session.user);
        await syncProfileFromSession(data.session);
        router.replace('/(main)/home');
      }
    } catch (e) {
      setIsLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(
        /network|failed|fetch|abort/i.test(msg) ? MSG_NETWORK : MSG_LOGIN_FAILED
      );
    }
  };

  // ── Phone OTP login ──────────────────────────────────────────────────────
  const handleSendPhoneOtp = async () => {
    setErrorMessage(null);

    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured.');
      return;
    }

    const normalized = normalizeToSierraLeone(localDigits);
    if (!isValidSierraLeonePhone(normalized)) {
      setErrorMessage('Enter a valid Sierra Leone number (e.g. 76 123 456)');
      return;
    }
    if (!checkRateLimit()) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: false }, // Login only — do not create ghost accounts
      });
      setIsLoading(false);

      if (error) {
        // Do NOT reveal whether the number is registered
        setErrorMessage('We could not send a verification code. Please try again.');
        return;
      }
      router.push({
        pathname: '/(auth)/otp',
        params: { phone: encodeURIComponent(normalized) },
      });
    } catch {
      setIsLoading(false);
      setErrorMessage('We could not send a verification code. Please try again.');
    }
  };

  // ── Google OAuth ─────────────────────────────────────────────────────────
  const handleGoogle = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured.');
      return;
    }
    setIsGoogleLoading(true);
    try {
      const { session, error, cancelled } = await signInWithGoogle();
      if (cancelled) { setIsGoogleLoading(false); return; }
      if (error) {
        // Google errors may contain OAuth details — show generic message
        setErrorMessage(toSafeAuthError(error, 'login'));
        setIsGoogleLoading(false);
        return;
      }
      if (session) {
        recordSuccess(RATE_KEY);
        setSession(session);
        setUser(session.user);
        await syncProfileFromSession(session);
        router.replace('/(main)/home');
      }
    } catch (e) {
      setErrorMessage(toSafeAuthError(e, 'login'));
    }
    setIsGoogleLoading(false);
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Decorative orange blob */}
          <View pointerEvents="none" style={s.blobTopRight} />

          {/* ── Header ───────────────────────────────── */}
          <View style={s.header}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace('/welcome')
              }
            >
              <ArrowLeft size={20} color={C.orange} />
            </TouchableOpacity>
            <Text style={s.wordmark}>Mi Osusu</Text>
            <View style={{ width: 38 }} />
          </View>

          {/* ── Hero ─────────────────────────────────── */}
          <View style={s.hero}>
            <Text style={[s.heroTitle, { color: C.text }]}>Welcome back</Text>
            <Text style={[s.heroSub, { color: C.sub }]}>
              Sign in to manage your{'\n'}contributions
            </Text>
          </View>

          {/* ── Mode toggle ──────────────────────────── */}
          <View style={[s.modeToggle, { backgroundColor: C.modeToggleBg }]}>
            {(['email', 'phone'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[s.modeBtn, authMode === m && s.modeBtnActive]}
                onPress={() => { setAuthMode(m); clearError(); }}
              >
                <Text style={[s.modeBtnText, authMode === m && s.modeBtnTextActive]}>
                  {m === 'email' ? 'Email' : 'Phone'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Form ─────────────────────────────────── */}
          {authMode === 'email' ? (
            <>
              {/* Email field */}
              <View style={s.fieldBlock}>
                <Text style={[s.fieldLabel, { color: C.text }]}>Email</Text>
                <View style={s.fieldRow}>
                  <FontAwesome
                    name="envelope-o"
                    size={17}
                    color={C.placeholder}
                    style={s.fieldIcon}
                  />
                  <TextInput
                    style={[s.fieldInput, { color: C.text }]}
                    placeholder="Enter your email"
                    placeholderTextColor={C.placeholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    maxLength={254}
                    value={email}
                    onChangeText={t => { setEmail(t); clearError(); }}
                  />
                </View>
                <View style={s.fieldUnderline} />
              </View>

              {/* Password field */}
              <View style={s.fieldBlock}>
                <View style={s.passwordLabelRow}>
                  <Text style={[s.fieldLabel, { color: C.text }]}>Password</Text>
                  <TouchableOpacity
                    onPress={() => router.push('/(auth)/forgot-password')}
                  >
                    <Text style={s.forgotLink}>Forgot password?  ›</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.fieldRow}>
                  <FontAwesome
                    name="lock"
                    size={18}
                    color={C.placeholder}
                    style={s.fieldIcon}
                  />
                  <TextInput
                    style={[s.fieldInput, { color: C.text }]}
                    placeholder="Enter your password"
                    placeholderTextColor={C.placeholder}
                    secureTextEntry={!showPassword}
                    autoComplete="current-password"
                    textContentType="password"
                    maxLength={128}
                    value={password}
                    onChangeText={t => { setPassword(t); clearError(); }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(v => !v)}
                    style={s.eyeBtn}
                  >
                    <FontAwesome
                      name={showPassword ? 'eye-slash' : 'eye'}
                      size={18}
                      color={C.placeholder}
                    />
                  </TouchableOpacity>
                </View>
                <View style={s.fieldUnderline} />
              </View>

              {errorMessage ? (
                <Text style={s.errorText}>{errorMessage}</Text>
              ) : null}

              <TouchableOpacity
                style={[s.cta, !canSubmit && s.ctaDisabled]}
                onPress={handleEmailLogin}
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={s.ctaText}>
                    {lockedSecs > 0 ? `Wait ${lockedSecs}s…` : 'Log In'}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Phone field — fixed +232 prefix, user types 8 digits */}
              <View style={s.fieldBlock}>
                <Text style={[s.fieldLabel, { color: C.text }]}>Mobile Number</Text>
                <View style={s.fieldRow}>
                  {/* Sierra Leone flag */}
                  <Text style={s.flag}>🇸🇱</Text>
                  <Text style={[s.countryCode, { color: C.text }]}>+232</Text>
                  <View style={[s.dividerLine, { backgroundColor: C.border }]} />
                  <TextInput
                    style={[s.fieldInput, { color: C.text }]}
                    placeholder="76 123 456"
                    placeholderTextColor={C.placeholder}
                    keyboardType="number-pad"
                    maxLength={8}
                    value={localDigits}
                    onChangeText={handlePhoneChange}
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                  />
                </View>
                <View style={s.fieldUnderline} />
                <Text style={[s.fieldHint, { color: C.sub }]}>
                  Enter your 8-digit Sierra Leone number
                </Text>
              </View>

              {errorMessage ? (
                <Text style={s.errorText}>{errorMessage}</Text>
              ) : null}

              <TouchableOpacity
                style={[s.cta, !canSubmit && s.ctaDisabled]}
                onPress={handleSendPhoneOtp}
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={s.ctaText}>
                    {lockedSecs > 0 ? `Wait ${lockedSecs}s…` : 'Send Verification Code'}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* ── OR divider ───────────────────────────── */}
          <View style={s.divider}>
            <View style={[s.dividerFull, { backgroundColor: C.border }]} />
            <Text style={s.dividerText}>OR</Text>
            <View style={[s.dividerFull, { backgroundColor: C.border }]} />
          </View>

          {/* ── Continue with Google ─────────────────── */}
          <TouchableOpacity
            style={[
              s.googleBtn,
              { backgroundColor: C.card, borderColor: C.border },
              (isLoading || isGoogleLoading) && s.ctaDisabled,
            ]}
            onPress={handleGoogle}
            disabled={isLoading || isGoogleLoading}
          >
            {isGoogleLoading ? (
              <ActivityIndicator color={C.sub} />
            ) : (
              <>
                <GoogleLogo size={20} />
                <Text style={[s.googleText, { color: C.text }]}>
                  Continue with Google
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* ── Sign up link ─────────────────────────── */}
          <View style={s.bottomRow}>
            <Text style={[s.bottomText, { color: C.sub }]}>
              Don't have an account?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/intro')}>
              <Text style={s.bottomLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* Decorative wave lines */}
          <View pointerEvents="none" style={s.waveWrap}>
            <View style={[s.waveLine, { bottom: 30, opacity: 0.18 }]} />
            <View
              style={[
                s.waveLine,
                { bottom: 16, opacity: 0.12, transform: [{ scaleX: 0.9 }] },
              ]}
            />
            <View
              style={[
                s.waveLine,
                { bottom: 2, opacity: 0.08, transform: [{ scaleX: 0.8 }] },
              ]}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FAF7F2' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 60 },

  blobTopRight: {
    position: 'absolute',
    top: -60, right: -60,
    width: 240, height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(249,115,22,0.13)',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 28,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(249,115,22,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  wordmark: { fontSize: 20, fontWeight: '800', color: '#F97316' },

  hero:      { marginBottom: 28 },
  heroTitle: {
    fontSize: 34, fontWeight: '800', color: '#111827',
    letterSpacing: -0.5, marginBottom: 8,
  },
  heroSub: { fontSize: 16, color: '#6B7280', lineHeight: 24 },

  modeToggle: {
    flexDirection: 'row', backgroundColor: '#F3F4F6',
    borderRadius: 14, padding: 4, marginBottom: 28,
  },
  modeBtn:           { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 11 },
  modeBtnActive:     {
    backgroundColor: '#F97316',
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  modeBtnText:       { color: '#9CA3AF', fontWeight: '600', fontSize: 15 },
  modeBtnTextActive: { color: '#FFFFFF', fontWeight: '700' },

  fieldBlock:   { marginBottom: 20 },
  fieldLabel:   { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10 },
  fieldRow:     { flexDirection: 'row', alignItems: 'center', paddingBottom: 8 },
  fieldIcon:    { marginRight: 12 },
  fieldInput:   { flex: 1, fontSize: 15, color: '#111827', paddingVertical: 0 },
  fieldUnderline: { height: 1.5, backgroundColor: '#F97316', borderRadius: 1 },
  fieldHint:    { fontSize: 11, color: '#9CA3AF', marginTop: 4 },

  // Phone prefix row
  flag:        { fontSize: 20, marginRight: 6 },
  countryCode: { fontSize: 15, fontWeight: '700', marginRight: 8 },
  dividerLine: { width: 1, height: 18, marginRight: 10 },

  passwordLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  forgotLink: { color: '#F97316', fontSize: 13, fontWeight: '600' },
  eyeBtn:     { paddingLeft: 10, paddingVertical: 2 },

  errorText: { color: '#EF4444', fontSize: 13, marginBottom: 12, marginTop: -6 },

  cta: {
    backgroundColor: '#F97316', borderRadius: 16, height: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  ctaDisabled: { opacity: 0.45, shadowOpacity: 0 },
  ctaText:     { color: '#FFFFFF', fontWeight: '800', fontSize: 17 },

  divider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 22, gap: 12 },
  dividerFull: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, borderRadius: 16, height: 56, borderWidth: 1.5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, marginBottom: 24,
  },
  googleText: { fontWeight: '700', fontSize: 15 },

  securityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, padding: 16, marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  securityIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(249,115,22,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  securityTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  securitySub:   { fontSize: 12, color: '#9CA3AF' },

  bottomRow:  { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  bottomText: { fontSize: 14 },
  bottomLink: { color: '#F97316', fontSize: 14, fontWeight: '700' },

  waveWrap: { position: 'relative', height: 50, overflow: 'hidden', marginTop: 8 },
  waveLine: {
    position: 'absolute', left: -20, right: -20,
    height: 40, borderRadius: 40,
    borderWidth: 2, borderColor: '#F97316', backgroundColor: 'transparent',
  },
});
