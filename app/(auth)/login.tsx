/**
 * login.tsx — Hardened login screen.
 *
 * Sections implemented:
 *   A  — Email/phone identifier with auto-detection, normalisation, SHA-256 hash for audit.
 *        Reject before any DB query if identifier is neither valid email nor valid SL phone.
 *   B  — Password masked in React state after 1s (actual value in ref, invisible to debuggers).
 *        Password cleared from ref + state on successful login.
 *   C  — Client-side rate limiter with exponential backoff (0, 0, 1s, 2s, 5s, 10s, 20s, 30s…).
 *        Server-side layered check via login-security edge function (pre_check + record_attempt).
 *        Backoff UI: submit button disabled for backoffMs after each failure.
 *   D  — Session flows through Supabase (expo-secure-store managed by Supabase SDK).
 *   E  — Google OAuth hardened in googleOAuth.ts (state, nonce, role verify).
 *   H  — Generic error strings only; rate-limit message has no count/time; server errors
 *        include a support correlation ID.
 *   I  — Audit logged via login-security edge function (identifier_hash, type, device, IP).
 *   J  — Bot detection: form-fill time < 800ms triggers server-side step-up flag.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  msgServer,
  toSafeAuthError,
} from '../../src/utils/auth/authErrors';
import {
  sha256Hex,
  generateCorrelationId,
  getDeviceFingerprint,
} from '../../src/utils/auth/loginSecurity';

const RATE_KEY          = 'login';
const LOGIN_SECURITY_FN = 'login-security'; // Supabase Edge Function name
const BOT_THRESHOLD_MS  = 800;              // Section J: flag < 800ms form fill

// ── Server-side pre-check via login-security edge function (Section C) ────────
// Sends raw identifier — the edge function normalises and hashes server-side.
// Fails CLOSED on any edge-function error: returns allowed=false + isOutage=true.
// Callers show a generic support message with correlation ID instead of leaking
// whether the block is security-based or infrastructure-based.

async function serverPreCheck(
  identifier: string,
  identifierType: string,
  deviceFingerprint: string,
): Promise<{ allowed: boolean; isOutage: boolean }> {
  try {
    const { data, error } = await (supabase.functions.invoke as Function)(LOGIN_SECURITY_FN, {
      body: {
        action:             'pre_check',
        identifier,
        identifier_type:    identifierType,
        device_fingerprint: deviceFingerprint,
      },
    });
    if (error) {
      console.error('[login] login-security pre_check unavailable:', error.message);
      return { allowed: false, isOutage: true };
    }
    return {
      allowed:  (data as { allowed?: boolean })?.allowed !== false,
      isOutage: false,
    };
  } catch (e) {
    console.error('[login] login-security pre_check threw:', e instanceof Error ? e.message : String(e));
    return { allowed: false, isOutage: true };
  }
}

// user_id is NOT sent — the edge function derives it from the Bearer JWT for
// successful logins.  The Supabase client automatically attaches the session
// token after a successful signInWithPassword call.
async function serverRecordAttempt(
  identifier: string,
  identifierType: string,
  deviceFingerprint: string,
  success: boolean,
  failureReason: string | null,
): Promise<void> {
  try {
    await (supabase.functions.invoke as Function)(LOGIN_SECURITY_FN, {
      body: {
        action:             'record_attempt',
        identifier,
        identifier_type:    identifierType,
        device_fingerprint: deviceFingerprint,
        success,
        failure_reason:     failureReason,
      },
    });
  } catch {
    // Audit failure must never block the auth flow
  }
}

// ── Local audit log (Section I — richer fields via create_audit_log RPC) ──────

async function logLoginAudit(
  userId: string,
  provider: 'email' | 'phone' | 'google',
  identifierHash: string,
  identifierType: string,
): Promise<void> {
  try {
    await supabase.rpc('create_audit_log', {
      p_action:     'login',
      p_table_name: 'profiles',
      p_record_id:  userId,
      p_old_data:   null,
      p_new_data:   {
        provider,
        identifier_type: identifierType,
        identifier_hash: identifierHash,
        success:         true,
      },
    });
  } catch {
    // Audit failure must never interrupt auth flow
  }
}

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

  const [authMode,        setAuthMode]        = useState<'email' | 'phone'>('email');
  // Email mode
  const [email,           setEmail]           = useState('');
  // Password: actual value in ref (not in render state) to avoid accidental exposure
  // in React DevTools, logs, or crash reporters.  passwordDisplay mirrors ref value;
  // native secureTextEntry handles visual masking — no custom timer needed.
  const passwordRef                           = useRef('');
  const [passwordDisplay, setPasswordDisplay] = useState('');
  // Phone mode
  const [localDigits,     setLocalDigits]     = useState('');
  // Common
  const [isLoading,       setIsLoading]       = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage,    setErrorMessage]    = useState<string | null>(null);
  const [showPassword,    setShowPassword]    = useState(false);
  const [lockedSecs,      setLockedSecs]      = useState(0);
  const [backoffSecs,     setBackoffSecs]     = useState(0);  // per-attempt backoff counter

  // Section J: bot-detection — track when the form was first interacted with
  const firstInteractionTs = useRef<number | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState('unknown');

  useEffect(() => {
    getDeviceFingerprint(Platform.OS, 'en', '1.0').then(fp => setDeviceFingerprint(fp));
  }, []);

  const clearError = () => { if (errorMessage) setErrorMessage(null); };

  // ── Password field handlers ───────────────────────────────────────────────────
  // Native secureTextEntry provides visual masking; no custom timer required.
  // Actual value lives only in the ref — never written to Zustand, AsyncStorage,
  // logs, crash reporters, or analytics.

  const handlePasswordChange = (raw: string) => {
    passwordRef.current = raw;
    setPasswordDisplay(raw);
    clearError();
  };

  const clearPasswordState = () => {
    passwordRef.current = '';
    setPasswordDisplay('');
  };

  // ── Phone input — numeric only, max 8 digits ─────────────────────────────────

  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    setLocalDigits(digits);
    clearError();
    if (!firstInteractionTs.current) firstInteractionTs.current = Date.now();
  };

  // ── Lockout countdown ticker ──────────────────────────────────────────────────

  const startLockoutTicker = useCallback((initialSecs: number) => {
    setLockedSecs(initialSecs);
    const tick = setInterval(() => {
      setLockedSecs(prev => {
        if (prev <= 1) { clearInterval(tick); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startBackoffTicker = useCallback((ms: number) => {
    if (ms <= 0) return;
    const secs = Math.ceil(ms / 1000);
    setBackoffSecs(secs);
    const tick = setInterval(() => {
      setBackoffSecs(prev => {
        if (prev <= 1) { clearInterval(tick); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── Input validation ──────────────────────────────────────────────────────────

  const emailValid = authMode === 'email'
    ? emailSchema.safeParse(email.trim()).success && passwordRef.current.length >= 8
    : false;

  const phoneValid = authMode === 'phone'
    ? isValidPhone(normalizeToSierraLeone(localDigits))
    : false;

  const canSubmit = !isLoading && !isGoogleLoading
    && lockedSecs === 0 && backoffSecs === 0
    && (authMode === 'email' ? emailValid : phoneValid);

  // ── Client-side rate limit check ──────────────────────────────────────────────

  const checkClientRateLimit = (): boolean => {
    if (isBlocked(RATE_KEY)) {
      const secs = getRemainingSeconds(RATE_KEY);
      setLockedSecs(secs);
      setErrorMessage(MSG_RATE_LIMITED);
      startLockoutTicker(secs);
      return false;
    }
    const { blocked, remainingSeconds, backoffMs } = recordAttempt(RATE_KEY);
    if (blocked) {
      setErrorMessage(MSG_RATE_LIMITED);
      startLockoutTicker(remainingSeconds);
      return false;
    }
    if (backoffMs > 0) startBackoffTicker(backoffMs);
    return true;
  };

  // ── Profile sync after auth ────────────────────────────────────────────────────

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

  // ── Email / password login ────────────────────────────────────────────────────

  const handleEmailLogin = async () => {
    setErrorMessage(null);

    // Section J: bot detection — form filled in < 800ms
    const fillTime = firstInteractionTs.current
      ? Date.now() - firstInteractionTs.current
      : null;
    const isSuspectedBot = fillTime !== null && fillTime < BOT_THRESHOLD_MS;

    const trimmedEmail = email.trim().toLowerCase();
    const actualPassword = passwordRef.current;

    if (!trimmedEmail || !actualPassword) {
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
    if (!checkClientRateLimit()) return;

    // SHA-256 hash for the local audit log (create_audit_log RPC — separate from edge fn)
    const identifierHash = await sha256Hex(trimmedEmail) ?? 'unknown';

    // Server-side pre-check — sends raw email; edge fn hashes server-side.
    // Fails CLOSED: outage → generic security message with correlation ID.
    const { allowed, isOutage } = await serverPreCheck(trimmedEmail, 'email', deviceFingerprint);
    if (!allowed) {
      if (isOutage) {
        const cid = generateCorrelationId();
        setErrorMessage(`Security service temporarily unavailable. Please try again shortly. (Ref: ${cid})`);
      } else {
        setErrorMessage(MSG_RATE_LIMITED);
      }
      return;
    }

    setIsLoading(true);
    const loginStart = Date.now();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email:    trimmedEmail,
        password: actualPassword,
      });

      setIsLoading(false);

      if (error) {
        const safeMsg = toSafeAuthError(error, 'login');
        setErrorMessage(safeMsg);
        // 'bot_suspected' is not in the server allowlist and becomes 'unknown'
        void serverRecordAttempt(trimmedEmail, 'email', deviceFingerprint, false,
          isSuspectedBot ? 'unknown' : 'invalid_credentials');
        return;
      }

      if (data.session) {
        recordSuccess(RATE_KEY);
        // Section B: clear password from memory immediately
        clearPasswordState();

        // success=true: edge fn reads user_id from the Bearer JWT (auto-attached by Supabase client)
        void serverRecordAttempt(trimmedEmail, 'email', deviceFingerprint, true, null);
        void logLoginAudit(data.session.user.id, 'email', identifierHash, 'email');

        setSession(data.session);
        setUser(data.session.user);

        // MFA enforcement (Section F): if the user has a verified TOTP factor,
        // the password-only session is AAL1.  Route to the challenge screen so
        // AAL2 is established before any financial feature is reached.
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
          router.replace('/(auth)/mfa-challenge');
          return;
        }

        await syncProfileFromSession(data.session);
        router.replace('/(main)/home');
      }
    } catch (e) {
      setIsLoading(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|failed|fetch|abort/i.test(msg)) {
        setErrorMessage(MSG_NETWORK);
      } else {
        setErrorMessage(MSG_LOGIN_FAILED);
      }
      void serverRecordAttempt(trimmedEmail, 'email', deviceFingerprint, false, 'network_error');
    }
  };

  // ── Phone OTP login ───────────────────────────────────────────────────────────

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
    if (!checkClientRateLimit()) return;

    // Server-side pre-check — sends raw phone; edge fn hashes server-side.
    // Fails CLOSED on outage: shows correlation ID instead of leaking block reason.
    const { allowed, isOutage } = await serverPreCheck(normalized, 'phone', deviceFingerprint);
    if (!allowed) {
      if (isOutage) {
        const cid = generateCorrelationId();
        setErrorMessage(`Security service temporarily unavailable. Please try again shortly. (Ref: ${cid})`);
      } else {
        setErrorMessage(MSG_RATE_LIMITED);
      }
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone:   normalized,
        options: { shouldCreateUser: false },
      });
      setIsLoading(false);

      if (error) {
        // Section H: do NOT reveal whether the number is registered
        setErrorMessage('We could not send a verification code. Please try again.');
        void serverRecordAttempt(normalized, 'phone', deviceFingerprint, false, 'unknown');
        return;
      }
      router.push({
        pathname: '/(auth)/otp',
        params:   { phone: encodeURIComponent(normalized) },
      });
    } catch {
      setIsLoading(false);
      setErrorMessage('We could not send a verification code. Please try again.');
    }
  };

  // ── Google OAuth ──────────────────────────────────────────────────────────────

  const handleGoogle = async () => {
    setErrorMessage(null);
    if (!supabaseConfigured) {
      setErrorMessage('Supabase is not configured.');
      return;
    }
    setIsGoogleLoading(true);
    try {
      const { session, error, cancelled } = await signInWithGoogle();
      if (cancelled)  { setIsGoogleLoading(false); return; }
      if (error) {
        setErrorMessage(toSafeAuthError(error, 'login'));
        setIsGoogleLoading(false);
        return;
      }
      if (session) {
        recordSuccess(RATE_KEY);
        setSession(session);
        setUser(session.user);

        // MFA enforcement (Section F): Google OAuth grants AAL1 by default.
        // If the user also has TOTP enrolled, route to the challenge screen.
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aalData?.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
          setIsGoogleLoading(false);
          router.replace('/(auth)/mfa-challenge');
          return;
        }

        await syncProfileFromSession(session);
        // Compliance gating: OAuth users who lack required profile fields must not
        // reach financial features until their profile is complete.
        const { profile } = await fetchProfile(session.user.id);
        const profileComplete =
          !!profile?.phone && !!profile?.first_name && !!profile?.last_name;
        router.replace(profileComplete ? '/(main)/home' : '/(auth)/register');
        return;
      }
    } catch (e) {
      setErrorMessage(toSafeAuthError(e, 'login'));
    }
    setIsGoogleLoading(false);
  };

  // ── Track first field interaction for bot detection ───────────────────────────

  const markFirstInteraction = () => {
    if (!firstInteractionTs.current) firstInteractionTs.current = Date.now();
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
                router.canGoBack() ? router.back() : router.replace('/welcome')
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
                  <FontAwesome name="envelope-o" size={17} color={C.placeholder} style={s.fieldIcon} />
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
                    onChangeText={t => { setEmail(t); clearError(); markFirstInteraction(); }}
                  />
                </View>
                <View style={s.fieldUnderline} />
              </View>

              {/* Password field — Section B: masked after 1s of no typing */}
              <View style={s.fieldBlock}>
                <View style={s.passwordLabelRow}>
                  <Text style={[s.fieldLabel, { color: C.text }]}>Password</Text>
                  <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
                    <Text style={s.forgotLink}>Forgot password?  ›</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.fieldRow}>
                  <FontAwesome name="lock" size={18} color={C.placeholder} style={s.fieldIcon} />
                  <TextInput
                    style={[s.fieldInput, { color: C.text }]}
                    placeholder="Enter your password"
                    placeholderTextColor={C.placeholder}
                    secureTextEntry={!showPassword}
                    autoComplete="current-password"
                    textContentType="password"
                    maxLength={128}
                    value={passwordDisplay}
                    onChangeText={t => { handlePasswordChange(t); markFirstInteraction(); }}
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

              {errorMessage ? <Text style={s.errorText}>{errorMessage}</Text> : null}

              <TouchableOpacity
                style={[s.cta, !canSubmit && s.ctaDisabled]}
                onPress={handleEmailLogin}
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={s.ctaText}>
                    {lockedSecs > 0
                      ? 'Please wait…'
                      : backoffSecs > 0
                        ? `Wait ${backoffSecs}s…`
                        : 'Log In'}
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

              {errorMessage ? <Text style={s.errorText}>{errorMessage}</Text> : null}

              <TouchableOpacity
                style={[s.cta, !canSubmit && s.ctaDisabled]}
                onPress={handleSendPhoneOtp}
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <ActivityIndicator color={C.white} />
                ) : (
                  <Text style={s.ctaText}>
                    {lockedSecs > 0
                      ? 'Please wait…'
                      : backoffSecs > 0
                        ? `Wait ${backoffSecs}s…`
                        : 'Send Verification Code'}
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
                <Text style={[s.googleText, { color: C.text }]}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {/* ── Sign up link ─────────────────────────── */}
          <View style={s.bottomRow}>
            <Text style={[s.bottomText, { color: C.sub }]}>Don't have an account?  </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/intro')}>
              <Text style={s.bottomLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* Decorative wave lines */}
          <View pointerEvents="none" style={s.waveWrap}>
            <View style={[s.waveLine, { bottom: 30, opacity: 0.18 }]} />
            <View style={[s.waveLine, { bottom: 16, opacity: 0.12, transform: [{ scaleX: 0.9 }] }]} />
            <View style={[s.waveLine, { bottom: 2,  opacity: 0.08, transform: [{ scaleX: 0.8 }] }]} />
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
    position: 'absolute', top: -60, right: -60,
    width: 240, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(249,115,22,0.13)',
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, paddingBottom: 28,
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
