/**
 * Send flow - Step 3: server-authoritative review and confirmation.
 *
 * Summary data and receipts are fetched from Supabase Edge Functions by
 * paymentIntentId. Route params cannot set amount, account, destination, method,
 * status, reference, or receipt content.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CheckCircle, Edit3, Lock, Share2 } from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import {
  confirmSendPayment,
  fetchSendPaymentIntent,
  type SendPaymentIntentPreview,
  type SendReceipt,
} from '../../src/services/sendPaymentService';
import { generateIdempotencyKey } from '../../src/services/paymentService';
import { PAYMENT_METHOD_LABELS } from '../../src/services/paymentMethodLinks';
import { EnterTransactionPinModal } from '../../src/components/security/EnterTransactionPinModal';

function SRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const { preferences } = useAppDataStore();
  const C = preferences.darkMode ? darkColors : lightColors;
  return (
    <View style={[sRowStyles.row, { borderBottomColor: C.border }]}>
      <Text style={[sRowStyles.label, { color: C.textSub }]}>{label}</Text>
      <Text style={[sRowStyles.value, { color: C.text }, highlight && sRowStyles.valueHighlight]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const sRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1 },
  label: { fontSize: 16, fontWeight: '500', color: '#6B7280' },
  value: { fontSize: 18, fontWeight: '500', color: '#12121A', flexShrink: 1, textAlign: 'right', marginLeft: 16 },
  valueHighlight: { color: '#F97316', fontWeight: '600', fontSize: 18 },
});

function receiptToText(receipt: SendReceipt): string {
  return [
    'Mi Osusu Payment Receipt',
    `Receipt: ${receipt.receiptNumber}`,
    `Intent: ${receipt.paymentIntentId}`,
    receipt.transactionId ? `Transaction: ${receipt.transactionId}` : null,
    `Status: ${receipt.status}`,
    `Time: ${receipt.timestamp}`,
    `Amount: ${receipt.currency} ${receipt.amount.toFixed(2)}`,
    `Account: ${receipt.maskedAccount}`,
    receipt.providerReference ? `Provider ref: ${receipt.providerReference}` : null,
  ].filter(Boolean).join('\n');
}

export default function SendSummaryScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const { from, paymentIntentId } = useLocalSearchParams<{ from?: string; paymentIntentId?: string }>();

  const [intent, setIntent] = useState<SendPaymentIntentPreview | null>(null);
  const [receipt, setReceipt] = useState<SendReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const idempotencyKeyRef = useRef(generateIdempotencyKey());

  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!user?.id || !paymentIntentId) {
        setLoading(false);
        return;
      }
      const { intent: row, error } = await fetchSendPaymentIntent(paymentIntentId);
      if (!mounted) return;
      if (error || !row) {
        Alert.alert('Payment unavailable', error?.message ?? 'Please recreate the payment.');
      } else {
        setIntent(row);
      }
      setLoading(false);
    };
    void load();
    return () => { mounted = false; };
  }, [paymentIntentId, user?.id]);

  const playSuccess = () => {
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, bounciness: 10, speed: 8 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  };

  const requireBiometric = async (): Promise<boolean> => {
    const hasHW = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHW || !enrolled) {
      Alert.alert('Secure confirmation required', 'Set up biometric authentication before confirming payments.');
      return false;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm payment',
      cancelLabel: 'Cancel payment',
      disableDeviceFallback: true,
    });
    if (!result.success) {
      Alert.alert('Confirmation failed', 'Payment was not submitted.');
      return false;
    }
    return true;
  };

  const handleConfirm = async () => {
    if (!intent || !paymentIntentId || submitting) return;
    if (!user?.id) {
      Alert.alert('Not signed in', 'Please sign in and try again.');
      return;
    }

    setSubmitting(true);
    const biometricOk = await requireBiometric();
    setSubmitting(false);
    if (!biometricOk) return;
    setPinError(null);
    setPinModalVisible(true);
  };

  const handleConfirmWithPin = async (transactionPin: string) => {
    if (!intent || !paymentIntentId || submitting) return;
    setSubmitting(true);
    const { receipt: serverReceipt, status, paymentCode, error } = await confirmSendPayment({
      paymentIntentId,
      idempotencyKey: idempotencyKeyRef.current,
      localAuthMethod: 'biometric',
      transactionPin,
    });
    setSubmitting(false);

    if (error) {
      setPinError(error.message);
      return;
    }

    setPinModalVisible(false);
    if (!serverReceipt) {
      if (paymentCode?.ussdCode || paymentCode?.monimePaymentCodeId) {
        router.replace({
          pathname: '/(groups)/monime-payment',
          params: {
            monimePaymentCodeId: paymentCode.monimePaymentCodeId ?? paymentCode.providerReference ?? undefined,
            ussdCode: paymentCode.ussdCode ?? undefined,
            expiresAt: paymentCode.expiresAt ?? undefined,
            paymentIntentId,
            reference: paymentCode.providerReference ?? paymentCode.monimePaymentCodeId ?? paymentIntentId,
            paymentType: intent.targetType === 'savings' ? 'savings_deposit' : 'osusu_contribution',
            groupId: intent.targetType === 'group' ? intent.targetId : undefined,
          },
        });
        return;
      }
      Alert.alert('Payment pending', `Current status: ${status ?? 'pending'}. We will update it after provider confirmation.`);
      return;
    }

    setReceipt(serverReceipt);
    setConfirmed(true);
    playSuccess();
  };

  const handleShare = async () => {
    if (!receipt) return;
    try {
      await Share.share({ message: receiptToText(receipt), title: `Mi Osusu Receipt ${receipt.receiptNumber}` });
    } catch {
      Alert.alert('Share failed', 'Could not open the share sheet.');
    }
  };

  const handleDone = () => {
    router.replace(from === 'vault' ? '/(main)/vault' : '/(main)/home');
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: C.bgSoft }]} edges={['top', 'bottom']}>
        <ActivityIndicator color="#F97316" size="large" />
        <Text style={[styles.loadingText, { color: C.textSub }]}>Loading secure payment preview...</Text>
      </SafeAreaView>
    );
  }

  if (!intent) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: C.bgSoft }]} edges={['top', 'bottom']}>
        <Text style={[styles.emptyTitle, { color: C.text }]}>Payment unavailable</Text>
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(send)/select')}>
          <Text style={styles.doneBtnText}>Choose destination again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (confirmed && receipt) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
        <Animated.View style={[styles.successContainer, { opacity: successOpacity, transform: [{ scale: successScale }] }]}>
          <View style={styles.successIconRing}>
            <CheckCircle size={48} color="#10B981" strokeWidth={1.5} />
          </View>
          <Text style={[styles.successTitle, { color: C.text }]}>Payment Submitted</Text>
          <Text style={[styles.successSub, { color: C.textSub }]}>
            {receipt.currency} {receipt.amount.toFixed(2)} for{'\n'}
            <Text style={{ fontWeight: '800', color: C.text }}>{intent.targetName}</Text>
          </Text>
          <View style={styles.successMeta}>
            <Text style={styles.successMetaLabel}>Receipt</Text>
            <Text style={styles.successMetaValue}>{receipt.receiptNumber}</Text>
          </View>
          <View style={styles.successMeta}>
            <Text style={styles.successMetaLabel}>Status</Text>
            <Text style={[styles.successMetaValue, { color: receipt.status === 'completed' ? '#10B981' : '#F59E0B' }]}>
              {receipt.status}
            </Text>
          </View>
          <TouchableOpacity style={styles.shareBtn} onPress={() => void handleShare()}>
            <Share2 size={18} color="#FFFFFF" />
            <Text style={styles.shareBtnText}>Share Receipt</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgSoft }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]} onPress={() => router.back()}>
          <ArrowLeft size={28} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: C.text }]}>Review & Confirm</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>Server-verified payment details</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionLabel, { color: C.textMuted }]}>Transaction Summary</Text>
        <View style={[styles.summaryCard, { backgroundColor: C.card }]}>
          <SRow label="Sending to" value={intent.targetName} />
          <SRow label="Amount" value={`${intent.currency} ${intent.amount.toFixed(2)}`} highlight />
          <SRow label="Method" value={PAYMENT_METHOD_LABELS[intent.method]} />
          <SRow label="Account" value={intent.maskedAccount} />
          <SRow label="Type" value={intent.targetType === 'group' ? 'Osusu contribution' : 'Savings deposit'} />
          <SRow label="Status" value={intent.status} />
        </View>

        <TouchableOpacity style={styles.editRow} onPress={() => router.back()}>
          <Edit3 size={14} color={C.textSub} />
          <Text style={[styles.editRowText, { color: C.textSub }]}>Edit payment details</Text>
        </TouchableOpacity>

        <View style={[styles.confirmCard, { backgroundColor: C.card }]}>
          <View style={styles.lockRow}>
            <Lock size={16} color="#F97316" />
            <Text style={[styles.confirmTitle, { color: C.text }]}>Authorise Payment</Text>
          </View>
          <Text style={[styles.confirmSub, { color: C.textSub }]}>
            Confirm with biometrics. Backend authorization still verifies your session, ownership, intent status, amount, and payment method.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.confirmBtn, submitting && styles.confirmBtnDisabled]}
          disabled={submitting}
          onPress={() => void handleConfirm()}
        >
          <CheckCircle size={18} color="#FFFFFF" />
          <Text style={styles.confirmBtnText}>{submitting ? 'Submitting...' : 'Confirm Payment'}</Text>
        </TouchableOpacity>

        <Text style={[styles.secureNote, { color: C.textMuted }]}>
          Secured by encrypted connection and server verification.
        </Text>
      </ScrollView>
      <EnterTransactionPinModal
        visible={pinModalVisible}
        subtitle={`Enter your Transaction PIN to authorise NLe ${intent?.amount.toFixed(2) ?? '0.00'} for ${intent?.targetName ?? 'this payment'}.`}
        loading={submitting}
        error={pinError}
        onCancel={() => {
          setPinModalVisible(false);
          setPinError(null);
        }}
        onConfirm={handleConfirmWithPin}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { marginTop: 14, fontSize: 16, fontWeight: '500', color: '#9CA3AF' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#12121A', marginBottom: 20 },

  /* Header — 20dp title, 28dp back arrow, 24dp H padding */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
    gap: 12,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#12121A' },
  headerSub: { fontSize: 14, fontWeight: '500', color: '#9CA3AF', marginTop: 2 },

  /* Content — 24dp H padding, 32dp between sections */
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    shadowColor: '#12121A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 32,
    paddingVertical: 10,
  },
  editRowText: { fontSize: 16, fontWeight: '500', color: '#6B7280' },
  confirmCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  confirmTitle: { fontSize: 18, fontWeight: '600', color: '#12121A' },
  confirmSub: { fontSize: 14, fontWeight: '500', color: '#6B7280', lineHeight: 21 },

  /* Primary confirm button — 52dp, 14dp radius, 17dp semi-bold */
  confirmBtn: {
    backgroundColor: '#F97316',
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  confirmBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  confirmBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  secureNote: { fontSize: 13, fontWeight: '500', color: '#9CA3AF', textAlign: 'center' },

  /* Success state */
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  successIconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: { fontSize: 20, fontWeight: '700', color: '#12121A', marginBottom: 10, textAlign: 'center' },
  successSub: { fontSize: 16, fontWeight: '500', color: '#6B7280', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  successMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
  },
  successMetaLabel: { fontSize: 16, fontWeight: '500', color: '#9CA3AF' },
  successMetaValue: { fontSize: 16, fontWeight: '600', color: '#12121A' },

  /* Share button — 52dp, 14dp radius, 17dp semi-bold */
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#12121A',
    borderRadius: 14,
    height: 52,
    width: '100%',
    marginTop: 32,
  },
  shareBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },

  /* Done button — 52dp, 14dp radius, outline style */
  doneBtn: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#F0F2F5',
    marginTop: 12,
  },
  doneBtnText: { color: '#6B7280', fontSize: 17, fontWeight: '600' },
});
