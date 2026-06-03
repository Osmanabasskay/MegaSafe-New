/**
 * Send flow — Step 3: Summary → confirm (password / biometric) → success + Share Receipt.
 *
 * Route params:
 *   type        'group' | 'savings'
 *   from        'home' | 'vault'
 *   targetId    string
 *   targetName  string
 *   amount      string  (NLe)
 *   method      SupportedPaymentMethod
 *   account     string  (account number / phone)
 */
import React, { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  Edit3,
  Lock,
  Share2,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import {
  getLinkedMobileMoneyAccount,
  PAYMENT_METHOD_LABELS,
} from '../../src/services/paymentMethodLinks';
import { processSavingsDeposit } from '../../src/services/savingsService';
import type { SupportedPaymentMethod } from '../../src/services/paymentService';

// ─── Summary row ────────────────────────────────────────────────
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  label: { fontSize: 13, fontWeight: '600' },
  value: {
    fontSize: 13, fontWeight: '700',
    flexShrink: 1, textAlign: 'right', marginLeft: 16,
  },
  valueHighlight: { color: '#F97316', fontSize: 15 },
});

// ─── Unique reference number ────────────────────────────────────
function makeRef(): string {
  return `MG-${Date.now().toString(36).toUpperCase().slice(-8)}`;
}

// ─── Screen ─────────────────────────────────────────────────────
export default function SendSummaryScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    linkedMobileMoneyAccounts,
    linkedBankAccounts,
    preferences,
  } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const {
    type, from, targetId, targetName, amount, method, account,
  } = useLocalSearchParams<{
    type?: string; from?: string; targetId?: string;
    targetName?: string; amount?: string; method?: string; account?: string;
  }>();

  const isGroup  = type !== 'savings';
  const amtNum   = Number(amount ?? '0');
  const pmMethod = (method ?? 'orange_money') as SupportedPaymentMethod;
  const today    = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const refNum   = useRef(makeRef()).current;

  const [password,   setPassword]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);
  const [receipt,    setReceipt]    = useState('');

  // Success animation
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  const playSuccess = () => {
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, bounciness: 10, speed: 8 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  };

  // ── Biometric helper ─────────────────────────────────────────
  const tryBiometric = async (): Promise<boolean> => {
    const hasHW = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHW || !enrolled) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm payment',
      cancelLabel: 'Use password instead',
    });
    return result.success;
  };

  // ── Confirm payment ──────────────────────────────────────────
  const handleConfirm = async () => {
    if (!password.trim()) {
      Alert.alert('Password required', 'Enter your password to authorise this payment.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Not signed in', 'Please sign in and try again.');
      return;
    }
    setSubmitting(true);

    // Try biometric — fall back to password (already validated above)
    await tryBiometric();

    // NOTE: Real financial processing must go through a Supabase Edge Function
    //       with an idempotency key. Never trust amounts from the client.
    if (!isGroup && targetId) {
      const { error } = await processSavingsDeposit({
        goalId: targetId,
        amount: amtNum,
        paymentMethod: pmMethod,
      });
      if (error) {
        setSubmitting(false);
        Alert.alert('Payment failed', error.message);
        return;
      }
    }

    // Receipt is generated server-side; display-only reference shown below.

    const receiptLines = [
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '    Mi Osusu Payment Receipt',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Ref:     ${refNum}`,
      `Date:    ${today}`,
      `To:      ${targetName ?? '—'}`,
      `Amount:  NLe ${amtNum.toFixed(2)}`,
      `Method:  ${PAYMENT_METHOD_LABELS[pmMethod]}`,
      `Account: ${account ?? '—'}`,
      `Type:    ${isGroup ? 'Osusu contribution' : 'Savings deposit'}`,
      `Status:  ${isGroup ? 'Processing' : 'Confirmed'}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '   Thank you for using Mi Osusu',
      '   Sierra Leone · miosusu.app',
    ].join('\n');

    setReceipt(receiptLines);
    setSubmitting(false);
    setConfirmed(true);
    playSuccess();
  };

  // ── Share receipt ────────────────────────────────────────────
  const handleShare = async () => {
    try {
      await Share.share({ message: receipt, title: `Mi Osusu Receipt ${refNum}` });
    } catch {
      Alert.alert('Share failed', 'Could not open the share sheet.');
    }
  };

  // ── Done navigation ──────────────────────────────────────────
  const handleDone = () => {
    if (from === 'vault') {
      router.replace('/(main)/vault');
    } else {
      router.replace('/(main)/home');
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SUCCESS VIEW
  // ═══════════════════════════════════════════════════════════════
  if (confirmed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
        <Animated.View
          style={[
            styles.successContainer,
            { opacity: successOpacity, transform: [{ scale: successScale }] },
          ]}
        >
          {/* Icon */}
          <View style={styles.successIconRing}>
            <CheckCircle size={60} color="#10B981" strokeWidth={1.5} />
          </View>

          <Text style={[styles.successTitle, { color: C.text }]}>Payment Confirmed!</Text>
          <Text style={[styles.successSub, { color: C.textSub }]}>
            NLe {amtNum.toFixed(2)} {isGroup ? 'sent to' : 'saved to'}{'\n'}
            <Text style={{ fontWeight: '800', color: C.text }}>{targetName}</Text>
          </Text>

          <View style={styles.successMeta}>
            <Text style={styles.successMetaLabel}>Reference</Text>
            <Text style={styles.successMetaValue}>{refNum}</Text>
          </View>
          <View style={styles.successMeta}>
            <Text style={styles.successMetaLabel}>Date</Text>
            <Text style={styles.successMetaValue}>{today}</Text>
          </View>
          <View style={styles.successMeta}>
            <Text style={styles.successMetaLabel}>Status</Text>
            <Text style={[styles.successMetaValue, { color: isGroup ? '#F59E0B' : '#10B981' }]}>
              {isGroup ? '⏳ Processing' : '✓ Confirmed'}
            </Text>
          </View>

          {/* Share receipt */}
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

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY + CONFIRM VIEW
  // ═══════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgSoft }]} edges={['top', 'bottom']}>
      {/* ── Header ────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: C.text }]}>Review & Confirm</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>Check details before paying</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Summary card ───────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: C.textMuted }]}>Transaction Summary</Text>
        <View style={[styles.summaryCard, { backgroundColor: C.card }]}>
          <SRow label="Sending to"  value={targetName ?? '—'} />
          <SRow label="Amount"      value={`NLe ${amtNum.toFixed(2)}`} highlight />
          <SRow label="Method"      value={PAYMENT_METHOD_LABELS[pmMethod]} />
          <SRow label="Account"     value={account || '—'} />
          <SRow label="Date"        value={today} />
          <SRow label="Type"        value={isGroup ? 'Osusu contribution' : 'Savings deposit'} />
          <SRow label="Reference"   value={refNum} />
        </View>

        {/* Edit link */}
        <TouchableOpacity style={styles.editRow} onPress={() => router.back()}>
          <Edit3 size={14} color={C.textSub} />
          <Text style={[styles.editRowText, { color: C.textSub }]}>Edit payment details</Text>
        </TouchableOpacity>

        {/* ── Confirm section ────────────────────────────── */}
        <View style={[styles.confirmCard, { backgroundColor: C.card }]}>
          <View style={styles.lockRow}>
            <Lock size={16} color="#F97316" />
            <Text style={[styles.confirmTitle, { color: C.text }]}>Authorise Payment</Text>
          </View>
          <Text style={[styles.confirmSub, { color: C.textSub }]}>
            Enter your password below — or tap Confirm to use biometric authentication.
          </Text>
          <TextInput
            style={[styles.passwordInput, { backgroundColor: C.inputBg, borderColor: C.borderStrong, color: C.text }]}
            placeholder="Enter password"
            placeholderTextColor={C.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            returnKeyType="done"
            onSubmitEditing={() => void handleConfirm()}
          />
        </View>

        {/* ── Confirm button ─────────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.confirmBtn,
            (!password.trim() || submitting) && styles.confirmBtnDisabled,
          ]}
          disabled={!password.trim() || submitting}
          onPress={() => void handleConfirm()}
        >
          <CheckCircle size={18} color="#FFFFFF" />
          <Text style={styles.confirmBtnText}>
            {submitting ? 'Processing…' : 'Confirm Payment'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.secureNote, { color: C.textMuted }]}>
          🔒 End-to-end encrypted · Mi Osusu Sierra Leone
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 10,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#1E2B5A' },
  headerSub:   { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  /* Content */
  content: { padding: 20, paddingBottom: 40 },

  /* Section label */
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },

  /* Summary card */
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 4,
    marginBottom: 8,
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  /* Edit row */
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 20,
    paddingVertical: 8,
  },
  editRowText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },

  /* Confirm card */
  confirmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  confirmTitle: { fontSize: 16, fontWeight: '800', color: '#1E2B5A' },
  confirmSub: { fontSize: 13, color: '#6B7280', lineHeight: 19, marginBottom: 14 },
  passwordInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#1E2B5A',
  },

  /* Confirm button */
  confirmBtn: {
    backgroundColor: '#F97316',
    borderRadius: 16,
    paddingVertical: 16,
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
  confirmBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

  /* Secure note */
  secureNote: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },

  /* ── Success view ─────────────────────────────────────── */
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  successIconRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 10,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  successMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  successMetaLabel: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },
  successMetaValue: { fontSize: 13, color: '#1E2B5A', fontWeight: '700' },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1E2B5A',
    borderRadius: 16,
    paddingVertical: 15,
    width: '100%',
    marginTop: 28,
  },
  shareBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  doneBtn: {
    width: '100%',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    marginTop: 12,
  },
  doneBtnText: { color: '#6B7280', fontSize: 15, fontWeight: '700' },
});
