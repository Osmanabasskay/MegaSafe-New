/**
 * Send flow — Step 2: Payment details.
 *   • Horizontal scrollable linked-account chips
 *   • Fixed amount for Osusu (group contribution); editable for savings
 *
 * Route params:
 *   type           'group' | 'savings'
 *   from           'home' | 'vault'
 *   targetId       string
 *   targetName     string
 *   prefillAmount  string  (group contribution amount; '0' for savings)
 */
import React, { useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Lock } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import {
  getFirstLinkedPaymentMethod,
  getPaymentMethodDetail,
  isPaymentMethodLinked,
  PAYMENT_METHOD_LABELS,
} from '../../src/services/paymentMethodLinks';
import type { SupportedPaymentMethod } from '../../src/services/paymentService';

const MOBILE_METHOD_LOGOS = {
  orange_money: { source: require('../../assets/payment-providers/orange-money.png'), title: 'Orange Money Logo' },
  afrimoney: { source: require('../../assets/payment-providers/afrimoney.png'), title: 'Afrimoney Logo' },
};

// qmoney intentionally excluded — not supported via Monime (see SupportedPaymentMethod)
const ALL_METHODS: Array<{ id: SupportedPaymentMethod; label: string; logo?: { source: number; title: string } }> = [
  { id: 'orange_money',  label: 'Orange Money', logo: MOBILE_METHOD_LOGOS.orange_money },
  { id: 'afrimoney',    label: 'AfriMoney', logo: MOBILE_METHOD_LOGOS.afrimoney },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'card',         label: 'Card'          },
];

export default function SendDetailScreen() {
  const router = useRouter();
  const { type, from, targetId, targetName, prefillAmount } =
    useLocalSearchParams<{
      type?: string;
      from?: string;
      targetId?: string;
      targetName?: string;
      prefillAmount?: string;
    }>();

  const { linkedMobileMoneyAccounts, linkedBankAccounts, preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const isGroup = type !== 'savings';
  const fixedAmt = Number(prefillAmount ?? '0');

  const [amount, setAmount] = useState(fixedAmt > 0 ? String(fixedAmt) : '');
  const [selectedMethod, setSelectedMethod] = useState<SupportedPaymentMethod>(() => {
    return (
      getFirstLinkedPaymentMethod({
        mobileMoneyAccounts: linkedMobileMoneyAccounts,
        bankAccounts: linkedBankAccounts,
      }) ?? 'orange_money'
    );
  });

  const methodLinked = isPaymentMethodLinked({
    method: selectedMethod,
    mobileMoneyAccounts: linkedMobileMoneyAccounts,
    bankAccounts: linkedBankAccounts,
  });

  const methodAccount = getPaymentMethodDetail({
    method: selectedMethod,
    mobileMoneyAccounts: linkedMobileMoneyAccounts,
    bankAccounts: linkedBankAccounts,
  });

  const parsedAmount = Number(amount);
  const canContinue =
    methodLinked &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  const goToSummary = () => {
    if (!canContinue) {
      if (!methodLinked) {
        Alert.alert('No payment method', 'Link a payment method in Settings first.');
        return;
      }
      Alert.alert('Invalid amount', 'Enter a valid amount greater than zero.');
      return;
    }
    router.push({
      pathname: '/(send)/summary',
      params: {
        type:       type   ?? 'group',
        from:       from   ?? 'home',
        targetId:   targetId   ?? '',
        targetName: targetName ?? '',
        amount:     String(parsedAmount),
        method:     selectedMethod,
        account:    methodAccount ?? '',
      },
    });
  };

  const hasAnyLinked =
    linkedMobileMoneyAccounts.length > 0 || linkedBankAccounts.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgSoft }]} edges={['top', 'bottom']}>
      {/* ── Header ──────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: C.text }]}>Payment Details</Text>
          <Text style={[styles.headerSub, { color: C.textMuted }]} numberOfLines={1}>{targetName}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Destination card ───────────────────────────── */}
        <View style={styles.destinationCard}>
          <Text style={styles.destinationMeta}>
            {isGroup ? 'Sending to Osusu Group' : 'Depositing to Savings Goal'}
          </Text>
          <Text style={styles.destinationName} numberOfLines={2}>{targetName}</Text>
        </View>

        {/* ── Pay with — horizontal scrollable chips ──── */}
        <Text style={[styles.sectionLabel, { color: C.text }]}>Pay With</Text>

        {!hasAnyLinked ? (
          <View style={[styles.noMethodBox, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
            <Lock size={20} color="#F97316" />
            <Text style={styles.noMethodText}>
              No payment method linked yet.{'\n'}Go to Settings → Payment Methods.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingBottom: 6, paddingRight: 16 }}
          >
            {ALL_METHODS.map((m) => {
              const linked = isPaymentMethodLinked({
                method: m.id,
                mobileMoneyAccounts: linkedMobileMoneyAccounts,
                bankAccounts: linkedBankAccounts,
              });
              const active = selectedMethod === m.id && linked;
              const detail = getPaymentMethodDetail({
                method: m.id,
                mobileMoneyAccounts: linkedMobileMoneyAccounts,
                bankAccounts: linkedBankAccounts,
              });
              return (
                <TouchableOpacity
                  key={m.id}
                  disabled={!linked}
                  onPress={() => setSelectedMethod(m.id)}
                  style={[
                    styles.methodChip,
                    active && styles.methodChipActive,
                    !linked && styles.methodChipDisabled,
                  ]}
                >
                  {m.logo ? (
                    <Image
                      source={m.logo.source}
                      style={styles.methodLogo}
                      resizeMode="contain"
                      accessibilityLabel={m.logo.title}
                    />
                  ) : null}
                  {!m.logo ? (
                    <Text
                      style={[
                        styles.methodLabel,
                        active && styles.methodLabelActive,
                        !linked && styles.methodLabelMuted,
                      ]}
                    >
                      {m.label}
                    </Text>
                  ) : null}
                  {linked ? (
                    <Text style={[styles.methodDetail, active && styles.methodDetailActive]}>
                      {detail}
                    </Text>
                  ) : (
                    <Text style={styles.notLinked}>Not linked</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* ── Amount ─────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { marginTop: 22, color: C.text }]}>Amount (NLe)</Text>

        {isGroup ? (
          /* Fixed — non-editable for group contributions */
          <View style={[styles.fixedAmountBox, { backgroundColor: C.card, borderColor: C.borderStrong }]}>
            <Text style={[styles.fixedAmountValue, { color: C.text }]}>NLe {fixedAmt.toFixed(2)}</Text>
            <Text style={[styles.fixedAmountNote, { color: C.textMuted }]}>
              This is your group's fixed contribution amount
            </Text>
          </View>
        ) : (
          <TextInput
            style={[styles.amountInput, { backgroundColor: C.inputBg, borderColor: C.borderStrong, color: C.text }]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={C.textMuted}
          />
        )}

        {/* ── Continue ───────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.continueBtn, !canContinue && styles.continueBtnDisabled]}
          disabled={!canContinue}
          onPress={goToSummary}
        >
          <Text style={styles.continueBtnText}>Review Summary →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelLink} onPress={() => router.back()}>
          <Text style={styles.cancelLinkText}>← Back</Text>
        </TouchableOpacity>
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
  headerSub: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },

  /* Content */
  content: { padding: 20, paddingBottom: 40 },

  /* Destination card */
  destinationCard: {
    backgroundColor: '#1E2B5A',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  destinationMeta: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  destinationName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },

  /* Section label */
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  /* No method box */
  noMethodBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  noMethodText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 20 },

  /* Method chips */
  methodChip: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FDBA74',
    paddingHorizontal: 12,
    paddingVertical: 12,
    minWidth: 150,
    minHeight: 78,
    alignItems: 'center',
  },
  methodChipActive:    { backgroundColor: '#F97316', borderColor: '#F97316' },
  methodChipDisabled:  { borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', opacity: 0.6 },
  methodLogo:          { width: 132, height: 52, marginBottom: 4 },
  methodLabel:         { fontSize: 13, fontWeight: '700', color: '#C2410C', textAlign: 'center' },
  methodLabelActive:   { color: '#FFFFFF' },
  methodLabelMuted:    { color: '#9CA3AF' },
  methodDetail:        { fontSize: 10, color: '#9A3412', fontWeight: '600', textAlign: 'center', marginTop: 3 },
  methodDetailActive:  { color: '#FFEDD5' },
  notLinked:           { fontSize: 10, color: '#9CA3AF', textAlign: 'center', marginTop: 3 },

  /* Fixed amount box */
  fixedAmountBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 18,
    alignItems: 'center',
    marginBottom: 24,
  },
  fixedAmountValue: { fontSize: 32, fontWeight: '800', color: '#1E2B5A' },
  fixedAmountNote: { fontSize: 12, color: '#9CA3AF', marginTop: 6 },

  /* Amount input */
  amountInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 24,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 24,
    textAlign: 'center',
  },

  /* Buttons */
  continueBtn: {
    backgroundColor: '#F97316',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  continueBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  continueBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  cancelLink: { alignItems: 'center', marginTop: 18 },
  cancelLinkText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
});
