/**
 * Two-Factor Authentication — Supabase TOTP enrollment and management.
 *
 * States: loading → not_enrolled ↔ enrolling → enrolled
 *                                              enrolled → removing → not_enrolled
 *
 * Security model:
 *  - enrollment.totp.secret is only displayed during the enrollment step.
 *    It is never stored client-side after that view is dismissed.
 *  - verification uses mfa.challenge() → mfa.verify() so the code is
 *    never sent to our own server — it goes directly to Supabase Auth.
 *  - unenroll requires re-entering a live TOTP code (not just a password)
 *    so a stolen session cannot silently remove 2FA protection.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView }             from 'react-native-safe-area-context';
import { useRouter }                from 'expo-router';
import * as Clipboard               from 'expo-clipboard';
import * as Linking                 from 'expo-linking';
import { SvgXml }                   from 'react-native-svg';
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Shield,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from 'lucide-react-native';
import { supabase }                 from '../../src/services/supabase';
import { useAuthStore }             from '../../src/store/authStore';
import { useAppDataStore }          from '../../src/store/appDataStore';
import { darkColors, lightColors }  from '../../src/theme/colors';

// ── QR code error boundary ────────────────────────────────────────────────────
// SvgXml can throw during rendering if:
//   a) The SVG string from Supabase is malformed,
//   b) The react-native-svg native module version mismatches the JS layer
//      (possible if an OTA update runs against an older binary).
// This class component catches those errors and falls back to manual-secret mode.

interface QrBoundaryProps {
  children: React.ReactNode;
  onError:  () => void;
}
interface QrBoundaryState { hasError: boolean }

class QrErrorBoundary extends React.Component<QrBoundaryProps, QrBoundaryState> {
  constructor(props: QrBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): QrBoundaryState {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn('[2fa] SvgXml render error — falling back to manual secret:', err.message);
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScreenState =
  | 'loading'
  | 'not_enrolled'
  | 'enrolling'      // QR + secret visible; waiting for user to enter code
  | 'verifying'      // Submitting the verification code
  | 'enrolled'       // 2FA active; show management options
  | 'confirming_remove' // User entered TOTP code to confirm unenroll
  | 'removing';

interface TOTPFactor {
  id:             string;
  friendly_name?: string;
  status:         string;
  created_at:     string;
}

interface Enrollment {
  factorId:  string;
  qrSvg:     string;
  secret:    string;
  uri:       string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function is6Digits(v: string): boolean {
  return /^\d{6}$/.test(v.trim());
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TwoFactorAuthScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [screenState,   setScreenState]   = useState<ScreenState>('loading');
  const [enrolledFactor, setEnrolledFactor] = useState<TOTPFactor | null>(null);
  const [enrollment,    setEnrollment]    = useState<Enrollment | null>(null);
  const [verifyCode,    setVerifyCode]    = useState('');
  const [removeCode,    setRemoveCode]    = useState('');
  const [showSecret,    setShowSecret]    = useState(false);
  const [copiedSecret,  setCopiedSecret]  = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  // qrFailed: set to true if SvgXml throws during rendering (e.g. native module
  // version mismatch on older app binaries receiving an OTA update).
  // When true, we show only the manual secret and the "Open in App" button.
  const [qrFailed,      setQrFailed]      = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Load current 2FA state ────────────────────────────────────────────────
  const loadFactors = useCallback(async () => {
    if (!mountedRef.current) return;
    setScreenState('loading');
    setError(null);
    try {
      const { data, error: listErr } = await supabase.auth.mfa.listFactors();
      if (!mountedRef.current) return;
      if (listErr) throw listErr;

      const verified = (data?.totp ?? []).find(
        (f: TOTPFactor) => f.status === 'verified'
      );
      if (verified) {
        setEnrolledFactor(verified);
        setScreenState('enrolled');
      } else {
        setEnrolledFactor(null);
        setScreenState('not_enrolled');
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError('Could not load 2FA status. Please try again.');
        setScreenState('not_enrolled');
      }
    }
  }, []);

  useEffect(() => { void loadFactors(); }, [loadFactors]);

  // ── Begin enrollment ──────────────────────────────────────────────────────
  const handleStartEnroll = async () => {
    setError(null);
    setScreenState('enrolling'); // show skeleton immediately
    try {
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType:   'totp',
        issuer:       'Mi Osusu',
        friendlyName: user?.email ?? 'Mi Osusu Account',
      });
      if (!mountedRef.current) return;
      if (enrollErr) throw enrollErr;

      setEnrollment({
        factorId: data.id,
        qrSvg:    data.totp.qr_code,   // SVG string from Supabase
        secret:   data.totp.secret,
        uri:      data.totp.uri,
      });
      setVerifyCode('');
      setShowSecret(false);
    } catch (err: unknown) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Enrollment failed.';
        setError(msg.length < 120 ? msg : 'Could not start 2FA setup. Please try again.');
        setScreenState('not_enrolled');
      }
    }
  };

  // ── Cancel enrollment ─────────────────────────────────────────────────────
  const handleCancelEnroll = async () => {
    if (enrollment?.factorId) {
      // Clean up the unverified factor so it doesn't linger
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId }).catch(() => {});
    }
    setEnrollment(null);
    setVerifyCode('');
    setScreenState('not_enrolled');
  };

  // ── Verify enrollment code ────────────────────────────────────────────────
  const handleVerifyEnrollment = async () => {
    if (!enrollment || !is6Digits(verifyCode)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError(null);
    setScreenState('verifying');
    try {
      const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: enrollment.factorId });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId:    enrollment.factorId,
        challengeId: challenge.id,
        code:        verifyCode.trim(),
      });
      if (!mountedRef.current) return;
      if (verifyErr) throw verifyErr;

      // Factor is now verified — reload to get the confirmed enrolled state
      setEnrollment(null);
      await loadFactors();
    } catch (err: unknown) {
      if (mountedRef.current) {
        const raw = err instanceof Error ? err.message : '';
        setError(
          raw.toLowerCase().includes('invalid') || raw.toLowerCase().includes('expired')
            ? 'Incorrect or expired code. Check your authenticator and try again.'
            : 'Verification failed. Please try again.'
        );
        setScreenState('enrolling');
      }
    }
  };

  // ── Unenroll (requires live TOTP code) ────────────────────────────────────
  const handleConfirmRemove = async () => {
    if (!enrolledFactor || !is6Digits(removeCode)) {
      setError('Enter a valid 6-digit code to confirm removal.');
      return;
    }
    setError(null);
    setScreenState('removing');
    try {
      // Must verify the live code before unenrolling to prevent
      // a stolen session silently disabling 2FA
      const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: enrolledFactor.id });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId:    enrolledFactor.id,
        challengeId: challenge.id,
        code:        removeCode.trim(),
      });
      if (verifyErr) throw new Error('Incorrect code — 2FA removal cancelled.');

      const { error: unenrollErr } =
        await supabase.auth.mfa.unenroll({ factorId: enrolledFactor.id });
      if (!mountedRef.current) return;
      if (unenrollErr) throw unenrollErr;

      setRemoveCode('');
      setEnrolledFactor(null);
      setScreenState('not_enrolled');
    } catch (err: unknown) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : 'Removal failed.';
        setError(msg.length < 120 ? msg : 'Could not remove 2FA. Please try again.');
        setScreenState('enrolled');
      }
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const handleCopySecret = async () => {
    if (!enrollment?.secret) return;
    await Clipboard.setStringAsync(enrollment.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2400);
  };

  const handleOpenAuthApp = async () => {
    if (!enrollment?.uri) return;
    const canOpen = await Linking.canOpenURL(enrollment.uri).catch(() => false);
    if (canOpen) await Linking.openURL(enrollment.uri);
    else Alert.alert('No Authenticator Found', 'Install Google Authenticator or Authy, then tap "Copy Secret" to add the account manually.');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: C.iconBg }]}>
          <ArrowLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Two-Factor Authentication</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── LOADING ── */}
        {screenState === 'loading' && (
          <View style={styles.centred}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={[styles.loadingText, { color: C.textSub }]}>Checking 2FA status…</Text>
          </View>
        )}

        {/* ── ERROR BANNER ── */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── NOT ENROLLED ── */}
        {(screenState === 'not_enrolled') && (
          <>
            <View style={[styles.statusCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[styles.statusIconWrap, { backgroundColor: isDark ? '#1E2B5A' : '#F1F5F9' }]}>
                <Shield size={32} color={C.textMuted} />
              </View>
              <Text style={[styles.statusTitle, { color: C.text }]}>2FA is Off</Text>
              <Text style={[styles.statusDesc, { color: C.textSub }]}>
                Your account is protected by your password. Enabling two-factor authentication
                requires a time-based code from an authenticator app on every login.
              </Text>
            </View>

            <View style={[styles.infoBox, { backgroundColor: isDark ? '#0C2233' : '#EFF6FF', borderColor: isDark ? '#1E3A5F' : '#BFDBFE' }]}>
              <Smartphone size={16} color="#3B82F6" />
              <Text style={[styles.infoText, { color: isDark ? '#93C5FD' : '#1D4ED8' }]}>
                Install Google Authenticator, Authy, or any TOTP-compatible app before continuing.
              </Text>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => void handleStartEnroll()}>
              <ShieldCheck size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Activate 2FA</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── ENROLLING ── */}
        {(screenState === 'enrolling' || screenState === 'verifying') && enrollment && (
          <>
            <View style={[styles.stepCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[styles.stepTitle, { color: C.text }]}>Step 1 — Scan or enter the key</Text>
              <Text style={[styles.stepDesc, { color: C.textSub }]}>
                Open your authenticator app and scan the QR code, or tap "Open in App".
              </Text>

              {/* QR Code — wrapped in error boundary to handle native module mismatches */}
              {!qrFailed ? (
                <View style={[styles.qrWrap, { backgroundColor: '#FFFFFF' }]}>
                  <QrErrorBoundary onError={() => setQrFailed(true)}>
                    <SvgXml xml={enrollment.qrSvg} width={200} height={200} />
                  </QrErrorBoundary>
                </View>
              ) : (
                <View style={[styles.qrFallback, { backgroundColor: C.bgSoft, borderColor: C.border }]}>
                  <Smartphone size={24} color={C.textMuted} />
                  <Text style={[styles.qrFallbackText, { color: C.textSub }]}>
                    QR code unavailable on this device. Use the manual key or "Open in App" below.
                  </Text>
                </View>
              )}

              {/* Open in authenticator app */}
              <TouchableOpacity
                style={[styles.openAppBtn, { backgroundColor: C.iconBg, borderColor: C.border }]}
                onPress={() => void handleOpenAuthApp()}
              >
                <Smartphone size={16} color="#F97316" />
                <Text style={[styles.openAppText, { color: C.text }]}>Open in Authenticator App</Text>
              </TouchableOpacity>

              {/* Manual secret */}
              <TouchableOpacity
                style={styles.secretToggle}
                onPress={() => setShowSecret(v => !v)}
              >
                {showSecret ? <EyeOff size={14} color={C.textMuted} /> : <Eye size={14} color={C.textMuted} />}
                <Text style={[styles.secretToggleText, { color: C.textMuted }]}>
                  {showSecret ? 'Hide manual key' : 'Show manual key'}
                </Text>
              </TouchableOpacity>

              {showSecret && (
                <View style={[styles.secretBox, { backgroundColor: isDark ? '#0A1628' : '#F8FAFC', borderColor: C.border }]}>
                  <Text
                    style={[styles.secretText, { color: C.text }]}
                    selectable
                    accessibilityLabel="TOTP secret key"
                  >
                    {enrollment.secret}
                  </Text>
                  <TouchableOpacity onPress={() => void handleCopySecret()} style={styles.copySecretBtn}>
                    {copiedSecret
                      ? <CheckCircle size={16} color="#10B981" />
                      : <Copy size={16} color="#F97316" />}
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={[styles.stepCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[styles.stepTitle, { color: C.text }]}>Step 2 — Enter the verification code</Text>
              <Text style={[styles.stepDesc, { color: C.textSub }]}>
                Enter the 6-digit code from your authenticator app to confirm setup.
              </Text>

              <TextInput
                style={[styles.codeInput, { backgroundColor: C.inputBg, color: C.text, borderColor: is6Digits(verifyCode) ? '#10B981' : C.borderStrong }]}
                value={verifyCode}
                onChangeText={t => setVerifyCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={C.textMuted}
                textAlign="center"
                accessibilityLabel="6-digit TOTP code"
              />

              <View style={styles.enrollActions}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { backgroundColor: C.inputBg }]}
                  onPress={() => void handleCancelEnroll()}
                  disabled={screenState === 'verifying'}
                >
                  <Text style={[styles.cancelBtnText, { color: C.textSub }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.verifyBtn, (!is6Digits(verifyCode) || screenState === 'verifying') && styles.btnDisabled]}
                  onPress={() => void handleVerifyEnrollment()}
                  disabled={!is6Digits(verifyCode) || screenState === 'verifying'}
                >
                  {screenState === 'verifying'
                    ? <ActivityIndicator color="#FFFFFF" size="small" />
                    : <Text style={styles.verifyBtnText}>Verify & Activate</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* Enrolling but enrollment not yet ready (calling enroll()) */}
        {screenState === 'enrolling' && !enrollment && (
          <View style={styles.centred}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={[styles.loadingText, { color: C.textSub }]}>Generating your secure key…</Text>
          </View>
        )}

        {/* ── ENROLLED ── */}
        {(screenState === 'enrolled' || screenState === 'confirming_remove' || screenState === 'removing') && (
          <>
            <View style={[styles.statusCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[styles.statusIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <ShieldCheck size={32} color="#10B981" />
              </View>
              <Text style={[styles.statusTitle, { color: '#10B981' }]}>2FA is Active</Text>
              <Text style={[styles.statusDesc, { color: C.textSub }]}>
                Your account is protected with a time-based one-time password.
                A code from your authenticator app is required at each login.
              </Text>
              {enrolledFactor && (
                <Text style={[styles.enrolledSince, { color: C.textMuted }]}>
                  Enabled {new Date(enrolledFactor.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              )}
            </View>

            {/* Unenroll section */}
            {screenState === 'enrolled' && (
              <View style={[styles.removeCard, { backgroundColor: C.card, borderColor: '#FECACA' }]}>
                <View style={styles.removeHeader}>
                  <ShieldOff size={18} color="#EF4444" />
                  <Text style={[styles.removeTitle, { color: C.text }]}>Remove 2FA</Text>
                </View>
                <Text style={[styles.removeDesc, { color: C.textSub }]}>
                  To disable 2FA you must confirm with a live authenticator code.
                  This prevents a stolen session from silently removing your protection.
                </Text>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => { setRemoveCode(''); setError(null); setScreenState('confirming_remove'); }}
                >
                  <Text style={styles.removeBtnText}>Disable 2FA…</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Confirm removal with live TOTP code */}
            {(screenState === 'confirming_remove' || screenState === 'removing') && (
              <View style={[styles.stepCard, { backgroundColor: C.card, borderColor: '#FECACA' }]}>
                <View style={styles.removeHeader}>
                  <Lock size={16} color="#EF4444" />
                  <Text style={[styles.stepTitle, { color: '#EF4444' }]}>Confirm with your authenticator</Text>
                </View>
                <Text style={[styles.stepDesc, { color: C.textSub }]}>
                  Enter the current 6-digit code from your app to confirm you have access before removing 2FA.
                </Text>
                <TextInput
                  style={[styles.codeInput, { backgroundColor: C.inputBg, color: C.text, borderColor: '#FECACA' }]}
                  value={removeCode}
                  onChangeText={t => setRemoveCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor={C.textMuted}
                  textAlign="center"
                />
                <View style={styles.enrollActions}>
                  <TouchableOpacity
                    style={[styles.cancelBtn, { backgroundColor: C.inputBg }]}
                    onPress={() => { setRemoveCode(''); setError(null); setScreenState('enrolled'); }}
                    disabled={screenState === 'removing'}
                  >
                    <Text style={[styles.cancelBtnText, { color: C.textSub }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.removeFinalBtn, (!is6Digits(removeCode) || screenState === 'removing') && styles.btnDisabled]}
                    onPress={() => void handleConfirmRemove()}
                    disabled={!is6Digits(removeCode) || screenState === 'removing'}
                  >
                    {screenState === 'removing'
                      ? <ActivityIndicator color="#FFFFFF" size="small" />
                      : <Text style={styles.removeFinalBtnText}>Confirm — Remove 2FA</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 14,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  scroll: { padding: 20, paddingBottom: 48 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  loadingText: { marginTop: 16, fontSize: 14, fontWeight: '500' },

  errorBanner: {
    backgroundColor: '#FEF2F2', borderRadius: 12, borderWidth: 1, borderColor: '#FECACA',
    padding: 14, marginBottom: 16,
  },
  errorText: { fontSize: 14, color: '#DC2626', lineHeight: 20 },

  statusCard: {
    borderRadius: 20, borderWidth: 1, padding: 24, marginBottom: 20, alignItems: 'center',
  },
  statusIconWrap: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  statusTitle:  { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  statusDesc:   { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  enrolledSince:{ fontSize: 12, marginTop: 10 },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F97316', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },

  stepCard: {
    borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 16,
  },
  stepTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  stepDesc:  { fontSize: 14, lineHeight: 21, marginBottom: 16 },

  qrWrap: {
    alignSelf: 'center', borderRadius: 16, padding: 12, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  qrFallback: {
    alignSelf: 'stretch', borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
    padding: 20, alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14,
  },
  qrFallbackText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  openAppBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingVertical: 12, marginBottom: 12,
  },
  openAppText: { fontSize: 14, fontWeight: '600' },

  secretToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  secretToggleText: { fontSize: 12, fontWeight: '600' },
  secretBox: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, borderWidth: 1, padding: 12, gap: 10,
  },
  secretText: {
    flex: 1, fontSize: 13, fontWeight: '700', letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  copySecretBtn: { padding: 4 },

  codeInput: {
    fontSize: 28, fontWeight: '800', letterSpacing: 12,
    borderRadius: 14, borderWidth: 2, paddingVertical: 16,
    marginBottom: 16, textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  enrollActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 15,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
  verifyBtn: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 15,
  },
  verifyBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  btnDisabled: { opacity: 0.45 },

  removeCard: {
    borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 16,
  },
  removeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  removeTitle:  { fontSize: 16, fontWeight: '800' },
  removeDesc:   { fontSize: 14, lineHeight: 21, marginBottom: 14 },
  removeBtn: {
    alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1.5,
    borderColor: '#EF4444', paddingHorizontal: 16, paddingVertical: 10,
  },
  removeBtnText: { fontSize: 14, fontWeight: '700', color: '#EF4444' },
  removeFinalBtn: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EF4444', borderRadius: 14, paddingVertical: 15,
  },
  removeFinalBtnText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
});
