/**
 * MonimePaymentScreen
 *
 * Full-screen premium USSD payment experience for all Monime-backed flows:
 * vault top-up, Osusu contribution, savings deposit, and transfers.
 *
 * Navigation params (all optional with safe defaults):
 *   topupId, monimePaymentCodeId, ussdCode, expiresAt,
 *   amount, fee, provider, reference, paymentType
 *
 * The frontend NEVER marks a payment as successful. All state transitions
 * are driven by the backend via polling (verifyVaultTopupStatus) which
 * itself relies on Monime webhooks.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Clipboard,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView }              from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Copy,
  Phone,
  RefreshCw,
  Shield,
  XCircle,
  Wallet,
} from 'lucide-react-native';
import { useAppDataStore }         from '../../src/store/appDataStore';
import { darkColors, lightColors, type AppColors } from '../../src/theme/colors';
import {
  verifyVaultTopupStatus,
} from '../../src/services/vaultService';
import {
  verifyMonimeCheckout,
} from '../../src/services/paymentService';
import {
  fetchSendPaymentIntent,
  type SendPaymentIntentPreview,
} from '../../src/services/sendPaymentService';
import { PAYMENT_METHOD_LABELS } from '../../src/services/paymentMethodLinks';

// ── Status state machine ──────────────────────────────────────────────

type ScreenStatus =
  | 'active'      // Showing code + countdown
  | 'dialing'     // Dialer opened, waiting for return
  | 'verifying'   // Returned from dialer, polling
  | 'processing'  // Monime confirms receipt, waiting for completion
  | 'successful'  // Webhook confirmed payment
  | 'failed'      // Payment failed
  | 'cancelled'   // User / provider cancelled
  | 'expired'     // Code expired
  | 'invalid'     // Missing / unknown payment code — cannot poll
  | 'error';      // Network/backend error while verifying — retriable

const TERMINAL: ScreenStatus[] = ['successful', 'failed', 'cancelled', 'expired', 'invalid'];

// Normalised outcome from whichever backend verifier we polled.
type VerifyEffective =
  | 'pending' | 'processing' | 'completed'
  | 'failed' | 'expired' | 'cancelled' | 'not_found';

interface PollOutcome {
  effective:   VerifyEffective;
  completedAt: string | null;
  error:       Error | null;
}

const PROVIDER_COLOR: Record<string, string> = {
  orange_money: '#FF6900',
  afrimoney:    '#00A652',
};

function resolveProviderColor(provider: string): string {
  const key = provider.toLowerCase().replace(/\s/g, '_');
  return PROVIDER_COLOR[key] ?? '#F97316';
}

// ── Screen ────────────────────────────────────────────────────────────

export default function MonimePaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    topupId?:             string;
    monimePaymentCodeId?: string;
    ussdCode?:            string;
    expiresAt?:           string;
    amount?:              string;
    fee?:                 string;
    provider?:            string;
    reference?:           string;
    paymentType?:         string;
    groupId?:             string;
    paymentIntentId?:     string;
  }>();

  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  // ── Parsed params ───────────────────────────────────────────────
  const ussdCode            = params.ussdCode ?? '';
  const expiresAt           = params.expiresAt ?? '';
  const fee                 = parseFloat(params.fee    ?? '0') || 0;
  const paymentIntentId     = params.paymentIntentId     ?? undefined;
  const paymentType         = params.paymentType         ?? undefined;
  const reference           = params.reference ?? paymentIntentId ?? params.topupId ?? '—';
  const topupId             = params.topupId             ?? undefined;
  const monimePaymentCodeId = params.monimePaymentCodeId ?? undefined;
  const groupId             = params.groupId             ?? undefined;

  // Which backend flow to verify against. Defaults to vault top-up so existing
  // callers that don't pass paymentType keep their exact behavior.
  const isPaymentCodeCheckout =
    paymentType === 'osusu_contribution' ||
    paymentType === 'savings_deposit';
  const isOsusu = paymentType === 'osusu_contribution';
  const isSavingsDeposit = paymentType === 'savings_deposit';

  const [sendIntent, setSendIntent] = useState<SendPaymentIntentPreview | null>(null);

  useEffect(() => {
    if (!isPaymentCodeCheckout || !paymentIntentId) {
      setSendIntent(null);
      return;
    }

    let mounted = true;
    const loadIntent = async () => {
      try {
        const { intent } = await fetchSendPaymentIntent(paymentIntentId);
        if (mounted) setSendIntent(intent);
      } catch {
        if (mounted) setSendIntent(null);
      }
    };

    void loadIntent();
    return () => { mounted = false; };
  }, [isPaymentCodeCheckout, paymentIntentId]);

  const amount              = (sendIntent?.amount ?? parseFloat(params.amount ?? '0')) || 0;
  const totalAmount         = amount + fee;
  const provider            = sendIntent ? PAYMENT_METHOD_LABELS[sendIntent.method] : params.provider ?? 'Orange Money';
  const providerColor       = resolveProviderColor(provider);

  // ── UI state ────────────────────────────────────────────────────
  const [screenStatus, setScreenStatus]   = useState<ScreenStatus>('active');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [codeCopied, setCodeCopied]       = useState(false);
  const [completedAt, setCompletedAt]     = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);

  const screenStatusRef = useRef<ScreenStatus>('active');
  screenStatusRef.current = screenStatus;

  const pollCountRef = useRef(0);

  // ── Countdown ───────────────────────────────────────────────────
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!expiresAt) return 600;
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (screenStatus === 'active' || screenStatus === 'dialing') {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            stopTimer();
            setScreenStatus('expired');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      stopTimer();
    }
    return stopTimer;
  }, [screenStatus, stopTimer]);

  // ── Animations ──────────────────────────────────────────────────
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.97)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Screen entrance
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, bounciness: 4, speed: 14 }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // USSD card breath pulse
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.012, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.000, duration: 1600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Status transition fade
  const statusFade = useRef(new Animated.Value(1)).current;
  const transitionStatus = useCallback((next: ScreenStatus) => {
    Animated.timing(statusFade, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      setScreenStatus(next);
      Animated.timing(statusFade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    });
  }, [statusFade]);

  // ── AppState: return from dialer ────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && screenStatusRef.current === 'dialing') {
        transitionStatus('verifying');
        pollCountRef.current = 0;
        void startPolling();
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Backend verification (dispatched by payment type) ───────────
  // This NEVER self-confirms a payment. It only relays the backend's
  // effective status. Final completion is set by the Monime webhook
  // (vault-webhook / mobile-money-webhook) via SECURITY DEFINER RPCs.
  const runVerification = useCallback(async (): Promise<PollOutcome> => {
    if (isPaymentCodeCheckout) {
      // Osusu contribution → verify-payment Edge Function
      if (!monimePaymentCodeId) {
        return { effective: 'not_found', completedAt: null, error: new Error('Missing payment code.') };
      }
      const r = await verifyMonimeCheckout(monimePaymentCodeId);
      return { effective: r.effectiveStatus, completedAt: null, error: r.error };
    }

    // Vault top-up → verify-vault-topup-status (unchanged behavior)
    if (!topupId && !monimePaymentCodeId) {
      return { effective: 'not_found', completedAt: null, error: new Error('Missing payment reference.') };
    }
    const r = await verifyVaultTopupStatus({ topupId, monimePaymentCodeId });
    return { effective: r.effectiveStatus, completedAt: r.completedAt, error: r.error };
  }, [isPaymentCodeCheckout, topupId, monimePaymentCodeId]);

  // ── Status polling ──────────────────────────────────────────────
  const pollStatus = useCallback(async (): Promise<void> => {
    const outcome = await runVerification();
    pollCountRef.current += 1;

    // Missing / unknown payment code — cannot recover by polling.
    if (outcome.effective === 'not_found') {
      setFailureReason(outcome.error?.message ?? 'We could not find this payment. Please start again.');
      transitionStatus('invalid');
      return;
    }

    // Network / backend error — retriable. Never treated as success or failure.
    if (outcome.error) {
      setFailureReason(outcome.error.message);
      transitionStatus('error');
      return;
    }

    if (outcome.effective === 'completed') {
      setCompletedAt(outcome.completedAt);
      transitionStatus('successful');
    } else if (outcome.effective === 'failed') {
      setFailureReason('Payment could not be processed. Please try again.');
      transitionStatus('failed');
    } else if (outcome.effective === 'cancelled') {
      transitionStatus('cancelled');
    } else if (outcome.effective === 'expired') {
      transitionStatus('expired');
    } else if (outcome.effective === 'processing') {
      if (screenStatusRef.current !== 'processing') transitionStatus('processing');
      if (pollCountRef.current < 20) {
        setTimeout(() => void pollStatus(), 4000);
      }
    } else {
      // Still pending
      if (
        (screenStatusRef.current === 'verifying' || screenStatusRef.current === 'processing') &&
        pollCountRef.current < 12
      ) {
        setTimeout(() => void pollStatus(), 5000);
      } else {
        // Exhausted auto-polling — let user retry manually
        transitionStatus('active');
      }
    }
  }, [runVerification, transitionStatus]);

  const startPolling = useCallback(() => void pollStatus(), [pollStatus]);

  // ── Copy code ───────────────────────────────────────────────────
  const handleCopy = () => {
    if (!ussdCode) return;
    Clipboard.setString(ussdCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2400);
  };

  // ── Launch dialer ───────────────────────────────────────────────
  const handleDial = async () => {
    if (!ussdCode || screenStatus === 'expired') return;

    // Encode # as %23 for tel: URI
    const telUri = `tel:${ussdCode.replace(/#/g, '%23')}`;

    let canOpen = false;
    try { canOpen = await Linking.canOpenURL(telUri); } catch { /* ignore */ }

    if (!canOpen) {
      Alert.alert(
        'Dialer Not Available',
        `Please dial this code manually on your ${provider} SIM:\n\n${ussdCode}`,
        [{ text: 'OK' }]
      );
      setConfirmVisible(false);
      return;
    }

    setConfirmVisible(false);
    setScreenStatus('dialing');

    try {
      await Linking.openURL(telUri);
    } catch {
      Alert.alert('Could Not Open Dialer', `Please dial manually: ${ussdCode}`);
      setScreenStatus('active');
    }
  };

  // ── Back navigation guard ───────────────────────────────────────
  const handleBack = () => {
    if (screenStatus === 'verifying' || screenStatus === 'processing') {
      Alert.alert(
        'Payment In Progress',
        'Your payment is being verified. Are you sure you want to leave?',
        [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => router.back() },
        ]
      );
      return;
    }
    router.back();
  };

  // ── Post-success navigation ─────────────────────────────────────
  // Osusu contributions return to the group; vault top-ups return to the vault.
  const handleDone = useCallback(() => {
    if (isOsusu) {
      if (groupId) {
        router.replace({ pathname: '/(groups)/[id]', params: { id: groupId } });
      } else {
        router.replace('/(main)/groups');
      }
      return;
    }
    if (isSavingsDeposit) {
      router.replace('/(main)/home');
      return;
    }
    router.replace('/(main)/vault');
  }, [isOsusu, isSavingsDeposit, groupId, router]);

  // ── Manual retry (network/backend error) ────────────────────────
  const handleRetryVerification = useCallback(() => {
    pollCountRef.current = 0;
    transitionStatus('verifying');
    void startPolling();
  }, [transitionStatus, startPolling]);

  // ── Countdown formatting ────────────────────────────────────────
  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isWarning  = secondsLeft > 0 && secondsLeft < 120;
  const isTerminal = TERMINAL.includes(screenStatus);
  const showCode   = (screenStatus === 'active' || screenStatus === 'dialing') && !!ussdCode;
  const showTimer  = screenStatus === 'active' || screenStatus === 'dialing';
  const showSummary = !isTerminal;

  // ── Render ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: C.iconBg }]}
          onPress={handleBack}
          activeOpacity={0.75}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={20} color={C.text} strokeWidth={2.2} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: C.text }]} numberOfLines={1}>
            Complete Payment
          </Text>
          <Text style={[styles.headerSub, { color: C.textSub }]} numberOfLines={1}>
            Use your mobile money account
          </Text>
        </View>

        <View style={styles.secureChip}>
          <Shield size={13} color="#10B981" strokeWidth={2.2} />
          <Text style={styles.secureChipText}>Secure</Text>
        </View>
      </View>

      {/* ── BODY ───────────────────────────────────────────────── */}
      <Animated.View style={[styles.bodyWrap, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── STATUS CARD (terminal / verifying / processing) ── */}
          <Animated.View style={{ opacity: statusFade }}>
            {screenStatus === 'verifying' || screenStatus === 'processing' ? (
              <View style={[styles.statusCard, styles.statusCardPending]}>
                <View style={styles.statusCardIconWrap}>
                  <ActivityIndicator color="#F97316" size="large" />
                </View>
                <Text style={[styles.statusCardTitle, { color: '#92400E' }]}>
                  {screenStatus === 'verifying'
                    ? 'Waiting for Payment Confirmation'
                    : 'Provider Has Received Your Payment'}
                </Text>
                <Text style={styles.statusCardMsg}>
                  {screenStatus === 'verifying'
                    ? 'We are verifying your payment with Monime. This may take a moment.'
                    : 'Your payment is being processed. Please keep this screen open.'}
                </Text>
              </View>
            ) : screenStatus === 'successful' ? (
              <View style={[styles.statusCard, styles.statusCardSuccess]}>
                <View style={styles.statusCardIconWrap}>
                  <CheckCircle size={44} color="#10B981" />
                </View>
                <Text style={[styles.statusCardTitle, { color: '#065F46' }]}>Payment Successful</Text>
                <View style={[styles.detailGrid, { borderColor: '#A7F3D0' }]}>
                  <DetailRow label="Amount"    value={`NLe ${amount.toFixed(2)}`} />
                  <DetailRow label="Reference" value={reference} mono />
                  <DetailRow label="Provider"  value={provider} />
                  <DetailRow
                    label="Date"
                    value={
                      completedAt
                        ? new Date(completedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                        : new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                    }
                  />
                </View>
              </View>
            ) : screenStatus === 'failed' ? (
              <View style={[styles.statusCard, styles.statusCardFailed]}>
                <View style={styles.statusCardIconWrap}>
                  <XCircle size={44} color="#EF4444" />
                </View>
                <Text style={[styles.statusCardTitle, { color: '#991B1B' }]}>Payment Failed</Text>
                <Text style={styles.statusCardMsg}>
                  {failureReason ?? 'An error occurred. Please try again.'}
                </Text>
              </View>
            ) : screenStatus === 'cancelled' ? (
              <View style={[styles.statusCard, { backgroundColor: C.bgSoft, borderColor: C.borderStrong }]}>
                <View style={styles.statusCardIconWrap}>
                  <XCircle size={44} color={C.textMuted} />
                </View>
                <Text style={[styles.statusCardTitle, { color: C.textSub }]}>Payment Cancelled</Text>
                <Text style={[styles.statusCardMsg, { color: C.textMuted }]}>
                  The payment was cancelled. You can go back and try again.
                </Text>
              </View>
            ) : screenStatus === 'expired' ? (
              <View style={[styles.statusCard, styles.statusCardExpired]}>
                <View style={styles.statusCardIconWrap}>
                  <Clock size={44} color="#F97316" />
                </View>
                <Text style={[styles.statusCardTitle, { color: '#92400E' }]}>Payment Session Expired</Text>
                <Text style={styles.statusCardMsg}>
                  Your payment code has expired. Go back to generate a new one and try again.
                </Text>
              </View>
            ) : screenStatus === 'invalid' ? (
              <View style={[styles.statusCard, styles.statusCardFailed]}>
                <View style={styles.statusCardIconWrap}>
                  <XCircle size={44} color="#EF4444" />
                </View>
                <Text style={[styles.statusCardTitle, { color: '#991B1B' }]}>Payment Not Found</Text>
                <Text style={styles.statusCardMsg}>
                  {failureReason ?? 'We could not find this payment. Please go back and start again.'}
                </Text>
              </View>
            ) : screenStatus === 'error' ? (
              <View style={[styles.statusCard, styles.statusCardPending]}>
                <View style={styles.statusCardIconWrap}>
                  <RefreshCw size={44} color="#F97316" />
                </View>
                <Text style={[styles.statusCardTitle, { color: '#92400E' }]}>Connection Problem</Text>
                <Text style={styles.statusCardMsg}>
                  {failureReason ?? 'We could not reach the server to check your payment.'}{'\n'}
                  Your payment is not lost — tap “Check Again” once you’re back online.
                </Text>
              </View>
            ) : null}
          </Animated.View>

          {/* ── PAYMENT SUMMARY CARD ─────────────────────────── */}
          {showSummary && (
            <View style={[styles.summaryCard, { backgroundColor: C.card, borderColor: C.borderStrong }]}>
              {/* Provider badge row */}
              <View style={styles.summaryTop}>
                <View style={[styles.providerPill, { backgroundColor: providerColor + '18', borderColor: providerColor + '40' }]}>
                  <View style={[styles.providerDot, { backgroundColor: providerColor }]} />
                  <Text style={[styles.providerName, { color: providerColor }]}>{provider}</Text>
                </View>
                <View style={[styles.paymentTypeBadge, { backgroundColor: C.iconBg }]}>
                  <Wallet size={12} color={C.textMuted} strokeWidth={2} />
                  <Text style={[styles.paymentTypeText, { color: C.textMuted }]}>
                    {paymentType === 'osusu_contribution' ? 'Osusu'
                      : paymentType === 'savings_deposit'  ? 'Savings'
                      : 'Vault Top-Up'}
                  </Text>
                </View>
              </View>

              {/* Rows */}
              <View style={styles.summaryRows}>
                <SummaryRow label="Amount" value={`NLe ${amount.toFixed(2)}`} C={C} />
                <View style={[styles.summaryDivider, { backgroundColor: C.border }]} />
                <SummaryRow
                  label="Fee"
                  value={fee > 0 ? `NLe ${fee.toFixed(2)}` : 'Free'}
                  C={C}
                  dim
                />
                <SummaryRow
                  label="Total"
                  value={`NLe ${totalAmount.toFixed(2)}`}
                  C={C}
                  accent
                />
                <View style={[styles.summaryDivider, { backgroundColor: C.border }]} />
                <SummaryRow
                  label="Reference"
                  value={reference.length > 22 ? `${reference.slice(0, 20)}…` : reference}
                  C={C}
                  mono
                />
              </View>
            </View>
          )}

          {/* ── USSD CODE CARD ───────────────────────────────── */}
          {showCode && (
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <View style={[styles.ussdCard, isDark && styles.ussdCardDark]}>
                {/* Decorative rings */}
                <View style={styles.ussdRingOuter} pointerEvents="none" />
                <View style={styles.ussdRingInner} pointerEvents="none" />

                {/* Live indicator */}
                <View style={styles.ussdTopRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.ussdTopLabel}>OFFICIAL MONIME PAYMENT CODE</Text>
                </View>

                {/* The actual USSD code — large monospace */}
                <Text
                  style={styles.ussdCode}
                  selectable
                  accessibilityLabel={`Payment code: ${ussdCode}`}
                  accessibilityHint="Dial this code to complete payment"
                >
                  {ussdCode}
                </Text>

                {/* Copy button */}
                <TouchableOpacity
                  style={[styles.copyBtn, codeCopied && styles.copyBtnSuccess]}
                  onPress={handleCopy}
                  activeOpacity={0.8}
                  accessibilityLabel={codeCopied ? 'Code copied' : 'Copy payment code'}
                  accessibilityRole="button"
                >
                  {codeCopied
                    ? <CheckCircle size={15} color="#10B981" strokeWidth={2.5} />
                    : <Copy size={15} color="#F97316" strokeWidth={2} />}
                  <Text style={[styles.copyBtnText, codeCopied && styles.copyBtnTextSuccess]}>
                    {codeCopied ? 'Payment code copied' : 'Copy code'}
                  </Text>
                </TouchableOpacity>

                {/* Instruction */}
                <Text style={styles.ussdHint}>
                  Dial on your {provider} SIM to authorise this payment
                </Text>
              </View>
            </Animated.View>
          )}

          {/* ── COUNTDOWN TIMER ──────────────────────────────── */}
          {showTimer && (
            <View
              style={[
                styles.timerRow,
                {
                  backgroundColor: isWarning ? '#FFF7ED' : C.card,
                  borderColor:     isWarning ? '#FED7AA' : C.border,
                },
              ]}
              accessibilityLabel={`Payment code expires in ${formatTime(secondsLeft)}`}
            >
              <Clock size={16} color={isWarning ? '#F97316' : C.textMuted} strokeWidth={2} />
              <Text style={[styles.timerLabel, { color: isWarning ? '#92400E' : C.textSub }]}>
                Payment code expires in
              </Text>
              <Text style={[styles.timerValue, { color: isWarning ? '#EF4444' : C.text }]}>
                {formatTime(secondsLeft)}
              </Text>
            </View>
          )}

          {/* ── TRUST STRIP ──────────────────────────────────── */}
          {screenStatus === 'active' && (
            <View style={[styles.trustStrip, { backgroundColor: C.bgSoft, borderColor: C.border }]}>
              <Shield size={13} color="#10B981" strokeWidth={2} />
              <Text style={[styles.trustText, { color: C.textSub }]}>
                Payment verified automatically by Monime · End-to-end encrypted
              </Text>
            </View>
          )}

          {/* ── DIALING HINT ─────────────────────────────────── */}
          {screenStatus === 'dialing' && (
            <View style={[styles.trustStrip, { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }]}>
              <Phone size={13} color="#F97316" strokeWidth={2} />
              <Text style={[styles.trustText, { color: '#92400E' }]}>
                Complete the payment on your phone, then return to Mi Osusu
              </Text>
            </View>
          )}

          {/* ── SPACER ───────────────────────────────────────── */}
          <View style={{ height: 24 }} />

        </ScrollView>
      </Animated.View>

      {/* ── BOTTOM ACTION BAR ──────────────────────────────────────── */}
      <View style={[styles.actionBar, { backgroundColor: C.bg, borderTopColor: C.border }]}>

        {/* Active: Pay Now */}
        {screenStatus === 'active' && (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, secondsLeft === 0 && styles.primaryBtnDisabled]}
              onPress={() => secondsLeft > 0 && setConfirmVisible(true)}
              activeOpacity={0.88}
              disabled={secondsLeft === 0}
              accessibilityLabel="Pay now"
              accessibilityRole="button"
            >
              <Phone size={20} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.primaryBtnText}>Pay Now</Text>
            </TouchableOpacity>

            {(topupId || monimePaymentCodeId) && (
              <TouchableOpacity
                style={[styles.ghostBtn, { borderColor: C.border }]}
                onPress={() => {
                  pollCountRef.current = 0;
                  transitionStatus('verifying');
                  void startPolling();
                }}
                activeOpacity={0.8}
                accessibilityLabel="Check if payment already went through"
              >
                <RefreshCw size={15} color={C.textSub} strokeWidth={2} />
                <Text style={[styles.ghostBtnText, { color: C.textSub }]}>
                  Already paid? Check status
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Dialing: hint only, no CTA */}
        {screenStatus === 'dialing' && (
          <View style={styles.dialingHint}>
            <ActivityIndicator color="#F97316" size="small" />
            <Text style={[styles.dialingHintText, { color: C.textSub }]}>
              Waiting for you to return from the dialer…
            </Text>
          </View>
        )}

        {/* Verifying / Processing: check status */}
        {(screenStatus === 'verifying' || screenStatus === 'processing') && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => void pollStatus()}
            activeOpacity={0.88}
          >
            <RefreshCw size={18} color="#FFFFFF" strokeWidth={2.2} />
            <Text style={styles.primaryBtnText}>Check Payment Status</Text>
          </TouchableOpacity>
        )}

        {/* Expired: generate new code */}
        {screenStatus === 'expired' && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.back()}
            activeOpacity={0.88}
          >
            <RefreshCw size={18} color="#FFFFFF" strokeWidth={2.2} />
            <Text style={styles.primaryBtnText}>Generate New Code</Text>
          </TouchableOpacity>
        )}

        {/* Failed: retry + close */}
        {screenStatus === 'failed' && (
          <View style={styles.dualRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: C.borderStrong }]}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <Text style={[styles.outlineBtnText, { color: C.text }]}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }]}
              onPress={() => router.back()}
              activeOpacity={0.88}
            >
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Successful: done + receipt */}
        {screenStatus === 'successful' && (
          <View style={styles.dualRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: C.borderStrong }]}
              onPress={() => router.push('/components/receipts')}
              activeOpacity={0.8}
            >
              <Text style={[styles.outlineBtnText, { color: C.text }]}>View Receipt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.successBtn, { flex: 1 }]}
              onPress={handleDone}
              activeOpacity={0.88}
            >
              <CheckCircle size={18} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Invalid: cannot poll — start again */}
        {screenStatus === 'invalid' && (
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 1 }]}
            onPress={() => router.back()}
            activeOpacity={0.88}
            accessibilityLabel="Go back and start again"
          >
            <ArrowLeft size={18} color="#FFFFFF" strokeWidth={2.2} />
            <Text style={styles.primaryBtnText}>Go Back &amp; Start Again</Text>
          </TouchableOpacity>
        )}

        {/* Error: retriable network/backend problem */}
        {screenStatus === 'error' && (
          <View style={styles.dualRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: C.borderStrong }]}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <Text style={[styles.outlineBtnText, { color: C.text }]}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }]}
              onPress={handleRetryVerification}
              activeOpacity={0.88}
            >
              <RefreshCw size={18} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.primaryBtnText}>Check Again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Cancelled: close */}
        {screenStatus === 'cancelled' && (
          <TouchableOpacity
            style={[styles.outlineBtn, { borderColor: C.borderStrong, flex: 1 }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={[styles.outlineBtnText, { color: C.text }]}>Close</Text>
          </TouchableOpacity>
        )}

      </View>

      {/* ══════════════════════════════════════════════════════════
          CONFIRMATION MODAL
      ══════════════════════════════════════════════════════════ */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalCard, { backgroundColor: C.card }]}>

            {/* Icon */}
            <View style={styles.modalIconCircle}>
              <Phone size={30} color="#F97316" strokeWidth={2} />
            </View>

            {/* Title */}
            <Text style={[styles.modalTitle, { color: C.text }]}>
              Complete Mobile Money Payment
            </Text>
            <Text style={[styles.modalSubtitle, { color: C.textSub }]}>
              You are about to dial the official payment code generated by Monime.
            </Text>

            {/* Steps */}
            <View style={[styles.stepsCard, { backgroundColor: C.bgSoft, borderColor: C.border }]}>
              {[
                'Confirm the payment on your phone',
                'Enter your mobile money PIN',
                'Complete the transaction',
              ].map((step, i) => (
                <View key={i} style={[styles.stepRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepText, { color: C.text }]}>{step}</Text>
                </View>
              ))}
            </View>

            {/* Auto-verify note */}
            <View style={[styles.autoVerifyNote, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
              <Shield size={13} color="#10B981" strokeWidth={2} />
              <Text style={styles.autoVerifyText}>
                Mi Osusu will automatically verify the payment once confirmed.
              </Text>
            </View>

            {/* Buttons */}
            <TouchableOpacity
              style={styles.modalContinueBtn}
              onPress={() => void handleDial()}
              activeOpacity={0.88}
              accessibilityLabel="Continue to dialer"
              accessibilityRole="button"
            >
              <Phone size={18} color="#FFFFFF" strokeWidth={2} />
              <Text style={styles.modalContinueBtnText}>Continue</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalCancelBtn, { backgroundColor: C.iconBg }]}
              onPress={() => setConfirmVisible(false)}
              activeOpacity={0.8}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Text style={[styles.modalCancelBtnText, { color: C.textSub }]}>Cancel</Text>
            </TouchableOpacity>

          </Animated.View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function SummaryRow({
  label,
  value,
  C,
  accent,
  dim,
  mono,
}: {
  label:  string;
  value:  string;
  C:      AppColors;
  accent?: boolean;
  dim?:    boolean;
  mono?:   boolean;
}) {
  return (
    <View style={styles.summaryRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.summaryLabel, { color: dim ? C.textMuted : C.textSub }]}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          { color: accent ? '#F97316' : C.text },
          accent && styles.summaryValueAccent,
          dim   && styles.summaryValueDim,
          mono  && { fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 12 },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          mono && { fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 11 },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  /* ── Root ─────────────────────────────────────────────────────── */
  root: { flex: 1 },

  /* ── Header ───────────────────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle:  { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22 },
  headerSub:    { fontSize: 12, fontWeight: '500', marginTop: 1, lineHeight: 16 },
  secureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#ECFDF5', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  secureChipText: { fontSize: 11, fontWeight: '700', color: '#10B981' },

  /* ── Body ─────────────────────────────────────────────────────── */
  bodyWrap: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },

  /* ── Status cards ─────────────────────────────────────────────── */
  statusCard: {
    borderRadius: 20, borderWidth: 1.5,
    padding: 24, marginBottom: 16, alignItems: 'center',
  },
  statusCardSuccess: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  statusCardFailed:  { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  statusCardPending: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  statusCardExpired: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  statusCardIconWrap: { marginBottom: 14 },
  statusCardTitle: {
    fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 8, letterSpacing: -0.3,
  },
  statusCardMsg: {
    fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21,
  },
  detailGrid: {
    alignSelf: 'stretch', marginTop: 14, borderRadius: 12,
    borderWidth: 1, overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#D1FAE5',
  },
  detailLabel: { fontSize: 13, color: '#6B7280', fontWeight: '500', flex: 1 },
  detailValue: { fontSize: 13, color: '#065F46', fontWeight: '700', flex: 2, textAlign: 'right' },

  /* ── Summary card ─────────────────────────────────────────────── */
  summaryCard: {
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
    marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  summaryTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  providerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  providerDot:  { width: 8, height: 8, borderRadius: 4 },
  providerName: { fontSize: 13, fontWeight: '700' },
  paymentTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  paymentTypeText: { fontSize: 11, fontWeight: '600' },
  summaryRows: { gap: 0 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 9,
  },
  summaryLabel: { fontSize: 14, fontWeight: '500' },
  summaryValue: { fontSize: 15, fontWeight: '700' },
  summaryValueAccent: { fontSize: 17, fontWeight: '800', color: '#F97316' },
  summaryValueDim:    { fontSize: 13, fontWeight: '600' },
  summaryDivider: { height: 1, marginVertical: 2 },

  /* ── USSD card ────────────────────────────────────────────────── */
  ussdCard: {
    borderRadius: 22,
    backgroundColor: '#1E2B5A',
    paddingHorizontal: 24,
    paddingVertical: 28,
    marginBottom: 12,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 12,
  },
  ussdCardDark: { backgroundColor: '#0A1628' },
  ussdRingOuter: {
    position: 'absolute',
    top: -80, right: -80,
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  ussdRingInner: {
    position: 'absolute',
    top: -30, right: -30,
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  ussdTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20,
  },
  liveDot: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#10B981',
  },
  ussdTopLabel: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  ussdCode: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 2.5,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    marginBottom: 26,
    lineHeight: 38,
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: 'rgba(249,115,22,0.7)',
    borderRadius: 11, paddingVertical: 10, paddingHorizontal: 20,
    marginBottom: 18,
    backgroundColor: 'rgba(249,115,22,0.1)',
  },
  copyBtnSuccess: {
    borderColor: 'rgba(16,185,129,0.7)',
    backgroundColor: 'rgba(16,185,129,0.1)',
  },
  copyBtnText:        { fontSize: 13, fontWeight: '700', color: '#F97316' },
  copyBtnTextSuccess: { color: '#10B981' },
  ussdHint: {
    fontSize: 12, color: 'rgba(255,255,255,0.42)',
    textAlign: 'center', lineHeight: 18,
  },

  /* ── Timer row ────────────────────────────────────────────────── */
  timerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 14, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 16,
    marginBottom: 12,
  },
  timerLabel: { fontSize: 13, fontWeight: '500', flex: 1 },
  timerValue: {
    fontSize: 18, fontWeight: '800', letterSpacing: -0.5,
    fontVariant: ['tabular-nums' as const],
  },

  /* ── Trust strip ──────────────────────────────────────────────── */
  trustStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 4,
  },
  trustText: { fontSize: 12, fontWeight: '500', flex: 1, lineHeight: 17 },

  /* ── Action bar ───────────────────────────────────────────────── */
  actionBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F97316', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32, shadowRadius: 14, elevation: 8,
  },
  primaryBtnDisabled: { opacity: 0.38 },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },
  successBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#10B981', borderRadius: 16, paddingVertical: 17,
    shadowColor: '#10B981', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
  },
  dualRow: { flexDirection: 'row', gap: 12 },
  outlineBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderRadius: 16, paddingVertical: 17,
  },
  outlineBtnText: { fontSize: 15, fontWeight: '700' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: 13, paddingVertical: 12,
  },
  ghostBtnText: { fontSize: 13, fontWeight: '600' },
  dialingHint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    paddingVertical: 14,
  },
  dialingHintText: { fontSize: 14, fontWeight: '500' },

  /* ── Confirmation modal ───────────────────────────────────────── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 26, paddingHorizontal: 24, paddingVertical: 28,
    width: '100%', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.22, shadowRadius: 48, elevation: 24,
  },
  modalIconCircle: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: '#FED7AA',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  modalTitle: {
    fontSize: 20, fontWeight: '800', textAlign: 'center',
    letterSpacing: -0.4, marginBottom: 10, lineHeight: 26,
  },
  modalSubtitle: {
    fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 20,
  },
  stepsCard: {
    alignSelf: 'stretch', borderRadius: 16, borderWidth: 1,
    overflow: 'hidden', marginBottom: 14,
  },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 13,
  },
  stepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  stepText:    { fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 20 },
  autoVerifyNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'stretch', borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  autoVerifyText: { fontSize: 12, fontWeight: '500', color: '#065F46', flex: 1, lineHeight: 17 },
  modalContinueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 16,
    width: '100%', marginBottom: 10,
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.32, shadowRadius: 12, elevation: 8,
  },
  modalContinueBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  modalCancelBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 14, alignItems: 'center',
  },
  modalCancelBtnText: { fontSize: 15, fontWeight: '600' },
});
