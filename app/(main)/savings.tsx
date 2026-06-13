import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  AlertCircle,
  ArrowDownLeft,
  Calendar,
  CheckCircle,
  ChevronRight,
  MoreHorizontal,
  Plus,
  PlusCircle,
  Wallet,
} from 'lucide-react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import {
  deleteSavingsGoal,
  fetchSavingsGoals,
  getVaultBalance,
  formatSavingsCategory,
  type SavingsGoal,
  type SavingsGoalCategory,
} from '../../src/api/walletApi';
import {
  getVaultSummary,
  depositSavingsFromVault,
  type VaultSummary,
} from '../../src/services/vaultService';
import { EnterTransactionPinModal } from '../../src/components/security/EnterTransactionPinModal';

const CATEGORY_EMOJI: Record<SavingsGoalCategory, string> = {
  car: '🚗',
  house: '🏠',
  rent: '🏢',
  school_fees: '📚',
  business: '💼',
  travel: '✈️',
  emergency: '🚨',
  other: '💰',
};

const CATEGORY_COLOR: Record<SavingsGoalCategory, string> = {
  car: '#FEF3C7',
  house: '#FEE2E2',
  rent: '#EDE9FE',
  school_fees: '#DBEAFE',
  business: '#D1FAE5',
  travel: '#F3F4F6',
  emergency: '#FEE2E2',
  other: '#F3F4F6',
};

export default function SavingsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isDark = useAppDataStore((s) => s.preferences.darkMode);
  const C = isDark ? darkColors : lightColors;

  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [serverTotals, setServerTotals] = useState<{ totalBalance: number; activeBalance: number; completedBalance: number }>({ totalBalance: 0, activeBalance: 0, completedBalance: 0 });
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  const [statsVisible, setStatsVisible] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [goalSheetVisible, setGoalSheetVisible] = useState(false);

  // ── Fund Goal (deposit from vault) ──────────────────────────
  const [fundGoalVisible, setFundGoalVisible]       = useState(false);
  const [fundGoalAmount, setFundGoalAmount]         = useState('');
  const [fundGoalVault, setFundGoalVault]           = useState<VaultSummary | null>(null);
  const [fundGoalLoading, setFundGoalLoading]       = useState(false);
  const [fundGoalProcessing, setFundGoalProcessing] = useState(false);
  const [fundGoalSuccess, setFundGoalSuccess]       = useState(false);
  const [fundGoalPinVisible, setFundGoalPinVisible] = useState(false);
  const [fundGoalPinError, setFundGoalPinError]     = useState<string | null>(null);

  const handleEyeTap = async () => {
    if (statsVisible) { setStatsVisible(false); return; }
    setGateLoading(true);
    const hasHW = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHW && enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to view your savings',
        fallbackLabel: 'Enter PIN',
        cancelLabel: 'Cancel',
      });
      setGateLoading(false);
      if (result.success) setStatsVisible(true);
    } else {
      Alert.alert('Verify Identity', 'Confirm to view your savings details.', [
        { text: 'Cancel', style: 'cancel', onPress: () => setGateLoading(false) },
        { text: 'Confirm', onPress: () => { setGateLoading(false); setStatsVisible(true); } },
      ]);
    }
  };

  const loadSavingsGoals = async () => {
    if (!user?.id) { setSavingsGoals([]); setIsLoading(false); return; }
    const [{ goals, error }, vaultResult] = await Promise.all([
      fetchSavingsGoals(user.id),
      getVaultBalance(),
    ]);
    setSavingsGoals(goals);
    setServerTotals({
      totalBalance:     vaultResult.totalBalance,
      activeBalance:    vaultResult.activeBalance,
      completedBalance: vaultResult.completedBalance,
    });
    setErrorMessage(error?.message ?? null);
    setIsLoading(false);
  };

  useEffect(() => { void loadSavingsGoals(); }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSavingsGoals();
    setRefreshing(false);
  };

  // Totals come from server (get_vault_balance RPC) — never recomputed on the client.
  const totals = {
    totalTarget:  serverTotals.activeBalance + serverTotals.completedBalance,
    totalSaved:   serverTotals.totalBalance,
    progress:     (serverTotals.activeBalance + serverTotals.completedBalance) > 0
                    ? (serverTotals.totalBalance / (serverTotals.activeBalance + serverTotals.completedBalance)) * 100
                    : 0,
  };

  // Counts are structural (filtering by status), not financial — safe on client.
  const activeGoals    = savingsGoals.filter((g) => g.status === 'active').length;
  const completedGoals = savingsGoals.filter((g) => g.status === 'completed').length;
  const autoSaveOn     = savingsGoals.some((g) => g.auto_save_enabled);

  const openFundGoal = async (goal: SavingsGoal) => {
    setGoalSheetVisible(false);
    setSelectedGoal(goal);
    setFundGoalAmount('');
    setFundGoalVault(null);
    setFundGoalSuccess(false);
    setFundGoalLoading(true);
    setFundGoalVisible(true);

    const { summary } = await getVaultSummary();
    setFundGoalVault(summary);
    setFundGoalLoading(false);
  };

  const handleDepositFromVault = async () => {
    if (!selectedGoal) return;
    const amount = parseFloat(fundGoalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid amount greater than zero.');
      return;
    }
    if ((fundGoalVault?.availableBalance ?? 0) < amount) {
      Alert.alert(
        'Insufficient vault balance',
        'You do not have enough vault funds for this deposit. Add money to your vault first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Money to Vault', onPress: () => { setFundGoalVisible(false); router.push('/(main)/vault'); } },
        ]
      );
      return;
    }

    setFundGoalPinError(null);
    setFundGoalPinVisible(true);
  };

  const submitDepositFromVault = async (transactionPin: string) => {
    if (!selectedGoal) return;
    const amount = parseFloat(fundGoalAmount);
    setFundGoalProcessing(true);
    const { success, error } = await depositSavingsFromVault({
      goalId: selectedGoal.id,
      amount,
      transactionPin,
    });
    setFundGoalProcessing(false);

    if (!success || error) {
      setFundGoalPinError(error?.message ?? 'Unable to deposit to savings goal. Please try again.');
      return;
    }

    setFundGoalPinVisible(false);
    setFundGoalSuccess(true);
    void loadSavingsGoals();
  };

  const handleDeleteGoal = (goal: SavingsGoal) => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again before deleting this savings goal.');
      return;
    }
    Alert.alert(
      'Delete savings goal?',
      `This will permanently delete "${goal.title}" and its savings history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingGoalId(goal.id);
            const { success, error } = await deleteSavingsGoal({ goalId: goal.id, ownerId: user.id });
            setDeletingGoalId(null);
            if (!success || error) {
              Alert.alert('Goal not deleted', error?.message ?? 'Unable to delete this savings goal.');
              return;
            }
            setSavingsGoals((cur) => cur.filter((item) => item.id !== goal.id));
          },
        },
      ]
    );
  };

  const progressBarWidth = `${Math.min(100, Math.max(0, totals.progress))}%` as const;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['bottom']}>
      <StatusBar barStyle={C.statusBar} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />}
      >
        {/* ══════════════════════════════════════════
            HERO CARD
        ══════════════════════════════════════════ */}
        <View style={styles.heroCard}>
          {/* Decorative rings */}
          <View style={styles.ring1} pointerEvents="none" />
          <View style={styles.ring2} pointerEvents="none" />
          <View style={styles.blob} pointerEvents="none" />

          {/* Header */}
          <View style={styles.heroHeader}>
            <View style={styles.heroTitleRow}>
              <Text style={styles.heroTitle}>Savings Progress</Text>
            </View>
            <TouchableOpacity
              style={styles.eyePill}
              onPress={() => void handleEyeTap()}
              disabled={gateLoading}
              activeOpacity={0.8}
            >
              <FontAwesome
                name={statsVisible ? 'eye-slash' : 'eye'}
                size={18}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.heroSub}>You're doing great!</Text>

          {/* Goal dots */}
          <View style={styles.dotsRow}>
            {savingsGoals.slice(0, 6).map((g) => (
              <View
                key={g.id}
                style={[
                  styles.goalDot,
                  { backgroundColor: g.status === 'completed' ? '#FFFFFF' : 'rgba(255,255,255,0.5)' },
                ]}
              />
            ))}
            {savingsGoals.length === 0 && (
              <View style={[styles.goalDot, { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
            )}
          </View>

          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressBarWidth }]} />
          </View>
          <View style={styles.progressMeta}>
            <View style={styles.dotsMenu}>
              <MoreHorizontal size={16} color="rgba(255,255,255,0.6)" />
            </View>
            <Text style={styles.progressPct}>
              {statsVisible ? `${totals.progress.toFixed(0)}%` : '···'}
            </Text>
          </View>

          {/* Three stats — clean, no icons */}
          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statVal}>
                {statsVisible ? activeGoals : '••'}
              </Text>
              <Text style={styles.statLbl}>Active</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statCol}>
              <Text style={styles.statVal}>
                {statsVisible ? completedGoals : '••'}
              </Text>
              <Text style={styles.statLbl}>Completed</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.statCol}>
              <Text style={styles.statVal}>
                {statsVisible ? (autoSaveOn ? 'On' : 'Off') : '••'}
              </Text>
              <Text style={styles.statLbl}>Auto-Save</Text>
            </View>
          </View>
        </View>

        {/* ══════════════════════════════════════════
            GOALS LIST
        ══════════════════════════════════════════ */}
        {errorMessage ? (
          <View style={[styles.warningCard, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
            <Text style={styles.warningTitle}>Backend attention needed</Text>
            <Text style={styles.warningText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Section header */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Your Savings Goals</Text>
          <TouchableOpacity activeOpacity={0.75}>
            <Text style={styles.sectionLink}>See all {'›'}</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#F97316" />
            <Text style={[styles.loadingText, { color: C.textSub }]}>Loading savings goals…</Text>
          </View>
        ) : savingsGoals.length > 0 ? (
          <View style={[styles.goalsList, { backgroundColor: C.card }]}>
            {savingsGoals.map((goal, index) => {
              const goalPct = goal.target_amount > 0
                ? (goal.current_amount / goal.target_amount) * 100
                : 0;
              const isCompleted = goal.status === 'completed';
              const isLast = index === savingsGoals.length - 1;

              return (
                <View key={goal.id}>
                  <TouchableOpacity
                    style={styles.goalCard}
                    onPress={() => { setSelectedGoal(goal); setGoalSheetVisible(true); }}
                    activeOpacity={0.88}
                  >
                    {/* Top row */}
                    <View style={styles.goalTop}>
                      <View style={styles.goalInfo}>
                        <Text style={[styles.goalTitle, { color: C.text }]} numberOfLines={1}>
                          {goal.title}
                        </Text>
                        <View style={styles.goalMetaRow}>
                          <Text style={[styles.goalCategory, { color: C.textSub }]}>
                            {formatSavingsCategory(goal.category)}
                          </Text>
                          <Text style={[styles.goalMetaDot, { color: C.textMuted }]}> · </Text>
                          <Text style={[
                            styles.goalStatus,
                            isCompleted ? styles.goalStatusDone : styles.goalStatusActive,
                          ]}>
                            {isCompleted ? 'Completed' : 'In Progress'}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.goalRight}>
                        <Text style={[styles.goalAmount, { color: C.text }]}>
                          NLe {goal.current_amount.toFixed(2)}
                        </Text>
                        <ChevronRight size={16} color="#9CA3AF" />
                      </View>
                    </View>

                    {/* Progress bar */}
                    <View style={[styles.goalTrack, { backgroundColor: isDark ? '#334155' : '#F3F4F6' }]}>
                      <View
                        style={[
                          styles.goalFill,
                          {
                            width: `${Math.min(goalPct, 100)}%` as const,
                            backgroundColor: isCompleted ? '#10B981' : '#F97316',
                          },
                        ]}
                      />
                    </View>

                    {/* Target + percent */}
                    <View style={styles.goalProgressMeta}>
                      <Text style={[styles.goalTarget, { color: C.textSub }]}>
                        Target NLe {goal.target_amount.toFixed(2)}
                      </Text>
                      <Text style={[styles.goalPct, { color: C.textSub }]}>
                        {goalPct.toFixed(1)}%
                      </Text>
                    </View>

                    {/* Due date */}
                    <View style={styles.goalFooter}>
                      <Text style={[styles.goalDue, { color: C.textSub }]}>
                        {goal.target_date ? `Due ${goal.target_date}` : 'No target date'}
                      </Text>
                    </View>

                    {/* Auto-save row */}
                    <View style={[styles.autoSaveRow, { borderTopColor: C.border }]}>
                      <Text style={[styles.autoSaveLabel, { color: C.textMuted }]}>
                        {goal.auto_save_enabled ? 'Auto-save enabled' : 'Auto-save disabled'}
                      </Text>
                      <View style={styles.autoSaveRight}>
                        <Calendar size={11} color={C.textMuted} />
                        <Text style={[styles.autoSaveSchedule, { color: C.textMuted }]}>
                          {goal.auto_save_next_date
                            ? `${goal.auto_save_frequency === 'weekly' ? 'Weekly on' : goal.auto_save_frequency === 'monthly' ? 'Monthly on' : 'Daily'} ${goal.auto_save_next_date}`
                            : 'No schedule'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Divider between cards (same as Osusu screen) */}
                  {!isLast && <View style={[styles.cardDivider, { backgroundColor: C.border }]} />}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
            <View style={styles.emptyIconWrap}>
              <Wallet size={34} color="#F97316" strokeWidth={1.9} />
            </View>
            <Text style={[styles.emptyTitle, { color: C.text }]}>No savings goals yet</Text>
            <Text style={[styles.emptyDesc, { color: C.textSub }]}>
              Create your first savings goal and start growing your money with a clear target.
            </Text>
            <TouchableOpacity
              style={styles.emptyCreateBtn}
              onPress={() => router.push('/(main)/savings-create')}
              activeOpacity={0.86}
            >
              <Text style={styles.emptyCreateBtnText}>Create Savings</Text>
              <ChevronRight size={16} color="#FFFFFF" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 96 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(main)/savings-create')}
        activeOpacity={0.88}
      >
        <Plus size={26} color="#FFFFFF" strokeWidth={2.5} />
      </TouchableOpacity>

      {/* ══════════════════════════════════════════
          FUND GOAL — DEPOSIT FROM VAULT MODAL
      ══════════════════════════════════════════ */}
      <Modal
        visible={fundGoalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !fundGoalProcessing && setFundGoalVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableOpacity
            style={styles.sheetBackdrop}
            activeOpacity={1}
            onPress={() => !fundGoalProcessing && setFundGoalVisible(false)}
          />
          <View style={[styles.sheet, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />

            {fundGoalSuccess ? (
              /* Success state */
              <View style={styles.fundSuccessWrap}>
                <CheckCircle size={52} color="#10B981" style={{ marginBottom: 14 }} />
                <Text style={[styles.sheetGoalTitle, { color: C.text, textAlign: 'center' }]}>Deposit Successful</Text>
                <Text style={[styles.sheetOptionSub, { textAlign: 'center', marginBottom: 20 }]}>
                  NLe {parseFloat(fundGoalAmount || '0').toFixed(2)} has been deposited into{' '}
                  {selectedGoal?.title ?? 'your savings goal'}.
                </Text>
                <TouchableOpacity
                  style={styles.fundSubmitBtn}
                  onPress={() => setFundGoalVisible(false)}
                  activeOpacity={0.88}
                >
                  <Text style={styles.fundSubmitText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Goal header */}
                {selectedGoal && (
                  <View style={styles.sheetGoalHeader}>
                    <View style={styles.sheetGoalInfo}>
                      <Text style={[styles.sheetGoalTitle, { color: C.text }]} numberOfLines={1}>
                        Fund: {selectedGoal.title}
                      </Text>
                      <Text style={styles.sheetGoalAmount}>
                        Current: NLe {selectedGoal.current_amount.toFixed(2)} / NLe {selectedGoal.target_amount.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Vault balance */}
                <View style={[styles.fundVaultRow, { backgroundColor: isDark ? '#1E293B' : '#FFF7ED', borderColor: isDark ? '#334155' : '#FED7AA' }]}>
                  <Wallet size={18} color="#F97316" />
                  {fundGoalLoading ? (
                    <ActivityIndicator color="#F97316" style={{ marginLeft: 10 }} />
                  ) : (
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.fundVaultLabel, { color: C.textSub }]}>Vault Available</Text>
                      <Text style={[styles.fundVaultBal, { color: C.text }]}>
                        NLe {(fundGoalVault?.availableBalance ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Insufficient balance warning */}
                {!fundGoalLoading && fundGoalAmount && parseFloat(fundGoalAmount) > (fundGoalVault?.availableBalance ?? 0) && (
                  <View style={styles.fundInsufficientRow}>
                    <AlertCircle size={15} color="#DC2626" />
                    <Text style={styles.fundInsufficientText}>Exceeds your vault balance</Text>
                  </View>
                )}

                {/* Amount input */}
                <Text style={[styles.fundAmountLabel, { color: C.textSub }]}>Amount to Deposit (NLe)</Text>
                <TextInput
                  style={[styles.fundAmountInput, { backgroundColor: C.inputBg, color: C.text, borderColor: C.border }]}
                  placeholder="0.00"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                  value={fundGoalAmount}
                  onChangeText={setFundGoalAmount}
                  editable={!fundGoalProcessing}
                  autoFocus
                />

                <TouchableOpacity
                  style={[
                    styles.fundSubmitBtn,
                    (fundGoalProcessing || !fundGoalAmount || parseFloat(fundGoalAmount) <= 0) && styles.fundSubmitBtnDisabled,
                  ]}
                  onPress={() => void handleDepositFromVault()}
                  disabled={fundGoalProcessing || !fundGoalAmount || parseFloat(fundGoalAmount) <= 0}
                  activeOpacity={0.88}
                >
                  {fundGoalProcessing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.fundSubmitText}>
                      Deposit NLe {parseFloat(fundGoalAmount || '0').toFixed(2)} from Vault
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Add Money to Vault CTA */}
                <TouchableOpacity
                  style={styles.fundAddVaultBtn}
                  onPress={() => { setFundGoalVisible(false); router.push('/(main)/vault'); }}
                  activeOpacity={0.85}
                >
                  <PlusCircle size={16} color="#F97316" />
                  <Text style={styles.fundAddVaultText}>Add Money to Vault First</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.sheetCancelBtn}
                  onPress={() => !fundGoalProcessing && setFundGoalVisible(false)}
                >
                  <Text style={styles.sheetCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════════════════════════════════════════
          GOAL OPTIONS BOTTOM SHEET
      ══════════════════════════════════════════ */}
      <Modal
        visible={goalSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGoalSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setGoalSheetVisible(false)}
        />
        {selectedGoal && (
          <View style={[styles.sheet, { backgroundColor: C.card }]}>
            <View style={styles.sheetHandle} />

            {/* Goal header */}
            <View style={styles.sheetGoalHeader}>
              <View style={[styles.sheetGoalEmoji, { backgroundColor: isDark ? '#334155' : (CATEGORY_COLOR[selectedGoal.category] ?? '#F3F4F6') }]}>
                <Text style={styles.sheetGoalEmojiText}>
                  {selectedGoal.goal_emoji ?? CATEGORY_EMOJI[selectedGoal.category] ?? '💰'}
                </Text>
              </View>
              <View style={styles.sheetGoalInfo}>
                <Text style={[styles.sheetGoalTitle, { color: C.text }]} numberOfLines={1}>
                  {selectedGoal.title}
                </Text>
                <Text style={styles.sheetGoalAmount}>
                  NLe {selectedGoal.current_amount.toFixed(2)} saved
                </Text>
              </View>
            </View>

            {/* Fund Goal */}
            <TouchableOpacity
              style={[styles.sheetOption, { backgroundColor: C.bgSoft ?? '#F9FAFB' }]}
              onPress={() => void openFundGoal(selectedGoal)}
              activeOpacity={0.85}
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: '#FFF7ED' }]}>
                <ArrowDownLeft size={22} color="#F97316" />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Fund Goal</Text>
                <Text style={styles.sheetOptionSub}>Deposit from your vault to this goal</Text>
              </View>
              <ChevronRight size={18} color="#F97316" />
            </TouchableOpacity>

            {/* Auto-save Settings */}
            <TouchableOpacity
              style={[styles.sheetOption, { backgroundColor: C.bgSoft ?? '#F9FAFB' }]}
              onPress={() => {
                setGoalSheetVisible(false);
                Alert.alert('Auto-save Settings', 'Auto-save configuration coming soon.');
              }}
              activeOpacity={0.85}
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: '#EFF6FF' }]}>
                <Calendar size={22} color="#1D4ED8" />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Auto-save Settings</Text>
                <Text style={styles.sheetOptionSub}>
                  {selectedGoal.auto_save_enabled ? 'Auto-save is currently on' : 'Enable automated contributions'}
                </Text>
              </View>
              <ChevronRight size={18} color="#9CA3AF" />
            </TouchableOpacity>

            {/* Delete Goal */}
            <TouchableOpacity
              style={[styles.sheetDeleteOption, { backgroundColor: isDark ? '#3B0F0F' : '#FFF1F2' }]}
              onPress={() => {
                setGoalSheetVisible(false);
                setTimeout(() => handleDeleteGoal(selectedGoal), 220);
              }}
              activeOpacity={0.85}
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: '#FEE2E2' }]}>
                {deletingGoalId === selectedGoal.id ? (
                  <ActivityIndicator size="small" color="#EF4444" />
                ) : (
                  <FontAwesome name="trash-o" size={20} color="#EF4444" />
                )}
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={styles.sheetDeleteTitle}>Delete Goal</Text>
                <Text style={styles.sheetOptionSub}>Permanently remove this goal</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetCancelBtn}
              onPress={() => setGoalSheetVisible(false)}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
      <EnterTransactionPinModal
        visible={fundGoalPinVisible}
        subtitle={`Enter your Transaction PIN to move NLe ${parseFloat(fundGoalAmount || '0').toFixed(2)} from Vault to ${selectedGoal?.title ?? 'savings'}.`}
        loading={fundGoalProcessing}
        error={fundGoalPinError}
        onCancel={() => {
          setFundGoalPinVisible(false);
          setFundGoalPinError(null);
        }}
        onConfirm={submitDepositFromVault}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 36 },

  /* Hero card — compact */
  heroCard: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: '#F97316',
    borderRadius: 20,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  ring1: {
    position: 'absolute', top: -80, right: -80,
    width: 220, height: 220, borderRadius: 110,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
  },
  ring2: {
    position: 'absolute', top: -30, right: -30,
    width: 130, height: 130, borderRadius: 65,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  blob: {
    position: 'absolute', bottom: -50, left: -50,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  eyePill: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
  },
  heroSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 10,
  },

  dotsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 10,
  },
  goalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  progressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dotsMenu: { padding: 4 },
  progressPct: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: 14,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statVal: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statLbl: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '600',
  },
  statDiv: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  /* Warning */
  warningCard: {
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  warningTitle: { color: '#9A3412', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  warningText: { color: '#9A3412', fontSize: 13, lineHeight: 19 },

  /* Loading */
  loadingWrap: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  loadingText: { fontSize: 14 },

  /* Section header */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  sectionLink: { fontSize: 13, fontWeight: '700', color: '#F97316' },

  /* Goals list container */
  goalsList: {
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
  },

  /* Individual goal card — flat, like Osusu screen */
  goalCard: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 0,
  },
  goalTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  goalEmoji: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  goalEmojiText: { fontSize: 22 },
  goalInfo: { flex: 1, marginRight: 8 },
  goalTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  goalMetaRow: { flexDirection: 'row', alignItems: 'center' },
  goalCategory: { fontSize: 12 },
  goalMetaDot: { fontSize: 12 },
  goalStatus: { fontSize: 12, fontWeight: '700' },
  goalStatusDone: { color: '#10B981' },
  goalStatusActive: { color: '#F97316' },
  goalRight: { alignItems: 'flex-end', gap: 6 },
  goalAmount: { fontSize: 15, fontWeight: '700' },

  /* Progress */
  goalTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  goalFill: {
    height: '100%',
    borderRadius: 4,
  },
  goalProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  goalTarget: { fontSize: 11 },
  goalPct: { fontSize: 11 },

  /* Footer */
  goalFooter: {
    marginBottom: 12,
  },
  goalDue: { fontSize: 12 },

  /* Auto-save */
  autoSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  autoSaveLabel: { fontSize: 11 },
  autoSaveRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  autoSaveSchedule: { fontSize: 11 },

  /* Divider between goal cards */
  cardDivider: { height: 1, marginHorizontal: 16 },

  /* Empty state */
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyDesc: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingHorizontal: 20,
    minHeight: 48,
    marginTop: 4,
  },
  emptyCreateBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  /* FAB */
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },

  /* ── Fund Goal deposit modal ────────────────────────────────── */
  fundSuccessWrap: { alignItems: 'center', paddingVertical: 12 },
  fundVaultRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14,
    padding: 14, marginBottom: 14, borderWidth: 1,
  },
  fundVaultLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  fundVaultBal:   { fontSize: 20, fontWeight: '800' },
  fundInsufficientRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10, marginBottom: 10,
  },
  fundInsufficientText: { fontSize: 13, color: '#DC2626', fontWeight: '600' },
  fundAmountLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  fundAmountInput: {
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 16,
  },
  fundSubmitBtn: {
    backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15, alignItems: 'center',
  },
  fundSubmitBtnDisabled: { opacity: 0.45 },
  fundSubmitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  fundAddVaultBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: 8,
  },
  fundAddVaultText: { fontSize: 14, fontWeight: '600', color: '#F97316' },

  /* ── Goal options sheet ──────────────────────────────────── */
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)' },
  sheet: {
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
  sheetGoalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 14,
  },
  sheetGoalEmoji: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetGoalEmojiText: { fontSize: 26 },
  sheetGoalInfo: { flex: 1 },
  sheetGoalTitle: { fontSize: 17, fontWeight: '800', marginBottom: 4 },
  sheetGoalAmount: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 14,
  },
  sheetOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionText: { flex: 1 },
  sheetOptionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  sheetOptionSub: { fontSize: 12, color: '#9CA3AF', lineHeight: 17 },
  sheetDeleteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 14,
  },
  sheetDeleteTitle: { fontSize: 15, fontWeight: '700', color: '#EF4444', marginBottom: 2 },
  sheetCancelBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  sheetCancelText: { fontSize: 15, fontWeight: '700', color: '#9CA3AF' },
});
