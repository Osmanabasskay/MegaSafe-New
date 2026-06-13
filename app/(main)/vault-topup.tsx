import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Calendar,
  Check,
  CircleDollarSign,
  Clock3,
  HelpCircle,
  Hash,
  Link2,
  LockKeyhole,
  Send,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react-native';
import { getMyPaymentMethods, type LinkedPaymentMethod } from '../../src/services/paymentMethodService';
import { fetchVaultTopupLimits, type VaultTopupLimits } from '../../src/services/platformSettingsService';
import {
  getVaultSummary,
  initiateVaultTopup,
  verifyVaultTopupStatus,
  type VaultTopupResult,
  type VaultTopupStatusResult,
} from '../../src/services/vaultService';
import { generateIdempotencyKey } from '../../src/services/paymentService';
import { EnterTransactionPinModal } from '../../src/components/security/EnterTransactionPinModal';

type FlowStep = 'method' | 'amount' | 'confirm' | 'approve' | 'success' | 'failed';

const ORANGE = '#F4510B';
const NAVY = '#061333';
const MUTED = '#596174';
const BORDER = '#E3E6EE';
const QUICK_AMOUNTS = [50, 100, 200, 500];

const METHOD_LOGOS = {
  orange_money: require('../../assets/payment-providers/orange-money.png'),
  afrimoney: require('../../assets/payment-providers/afrimoney.png'),
};

const METHOD_LABELS = {
  orange_money: 'Orange Money',
  afrimoney: 'AfriMoney',
};

function money(value: number | null | undefined) {
  return `NLe ${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function methodLabel(method: LinkedPaymentMethod | VaultTopupResult | VaultTopupStatusResult | null) {
  const provider = method?.provider;
  return provider ? METHOD_LABELS[provider] : 'Mobile Money';
}

export default function VaultTopupScreen() {
  const router = useRouter();
  const [step, setStep] = useState<FlowStep>('method');
  const [methods, setMethods] = useState<LinkedPaymentMethod[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('200');
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [topup, setTopup] = useState<VaultTopupResult | null>(null);
  const [status, setStatus] = useState<VaultTopupStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const [limits, setLimits] = useState<VaultTopupLimits>({
    minAmount: 50,
    maxAmount: 100000,
    dailyLimit: 50000,
    monthlyLimit: 500000,
  });
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeMethods = useMemo(
    () => methods.filter((method) => method.is_active && method.is_verified),
    [methods],
  );

  const pendingMethods = useMemo(
    () => methods.filter((method) => !method.is_active || !method.is_verified),
    [methods],
  );

  const selectedMethod = useMemo(
    () => activeMethods.find((method) => method.id === selectedMethodId) ?? activeMethods[0] ?? null,
    [activeMethods, selectedMethodId],
  );

  const amount = Number(amountText || 0);
  const amountOutOfRange =
    Number.isFinite(amount) && amount > 0
      ? amount < limits.minAmount || amount > limits.maxAmount
      : false;
  const amountRangeError = amountOutOfRange
    ? amount < limits.minAmount
      ? `Minimum vault top-up is ${money(limits.minAmount)}.`
      : `Maximum vault top-up is ${money(limits.maxAmount)}.`
    : null;
  const displayFee = topup?.fee ?? status?.fee ?? 0;
  const displayTotal = topup?.totalAmount ?? status?.totalAmount ?? amount + displayFee;
  const vaultReceives = topup?.amount ?? status?.amount ?? amount;

  const loadMethods = useCallback(async () => {
    setLoadingMethods(true);
    const result = await getMyPaymentMethods();
    const verified = result.methods.filter((method) => method.is_active && method.is_verified);
    setMethods(result.methods);
    setSelectedMethodId((current) => (
      current && verified.some((method) => method.id === current)
        ? current
        : verified[0]?.id ?? null
    ));
    setError(result.error?.message ?? null);
    setLoadingMethods(false);
  }, []);

  useEffect(() => {
    void loadMethods();
    void fetchVaultTopupLimits().then(setLimits);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadMethods]);

  useFocusEffect(
    useCallback(() => {
      void loadMethods();
    }, [loadMethods])
  );

  const pollStatus = useCallback(async () => {
    if (!topup?.topupId && !topup?.monimePaymentCodeId) return;
    setPolling(true);
    const next = await verifyVaultTopupStatus({
      topupId: topup.topupId ?? undefined,
      monimePaymentCodeId: topup.monimePaymentCodeId ?? undefined,
    });
    setStatus(next);
    setPolling(false);

    if (next.error) {
      setError(next.error.message);
      return;
    }

    if (next.effectiveStatus === 'completed') {
      if (pollRef.current) clearInterval(pollRef.current);
      const summary = await getVaultSummary();
      setNewBalance(summary.summary?.availableBalance ?? null);
      setStep('success');
    }

    if (['failed', 'expired', 'cancelled'].includes(next.effectiveStatus)) {
      if (pollRef.current) clearInterval(pollRef.current);
      setStep('failed');
    }
  }, [topup?.monimePaymentCodeId, topup?.topupId]);

  useEffect(() => {
    if (step !== 'approve') return;
    void pollStatus();
    pollRef.current = setInterval(() => void pollStatus(), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollStatus, step]);

  const continueToConfirm = () => {
    setError(null);
    if (!selectedMethod) {
      setError('Link and verify Orange Money or AfriMoney before topping up.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid amount greater than zero.');
      return;
    }
    if (amountRangeError) {
      setError(amountRangeError);
      return;
    }
    setStep('confirm');
  };

  const continueToAmount = () => {
    setError(null);
    if (!selectedMethod) {
      setError('Link and verify Orange Money or AfriMoney before topping up.');
      return;
    }
    setStep('amount');
  };

  const openPaymentMethods = () => {
    router.push('/components/payment-methods');
  };

  const requestApproval = async () => {
    if (!selectedMethod || submitting) return;
    if (amountRangeError) {
      setError(amountRangeError);
      return;
    }
    setPinError(null);
    setPinModalVisible(true);
  };

  const submitApprovalWithPin = async (transactionPin: string) => {
    if (!selectedMethod || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await initiateVaultTopup({
      amount,
      paymentMethodId: selectedMethod.id,
      idempotencyKey,
      description: `Vault top-up from ${METHOD_LABELS[selectedMethod.provider]}`,
      transactionPin,
    });
    setSubmitting(false);

    if (!result.success || result.error) {
      setPinError(result.error?.message ?? 'Could not request payment approval.');
      return;
    }

    setPinModalVisible(false);
    setTopup(result);
    setStep('approve');
  };

  const retry = () => {
    setTopup(null);
    setStatus(null);
    setError(null);
    setIdempotencyKey(generateIdempotencyKey());
    setStep('amount');
  };

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconButton} onPress={() => (step === 'method' ? router.back() : setStep(step === 'amount' ? 'method' : 'amount'))}>
        <ArrowLeft size={28} color={NAVY} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <TouchableOpacity style={styles.iconButton}>
        <HelpCircle size={28} color={NAVY} />
      </TouchableOpacity>
    </View>
  );

  const renderMethodIcon = (provider: LinkedPaymentMethod['provider'] | VaultTopupResult['provider'] | null | undefined, large = false) => (
    <View style={[large ? styles.methodIconLarge : styles.methodIcon, provider === 'afrimoney' && styles.afriIcon]}>
      {provider ? <Image source={METHOD_LOGOS[provider]} style={large ? styles.logoLarge : styles.logo} resizeMode="contain" /> : null}
    </View>
  );

  const renderMethodSelection = () => (
    <>
      {renderHeader('Choose Mobile Money')}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Linked payment method</Text>
        {loadingMethods ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={ORANGE} />
            <Text style={styles.cardText}>Checking your linked mobile money accounts...</Text>
          </View>
        ) : methods.length > 0 ? (
          <>
            {activeMethods.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[styles.selectMethodCard, selectedMethod?.id === method.id && styles.selectMethodCardActive]}
                onPress={() => setSelectedMethodId(method.id)}
                activeOpacity={0.88}
              >
                {renderMethodIcon(method.provider, true)}
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>{METHOD_LABELS[method.provider]}</Text>
                  <Text style={styles.cardText}>{method.masked_number}</Text>
                  <View style={styles.verifiedPill}>
                    <ShieldCheck size={14} color="#15803D" />
                    <Text style={styles.verifiedPillText}>Linked and verified</Text>
                  </View>
                </View>
                <View style={[styles.radioCircle, selectedMethod?.id === method.id && styles.radioCircleActive]}>
                  {selectedMethod?.id === method.id ? <Check size={18} color="#FFFFFF" /> : null}
                </View>
              </TouchableOpacity>
            ))}
            {pendingMethods.length > 0 ? (
              <>
                <Text style={styles.pendingSectionLabel}>Needs verification</Text>
                {pendingMethods.map((method) => (
                  <View key={method.id} style={styles.pendingMethodCard}>
                    {renderMethodIcon(method.provider, true)}
                    <View style={styles.flex}>
                      <Text style={styles.cardTitle}>{METHOD_LABELS[method.provider]}</Text>
                      <Text style={styles.cardText}>{method.masked_number}</Text>
                      <Text style={styles.pendingMethodText}>Linked payment method. Verify it before topping up your vault.</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}
            <TouchableOpacity style={styles.linkAnotherButton} onPress={openPaymentMethods} activeOpacity={0.88}>
              <Link2 size={20} color={ORANGE} />
              <Text style={styles.linkAnotherText}>{activeMethods.length > 0 ? 'Link another mobile money number' : 'Verify linked mobile money'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.warningCard}>
            <View style={styles.warningIcon}>
              <TriangleAlert size={28} color={ORANGE} />
            </View>
            <Text style={styles.warningTitle}>No linked mobile money found</Text>
            <Text style={styles.warningText}>
              Add and verify an Orange Money or AfriMoney number in linked payment methods before adding money to your vault.
            </Text>
            <TouchableOpacity style={styles.warningButton} onPress={openPaymentMethods} activeOpacity={0.88}>
              <Link2 size={20} color="#FFFFFF" />
              <Text style={styles.warningButtonText}>Link Mobile Money</Text>
            </TouchableOpacity>
          </View>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
      <BottomButton
        label={activeMethods.length > 0 ? 'Continue' : methods.length > 0 ? 'Verify Mobile Money' : 'Link Mobile Money'}
        disabled={loadingMethods}
        onPress={activeMethods.length > 0 ? continueToAmount : openPaymentMethods}
      />
    </>
  );

  const renderAmount = () => (
    <>
      {renderHeader('Top Up Vault')}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>From</Text>
        <View style={styles.card}>
          {loadingMethods ? (
            <ActivityIndicator color={ORANGE} />
          ) : selectedMethod ? (
            <View style={styles.methodRow}>
              {renderMethodIcon(selectedMethod.provider, true)}
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{METHOD_LABELS[selectedMethod.provider]}</Text>
                <Text style={styles.cardText}>{selectedMethod.masked_number}</Text>
              </View>
              <TouchableOpacity style={styles.changeMethodButton} onPress={() => setStep('method')}>
                <Text style={styles.changeMethodText}>Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.cardText}>No verified mobile money account found.</Text>
          )}
        </View>

        {activeMethods.length > 1 ? (
          <View style={styles.methodPicker}>
            {activeMethods.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[styles.methodChip, selectedMethod?.id === method.id && styles.methodChipActive]}
                onPress={() => setSelectedMethodId(method.id)}
              >
                <Text style={[styles.methodChipText, selectedMethod?.id === method.id && styles.methodChipTextActive]}>
                  {METHOD_LABELS[method.provider]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>Amount</Text>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.amountBox}>
            <View style={styles.amountRow}>
              <Text style={styles.currencyText}>NLe</Text>
              <TextInput
                value={amountText}
                onChangeText={(value) => setAmountText(value.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                style={styles.amountInput}
                placeholder="0"
                placeholderTextColor="#B9BEC9"
              />
            </View>
            <View style={styles.amountDivider} />
            <Text style={styles.amountHint}>Enter {money(limits.minAmount)} - {money(limits.maxAmount)}</Text>
          </View>
        </KeyboardAvoidingView>

        <View style={styles.quickRow}>
          {QUICK_AMOUNTS.map((quick) => (
            <TouchableOpacity
              key={quick}
              style={[styles.quickButton, amount === quick && styles.quickButtonActive]}
              onPress={() => setAmountText(String(quick))}
            >
              <Text style={[styles.quickText, amount === quick && styles.quickTextActive]}>{quick}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>To</Text>
        <View style={styles.card}>
          <View style={styles.methodRow}>
            <View style={styles.vaultBadge}><Text style={styles.vaultBadgeText}>M</Text></View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>To: Mi Osusu Vault</Text>
              <Text style={styles.cardText}>Your secure savings vault</Text>
            </View>
            <View style={styles.shieldCircle}><ShieldCheck size={28} color={NAVY} /></View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Transfer summary</Text>
        <View style={styles.summaryCard}>
          <SummaryRow label="Transfer amount" value={money(amount)} />
          <SummaryRow label="Fee" value={money(0)} />
          <View style={styles.line} />
          <SummaryRow label="Vault receives" value={money(amount)} strong accent />
        </View>

        {amountRangeError ? <Text style={styles.errorText}>{amountRangeError}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
      <BottomButton label="Continue" disabled={loadingMethods || !selectedMethod || amount <= 0 || !!amountRangeError} onPress={continueToConfirm} />
    </>
  );

  const renderConfirm = () => (
    <>
      {renderHeader('Confirm Transfer')}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.reviewCopy}>Please review the details of your transfer before requesting approval.</Text>
        <View style={styles.confirmCard}>
          <Text style={styles.sectionLabel}>From</Text>
          <View style={styles.methodRow}>
            {selectedMethod ? renderMethodIcon(selectedMethod.provider, true) : null}
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{selectedMethod ? METHOD_LABELS[selectedMethod.provider] : 'Mobile Money'}</Text>
              <Text style={styles.cardText}>{selectedMethod?.masked_number}</Text>
            </View>
          </View>
          <View style={styles.line} />
          <Text style={styles.sectionLabel}>To</Text>
          <View style={styles.methodRow}>
            <View style={styles.vaultBadge}><Text style={styles.vaultBadgeText}>M</Text></View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Mi Osusu Vault</Text>
              <Text style={styles.cardText}>Your secure savings vault</Text>
            </View>
          </View>
          <View style={styles.line} />
          <SummaryRow label="Amount" value={money(amount)} />
          <SummaryRow label="Fee" value={money(displayFee)} />
          <SummaryRow label="Total to pay" value={money(displayTotal)} accent />
          <View style={styles.line} />
          <SummaryRow label="Vault will receive" value={money(vaultReceives)} accent />
        </View>
        <View style={styles.noteCard}>
          <ShieldCheck size={28} color={NAVY} />
          <Text style={styles.noteText}>You will receive an approval prompt on your mobile money phone number.</Text>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
      <BottomButton label="Confirm & Request Approval" disabled={!!amountRangeError} loading={submitting} onPress={() => void requestApproval()} />
    </>
  );

  const renderApprove = () => (
    <>
      {renderHeader('Approve on Your Phone')}
      <ScrollView contentContainerStyle={[styles.content, styles.centerContent]} showsVerticalScrollIndicator={false}>
        <View style={styles.phoneIllustration}>
          <View style={styles.phoneShape}>
            <View style={styles.phoneSpeaker} />
            {renderMethodIcon(topup?.provider ?? selectedMethod?.provider, true)}
            <View style={styles.fakeLineShort} />
            <View style={styles.fakeLine} />
            <View style={styles.pinDots}>
              {[0, 1, 2, 3].map((dot) => <View key={dot} style={styles.pinDot} />)}
            </View>
          </View>
          <View style={styles.lockBubble}><LockKeyhole size={32} color={NAVY} /></View>
        </View>

        <View style={styles.messageCard}>
          <View style={styles.sendBubble}><Send size={28} color={ORANGE} /></View>
          <View style={styles.flex}>
            <Text style={styles.messageTitle}>A payment request has been sent to {methodLabel(topup ?? selectedMethod)}</Text>
            <Text style={styles.messageText}>Approve <Text style={styles.accentText}>{money(topup?.amount ?? amount)}</Text> on {topup?.maskedPhone ?? selectedMethod?.masked_number} using your mobile money PIN.</Text>
          </View>
        </View>

        <View style={styles.detailsCard}>
          <DetailRow icon={<CircleDollarSign size={22} color={NAVY} />} label="Amount" value={money(topup?.amount ?? amount)} accent />
          <DetailRow icon={renderMethodIcon(topup?.provider ?? selectedMethod?.provider)} label="From" value={methodLabel(topup ?? selectedMethod)} />
          <DetailRow icon={<View style={styles.vaultBadgeSmall}><Text style={styles.vaultBadgeSmallText}>M</Text></View>} label="To" value="Mi Osusu Vault" />
        </View>

        <View style={styles.expiryBox}>
          <Clock3 size={24} color={ORANGE} />
          <Text style={styles.expiryText}>This request will expire if not approved before the provider timeout.</Text>
        </View>
        {topup?.ussdCode ? <Text style={styles.ussdText}>USSD: {topup.ussdCode}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
      <BottomButton label="I Have Approved" loading={polling} onPress={() => void pollStatus()} />
    </>
  );

  const finalStatus = status ?? topup;
  const renderSuccess = () => (
    <>
      {renderHeader('Transfer Successful')}
      <ScrollView contentContainerStyle={[styles.content, styles.centerContent]} showsVerticalScrollIndicator={false}>
        <View style={styles.successHalo}><View style={styles.successCircle}><Check size={58} color="#FFFFFF" /></View></View>
        <Text style={styles.successTitle}><Text style={styles.accentText}>{money(finalStatus?.amount ?? amount)}</Text> added to your Vault</Text>
        <Text style={styles.successCopy}>Money has been transferred from your mobile money account to Mi Osusu Vault successfully.</Text>
        <View style={styles.detailsCard}>
          <DetailRow icon={<CircleDollarSign size={22} color={ORANGE} />} label="Amount" value={money(finalStatus?.amount ?? amount)} accent />
          <DetailRow icon={renderMethodIcon(finalStatus?.provider ?? selectedMethod?.provider)} label="Source" value={methodLabel(finalStatus ?? selectedMethod)} />
          <DetailRow icon={<View style={styles.vaultBadgeSmall}><Text style={styles.vaultBadgeSmallText}>M</Text></View>} label="Destination" value="Mi Osusu Vault" />
          <DetailRow icon={<Hash size={22} color={NAVY} />} label="Transaction ID" value={status?.transactionId ?? 'Pending receipt'} />
          <DetailRow icon={<Calendar size={22} color={NAVY} />} label="Date" value={new Date(status?.transactionDate ?? status?.completedAt ?? Date.now()).toLocaleString()} />
          <DetailRow icon={<ShieldCheck size={22} color={NAVY} />} label="New Vault Balance" value={newBalance == null ? 'Refreshing' : money(newBalance)} accent />
        </View>
      </ScrollView>
      <View style={styles.bottomStack}>
        <BottomButton label="Done" onPress={() => router.replace('/(main)/vault')} inline />
        <TouchableOpacity style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>View Receipt</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderFailed = () => (
    <>
      {renderHeader('Transfer Failed')}
      <View style={[styles.content, styles.centerContent]}>
        <View style={styles.failedCircle}><Text style={styles.failedMark}>!</Text></View>
        <Text style={styles.successTitle}>Top-up was not completed</Text>
        <Text style={styles.successCopy}>{status?.failureReason ?? error ?? 'The payment failed, expired, or was cancelled. Your Vault was not credited.'}</Text>
      </View>
      <BottomButton label="Try Again" onPress={retry} />
    </>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {step === 'method' ? renderMethodSelection() : null}
      {step === 'amount' ? renderAmount() : null}
      {step === 'confirm' ? renderConfirm() : null}
      {step === 'approve' ? renderApprove() : null}
      {step === 'success' ? renderSuccess() : null}
      {step === 'failed' ? renderFailed() : null}
      <EnterTransactionPinModal
        visible={pinModalVisible}
        subtitle={`Enter your Transaction PIN to top up ${money(amount)} to your Vault.`}
        loading={submitting}
        error={pinError}
        onCancel={() => {
          setPinModalVisible(false);
          setPinError(null);
        }}
        onConfirm={submitApprovalWithPin}
      />
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, accent, strong }: { label: string; value: string; accent?: boolean; strong?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, strong && styles.summaryStrong]}>{label}</Text>
      <Text style={[styles.summaryValue, accent && styles.summaryAccent]}>{value}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>{icon}</View>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, accent && styles.summaryAccent]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function BottomButton({ label, onPress, disabled, loading, inline }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  inline?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[inline ? styles.bottomButtonInline : styles.bottomButton, disabled && styles.disabledButton]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.88}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.bottomButtonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { height: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: NAVY, fontSize: 24, fontWeight: '800' },
  content: { paddingHorizontal: 24, paddingBottom: 24 },
  centerContent: { alignItems: 'center' },
  sectionLabel: { color: MUTED, fontSize: 18, fontWeight: '700', marginBottom: 10, alignSelf: 'stretch' },
  card: { borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 24, shadowColor: '#0F172A', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  loadingCard: { minHeight: 148, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 18, marginBottom: 24 },
  selectMethodCard: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 14, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  selectMethodCardActive: { borderColor: ORANGE, backgroundColor: '#FFF8F4' },
  pendingSectionLabel: { color: MUTED, fontSize: 15, fontWeight: '800', marginTop: 8, marginBottom: 10 },
  pendingMethodCard: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, borderWidth: 1, borderColor: '#FED7AA', backgroundColor: '#FFF7ED', padding: 16, marginBottom: 14 },
  pendingMethodText: { color: '#B45309', fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 8 },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flex: { flex: 1 },
  methodIconLarge: { width: 76, height: 76, borderRadius: 18, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  methodIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  afriIcon: { backgroundColor: NAVY },
  logoLarge: { width: 58, height: 58 },
  logo: { width: 34, height: 34 },
  cardTitle: { color: NAVY, fontSize: 22, fontWeight: '800' },
  cardText: { color: MUTED, fontSize: 17, marginTop: 4 },
  changeMethodButton: { minHeight: 42, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  changeMethodText: { color: ORANGE, fontSize: 15, fontWeight: '800' },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#DCFCE7' },
  verifiedPillText: { color: '#15803D', fontSize: 12, fontWeight: '800' },
  radioCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioCircleActive: { borderColor: ORANGE, backgroundColor: ORANGE },
  linkAnotherButton: { minHeight: 52, borderRadius: 14, borderWidth: 1.5, borderColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, marginBottom: 20 },
  linkAnotherText: { color: ORANGE, fontSize: 16, fontWeight: '800' },
  warningCard: { borderRadius: 16, borderWidth: 1, borderColor: '#FED7AA', backgroundColor: '#FFF7ED', padding: 20, alignItems: 'center', marginBottom: 20 },
  warningIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  warningTitle: { color: NAVY, fontSize: 24, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  warningText: { color: MUTED, fontSize: 17, lineHeight: 25, textAlign: 'center', marginBottom: 18 },
  warningButton: { minHeight: 54, alignSelf: 'stretch', borderRadius: 14, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  warningButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  methodPicker: { flexDirection: 'row', gap: 10, marginTop: -14, marginBottom: 20 },
  methodChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  methodChipActive: { borderColor: ORANGE, backgroundColor: '#FFF3ED' },
  methodChipText: { color: MUTED, fontWeight: '700' },
  methodChipTextActive: { color: ORANGE },
  amountBox: { borderWidth: 1.5, borderColor: ORANGE, borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 18 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  currencyText: { color: NAVY, fontSize: 42, fontWeight: '800', marginRight: 14 },
  amountInput: { color: ORANGE, fontSize: 54, fontWeight: '800', minWidth: 120, maxWidth: 230, padding: 0 },
  amountDivider: { height: 1, backgroundColor: BORDER, alignSelf: 'stretch', marginVertical: 12 },
  amountHint: { color: MUTED, fontSize: 17 },
  quickRow: { flexDirection: 'row', gap: 14, marginBottom: 26 },
  quickButton: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  quickButtonActive: { borderColor: ORANGE, backgroundColor: '#FFF3ED' },
  quickText: { color: NAVY, fontSize: 18, fontWeight: '800' },
  quickTextActive: { color: ORANGE },
  vaultBadge: { width: 76, height: 76, borderRadius: 38, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  vaultBadgeText: { color: ORANGE, fontSize: 42, fontWeight: '900' },
  vaultBadgeSmall: { width: 38, height: 38, borderRadius: 19, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  vaultBadgeSmallText: { color: ORANGE, fontSize: 22, fontWeight: '900' },
  shieldCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#F0F2F7', alignItems: 'center', justifyContent: 'center' },
  summaryCard: { borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 20 },
  confirmCard: { borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 18, marginBottom: 22 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, gap: 16 },
  summaryLabel: { color: MUTED, fontSize: 17, flex: 1 },
  summaryStrong: { color: NAVY, fontWeight: '800' },
  summaryValue: { color: NAVY, fontSize: 18, fontWeight: '700', textAlign: 'right' },
  summaryAccent: { color: ORANGE, fontWeight: '900' },
  line: { height: 1, backgroundColor: BORDER, marginVertical: 10 },
  reviewCopy: { color: MUTED, fontSize: 19, lineHeight: 32, marginBottom: 28 },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#F9FAFC', borderRadius: 16, padding: 18 },
  noteText: { flex: 1, color: MUTED, fontSize: 17, lineHeight: 25 },
  phoneIllustration: { width: 250, height: 310, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  phoneShape: { width: 150, height: 250, borderWidth: 6, borderColor: NAVY, borderRadius: 24, alignItems: 'center', paddingTop: 28, backgroundColor: '#FFFFFF' },
  phoneSpeaker: { width: 54, height: 8, borderRadius: 4, backgroundColor: NAVY, marginBottom: 24 },
  fakeLineShort: { width: 76, height: 12, borderRadius: 6, backgroundColor: '#E6E8ED', marginTop: 22 },
  fakeLine: { width: 106, height: 12, borderRadius: 6, backgroundColor: '#E6E8ED', marginTop: 12 },
  pinDots: { flexDirection: 'row', gap: 16, borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 16, marginTop: 18 },
  pinDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: NAVY },
  lockBubble: { position: 'absolute', right: 30, bottom: 36, width: 74, height: 74, borderRadius: 37, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#0F172A', shadowOpacity: 0.14, shadowRadius: 8, elevation: 4 },
  messageCard: { flexDirection: 'row', gap: 18, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 20, marginBottom: 18, alignSelf: 'stretch' },
  sendBubble: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#FFF0E8', alignItems: 'center', justifyContent: 'center' },
  messageTitle: { color: NAVY, fontSize: 22, fontWeight: '800', lineHeight: 30 },
  messageText: { color: MUTED, fontSize: 18, lineHeight: 28, marginTop: 8 },
  accentText: { color: ORANGE, fontWeight: '900' },
  detailsCard: { alignSelf: 'stretch', borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, marginBottom: 20 },
  detailRow: { flexDirection: 'row', alignItems: 'center', minHeight: 70, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 14 },
  detailIcon: { width: 46, alignItems: 'center' },
  detailLabel: { color: MUTED, fontSize: 17, flex: 1 },
  detailValue: { color: NAVY, fontSize: 18, fontWeight: '800', flex: 1.15, textAlign: 'right' },
  expiryBox: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', borderRadius: 12, backgroundColor: '#FFF0E8', padding: 14, marginBottom: 14 },
  expiryText: { flex: 1, color: MUTED, fontSize: 15 },
  ussdText: { color: ORANGE, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  successHalo: { width: 122, height: 122, borderRadius: 61, backgroundColor: '#E6F7E8', alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 22 },
  successCircle: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: NAVY, fontSize: 34, lineHeight: 43, fontWeight: '900', textAlign: 'center', marginBottom: 18 },
  successCopy: { color: MUTED, fontSize: 18, lineHeight: 27, textAlign: 'center', marginBottom: 26 },
  failedCircle: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginTop: 80, marginBottom: 24 },
  failedMark: { color: '#DC2626', fontSize: 52, fontWeight: '900' },
  bottomButton: { marginHorizontal: 24, marginBottom: 14, minHeight: 66, borderRadius: 14, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  bottomButtonInline: { minHeight: 66, borderRadius: 14, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  bottomButtonText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  disabledButton: { opacity: 0.45 },
  bottomStack: { paddingHorizontal: 24, paddingBottom: 14, gap: 12 },
  secondaryButton: { minHeight: 58, borderRadius: 14, borderWidth: 1.5, borderColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: ORANGE, fontSize: 20, fontWeight: '800' },
  errorText: { color: '#DC2626', fontSize: 15, fontWeight: '700', lineHeight: 21, marginTop: 8, alignSelf: 'stretch' },
});
