/**
 * MfaChallengeScreen — TOTP second-factor challenge at login.
 *
 * Reached automatically after a successful password or Google login when
 * supabase.auth.mfa.getAuthenticatorAssuranceLevel() reports:
 *   currentLevel === 'aal1' AND nextLevel === 'aal2'
 *
 * This means the user has a verified TOTP factor enrolled but the current
 * session has only passed password (AAL1), not the second factor (AAL2).
 *
 * Flow:
 *   1. Mount: listFactors() → find the verified TOTP factor → challenge()
 *   2. User enters 6-digit code from authenticator app
 *   3. verify(factorId, challengeId, code) → AAL2 session established
 *   4. Navigate to home
 *
 * Security properties:
 *  - mfa.challenge() / mfa.verify() go directly to Supabase Auth — the code
 *    never passes through Mi Osusu's own Edge Functions.
 *  - A new challenge is requested on each mount so codes cannot be replayed.
 *  - The screen does not reveal which factor type is enrolled or how many exist.
 *  - Cancelling logs the user out (AAL1-only sessions must not reach the app).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView }            from 'react-native-safe-area-context';
import { useRouter }               from 'expo-router';
import { Lock, ShieldCheck }       from 'lucide-react-native';
import { supabase }                from '../../src/services/supabase';
import { useAuthStore }            from '../../src/store/authStore';
import { useAppDataStore }         from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

type State = 'loading' | 'challenge' | 'verifying' | 'error';

const MAX_VERIFY_ATTEMPTS = 5; // prevent brute-force on this screen

export default function MfaChallengeScreen() {
  const router           = useRouter();
  const { logout }       = useAuthStore();
  const { preferences }  = useAppDataStore();
  const isDark           = preferences.darkMode;
  const C                = isDark ? darkColors : lightColors;

  const [state,          setState]        = useState<State>('loading');
  const [code,           setCode]         = useState('');
  const [errorMsg,       setErrorMsg]     = useState<string | null>(null);
  const [attemptsLeft,   setAttemptsLeft] = useState(MAX_VERIFY_ATTEMPTS);

  const factorIdRef    = useRef<string | null>(null);
  const challengeIdRef = useRef<string | null>(null);
  const mountedRef     = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Step 1: list factors, start challenge ──────────────────────────────────

  const startChallenge = useCallback(async () => {
    if (!mountedRef.current) return;
    setState('loading');
    setErrorMsg(null);
    setCode('');

    try {
      const { data: factorsData, error: listErr } =
        await supabase.auth.mfa.listFactors();

      if (!mountedRef.current) return;
      if (listErr) throw new Error('Could not load your security key.');

      // Find the first verified TOTP factor
      const factor = (factorsData?.totp ?? []).find(
        (f: { status: string }) => f.status === 'verified'
      );
      if (!factor) {
        // No verified TOTP factor — should not normally reach this screen;
        // let the user through without blocking (fail open, not fail locked).
        console.warn('[mfa-challenge] No verified TOTP factor found; bypassing challenge.');
        router.replace('/(main)/home');
        return;
      }

      factorIdRef.current = factor.id;

      const { data: challengeData, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: factor.id });

      if (!mountedRef.current) return;
      if (challengeErr) throw new Error('Could not start verification. Please try again.');

      challengeIdRef.current = challengeData.id;
      setState('challenge');
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'An error occurred.';
      setErrorMsg(msg);
      setState('error');
    }
  }, [router]);

  useEffect(() => { void startChallenge(); }, [startChallenge]);

  // ── Step 2: verify code ────────────────────────────────────────────────────

  const handleVerify = async () => {
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setErrorMsg('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (!factorIdRef.current || !challengeIdRef.current) {
      setErrorMsg('Session expired. Please try again.');
      void startChallenge();
      return;
    }

    setErrorMsg(null);
    setState('verifying');

    try {
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId:    factorIdRef.current,
        challengeId: challengeIdRef.current,
        code:        trimmedCode,
      });

      if (!mountedRef.current) return;

      if (verifyErr) {
        const remaining = attemptsLeft - 1;
        setAttemptsLeft(remaining);
        setCode('');

        if (remaining <= 0) {
          // Too many failures — sign out to prevent session abuse
          Alert.alert(
            'Too Many Attempts',
            'You have entered an incorrect code too many times. You will be signed out.',
            [{ text: 'OK', onPress: () => void logout() }]
          );
          return;
        }

        const isExpired = verifyErr.message?.toLowerCase().includes('expired');
        if (isExpired) {
          // Challenge expired — start a fresh one
          setErrorMsg('The code expired. A new challenge has been started.');
          void startChallenge();
        } else {
          setErrorMsg(
            `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
          );
          setState('challenge');
        }
        return;
      }

      // ── Success: AAL2 session established ──────────────────────────────────
      router.replace('/(main)/home');
    } catch {
      if (mountedRef.current) {
        setErrorMsg('Verification failed. Please try again.');
        setState('challenge');
      }
    }
  };

  // ── Cancel: must sign out — AAL1-only sessions cannot reach the app ────────

  const handleCancel = () => {
    Alert.alert(
      'Cancel Sign-In',
      'Cancelling will sign you out. You can sign in again from the login screen.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => void logout() },
      ]
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
      <View style={styles.content}>

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: isDark ? '#1E2B5A' : '#EFF6FF' }]}>
          <ShieldCheck size={40} color="#3B82F6" />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: C.text }]}>
          Two-Factor Verification
        </Text>
        <Text style={[styles.subtitle, { color: C.textSub }]}>
          Enter the 6-digit code from your authenticator app to complete sign-in.
        </Text>

        {/* Loading */}
        {state === 'loading' && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={[styles.loadingText, { color: C.textSub }]}>
              Starting verification…
            </Text>
          </View>
        )}

        {/* Error (non-retriable) */}
        {state === 'error' && (
          <View style={[styles.errorCard, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
            <Text style={styles.errorCardText}>
              {errorMsg ?? 'Could not start verification.'}
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void startChallenge()}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Challenge input */}
        {(state === 'challenge' || state === 'verifying') && (
          <>
            <View style={[styles.codeInputWrap, { borderColor: errorMsg ? '#EF4444' : '#3B82F6' }]}>
              <Lock size={18} color={C.textMuted} style={{ marginRight: 10 }} />
              <TextInput
                style={[styles.codeInput, { color: C.text }]}
                value={code}
                onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); setErrorMsg(null); }}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={C.textMuted}
                editable={state === 'challenge'}
                autoFocus
                accessibilityLabel="6-digit authentication code"
              />
            </View>

            {errorMsg && (
              <Text style={styles.inlineError}>{errorMsg}</Text>
            )}

            <TouchableOpacity
              style={[
                styles.verifyBtn,
                (state === 'verifying' || code.length < 6) && styles.btnDisabled,
              ]}
              onPress={() => void handleVerify()}
              disabled={state === 'verifying' || code.length < 6}
            >
              {state === 'verifying'
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.verifyBtnText}>Verify</Text>}
            </TouchableOpacity>

            <Text style={[styles.hint, { color: C.textMuted }]}>
              Open your authenticator app and enter the current code for Mi Osusu.
            </Text>
          </>
        )}

        {/* Cancel */}
        {state !== 'loading' && (
          <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
            <Text style={[styles.cancelBtnText, { color: C.textSub }]}>
              Cancel and sign out
            </Text>
          </TouchableOpacity>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingBottom: 40,
  },

  iconWrap: {
    width: 84, height: 84, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 28,
  },

  title: {
    fontSize: 26, fontWeight: '800', textAlign: 'center',
    letterSpacing: -0.4, marginBottom: 10,
  },
  subtitle: {
    fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 32,
  },

  loadingWrap: { alignItems: 'center', gap: 14 },
  loadingText: { fontSize: 14, fontWeight: '500' },

  errorCard: {
    borderRadius: 14, borderWidth: 1.5, padding: 18, alignItems: 'center',
    marginBottom: 20, alignSelf: 'stretch',
  },
  errorCardText: { fontSize: 14, color: '#DC2626', textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  retryBtn: {
    backgroundColor: '#DC2626', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  codeInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 2, borderRadius: 16, paddingHorizontal: 18,
    alignSelf: 'stretch', marginBottom: 10,
  },
  codeInput: {
    flex: 1, fontSize: 32, fontWeight: '800', letterSpacing: 16,
    textAlign: 'center', paddingVertical: 18,
    fontVariant: ['tabular-nums'],
  },

  inlineError: {
    color: '#EF4444', fontSize: 13, textAlign: 'center', marginBottom: 10,
  },

  verifyBtn: {
    backgroundColor: '#3B82F6', borderRadius: 16, paddingVertical: 17,
    alignSelf: 'stretch', alignItems: 'center', marginBottom: 14, marginTop: 6,
    shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  verifyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  btnDisabled:   { opacity: 0.4, shadowOpacity: 0 },

  hint: { fontSize: 12, textAlign: 'center', lineHeight: 18 },

  cancelBtn:     { marginTop: 28, paddingVertical: 8 },
  cancelBtnText: { fontSize: 13, fontWeight: '600' },
});
