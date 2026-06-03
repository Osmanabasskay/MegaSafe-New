import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Clipboard,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView }         from 'react-native-safe-area-context';
import { useRouter }            from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle,
  Clock,
  RefreshCw,
  Shield,
  Wallet,
} from 'lucide-react-native';
import FontAwesome    from '@expo/vector-icons/FontAwesome';
import MaterialIcons  from '@expo/vector-icons/MaterialIcons';
import { useAuthStore }     from '../../src/store/authStore';
import { useAppDataStore }  from '../../src/store/appDataStore';
import { useKycGuard }      from '../../src/hooks/useKycGuard';
import { darkColors, lightColors } from '../../src/theme/colors';
import { fetchSavingsGoals, processSavingsWithdrawal, type SavingsGoal } from '../../src/api/walletApi';
import {
  getVaultSummary,
  initiateVaultTopup,
  verifyVaultTopupStatus,
  type VaultSummary,
  type VaultTopupMethod,
  type VaultTopupResult,
  type VaultTopupStatusResult,
} from '../../src/services/vaultService';

// ── Monime method logos ─────────────────────────────────────────
const METHOD_LOGOS: Record<VaultTopupMethod, { source: ReturnType<typeof require>; title: string }> = {
  orange_money: { source: require('../../Orange Money logo.png'), title: 'Orange Money' },
  afrimoney:    { source: require('../../AfriMoney Logo.png'),    title: 'AfriMoney' },
};

const METHOD_COLORS: Record<VaultTopupMethod, string> = {
  orange_money: '#FF6900',
  afrimoney:    '#00A652',
};

const QUICK_AMOUNTS = [50, 100, 200, 500];

// ── Topup multi-step flow ───────────────────────────────────────
type TopupStep = 'idle' | 'method' | 'amount' | 'processing' | 'checkout' | 'complete' | 'failed';

// ─── Screen ─────────────────────────────────────────────────────
export default function VaultScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { requireKyc } = useKycGuard();
  const {
    linkedMobileMoneyAccounts,
    linkedBankAccounts,
    preferences,
  } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [showBalance, setShowBalance] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const balanceAnim = useRef(new Animated.Value(0)).current;
  const badgePulse  = useRef(new Animated.Value(1)).current;
  const badgeRing   = useRef(new Animated.Value(0)).current;

  const [refreshing, setRefreshing] = useState(false);
  const [vaultSummary, setVaultSummary] = useState<VaultSummary | null>(null);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);

  // ── Vault top-up flow ───────────────────────────────────────
  const [topupStep, setTopupStep]     = useState<TopupStep>('idle');
  const [topupMethod, setTopupMethod] = useState<VaultTopupMethod | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupResult, setTopupResult] = useState<VaultTopupResult | null>(null);
  const [topupStatus, setTopupStatus] = useState<VaultTopupStatusResult | null>(null);
  const [topupPolling, setTopupPolling] = useState(false);

  // ── Withdrawal detail flow ──────────────────────────────────
  const [withdrawSheetVisible, setWithdrawSheetVisible]   = useState(false);
  const [withdrawType, setWithdrawType]                   = useState<'savings' | 'osusu' | null>(null);
  const [withdrawDetailVisible, setWithdrawDetailVisible] = useState(false);
  const [selectedGoalId, setSelectedGoalId]               = useState<string>('');
  const [withdrawAmount, setWithdrawAmount]               = useState('');
  const [withdrawNote, setWithdrawNote]                   = useState('');
  const [withdrawProcessing, setWithdrawProcessing]       = useState(false);

  // ── Data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user?.id) { setSavingsGoals([]); return; }
    const [{ goals }, { summary }] = await Promise.all([
      fetchSavingsGoals(user.id),
      getVaultSummary(),
    ]);
    setSavingsGoals(goals);
    if (summary) setVaultSummary(summary);
  }, [user?.id]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Reload when app comes back to foreground (e.g. after Monime checkout)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && topupStep === 'checkout') {
        void pollTopupStatus();
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupStep, topupResult]);

  // ── Animations ──────────────────────────────────────────────
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(badgePulse, { toValue: 1.1, duration: 1000, useNativeDriver: true }),
        Animated.timing(badgePulse, { toValue: 1,   duration: 1000, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.timing(badgeRing, { toValue: 1, duration: 2400, useNativeDriver: true })
    ).start();
  }, []);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  // ── Balance gate ────────────────────────────────────────────
  const revealBalance = () => {
    setShowBalance(true);
    Animated.spring(balanceAnim, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 14 }).start();
  };

  const handleEyeTap = async () => {
    if (showBalance) {
      Animated.timing(balanceAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
      setShowBalance(false);
      return;
    }
    setGateLoading(true);
    const hasHW   = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHW && enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to view balance',
        fallbackLabel: 'Enter PIN',
        cancelLabel:   'Cancel',
      });
      setGateLoading(false);
      if (result.success) revealBalance();
    } else {
      Alert.alert('Verify Identity', 'Confirm to view your balance.', [
        { text: 'Cancel', style: 'cancel', onPress: () => setGateLoading(false) },
        { text: 'Confirm', onPress: () => { setGateLoading(false); revealBalance(); } },
      ]);
    }
  };

  // ── Vault Top-Up flow ────────────────────────────────────────
  const openTopupFlow = () => {
    if (!requireKyc('top up your vault')) return;
    setTopupMethod(null);
    setTopupAmount('');
    setTopupResult(null);
    setTopupStatus(null);
    setTopupStep('method');
  };

  const handleSelectMethod = (method: VaultTopupMethod) => {
    setTopupMethod(method);
    setTopupStep('amount');
  };

  const handleSubmitTopup = async () => {
    if (!topupMethod) return;
    const amount = parseFloat(topupAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid amount greater than zero.');
      return;
    }

    setTopupStep('processing');
    const result = await initiateVaultTopup({ amount, method: topupMethod });

    if (result.error || !result.success) {
      setTopupResult(result);
      setTopupStep('failed');
      return;
    }

    setTopupResult(result);

    // Navigate to the dedicated premium payment screen
    closeTopupFlow();
    router.push({
      pathname: '/(groups)/monime-payment',
      params: {
        topupId:             result.topupId             ?? '',
        monimePaymentCodeId: result.monimePaymentCodeId ?? '',
        ussdCode:            result.ussdCode            ?? '',
        expiresAt:           result.expiresAt           ?? '',
        amount:              String(result.amount       ?? amount),
        fee:                 '0',
        provider:            topupMethod === 'orange_money' ? 'Orange Money' : 'AfriMoney',
        reference:           result.topupId             ?? '',
        paymentType:         'vault_topup',
      },
    });
  };

  const pollTopupStatus = async () => {
    if (!topupResult?.topupId && !topupResult?.monimePaymentCodeId) return;
    setTopupPolling(true);
    const status = await verifyVaultTopupStatus({
      topupId:             topupResult?.topupId             ?? undefined,
      monimePaymentCodeId: topupResult?.monimePaymentCodeId ?? undefined,
    });
    setTopupStatus(status);
    setTopupPolling(false);

    if (status.effectiveStatus === 'completed') {
      setTopupStep('complete');
      void loadData(); // refresh vault balance
    }
  };

  const closeTopupFlow = () => {
    setTopupStep('idle');
    setTopupMethod(null);
    setTopupAmount('');
    setTopupResult(null);
    setTopupStatus(null);
  };

  // ── Withdraw flow ───────────────────────────────────────────
  const handleWithdraw = (type: 'savings' | 'osusu') => {
    const hasMethod = linkedMobileMoneyAccounts.length > 0 || linkedBankAccounts.length > 0;
    if (!hasMethod) {
      setWithdrawSheetVisible(false);
      Alert.alert('Link withdrawal method', 'Link a payment method in Settings first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => router.push('/components/payment-methods') },
      ]);
      return;
    }
    setWithdrawSheetVisible(false);
    setWithdrawType(type);
    setSelectedGoalId('');
    setWithdrawAmount('');
    setWithdrawNote('');
    setTimeout(() => setWithdrawDetailVisible(true), 260);
  };

  const handleProcessWithdrawal = async () => {
    if (!requireKyc('request a withdrawal')) return;

    if (withdrawType === 'savings') {
      if (!selectedGoalId) {
        Alert.alert('Select goal', 'Choose a savings goal to withdraw from.');
        return;
      }
      const amount = parseFloat(withdrawAmount);
      if (!amount || amount <= 0) {
        Alert.alert('Invalid amount', 'Enter a valid withdrawal amount greater than zero.');
        return;
      }
      setWithdrawProcessing(true);
      const { success, error } = await processSavingsWithdrawal({
        goalId: selectedGoalId,
        amount,
        note: withdrawNote.trim() || undefined,
      });
      setWithdrawProcessing(false);
      if (!success || error) {
        Alert.alert('Withdrawal failed', error?.message ?? 'Could not process withdrawal. Please try again.');
        return;
      }
      setWithdrawDetailVisible(false);
      await loadData();
      Alert.alert('Request submitted', 'Your savings withdrawal request has been submitted and will be processed within 24 hours.');
    } else {
      setWithdrawDetailVisible(false);
      router.push('/(main)/groups');
    }
  };

  const availableBalance = vaultSummary?.availableBalance ?? 0;
  const reservedBalance  = vaultSummary?.reservedBalance  ?? 0;
  const pendingCount     = vaultSummary?.pendingTopupCount ?? 0;

  // ── Render ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Vault Balance Card ─────────────────────────────── */}
        <View style={styles.heroSection}>
          <View style={styles.heroDot1} pointerEvents="none" />
          <View style={styles.heroDot2} pointerEvents="none" />

          <View style={styles.heroTopRow}>
            <View style={styles.heroLabelCol}>
              <Text style={styles.heroTopLabel}>Vault Balance</Text>
              <Text style={styles.heroBalanceSubLabel}>Available to spend</Text>
            </View>
            <View style={styles.heroEyeCol}>
              <TouchableOpacity
                style={styles.heroEyeBtn}
                onPress={() => void handleEyeTap()}
                disabled={gateLoading}
                activeOpacity={0.8}
              >
                <FontAwesome name={showBalance ? 'eye-slash' : 'eye'} size={18} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.heroBadgeWrap}>
                <Animated.View
                  style={[
                    styles.heroBadgeRing,
                    {
                      transform: [{ scale: badgeRing.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.35] }) }],
                      opacity:   badgeRing.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.15, 0] }),
                    },
                  ]}
                />
                <Animated.View style={[styles.heroBadgeCircle, { transform: [{ scale: badgePulse }] }]}>
                  <FontAwesome name="bank" size={15} color="#F97316" />
                </Animated.View>
              </View>
            </View>
          </View>

          <Animated.Text style={[styles.heroBalanceAmount, { opacity: showBalance ? balanceAnim : 1 }]}>
            {showBalance
              ? `NLe ${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              : 'NLe ••••••'}
          </Animated.Text>

          {/* Stats row — available vs reserved */}
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStatCol}>
              <Text style={styles.heroStatVal}>
                {showBalance
                  ? `NLe ${(vaultSummary?.postedBalance ?? 0).toFixed(2)}`
                  : '••••'}
              </Text>
              <Text style={styles.heroStatLbl}>Posted</Text>
            </View>
            <View style={styles.heroStatDiv} />
            <View style={styles.heroStatCol}>
              <Text style={styles.heroStatVal}>
                {showBalance
                  ? `NLe ${reservedBalance.toFixed(2)}`
                  : '••••'}
              </Text>
              <Text style={styles.heroStatLbl}>Reserved</Text>
            </View>
            {pendingCount > 0 && (
              <>
                <View style={styles.heroStatDiv} />
                <View style={styles.heroStatCol}>
                  <Text style={styles.heroStatVal}>{pendingCount}</Text>
                  <Text style={styles.heroStatLbl}>Pending</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── Floating Action Buttons ──────────────────────────── */}
        <View style={styles.floatActionsRow}>
          <TouchableOpacity
            style={styles.floatAddBtn}
            onPress={openTopupFlow}
            activeOpacity={0.88}
          >
            <View style={styles.floatIconWrap}>
              <ArrowDownLeft size={20} color="#FFFFFF" />
            </View>
            <Text style={styles.floatAddTitle}>Add Money</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.floatWithdrawBtn, { backgroundColor: C.card }]}
            onPress={() => setWithdrawSheetVisible(true)}
            activeOpacity={0.88}
          >
            <View style={styles.floatWithdrawIconWrap}>
              <ArrowUpRight size={20} color="#F97316" />
            </View>
            <Text style={[styles.floatWithdrawTitle, { color: C.text }]}>Withdraw</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ════════════════════════════════════════════════════
          VAULT TOP-UP MODAL (multi-step)
      ════════════════════════════════════════════════════ */}
      <Modal
        visible={topupStep !== 'idle'}
        transparent
        animationType="slide"
        onRequestClose={() => topupStep !== 'processing' && closeTopupFlow()}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => topupStep !== 'processing' && closeTopupFlow()}
        />

        {/* ── STEP: method selection ── */}
        {topupStep === 'method' && (
          <View style={[styles.sheet, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>Add Money to Vault</Text>
            <Text style={styles.sheetSub}>Choose your mobile money provider</Text>

            {(['orange_money', 'afrimoney'] as VaultTopupMethod[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.methodRow, { backgroundColor: C.bgSoft, borderColor: C.border }]}
                onPress={() => handleSelectMethod(m)}
                activeOpacity={0.88}
              >
                <View style={[styles.methodLogoWrap, { borderColor: METHOD_COLORS[m] + '33' }]}>
                  <Image
                    source={METHOD_LOGOS[m].source}
                    style={styles.methodLogo}
                    resizeMode="contain"
                    accessibilityLabel={METHOD_LOGOS[m].title}
                  />
                </View>
                <Text style={[styles.methodRowName, { color: C.text }]}>{METHOD_LOGOS[m].title}</Text>
                <ArrowUpRight size={18} color={METHOD_COLORS[m]} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: C.iconBg }]}
              onPress={closeTopupFlow}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP: amount entry ── */}
        {topupStep === 'amount' && topupMethod && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeTopupFlow} />
            <View style={[styles.sheet, { backgroundColor: C.card }]}>
              <View style={styles.sheetHandle} />

              <TouchableOpacity onPress={() => setTopupStep('method')} style={styles.backRow} activeOpacity={0.7}>
                <FontAwesome name="angle-left" size={20} color="#F97316" />
                <Text style={styles.backText}>Choose different method</Text>
              </TouchableOpacity>

              <View style={[styles.methodBadge, { borderColor: METHOD_COLORS[topupMethod] + '40' }]}>
                <Image
                  source={METHOD_LOGOS[topupMethod].source}
                  style={styles.methodBadgeLogo}
                  resizeMode="contain"
                />
              </View>

              <Text style={[styles.sheetTitle, { color: C.text, marginTop: 8 }]}>How much to add?</Text>
              <Text style={styles.sheetSub}>Minimum NLe 1.00 · Funds credited after payment confirmation</Text>

              <TextInput
                style={[styles.amountInput, { backgroundColor: C.inputBg, color: C.text, borderColor: C.border }]}
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
                value={topupAmount}
                onChangeText={setTopupAmount}
                autoFocus
              />

              {/* Quick amount chips */}
              <View style={styles.quickRow}>
                {QUICK_AMOUNTS.map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={[styles.quickChip, topupAmount === String(q) && styles.quickChipActive]}
                    onPress={() => setTopupAmount(String(q))}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.quickChipText, topupAmount === String(q) && styles.quickChipTextActive]}>
                      {q}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.continueBtn, (!topupAmount || parseFloat(topupAmount) <= 0) && styles.continueBtnDisabled]}
                onPress={() => void handleSubmitTopup()}
                disabled={!topupAmount || parseFloat(topupAmount) <= 0}
                activeOpacity={0.88}
              >
                <Text style={styles.continueBtnText}>
                  Continue — NLe {parseFloat(topupAmount || '0').toFixed(2)}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* ── STEP: processing ── */}
        {topupStep === 'processing' && (
          <View style={[styles.sheet, styles.sheetCenter, { backgroundColor: C.card }]}>
            <ActivityIndicator size="large" color="#F97316" style={{ marginBottom: 16 }} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>Creating payment code…</Text>
            <Text style={styles.sheetSub}>Please wait while we prepare your USSD payment.</Text>
          </View>
        )}

        {/* ── STEP: checkout — show USSD dial code ── */}
        {topupStep === 'checkout' && (
          <View style={[styles.sheet, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.checkoutIconWrap}>
              <Clock size={42} color="#F97316" />
            </View>
            <Text style={[styles.sheetTitle, { color: C.text }]}>Dial to Pay</Text>

            {topupResult?.ussdCode ? (
              <>
                <Text style={styles.sheetSub}>
                  Dial the code below on your {topupMethod === 'orange_money' ? 'Orange Money' : 'AfriMoney'} SIM to authorise payment of NLe {topupResult.amount?.toFixed(2) ?? '—'}.
                </Text>
                <View style={styles.ussdBox}>
                  <Text style={styles.ussdCode} selectable>{topupResult.ussdCode}</Text>
                </View>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={() => {
                    Clipboard.setString(topupResult.ussdCode ?? '');
                    Alert.alert('Copied', 'USSD code copied to clipboard.');
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.copyBtnText}>Copy Code</Text>
                </TouchableOpacity>
                <Text style={styles.ussdNote}>
                  Code expires in ~10 minutes. Your vault will be credited automatically once the payment is confirmed — do not close this screen.
                </Text>
              </>
            ) : (
              <Text style={styles.sheetSub}>
                Your payment is being processed. Tap "Check Status" to see if it has been confirmed.
              </Text>
            )}

            {topupStatus && (
              <View style={[styles.statusBox, {
                backgroundColor:
                  topupStatus.effectiveStatus === 'completed' ? '#ECFDF5' :
                  topupStatus.effectiveStatus === 'failed'    ? '#FEF2F2' : '#FFF7ED',
              }]}>
                <Text style={[styles.statusBoxText, {
                  color:
                    topupStatus.effectiveStatus === 'completed' ? '#065F46' :
                    topupStatus.effectiveStatus === 'failed'    ? '#991B1B' : '#92400E',
                }]}>
                  {topupStatus.effectiveStatus === 'completed'
                    ? 'Payment confirmed! Vault will be updated shortly.'
                    : topupStatus.effectiveStatus === 'failed'
                      ? 'Payment failed or code expired.'
                      : topupStatus.effectiveStatus === 'processing'
                        ? 'Payment received — confirming with provider…'
                        : `Status: ${topupStatus.dbStatus ?? 'pending'}`}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.continueBtn, { marginTop: topupResult?.ussdCode ? 0 : 8 }]}
              onPress={() => void pollTopupStatus()}
              disabled={topupPolling}
              activeOpacity={0.88}
            >
              {topupPolling
                ? <ActivityIndicator color="#FFFFFF" />
                : (
                  <View style={styles.btnRow}>
                    <RefreshCw size={16} color="#FFFFFF" />
                    <Text style={[styles.continueBtnText, { marginLeft: 8 }]}>Check Payment Status</Text>
                  </View>
                )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: C.iconBg, marginTop: 10 }]}
              onPress={closeTopupFlow}
            >
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP: complete ── */}
        {topupStep === 'complete' && (
          <View style={[styles.sheet, styles.sheetCenter, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />
            <CheckCircle size={52} color="#10B981" style={{ marginBottom: 16 }} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>Vault Funded!</Text>
            <Text style={styles.sheetSub}>
              {topupResult?.amount != null
                ? `NLe ${topupResult.amount.toFixed(2)} has been credited to your vault.`
                : 'Your vault has been credited.'}
            </Text>
            <TouchableOpacity style={styles.continueBtn} onPress={closeTopupFlow} activeOpacity={0.88}>
              <Text style={styles.continueBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── STEP: failed ── */}
        {topupStep === 'failed' && (
          <View style={[styles.sheet, styles.sheetCenter, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />
            <Wallet size={48} color="#EF4444" style={{ marginBottom: 16 }} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>Top-Up Failed</Text>
            <Text style={styles.sheetSub}>
              {topupResult?.error?.message ?? 'Something went wrong. Please try again.'}
            </Text>
            <TouchableOpacity style={styles.continueBtn} onPress={() => setTopupStep('method')} activeOpacity={0.88}>
              <Text style={styles.continueBtnText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: C.iconBg, marginTop: 10 }]} onPress={closeTopupFlow}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>

      {/* ════════════════════════════════════════════════════
          WITHDRAW BOTTOM SHEET
      ════════════════════════════════════════════════════ */}
      <Modal
        visible={withdrawSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setWithdrawSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setWithdrawSheetVisible(false)}
        />
        <View style={[styles.sheet, { backgroundColor: C.card }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: C.text }]}>Request Withdrawal From</Text>
          <Text style={styles.sheetSub}>Choose which account to withdraw from</Text>

          <TouchableOpacity
            style={[styles.sheetOption, { backgroundColor: C.bgSoft, borderColor: C.border }]}
            onPress={() => handleWithdraw('savings')}
            activeOpacity={0.88}
          >
            <View style={[styles.sheetOptionIcon, { backgroundColor: '#EFF6FF' }]}>
              <MaterialIcons name="savings" size={26} color="#1D4ED8" />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Savings Goal</Text>
              <Text style={styles.sheetOptionSub}>Withdraw from one of your personal savings goals</Text>
            </View>
            <View style={[styles.sheetOptionArrow, { backgroundColor: C.iconBg }]}>
              <ArrowUpRight size={18} color="#1D4ED8" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sheetOption, { backgroundColor: C.bgSoft, borderColor: C.border }]}
            onPress={() => handleWithdraw('osusu')}
            activeOpacity={0.88}
          >
            <View style={[styles.sheetOptionIcon, { backgroundColor: '#FFF7ED' }]}>
              <FontAwesome name="group" size={26} color="#F97316" />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Osusu Group</Text>
              <Text style={styles.sheetOptionSub}>Requires admin verification before processing</Text>
              <View style={styles.adminBadge}>
                <Shield size={10} color="#9A3412" strokeWidth={2} />
                <Text style={styles.adminBadgeText}>Admin verified</Text>
              </View>
            </View>
            <View style={[styles.sheetOptionArrow, { backgroundColor: C.iconBg }]}>
              <ArrowUpRight size={18} color="#F97316" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cancelBtn, { backgroundColor: C.iconBg }]}
            onPress={() => setWithdrawSheetVisible(false)}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════
          WITHDRAWAL DETAIL MODAL
      ════════════════════════════════════════════════════ */}
      <Modal
        visible={withdrawDetailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !withdrawProcessing && setWithdrawDetailVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            activeOpacity={1}
            onPress={() => !withdrawProcessing && setWithdrawDetailVisible(false)}
          />
          <View style={[styles.sheet, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>
              {withdrawType === 'savings' ? 'Savings Withdrawal' : 'Osusu Withdrawal'}
            </Text>
            <Text style={styles.sheetSub}>
              {withdrawType === 'savings'
                ? 'Select a goal and enter the amount to withdraw'
                : 'Osusu withdrawals require admin approval'}
            </Text>

            {withdrawType === 'savings' ? (
              <>
                <Text style={[styles.withdrawFieldLabel, { color: C.textSub }]}>Select Savings Goal</Text>
                {savingsGoals.filter((g) => g.status === 'active' && g.current_amount > 0).length === 0 ? (
                  <Text style={[styles.withdrawEmptyText, { color: C.textMuted }]}>
                    No goals with available balance.
                  </Text>
                ) : (
                  savingsGoals
                    .filter((g) => g.status === 'active' && g.current_amount > 0)
                    .map((g) => (
                      <TouchableOpacity
                        key={g.id}
                        style={[
                          styles.withdrawGoalRow,
                          { backgroundColor: C.bgSoft, borderColor: selectedGoalId === g.id ? '#F97316' : C.border },
                        ]}
                        onPress={() => setSelectedGoalId(g.id)}
                        activeOpacity={0.8}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.withdrawGoalName, { color: C.text }]} numberOfLines={1}>{g.title}</Text>
                          <Text style={[styles.withdrawGoalBal, { color: C.textMuted }]}>
                            Balance: NLe {g.current_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </Text>
                        </View>
                        {selectedGoalId === g.id && (
                          <View style={styles.withdrawGoalCheck}>
                            <Text style={styles.withdrawGoalCheckText}>✓</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))
                )}

                <Text style={[styles.withdrawFieldLabel, { color: C.textSub, marginTop: 12 }]}>Amount (NLe)</Text>
                <TextInput
                  style={[styles.withdrawAmountInput, { backgroundColor: C.inputBg, color: C.text, borderColor: C.border }]}
                  placeholder="0.00"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                  editable={!withdrawProcessing}
                />

                <TextInput
                  style={[styles.withdrawAmountInput, { backgroundColor: C.inputBg, color: C.text, borderColor: C.border, marginTop: 8 }]}
                  placeholder="Note (optional)"
                  placeholderTextColor={C.textMuted}
                  value={withdrawNote}
                  onChangeText={setWithdrawNote}
                  editable={!withdrawProcessing}
                />

                <TouchableOpacity
                  style={[styles.continueBtn, { marginTop: 16 }, withdrawProcessing && styles.continueBtnDisabled]}
                  onPress={() => void handleProcessWithdrawal()}
                  disabled={withdrawProcessing}
                  activeOpacity={0.88}
                >
                  {withdrawProcessing
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={styles.continueBtnText}>Submit Withdrawal Request</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.withdrawEmptyText, { color: C.textMuted, marginBottom: 20 }]}>
                  Osusu group withdrawals are processed by your group admin after cycle completion. You will be redirected to your groups.
                </Text>
                <TouchableOpacity
                  style={styles.continueBtn}
                  onPress={() => void handleProcessWithdrawal()}
                  activeOpacity={0.88}
                >
                  <Text style={styles.continueBtnText}>Go to My Groups</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: C.iconBg, marginTop: 8 }]}
              onPress={() => !withdrawProcessing && setWithdrawDetailVisible(false)}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1 },
  scrollView:    { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  /* ── Vault Balance Card ───────────────────────────────────── */
  heroSection: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#F97316',
    borderRadius: 20,
    padding: 14,
    marginBottom: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  heroDot1: {
    position: 'absolute', top: -70, right: -70,
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
  },
  heroDot2: {
    position: 'absolute', top: -20, right: -20,
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  heroLabelCol: { flex: 1 },
  heroTopLabel: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 18, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22,
  },
  heroEyeCol: { alignItems: 'center', gap: 5 },
  heroEyeBtn: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 18,
  },
  heroBadgeWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  heroBadgeRing: {
    position: 'absolute', width: 34, height: 34, borderRadius: 17,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
  },
  heroBadgeCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  heroBalanceSubLabel: {
    color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500', lineHeight: 14,
  },
  heroBalanceAmount: {
    color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34,
  },
  heroStatsRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)',
    marginTop: 8, paddingTop: 8,
  },
  heroStatCol: { flex: 1, alignItems: 'center', gap: 2 },
  heroStatVal: { fontSize: 13, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  heroStatLbl: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },
  heroStatDiv: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },

  /* ── Floating Action Buttons ────────────────────────────────── */
  floatActionsRow: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 20,
  },
  floatAddBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: '#F97316', borderRadius: 16, paddingVertical: 15,
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.38, shadowRadius: 12, elevation: 8,
  },
  floatIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  floatAddTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  floatWithdrawBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    borderRadius: 16, paddingVertical: 15, borderWidth: 1.5, borderColor: '#F97316',
    shadowColor: '#F97316', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14, shadowRadius: 8, elevation: 3,
  },
  floatWithdrawIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center',
  },
  floatWithdrawTitle: { fontSize: 14, fontWeight: '700' },

  /* ── Shared bottom sheet ────────────────────────────────────── */
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  sheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 6,
  },
  sheetCenter: { alignItems: 'center', paddingVertical: 32 },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB', alignSelf: 'center', marginTop: 10, marginBottom: 18,
  },
  sheetTitle: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sheetSub:   { fontSize: 13, color: '#9CA3AF', marginBottom: 20, lineHeight: 19 },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 18,
    padding: 16, marginBottom: 12, borderWidth: 1,
  },
  sheetOptionIcon: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  sheetOptionText: { flex: 1 },
  sheetOptionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  sheetOptionSub:   { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  sheetOptionArrow: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },

  /* ── Top-up modal specific ──────────────────────────────────── */
  methodRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 16,
    padding: 14, marginBottom: 12, borderWidth: 1,
  },
  methodLogoWrap: {
    width: 80, height: 40, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', marginRight: 14,
  },
  methodLogo: { width: 74, height: 34 },
  methodRowName: { flex: 1, fontSize: 15, fontWeight: '700' },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  backText: { fontSize: 14, color: '#F97316', fontWeight: '600' },

  methodBadge: {
    alignSelf: 'center', borderRadius: 14, borderWidth: 1,
    backgroundColor: '#FFFFFF', padding: 8, marginBottom: 4,
  },
  methodBadgeLogo: { width: 110, height: 44 },

  amountInput: {
    borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 16,
    fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 14,
  },
  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 20, justifyContent: 'center' },
  quickChip: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 22,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  quickChipActive: { backgroundColor: '#FFF7ED', borderColor: '#F97316' },
  quickChipText: { fontSize: 14, fontWeight: '700', color: '#6B7280' },
  quickChipTextActive: { color: '#F97316' },

  continueBtn: {
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center',
  },
  continueBtnDisabled: { opacity: 0.45 },
  continueBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', alignItems: 'center' },

  checkoutIconWrap: { alignItems: 'center', marginBottom: 16, marginTop: 4 },
  statusBox: { borderRadius: 12, padding: 14, marginBottom: 16 },
  statusBoxText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },

  ussdBox: {
    backgroundColor: '#1E2B5A', borderRadius: 14, paddingVertical: 18,
    paddingHorizontal: 20, marginBottom: 12, alignItems: 'center',
  },
  ussdCode: {
    color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: 2, textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  copyBtn: {
    backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: '#F97316',
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 24,
    alignSelf: 'center', marginBottom: 12,
  },
  copyBtnText: { fontSize: 14, fontWeight: '700', color: '#F97316' },
  ussdNote: {
    fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 17,
    marginBottom: 14,
  },

  cancelBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 14, marginTop: 4 },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },

  /* ── Admin badge ────────────────────────────────────────────── */
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6,
    backgroundColor: '#FEF3C7', alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  adminBadgeText: { fontSize: 10, fontWeight: '700', color: '#9A3412' },

  /* ── Withdrawal detail modal ────────────────────────────────── */
  withdrawFieldLabel: {
    fontSize: 12, fontWeight: '600', marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  withdrawGoalRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1.5,
  },
  withdrawGoalName:      { fontSize: 14, fontWeight: '600' },
  withdrawGoalBal:       { fontSize: 12, marginTop: 2 },
  withdrawGoalCheck: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#F97316',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  withdrawGoalCheckText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  withdrawAmountInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '600',
  },
  withdrawEmptyText: { fontSize: 14, lineHeight: 20 },
});
