import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Shield,
} from 'lucide-react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { fetchSavingsGoals, getVaultBalance, processSavingsWithdrawal, type SavingsGoal } from '../../src/api/walletApi';
import { getFirstLinkedPaymentMethod } from '../../src/services/paymentMethodLinks';

// ─── Screen ─────────────────────────────────────────────────────
export default function VaultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ target?: string; goalId?: string }>();
  const { user } = useAuthStore();
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
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [totals, setTotals] = useState({ balance: 0, deposited: 0, pending: 0 });

  const [addMoneySheetVisible, setAddMoneySheetVisible] = useState(false);
  const [withdrawSheetVisible, setWithdrawSheetVisible] = useState(false);

  // ── Withdrawal detail flow ──────────────────────────────────
  const [withdrawType, setWithdrawType] = useState<'savings' | 'osusu' | null>(null);
  const [withdrawDetailVisible, setWithdrawDetailVisible] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [withdrawProcessing, setWithdrawProcessing] = useState(false);

  // ── Data ────────────────────────────────────────────────────
  const loadData = async () => {
    if (!user?.id) { setSavingsGoals([]); return; }
    const [{ goals }, vaultResult] = await Promise.all([
      fetchSavingsGoals(user.id),
      getVaultBalance(),
    ]);
    setSavingsGoals(goals);
    setTotals({
      balance:   vaultResult.totalBalance,
      deposited: vaultResult.activeBalance + vaultResult.completedBalance,
      pending:   0,
    });
  };

  useEffect(() => { void loadData(); }, [user?.id]);

  // ── Badge pulse animation ───────────────────────────────────
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

  useEffect(() => {
    if (params.target === 'savings' || params.target === 'group') {
      openAddMoneyFlow(params.target === 'savings' ? 'savings' : 'group');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.target]);


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
    const hasHW = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHW && enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to view balance',
        fallbackLabel: 'Enter PIN',
        cancelLabel: 'Cancel',
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

  // ── Add money flow ──────────────────────────────────────────
  const openAddMoneyFlow = (type: 'group' | 'savings') => {
    const first = getFirstLinkedPaymentMethod({
      mobileMoneyAccounts: linkedMobileMoneyAccounts,
      bankAccounts: linkedBankAccounts,
    });
    if (!first) {
      Alert.alert(
        'Link payment method',
        'Please link a payment method in Settings before sending money.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => router.push('/components/payment-methods') },
        ]
      );
      return;
    }
    setAddMoneySheetVisible(false);
    setTimeout(() => {
      router.push({ pathname: '/(send)/select', params: { type, from: 'vault' } });
    }, 220);
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
    // Small delay so the sheet closes before detail modal opens
    setTimeout(() => setWithdrawDetailVisible(true), 260);
  };

  const handleProcessWithdrawal = async () => {
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
      // Osusu withdrawal: navigate to groups screen where group-specific withdrawal is managed
      setWithdrawDetailVisible(false);
      router.push('/(main)/groups');
    }
  };

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
          {/* Decorative rings */}
          <View style={styles.heroDot1} pointerEvents="none" />
          <View style={styles.heroDot2} pointerEvents="none" />

          {/* Title + eye + animated badge */}
          <View style={styles.heroTopRow}>
            <View style={styles.heroLabelCol}>
              <Text style={styles.heroTopLabel}>Vault Balance</Text>
              <Text style={styles.heroBalanceSubLabel}>Total Balance</Text>
            </View>
            <View style={styles.heroEyeCol}>
              <TouchableOpacity
                style={styles.heroEyeBtn}
                onPress={() => void handleEyeTap()}
                disabled={gateLoading}
                activeOpacity={0.8}
              >
                <FontAwesome
                  name={showBalance ? 'eye-slash' : 'eye'}
                  size={18}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              {/* Animated bank badge below eye */}
              <View style={styles.heroBadgeWrap}>
                <Animated.View
                  style={[
                    styles.heroBadgeRing,
                    {
                      transform: [{ scale: badgeRing.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.35] }) }],
                      opacity: badgeRing.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.15, 0] }),
                    },
                  ]}
                />
                <Animated.View style={[styles.heroBadgeCircle, { transform: [{ scale: badgePulse }] }]}>
                  <FontAwesome name="bank" size={15} color="#F97316" />
                </Animated.View>
              </View>
            </View>
          </View>

          {/* Amount */}
          <Animated.Text
            style={[styles.heroBalanceAmount, { opacity: showBalance ? balanceAnim : 1 }]}
          >
            {showBalance
              ? `NLe ${totals.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              : 'NLe ••••••'}
          </Animated.Text>

          {/* Stats — clean, no icons */}
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStatCol}>
              <Text style={styles.heroStatVal}>{savingsGoals.length}</Text>
              <Text style={styles.heroStatLbl}>Transactions</Text>
            </View>
            <View style={styles.heroStatDiv} />
            <TouchableOpacity
              style={styles.heroStatCol}
              onPress={() => router.push('/(main)/savings')}
              activeOpacity={0.8}
            >
              <Text style={styles.heroStatVal}>{savingsGoals.length}</Text>
              <Text style={styles.heroStatLbl}>Savings Goals</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Floating Action Buttons ──────────────────────────── */}
        <View style={styles.floatActionsRow}>
          <TouchableOpacity
            style={styles.floatAddBtn}
            onPress={() => setAddMoneySheetVisible(true)}
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
          ADD MONEY BOTTOM SHEET
      ════════════════════════════════════════════════════ */}
      <Modal
        visible={addMoneySheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddMoneySheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setAddMoneySheetVisible(false)}
        />
        <View style={[styles.sheet, { backgroundColor: C.card }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: C.text }]}>Add Money To</Text>
          <Text style={styles.sheetSub}>Choose where you want to send your money</Text>

          <TouchableOpacity
            style={[styles.sheetOption, { backgroundColor: C.bgSoft, borderColor: C.border }]}
            onPress={() => openAddMoneyFlow('group')}
            activeOpacity={0.88}
          >
            <View style={[styles.sheetOptionIcon, { backgroundColor: '#FFF7ED' }]}>
              <FontAwesome name="group" size={28} color="#111827" />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Osusu Group</Text>
              <Text style={styles.sheetOptionSub}>Contribute to one of your savings circles</Text>
            </View>
            <View style={[styles.sheetOptionArrow, { backgroundColor: C.iconBg }]}>
              <ArrowUpRight size={18} color="#F97316" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sheetOption, { backgroundColor: C.bgSoft, borderColor: C.border }]}
            onPress={() => openAddMoneyFlow('savings')}
            activeOpacity={0.88}
          >
            <View style={[styles.sheetOptionIcon, { backgroundColor: '#ECFDF5' }]}>
              <MaterialIcons name="savings" size={28} color="#111827" />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Savings Goal</Text>
              <Text style={styles.sheetOptionSub}>Deposit into one of your savings goals</Text>
            </View>
            <View style={[styles.sheetOptionArrow, { backgroundColor: C.iconBg }]}>
              <ArrowUpRight size={18} color="#10B981" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cancelBtn, { backgroundColor: C.iconBg }]}
            onPress={() => setAddMoneySheetVisible(false)}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
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
          Savings: goal picker + amount → processSavingsWithdrawal RPC
          Osusu: navigate to groups screen
      ════════════════════════════════════════════════════ */}
      <Modal
        visible={withdrawDetailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !withdrawProcessing && setWithdrawDetailVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
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
                {/* Goal selector */}
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

                {/* Amount input */}
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

                {/* Optional note */}
                <TextInput
                  style={[styles.withdrawAmountInput, { backgroundColor: C.inputBg, color: C.text, borderColor: C.border, marginTop: 8 }]}
                  placeholder="Note (optional)"
                  placeholderTextColor={C.textMuted}
                  value={withdrawNote}
                  onChangeText={setWithdrawNote}
                  editable={!withdrawProcessing}
                />

                <TouchableOpacity
                  style={[styles.withdrawSubmitBtn, withdrawProcessing && styles.withdrawSubmitBtnDisabled]}
                  onPress={() => void handleProcessWithdrawal()}
                  disabled={withdrawProcessing}
                  activeOpacity={0.88}
                >
                  {withdrawProcessing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.withdrawSubmitText}>Submit Withdrawal Request</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.withdrawEmptyText, { color: C.textMuted, marginBottom: 20 }]}>
                  Osusu group withdrawals are processed by your group admin after cycle completion.
                  You will be redirected to your groups to select the relevant group.
                </Text>
                <TouchableOpacity
                  style={styles.withdrawSubmitBtn}
                  onPress={() => void handleProcessWithdrawal()}
                  activeOpacity={0.88}
                >
                  <Text style={styles.withdrawSubmitText}>Go to My Groups</Text>
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
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  /* ── Vault Balance Card — compact ───────────────────────────── */
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
  heroLabelCol: {
    flex: 1,
    gap: 0,
  },
  heroTopLabel: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 22,
  },

  /* Eye + animated badge column */
  heroEyeCol: {
    alignItems: 'center',
    gap: 5,
  },
  heroEyeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 18,
  },
  heroBadgeWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadgeRing: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  heroBadgeCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroBalanceSubLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  heroBalanceAmount: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
  },

  /* ── Hero stats ─────────────────────────────────────────────── */
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    marginTop: 8,
    paddingTop: 8,
  },
  heroStatCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  heroStatVal: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    lineHeight: 20,
  },
  heroStatLbl: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 13,
  },
  heroStatDiv: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  /* ── Floating Action Buttons ────────────────────────────────── */
  floatActionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  floatAddBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#F97316',
    borderRadius: 16,
    paddingVertical: 15,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 8,
  },
  floatIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatAddTitle: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  floatWithdrawBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 16,
    paddingVertical: 15,
    borderWidth: 1.5,
    borderColor: '#F97316',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 3,
  },
  floatWithdrawIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatWithdrawTitle: { fontSize: 14, fontWeight: '700' },

  /* ── Shared bottom sheet ────────────────────────────────────── */
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 6,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center', marginTop: 10, marginBottom: 18,
  },
  sheetTitle: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sheetSub: { fontSize: 13, color: '#9CA3AF', marginBottom: 22 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sheetOptionIcon: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  sheetOptionText: { flex: 1 },
  sheetOptionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  sheetOptionSub: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  sheetOptionArrow: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6, backgroundColor: '#FEF3C7',
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  adminBadgeText: { fontSize: 10, fontWeight: '700', color: '#9A3412' },
  cancelBtn: {
    alignItems: 'center', paddingVertical: 14,
    borderRadius: 14, marginTop: 4,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },

  /* ── Withdrawal detail modal ────────────────────────────────── */
  withdrawFieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  withdrawGoalRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1.5,
  },
  withdrawGoalName: { fontSize: 14, fontWeight: '600' },
  withdrawGoalBal: { fontSize: 12, marginTop: 2 },
  withdrawGoalCheck: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#F97316',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  withdrawGoalCheckText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  withdrawAmountInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '600',
  },
  withdrawSubmitBtn: {
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginTop: 16,
  },
  withdrawSubmitBtnDisabled: { opacity: 0.6 },
  withdrawSubmitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  withdrawEmptyText: { fontSize: 14, lineHeight: 20 },
});
