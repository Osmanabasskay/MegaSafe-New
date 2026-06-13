/**
 * Send flow - amount and payment method entry.
 *
 * Osusu and Savings continue through the server-created payment intent flow.
 * Vault deposits use the vault top-up Edge Function and then open the Monime
 * USSD payment screen returned by the backend.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Banknote,
  Check,
  Delete,
  Edit3,
  Lock,
  PiggyBank,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { getMyPaymentMethods, type LinkedPaymentMethod } from '../../src/services/paymentMethodService';
import {
  createSendPaymentIntent,
  type SendPaymentMethod,
} from '../../src/services/sendPaymentService';
import { initiateVaultTopup } from '../../src/services/vaultService';
import { fetchVaultTopupLimits, type VaultTopupLimits } from '../../src/services/platformSettingsService';
import {
  getMobileMoneyProvider,
  isMobileMoneyProvider,
  MOBILE_MONEY_PROVIDER_CONFIG,
} from '../../src/services/mobileMoneyConfig';
import { EnterTransactionPinModal } from '../../src/components/security/EnterTransactionPinModal';

type DestinationType = 'group' | 'savings' | 'vault';
const AMOUNT_VISUAL_LIMIT = 9;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const METHOD_LOGOS = {
  orange_money: { source: require('../../assets/payment-providers/orange-money.png'), title: 'Orange Money Logo' },
  afrimoney: { source: require('../../assets/payment-providers/afrimoney.png'), title: 'AfriMoney Logo' },
};

const METHODS: Array<{ id: SendPaymentMethod; label: string; logo: { source: number; title: string } }> = [
  ...MOBILE_MONEY_PROVIDER_CONFIG.map((provider) => ({
    id: provider.id,
    label: provider.label,
    logo: METHOD_LOGOS[provider.id],
  })),
];

function sanitizeAmount(value: string): string {
  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  const whole = parts[0]?.replace(/^0+(?=\d)/, '') ?? '';
  const cents = parts.slice(1).join('').slice(0, 2);
  const cleaned = normalized.startsWith('.')
    ? `0.${cents}`
    : parts.length > 1 ? `${whole || '0'}.${cents}` : whole;
  return cleaned.slice(0, AMOUNT_VISUAL_LIMIT);
}

function amountLabel(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '0.00';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function firstRouteParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const cleaned = typeof raw === 'string' ? raw.trim() : '';
  if (!cleaned || cleaned === 'undefined' || cleaned === 'null') return undefined;
  return cleaned;
}

function routeDestinationType(value: string | undefined): DestinationType {
  if (value === 'vault') return 'vault';
  if (value === 'savings') return 'savings';
  return 'group';
}

function destinationCopy(type: DestinationType) {
  if (type === 'vault') {
    return {
      title: 'Add Money',
      meta: 'Sending to Vault',
      fallbackName: 'Mi Osusu Vault',
      helper: 'Add funds to your secure wallet balance.',
      icon: Wallet,
      color: '#1E2B5A',
      soft: '#EEF2FF',
    };
  }
  if (type === 'savings') {
    return {
      title: 'Add Money',
      meta: 'Sending to Savings',
      fallbackName: 'Selected savings goal',
      helper: 'Deposit into one of your savings goals.',
      icon: PiggyBank,
      color: '#10B981',
      soft: '#ECFDF5',
    };
  }
  return {
    title: 'Add Money',
    meta: 'Sending to Osusu Group',
    fallbackName: 'Selected Osusu group',
    helper: 'Contribute to your selected savings circle.',
    icon: Users,
    color: '#F97316',
    soft: '#FFF7ED',
  };
}

export default function SendDetailScreen() {
  const router = useRouter();
  // displayName/displayAmount are UI hints only — the server resolves the
  // authoritative target name and amount from targetId when the payment
  // intent is created, and the summary screen re-fetches that intent.
  const params = useLocalSearchParams<{
    type?: string | string[];
    from?: string | string[];
    targetId?: string | string[];
    displayName?: string | string[];
    displayAmount?: string | string[];
    paymentMethod?: string | string[];
  }>();
  const type = firstRouteParam(params.type);
  const from = firstRouteParam(params.from);
  const targetId = firstRouteParam(params.targetId);
  const displayName = firstRouteParam(params.displayName);
  const displayAmount = firstRouteParam(params.displayAmount);
  const paymentMethod = firstRouteParam(params.paymentMethod);

  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const destinationType: DestinationType = routeDestinationType(type);
  const isGroup = destinationType === 'group';
  const isVault = destinationType === 'vault';
  const hasValidTargetId = typeof targetId === 'string' && UUID_RE.test(targetId);
  const copy = destinationCopy(destinationType);
  const DestinationIcon = copy.icon;

  const fixedGroupAmount = Number(displayAmount);
  const [amount, setAmount] = useState(
    isGroup && Number.isFinite(fixedGroupAmount) && fixedGroupAmount > 0 ? fixedGroupAmount.toFixed(2) : ''
  );
  const [methods, setMethods] = useState<LinkedPaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<SendPaymentMethod>(METHODS[0].id);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [vaultLimits, setVaultLimits] = useState<VaultTopupLimits>({
    minAmount: 50,
    maxAmount: 100000,
    dailyLimit: 50000,
    monthlyLimit: 500000,
  });

  useEffect(() => {
    if (!isVault) return;
    void fetchVaultTopupLimits().then(setVaultLimits);
  }, [isVault]);

  useEffect(() => {
    let mounted = true;
    const loadMethods = async () => {
      const { methods: rows, error } = await getMyPaymentMethods();
      if (!mounted) return;
      if (error) Alert.alert('Payment methods unavailable', error.message);
      const merged = rows.filter((m) => m.is_active && m.is_verified);
      setMethods(merged);
      const requested = isMobileMoneyProvider(paymentMethod)
        ? merged.find((m) => m.provider === paymentMethod)
        : undefined;
      const first = requested ?? merged.find((m) => isMobileMoneyProvider(m.provider));
      if (first) setSelectedMethod(first.provider);
      setLoadingMethods(false);
    };
    void loadMethods();
    return () => { mounted = false; };
  }, [paymentMethod]);

  const selectedMethodRow = methods.find((m) => m.provider === selectedMethod);
  const parsedAmount = Number(amount);
  const canEditAmount = !isGroup;
  const amountError = (() => {
    if (isGroup) return null;
    if (!amount) return 'Enter an amount';
    if (!/^\d+(\.\d{0,2})?$/.test(amount)) return 'Use only 2 decimal places';
    if (!Number.isFinite(parsedAmount)) return 'Enter an amount';
    if (parsedAmount < vaultLimits.minAmount) return `Minimum amount is NLe ${vaultLimits.minAmount.toLocaleString()}`;
    if (parsedAmount > vaultLimits.maxAmount) return `Maximum amount is NLe ${vaultLimits.maxAmount.toLocaleString()}`;
    return null;
  })();
  const amountIsValid =
    isGroup ||
    amountError == null;
  const canContinue =
    !!selectedMethodRow &&
    !submitting &&
    (isVault || hasValidTargetId) &&
    amountIsValid;

  const targetDisplayName = typeof displayName === 'string' && displayName.trim()
    ? displayName.trim()
    : copy.fallbackName;

  const methodLabel = getMobileMoneyProvider(selectedMethod)?.label ?? 'Mobile Money';
  const vaultPresetAmounts = useMemo(
    () => [vaultLimits.minAmount, 100, 500, 1000, 5000, 10000]
      .filter((value, index, values) => value <= vaultLimits.maxAmount && values.indexOf(value) === index),
    [vaultLimits.maxAmount, vaultLimits.minAmount],
  );

  const setPresetAmount = (value: number) => {
    if (!canEditAmount) return;
    setAmount(String(value));
  };

  const handleKeyPress = (key: string) => {
    if (!canEditAmount) return;
    if (key === 'backspace') {
      setAmount((current) => current.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      setAmount('');
      return;
    }
    if (key === 'done') {
      return;
    }
    setAmount((current) => sanitizeAmount(`${current}${key}`));
  };

  const handleQuit = () => router.back();

  const goToSummary = async () => {
    if (!selectedMethodRow) {
      Alert.alert('No verified payment method', 'Link and verify Orange Money or AfriMoney in Settings first.');
      return;
    }
    if (!isGroup && !amountIsValid) {
      Alert.alert('Invalid amount', amountError ?? 'Enter an amount');
      return;
    }

    if (isVault) {
      setPinError(null);
      setPinModalVisible(true);
      return;
    }

    if (!hasValidTargetId) {
      Alert.alert('Invalid destination', 'Please choose a destination again.');
      return;
    }

    setSubmitting(true);
    const sendTargetType = destinationType === 'savings' ? 'savings' : 'group';
    const { intent, error } = await createSendPaymentIntent({
      targetType: sendTargetType,
      targetId,
      amount: isGroup ? undefined : parsedAmount,
      method: selectedMethod,
    });
    setSubmitting(false);

    if (error || !intent) {
      Alert.alert('Payment could not be prepared', error?.message ?? 'Please try again.');
      return;
    }

    router.push({
      pathname: '/(send)/summary',
      params: {
        from: from ?? 'home',
        paymentIntentId: intent.paymentIntentId,
      },
    });
  };

  const submitVaultTopupWithPin = async (transactionPin: string) => {
    if (!selectedMethodRow) return;
    setSubmitting(true);
      const result = await initiateVaultTopup({
        amount: parsedAmount,
        paymentMethodId: selectedMethodRow.id,
        description: 'Vault top-up from payment screen',
        transactionPin,
      });
      setSubmitting(false);

      if (result.error || !result.success || !result.ussdCode) {
        setPinError(result.error?.message ?? 'Please try again.');
        return;
      }

      setPinModalVisible(false);
      router.push({
        pathname: '/(groups)/monime-payment',
        params: {
          topupId: result.topupId ?? undefined,
          monimePaymentCodeId: result.monimePaymentCodeId ?? undefined,
          ussdCode: result.ussdCode,
          expiresAt: result.expiresAt ?? undefined,
          // Display-only: server-returned amount from initiate-vault-topup.
          // Never fall back to client input — the USSD screen must show what
          // the backend actually charged.
          amount: result.amount != null ? String(result.amount) : '',
          provider: methodLabel,
          reference: result.topupId ?? result.monimePaymentCodeId ?? undefined,
          paymentType: 'vault_topup',
        },
      });
  };

  const keypadRows = useMemo(() => [
    ['1', '2', '3', '-'],
    ['4', '5', '6', 'clear'],
    ['7', '8', '9', 'backspace'],
    [',', '0', '.', 'done'],
  ], []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <ArrowLeft size={28} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>{copy.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.destinationCard, { borderColor: C.border, backgroundColor: C.card }]}>
          <View style={[styles.destinationIcon, { backgroundColor: copy.soft }]}>
            <DestinationIcon size={22} color={copy.color} />
          </View>
          <View style={styles.destinationBody}>
            <Text style={[styles.destinationMeta, { color: C.textMuted }]}>{copy.meta}</Text>
            <Text style={[styles.destinationName, { color: C.text }]} numberOfLines={1}>{targetDisplayName}</Text>
            <Text style={[styles.destinationHelper, { color: C.textSub }]} numberOfLines={1}>{copy.helper}</Text>
          </View>
        </View>

        <View style={styles.methodAmountRow}>
          <View style={styles.methodField}>
            <Text style={[styles.fieldLabel, { color: C.textSub }]}>
              Payment Method <Text style={styles.required}>*</Text>
            </Text>
            {loadingMethods ? (
              <View style={styles.methodLoadingRow}>
                <ActivityIndicator color="#F97316" size="small" />
                <Text style={[styles.methodLoadingText, { color: C.textMuted }]}>Loading...</Text>
              </View>
            ) : methods.length === 0 ? (
              <TouchableOpacity
                style={styles.noMethodInline}
                onPress={() => router.push('/components/payment-methods')}
                activeOpacity={0.82}
              >
                <Lock size={16} color="#F97316" />
                <Text style={styles.noMethodInlineText}>Link a verified method</Text>
              </TouchableOpacity>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.methodOptions}>
                {METHODS.map((m) => {
                  const linkedMethod = methods.find((method) => method.provider === m.id);
                  const linked = linkedMethod != null;
                  const active = selectedMethod === m.id && linked;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      disabled={!linked}
                      onPress={() => setSelectedMethod(m.id)}
                      style={[
                        styles.methodOption,
                        { borderColor: active ? '#F97316' : C.borderStrong, backgroundColor: active ? '#FFF7ED' : C.card },
                        !linked && styles.methodOptionDisabled,
                      ]}
                    >
                      <Image source={m.logo.source} style={styles.methodLogo} resizeMode="contain" accessibilityLabel={m.logo.title} />
                      <Text style={[styles.methodMasked, { color: active ? '#F97316' : C.textMuted }]} numberOfLines={1}>
                        {linkedMethod?.masked_number ?? 'Not linked'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          <TouchableOpacity
            style={styles.editMethodBtn}
            onPress={() => router.push('/components/payment-methods')}
            accessibilityRole="button"
            accessibilityLabel="Edit payment method"
          >
            <Edit3 size={22} color="#F97316" />
          </TouchableOpacity>
        </View>

        <View style={styles.amountSection}>
          <View style={styles.amountLabelRow}>
            <Text style={[styles.amountLabel, { color: C.textSub }]}>
              Please enter an amount <Text style={styles.required}>*</Text>
            </Text>
            <Banknote size={20} color={C.textSub} strokeWidth={1.5} />
          </View>

          <Text style={[styles.amountValue, { color: C.text }]}>{amountLabel(amount)}</Text>
          <View style={[styles.amountUnderline, { borderBottomColor: canContinue ? '#F97316' : C.borderStrong }]} />
          <Text style={[styles.amountCounter, { color: C.textMuted }]}>{amount.length}/{AMOUNT_VISUAL_LIMIT}</Text>
          {amountError && (
            <Text style={styles.errorText}>{amountError}</Text>
          )}
          {isGroup ? (
            <Text style={[styles.rangeText, { color: C.textSub }]}>
              Exact group contribution is set by the group and verified by the server.
            </Text>
          ) : (
            <Text style={[styles.rangeText, { color: C.textSub }]}>
              Between <Text style={styles.rangeEmphasis}>NLe {vaultLimits.minAmount.toLocaleString()}</Text> - <Text style={styles.rangeEmphasis}>NLe {vaultLimits.maxAmount.toLocaleString()}</Text>
            </Text>
          )}
        </View>

        <View style={styles.presetsGrid}>
          {vaultPresetAmounts.map((value) => {
            const active = Number(amount) === value;
            return (
              <TouchableOpacity
                key={value}
                style={[
                  styles.presetButton,
                  active && styles.presetButtonActive,
                  !canEditAmount && styles.presetButtonDisabled,
                ]}
                disabled={!canEditAmount}
                onPress={() => setPresetAmount(value)}
                activeOpacity={0.86}
              >
                <Text style={[styles.presetText, active && styles.presetTextActive]}>NLe {value.toLocaleString()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.quitButton} onPress={handleQuit} activeOpacity={0.86}>
            <Text style={styles.quitButtonText}>Quit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
            disabled={!canContinue}
            onPress={() => void goToSummary()}
            activeOpacity={0.88}
          >
            <Text style={styles.continueButtonText}>{submitting ? 'Preparing...' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.keypad, { backgroundColor: isDark ? '#0F172A' : '#F3F4F8' }]}>
        {keypadRows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keypadRow}>
            {row.map((key) => {
              const disabledKey = key === '-' || !canEditAmount;
              const isAction = ['-', 'clear', 'backspace', 'done'].includes(key);
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.key,
                    isAction && styles.keyAction,
                    disabledKey && styles.keyDisabled,
                  ]}
                  disabled={disabledKey}
                  onPress={() => handleKeyPress(key)}
                  activeOpacity={0.84}
                >
                  {key === 'backspace' ? (
                    <Delete size={22} color="#12121A" />
                  ) : key === 'done' ? (
                    <Check size={22} color="#12121A" />
                  ) : key === 'clear' ? (
                    <Text style={styles.keyText}>C</Text>
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
      </KeyboardAvoidingView>
      <EnterTransactionPinModal
        visible={pinModalVisible}
        subtitle={`Enter your Transaction PIN to top up NLe ${parsedAmount.toFixed(2)} to your Vault.`}
        loading={submitting}
        error={pinError}
        onCancel={() => {
          setPinModalVisible(false);
          setPinError(null);
        }}
        onConfirm={submitVaultTopupWithPin}
      />
    </SafeAreaView>
  );
}

// ─── Design tokens ────────────────────────────────────────────
// Screen title   20 / bold ('700')
// Form labels    16 / medium ('500')
// Input values   18 / medium ('500')
// Quick amounts  h:56  r:12  bw:1.5  fs:16  fw:'600'
// Primary btns   h:52  r:14  fs:17   fw:'600'
// H padding      24     Section gap  32
// Back arrow     28     Edit icon 22   Chevron 20
// ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardAvoider: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#12121A',
    marginLeft: 12,
  },
  headerSpacer: { width: 44 },

  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 16,
  },

  // ── Destination card ──────────────────────────────────────
  destinationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0F2F5',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    marginBottom: 32,
  },
  destinationIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  destinationBody: { flex: 1 },
  destinationMeta: { fontSize: 12, color: '#9CA3AF', fontWeight: '500', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  destinationName: { fontSize: 18, color: '#12121A', fontWeight: '500', marginBottom: 2 },
  destinationHelper: { fontSize: 13, color: '#9CA3AF' },

  // ── Payment method row ────────────────────────────────────
  methodAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  methodField: { flex: 1 },
  fieldLabel: { fontSize: 16, fontWeight: '500', color: '#6B7280', marginBottom: 12 },
  required: { color: '#F97316', fontWeight: '700' },
  methodLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  methodLoadingText: { fontSize: 16, color: '#9CA3AF' },
  noMethodInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: '#F0F2F5',
  },
  noMethodInlineText: { color: '#F97316', fontSize: 16, fontWeight: '600' },
  methodOptions: { gap: 10, paddingBottom: 4, paddingRight: 8 },
  methodOption: {
    width: 124,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodOptionDisabled: { opacity: 0.48 },
  methodLogo: { width: 92, height: 24 },
  methodMasked: { fontSize: 12, fontWeight: '500', marginTop: 4, color: '#6B7280' },
  editMethodBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },

  // ── Amount section ────────────────────────────────────────
  amountSection: { marginBottom: 32 },
  amountLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  amountLabel: { fontSize: 16, color: '#6B7280', fontWeight: '500' },
  amountValue: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '500',
    color: '#12121A',
    fontVariant: ['tabular-nums' as const],
  },
  amountUnderline: { borderBottomWidth: 1.5, paddingBottom: 8, marginBottom: 8, borderBottomColor: '#F0F2F5' },
  amountCounter: { fontSize: 13, fontWeight: '500', textAlign: 'right', marginBottom: 6, color: '#9CA3AF' },
  errorText: { color: '#DC2626', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  rangeText: { fontSize: 14, color: '#6B7280', lineHeight: 21, marginTop: 10 },
  rangeEmphasis: { color: '#F97316', fontWeight: '700' },

  // ── Quick amount presets ──────────────────────────────────
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginBottom: 32,
  },
  presetButton: {
    width: '31%',
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  presetButtonActive: { backgroundColor: '#F97316' },
  presetButtonDisabled: { opacity: 0.42 },
  presetText: { color: '#12121A', fontSize: 16, fontWeight: '600' },
  presetTextActive: { color: '#FFFFFF' },

  // ── Primary action buttons ────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  quitButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  quitButtonText: { color: '#12121A', fontSize: 17, fontWeight: '600' },
  continueButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.26,
    shadowRadius: 10,
    elevation: 5,
  },
  continueButtonDisabled: { opacity: 0.45, shadowOpacity: 0 },
  continueButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },

  // ── Numeric keypad ────────────────────────────────────────
  keypad: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 14,
    backgroundColor: '#F8FAFC',
  },
  keypadRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  key: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#12121A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  keyAction: { backgroundColor: '#EDEEF2' },
  keyDisabled: { opacity: 0.42 },
  keyText: {
    fontSize: 20,
    lineHeight: 24,
    color: '#12121A',
    fontWeight: '500',
  },
});
