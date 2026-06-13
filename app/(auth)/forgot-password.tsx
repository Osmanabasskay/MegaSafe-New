import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Mail, Lock, Eye, EyeOff, Check } from 'lucide-react-native';
import { supabase, supabaseConfigured } from '../../src/services/supabase';
import {
  getPasswordError,
  getPasswordStrength,
  PASSWORD_REQUIREMENTS,
} from '../../src/utils/validation/auth';
import { checkHaveIBeenPwned } from '../../src/utils/auth/hibp';
import { MSG_OTP_INVALID, MSG_RATE_LIMITED } from '../../src/utils/auth/authErrors';
import { generateCorrelationId } from '../../src/utils/auth/loginSecurity';
import { OTP_LENGTH } from '../../src/utils/auth/securityConfig';

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg: '#0F1419',
  card: 'rgba(28,32,38,0.75)',
  cardBorder: 'rgba(255,255,255,0.1)',
  orange: '#FFA504',
  orangeText: '#5C3400',
  text: '#DFE2EA',
  muted: '#C6C5D4',
  inputBg: 'rgba(255,255,255,0.07)',
  inputBorder: 'rgba(255,255,255,0.12)',
  inputActive: '#FFA504',
  inputFilled: 'rgba(255,255,255,0.22)',
  error: '#FF7878',
  success: '#34D399',
};

const COOLDOWN_SEC         = 60;
const MAX_RESET_OTP_ATTEMPTS = 3;   // frontend guard; server enforces its own limit
const MAX_RESET_RESENDS    = 3;     // max resend attempts per session
// Generic messages — never reveal whether email exists or OTP is invalid vs. expired
const RESET_SEND_MESSAGE   = 'If that email can receive resets, we sent a code.';
const RESET_ERROR_MESSAGE  = 'We could not complete that request right now.';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  // ── State machine (0 = email, 1 = OTP, 2 = new password, 3 = success) ────────
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  // OTP brute-force guard (frontend; server enforces its own limit)
  const otpAttemptsRef  = useRef(0);
  const resendCountRef  = useRef(0);
  const [requiresResend, setRequiresResend] = useState(false);

  const otpRefs = useRef<(TextInput | null)[]>(Array(OTP_LENGTH).fill(null));

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Use the same strength/requirements as registration — passwordSchema is the authority
  const strength     = getPasswordStrength(newPassword);
  const requirements = PASSWORD_REQUIREMENTS;

  // ── Step 0: Send recovery code ──────────────────────────────────────────────
  // Always respond with RESET_SEND_MESSAGE regardless of whether the email is
  // registered — prevents account enumeration (OWASP A07).
  const handleSendCode = async () => {
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      if (supabaseConfigured) {
        // Error is intentionally ignored — always proceed to OTP step to
        // prevent leaking whether the email is registered.
        await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
      }
      // Reset per-session attempt counters for the new code flow
      otpAttemptsRef.current = 0;
      resendCountRef.current = 1; // this send counts as the first
      setRequiresResend(false);
      setCooldown(COOLDOWN_SEC);
      setStep(1);
    } catch {
      // Never show detailed error — generic message prevents enumeration
      setError(RESET_SEND_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || !email) return;
    if (resendCountRef.current >= MAX_RESET_RESENDS) {
      setError('Too many code requests. Please request a new reset link.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      if (supabaseConfigured) {
        await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
      }
      resendCountRef.current++;
      otpAttemptsRef.current = 0; // fresh code resets attempt counter
      setRequiresResend(false);
      setCooldown(COOLDOWN_SEC);
    } catch {
      setError(RESET_SEND_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [cooldown, email]);

  // ── Step 1: Verify OTP ──────────────────────────────────────────────────────
  // Generic error message regardless of whether code is wrong, expired, or
  // doesn't match any account — prevents enumeration (OWASP A07).
  const handleVerifyOtp = async () => {
    const token = digits.join('').trim();
    if (token.length < OTP_LENGTH) { setError(`Enter the full ${OTP_LENGTH}-digit code.`); return; }
    if (!supabaseConfigured) { setError('Supabase is not configured.'); return; }
    if (requiresResend) return; // blocked until user requests new code
    setIsLoading(true);
    setError('');
    try {
      const { data, error: e } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: 'recovery',
      });
      if (e || !data?.session) {
        otpAttemptsRef.current++;
        if (otpAttemptsRef.current >= MAX_RESET_OTP_ATTEMPTS) {
          setDigits(Array(OTP_LENGTH).fill(''));
          setRequiresResend(true);
          setError('Too many incorrect attempts. Please request a new code.');
          otpAttemptsRef.current = 0;
        } else {
          setError(MSG_OTP_INVALID);
        }
        setIsLoading(false);
        return;
      }
      setStep(2);
    } catch {
      setError(MSG_OTP_INVALID);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 2: Update password ─────────────────────────────────────────────────
  // Uses the same passwordSchema as registration — no weaker check at reset.
  // Includes HIBP k-anonymity breach check and global sign-out on success.
  const handleUpdatePassword = async () => {
    // Full policy enforcement via shared passwordSchema
    const pwErr = getPasswordError(newPassword);
    if (pwErr) { setError(pwErr); return; }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!supabaseConfigured) { setError('Supabase is not configured.'); return; }
    setIsLoading(true);
    setError('');
    try {
      // HIBP breach check — fail open (never block on HIBP API error)
      try {
        const { pwned } = await checkHaveIBeenPwned(newPassword);
        if (pwned) {
          setError('This password has appeared in a known data breach. Please choose a different password.');
          setIsLoading(false);
          return;
        }
      } catch {
        // HIBP check failure must never block the reset
      }

      const { error: e } = await supabase.auth.updateUser({ password: newPassword });
      if (e) {
        const cid = generateCorrelationId();
        setError(`${RESET_ERROR_MESSAGE} (Ref: ${cid})`);
        setIsLoading(false);
        return;
      }
      // Clear sensitive state before navigating away
      setNewPassword('');
      setConfirmPassword('');
      // Global sign-out: all sessions are invalidated; user must log in with new password
      await supabase.auth.signOut({ scope: 'global' });
      setStep(3);
    } catch {
      setError(RESET_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  };

  // ── OTP digit helpers ───────────────────────────────────────────────────────
  const onChangeDigit = (text: string, idx: number) => {
    const cleaned = text.replace(/[^\d]/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[idx] = cleaned;
    setDigits(newDigits);
    setError('');
    if (cleaned && idx < OTP_LENGTH - 1) otpRefs.current[idx + 1]?.focus();
  };

  const onKeyPressDigit = (e: { nativeEvent: { key: string } }, idx: number) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const timerLabel = (() => {
    const m = Math.floor(cooldown / 60);
    const sec = String(cooldown % 60).padStart(2, '0');
    return `${m}:${sec}`;
  })();

  const maskedEmail = email.replace(/(.{2}).*(@.*)/, '$1***$2');

  // ── Renders ─────────────────────────────────────────────────────────────────

  const renderStep0 = () => (
    <ScrollView
      contentContainerStyle={fs.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Icon orb */}
      <View style={fs.iconOrb}>
        <Text style={fs.iconOrbText}>🔐</Text>
      </View>

      <Text style={fs.stepTitle}>Forgot Password?</Text>
      <Text style={fs.stepSubtitle}>
        Enter your registered email to receive an {OTP_LENGTH}-digit reset code.
      </Text>

      {/* Glass card */}
      <View style={fs.glassCard}>
        <Text style={fs.label}>Email Address</Text>
        <View style={[fs.inputRow, error ? fs.inputRowError : undefined]}>
          <Mail size={18} color={C.muted} />
          <TextInput
            style={fs.input}
            placeholder="name@example.com"
            placeholderTextColor="rgba(198,197,212,0.4)"
            value={email}
            onChangeText={t => { setEmail(t); setError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        {error ? <Text style={fs.errorText}>{error}</Text> : null}
        <TouchableOpacity
          style={[fs.primaryBtn, isLoading && fs.primaryBtnDisabled]}
          onPress={handleSendCode}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading
            ? <ActivityIndicator color={C.orangeText} />
            : <Text style={fs.primaryBtnText}>Send Reset Code</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={fs.linkRow} onPress={() => router.replace('/(auth)/login')}>
        <Text style={fs.linkText}>
          Remembered your password?{' '}
          <Text style={fs.linkAccent}>Log In</Text>
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderStep1 = () => (
    <View style={fs.centeredContent}>
      <Text style={fs.stepTitle}>Check your email</Text>
      <Text style={fs.stepSubtitle}>
        We sent an {OTP_LENGTH}-digit code to{'\n'}
        <Text style={fs.highlight}>{maskedEmail}</Text>
      </Text>

      {/* OTP boxes */}
      <View style={fs.otpRow}>
        {Array(OTP_LENGTH).fill(null).map((_, idx) => (
          <TextInput
            key={idx}
            ref={r => { otpRefs.current[idx] = r; }}
            style={[
              fs.digitBox,
              focusedIdx === idx && fs.digitBoxActive,
              digits[idx] ? fs.digitBoxFilled : undefined,
            ]}
            value={digits[idx]}
            onChangeText={t => onChangeDigit(t, idx)}
            onKeyPress={e => onKeyPressDigit(e, idx)}
            onFocus={() => setFocusedIdx(idx)}
            onBlur={() => setFocusedIdx(-1)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
            textAlign="center"
          />
        ))}
      </View>

      {error ? <Text style={[fs.errorText, { textAlign: 'center' }]}>{error}</Text> : null}

      <View style={fs.timerRow}>
        <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || isLoading || resendCountRef.current >= MAX_RESET_RESENDS}>
          <Text style={[fs.resendText, (cooldown > 0 || resendCountRef.current >= MAX_RESET_RESENDS) && { color: C.muted }]}>
            {cooldown > 0 ? `Resend in ${timerLabel}` : 'Resend code'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[fs.primaryBtn, (isLoading || requiresResend) && fs.primaryBtnDisabled, { width: '100%' }]}
        onPress={handleVerifyOtp}
        disabled={isLoading || requiresResend}
        activeOpacity={0.85}
      >
        {isLoading
          ? <ActivityIndicator color={C.orangeText} />
          : <Text style={fs.primaryBtnText}>Verify &amp; Continue</Text>}
      </TouchableOpacity>
    </View>
  );

  const renderStep2 = () => (
    <ScrollView
      contentContainerStyle={fs.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={fs.stepTitle}>New Password</Text>
      <Text style={fs.stepSubtitle}>
        Create a strong new password to protect your account.
      </Text>

      <View style={fs.glassCard}>
        <Text style={fs.label}>New Password</Text>
        <View style={[fs.inputRow, error && !confirmPassword ? fs.inputRowError : undefined]}>
          <Lock size={18} color={C.muted} />
          <TextInput
            style={[fs.input, { flex: 1 }]}
            placeholder="••••••••"
            placeholderTextColor="rgba(198,197,212,0.4)"
            value={newPassword}
            onChangeText={t => { setNewPassword(t); setError(''); }}
            secureTextEntry={!showPw}
          />
          <TouchableOpacity onPress={() => setShowPw(!showPw)}>
            {showPw ? <EyeOff size={18} color={C.muted} /> : <Eye size={18} color={C.muted} />}
          </TouchableOpacity>
        </View>

        {/* Strength */}
        {newPassword.length > 0 && (
          <View style={fs.strengthWrap}>
            <View style={fs.strengthRow}>
              <Text style={fs.strengthLabel}>Password Strength</Text>
              <Text style={[fs.strengthLabel, { color: strength.color, fontWeight: '700' }]}>
                {strength.label}
              </Text>
            </View>
            <View style={fs.strengthBar}>
              {[1, 2, 3, 4].map(i => (
                <View
                  key={i}
                  style={[
                    fs.strengthSeg,
                    { backgroundColor: i <= strength.score ? strength.color : 'rgba(255,255,255,0.1)' },
                  ]}
                />
              ))}
            </View>
            <View style={fs.reqList}>
              {requirements.map((req, i) => {
                const met = req.test(newPassword);
                return (
                  <View key={i} style={fs.reqRow}>
                    <View
                      style={[
                        fs.reqDot,
                        {
                          backgroundColor: met ? C.success : 'transparent',
                          borderColor: met ? C.success : 'rgba(255,255,255,0.2)',
                        },
                      ]}
                    >
                      {met ? <Check size={9} color="#FFFFFF" /> : null}
                    </View>
                    <Text style={[fs.reqText, { color: met ? C.text : C.muted }]}>
                      {req.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <Text style={[fs.label, { marginTop: 16 }]}>Confirm New Password</Text>
        <View style={[fs.inputRow, error && confirmPassword ? fs.inputRowError : undefined]}>
          <Lock size={18} color={C.muted} />
          <TextInput
            style={[fs.input, { flex: 1 }]}
            placeholder="••••••••"
            placeholderTextColor="rgba(198,197,212,0.4)"
            value={confirmPassword}
            onChangeText={t => { setConfirmPassword(t); setError(''); }}
            secureTextEntry={!showConfirm}
          />
          <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)}>
            {showConfirm ? <EyeOff size={18} color={C.muted} /> : <Eye size={18} color={C.muted} />}
          </TouchableOpacity>
        </View>

        {error ? <Text style={fs.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[fs.primaryBtn, { marginTop: 20 }, isLoading && fs.primaryBtnDisabled]}
          onPress={handleUpdatePassword}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading
            ? <ActivityIndicator color={C.orangeText} />
            : <Text style={fs.primaryBtnText}>Update Password</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={fs.linkRow} onPress={() => router.replace('/(auth)/login')}>
        <Text style={fs.linkText}>
          Need help?{' '}
          <Text style={fs.linkAccent}>Contact support</Text>
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderStep3 = () => (
    <View style={fs.successContainer}>
      {/* Checkmark orb */}
      <View style={fs.successOrb}>
        <Check size={44} color={C.orange} strokeWidth={2.5} />
      </View>

      <Text style={fs.successTitle}>Password Updated!</Text>
      <Text style={fs.successSubtitle}>
        Your password has been successfully reset. You can now log in with your new credentials.
      </Text>

      <TouchableOpacity
        style={[fs.primaryBtn, { marginTop: 36, width: '100%' }]}
        onPress={() => router.replace('/(auth)/login')}
        activeOpacity={0.85}
      >
        <Text style={fs.primaryBtnText}>Back to Login</Text>
      </TouchableOpacity>

      {/* Decorative bar */}
      <View style={fs.successBar}>
        <View style={fs.successBarFill} />
      </View>
    </View>
  );

  const stepContent = [renderStep0, renderStep1, renderStep2, renderStep3];

  return (
    <SafeAreaView style={fs.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={fs.container}
      >
        {/* Header — hidden on success screen */}
        {step < 3 && (
          <View style={fs.header}>
            <TouchableOpacity
              onPress={step === 0 ? () => router.back() : () => setStep(s => s - 1)}
              style={fs.backBtn}
              activeOpacity={0.7}
            >
              <ChevronLeft size={24} color="#BBC3FF" />
            </TouchableOpacity>
            <Text style={fs.wordmark}>Mi Osusu</Text>
            <View style={{ width: 40 }} />
          </View>
        )}

        <View style={fs.body}>
          {stepContent[step]?.()}
        </View>

        {/* Bg glows */}
        <View style={fs.glowTR} pointerEvents="none" />
        <View style={fs.glowBL} pointerEvents="none" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const fs = StyleSheet.create({
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
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  centeredContent: {
    flex: 1, paddingHorizontal: 24, paddingTop: 32, alignItems: 'center',
  },
  iconOrb: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(0,21,127,0.25)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  iconOrbText: { fontSize: 34 },
  stepTitle: { fontSize: 28, fontWeight: '700', color: C.text, marginBottom: 8 },
  stepSubtitle: { fontSize: 15, color: C.muted, lineHeight: 22, marginBottom: 28 },
  highlight: { color: C.orange, fontWeight: '700' },
  glassCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
    marginBottom: 20,
  },
  label: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.inputBg, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.inputBorder,
    gap: 10, marginBottom: 4,
  },
  inputRowError: { borderColor: '#FF7878' },
  input: { flex: 1, fontSize: 16, color: C.text, fontWeight: '500' },
  errorText: { fontSize: 13, color: C.error, marginTop: 6, marginBottom: 4 },
  primaryBtn: {
    height: 54, borderRadius: 14, backgroundColor: C.orange,
    alignItems: 'center', justifyContent: 'center', marginTop: 14,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: C.orangeText },
  linkRow: { marginTop: 4, alignItems: 'center' },
  linkText: { fontSize: 14, color: C.muted, textAlign: 'center' },
  linkAccent: { color: C.orange, fontWeight: '700' },
  otpRow: { flexDirection: 'row', gap: 5, justifyContent: 'center', marginBottom: 20, width: '100%' },
  digitBox: {
    flex: 1, maxWidth: 48, height: 58, borderRadius: 12, borderWidth: 1.5,
    backgroundColor: C.inputBg, borderColor: C.inputBorder,
    fontSize: 22, fontWeight: '700', color: C.text,
  },
  digitBoxActive: { borderColor: C.orange, backgroundColor: 'rgba(255,165,4,0.08)' },
  digitBoxFilled: { borderColor: C.inputFilled },
  timerRow: { alignItems: 'center', marginBottom: 24 },
  resendText: { fontSize: 14, fontWeight: '700', color: C.orange },
  strengthWrap: { marginTop: 8, marginBottom: 8 },
  strengthRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  strengthLabel: { fontSize: 12, color: C.muted, fontWeight: '500' },
  strengthBar: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  strengthSeg: { flex: 1, height: 4, borderRadius: 4 },
  reqList: { gap: 6 },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqDot: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  reqText: { fontSize: 12, fontWeight: '500' },
  successContainer: {
    flex: 1, paddingHorizontal: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  successOrb: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 1, borderColor: 'rgba(255,165,4,0.2)',
    backgroundColor: 'rgba(255,165,4,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 28,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3, shadowRadius: 28, elevation: 8,
  },
  successTitle: { fontSize: 32, fontWeight: '700', color: C.text, marginBottom: 12 },
  successSubtitle: {
    fontSize: 16, color: C.muted, textAlign: 'center', lineHeight: 24, maxWidth: 300,
  },
  successBar: {
    marginTop: 48, width: '80%', height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden',
  },
  successBarFill: { flex: 1, backgroundColor: C.orange },
  glowTR: {
    position: 'absolute', top: -80, right: -80,
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(0,21,127,0.14)', zIndex: -1,
  },
  glowBL: {
    position: 'absolute', bottom: -60, left: -60,
    width: 250, height: 250, borderRadius: 125,
    backgroundColor: 'rgba(255,165,4,0.06)', zIndex: -1,
  },
});
