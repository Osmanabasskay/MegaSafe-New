import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Lock,
  MapPin,
  MoreHorizontal,
  PiggyBank,
  TrendingUp,
  Users,
} from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Banner slides ────────────────────────────────────────────
const BANNER_SLIDES = [
  {
    id: '1',
    icon: MapPin,
    iconColor: '#FFFFFF',
    bg: '#3B0A00',
    title: 'Proudly Sierra\nLeone First',
    sub: 'Orange Money, AfriMoney,\nQ Money — all in one place.',
    btn: 'Learn more',
  },
  {
    id: '2',
    icon: Users,
    iconColor: '#FFFFFF',
    bg: '#1E2B5A',
    title: 'Save with Your\nCircle',
    sub: 'Join Osusu groups with family,\nfriends & colleagues.',
    btn: 'Start a group',
  },
  {
    id: '3',
    icon: Lock,
    iconColor: '#FFFFFF',
    bg: '#064E3B',
    title: 'Bank-Grade\nSecurity',
    sub: 'End-to-end encrypted.\nYour money is always safe.',
    btn: 'Learn more',
  },
  {
    id: '4',
    icon: TrendingUp,
    iconColor: '#FFFFFF',
    bg: '#4C1D95',
    title: 'Track Every\nContribution',
    sub: 'Full transparency on every\npayout and cycle.',
    btn: 'See details',
  },
];
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { getHomeSummary } from '../../src/api/reportApi';
import { fetchSavingsGoals, getVaultBalance } from '../../src/api/walletApi';

// ─── Statement helpers ────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface VaultTx {
  id: string; type: string; amount: number;
  description: string; status: string; occurredAt: string;
}
interface MonthEntry {
  year: number; month: number; label: string;
  transactions: VaultTx[]; net: number;
}
interface YearGroup { year: number; months: MonthEntry[] }

function buildStatement(txns: VaultTx[], joinDate: Date): YearGroup[] {
  const now = new Date();
  const start = new Date(joinDate.getFullYear(), joinDate.getMonth(), 1);
  const map = new Map<string, VaultTx[]>();
  let cur = new Date(start);
  while (cur <= now) {
    map.set(`${cur.getFullYear()}-${cur.getMonth()}`, []);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  for (const tx of txns) {
    const d = new Date(tx.occurredAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (map.has(key)) map.get(key)!.push(tx);
  }
  const yearMap = new Map<number, MonthEntry[]>();
  let cur2 = new Date(start);
  while (cur2 <= now) {
    const y = cur2.getFullYear(); const m = cur2.getMonth();
    const txs = map.get(`${y}-${m}`) ?? [];
    if (!yearMap.has(y)) yearMap.set(y, []);
    yearMap.get(y)!.push({
      year: y, month: m, label: MONTH_NAMES[m]!,
      transactions: txs,
      net: txs.reduce((s, t) => s + (t.type === 'withdrawal' ? -t.amount : t.amount), 0),
    });
    cur2 = new Date(y, m + 1, 1);
  }
  return Array.from(yearMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({ year, months: [...months].reverse() }));
}

// ─── Quick Action Card ────────────────────────────────────────
type ActionCardProps = {
  iconBg: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  arrowColor: string;
  onPress: () => void;
  cardBg?: string;
  titleColor?: string;
  cardBorder?: string;
};

function ActionCard({ iconBg, icon, title, subtitle, arrowColor, onPress, cardBg = '#FFFFFF', titleColor = '#1E2B5A', cardBorder = '#F3F4F6' }: ActionCardProps) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[styles.actionCard, { transform: [{ scale }] }]}>
      <TouchableOpacity
        style={[styles.actionCardInner, { backgroundColor: cardBg, borderColor: cardBorder }]}
        onPress={onPress}
        activeOpacity={1}
        onPressIn={() => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 40 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start()}
      >
        <View style={[styles.actionIconBox, { backgroundColor: iconBg }]}>{icon}</View>
        <Text style={[styles.actionCardTitle, { color: titleColor }]}>{title}</Text>
        <Text style={styles.actionCardSub}>{subtitle}</Text>
        <View style={[styles.actionArrow, { borderColor: arrowColor + '30' }]}>
          <ChevronRight size={13} color={arrowColor} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { initializeForUser } = useAppDataStore();

  const isDark = useAppDataStore((s) => s.preferences.darkMode);
  const C = isDark ? darkColors : lightColors;

  const [groupCount, setGroupCount] = useState(0);
  const [activeGoalCount, setActiveGoalCount] = useState(0);
  const [savingsProgress, setSavingsProgress] = useState(0);
  const [vaultBalance, setVaultBalance] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [balanceVisible, setBalanceVisible] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [sendSheetVisible, setSendSheetVisible] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  // Banner carousel
  const [activeBanner, setActiveBanner] = useState(0);
  const bannerRef = useRef<FlatList>(null);
  const bannerTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bannerTimer.current = setInterval(() => {
      setActiveBanner((prev) => {
        const next = (prev + 1) % BANNER_SLIDES.length;
        bannerRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 3500);
    return () => { if (bannerTimer.current) clearInterval(bannerTimer.current); };
  }, []);

  const joinDate = useMemo(() => {
    const raw = (user as { created_at?: string } | null)?.created_at;
    return raw ? new Date(raw) : new Date(new Date().getFullYear(), 0, 1);
  }, [user]);

  const [statementData, setStatementData] = useState<YearGroup[]>([]);

  const selectedEntry = useMemo((): MonthEntry | null => {
    if (!selectedMonthKey) return null;
    const [ys, ms] = selectedMonthKey.split('-');
    const y = Number(ys); const m = Number(ms);
    return statementData.find((yg) => yg.year === y)?.months.find((me) => me.month === m) ?? null;
  }, [selectedMonthKey, statementData]);

  useEffect(() => {
    initializeForUser(user);
  }, [initializeForUser, user]);

  useEffect(() => {
    let live = true;
    const run = async () => {
      if (!user?.id) return;
      setSummaryLoading(true);
      const { summary, error } = await getHomeSummary();
      if (!live) return;
      setSummaryLoading(false);
      if (!error && summary) {
        setVaultBalance(summary.savingsTotal);
        setGroupCount(summary.groups.length);
      }
      const [{ goals }, vaultResult] = await Promise.all([
        fetchSavingsGoals(user.id),
        getVaultBalance(),
      ]);
      if (!live) return;
      setActiveGoalCount(goals.filter((g) => g.status === 'active').length);
      // Progress comes pre-computed from getVaultBalance() — never recompute here.
      setSavingsProgress(vaultResult.savingsProgressPct);
      setStatementData(buildStatement([], joinDate));
    };
    void run();
    return () => { live = false; };
  }, [user?.id, joinDate]);

  const handleEyeTap = async () => {
    if (balanceVisible) { setBalanceVisible(false); return; }
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
      if (result.success) setBalanceVisible(true);
    } else {
      Alert.alert('Verify Identity', 'Confirm to view your vault balance.', [
        { text: 'Cancel', style: 'cancel', onPress: () => setGateLoading(false) },
        { text: 'Confirm', onPress: () => { setGateLoading(false); setBalanceVisible(true); } },
      ]);
    }
  };

  const openSendFlow = (type: 'group' | 'savings') => {
    setSendSheetVisible(false);
    setTimeout(() => {
      router.push({ pathname: '/(send)/select', params: { type, from: 'home' } });
    }, 220);
  };

  const openStatement = () => { setSelectedMonthKey(null); setStatementOpen(true); };
  const closeStatement = () => { setStatementOpen(false); setSelectedMonthKey(null); };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['bottom']}>
      <StatusBar barStyle={C.statusBar} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ══════════════════════════════════════════════
            OVERVIEW CARD
        ══════════════════════════════════════════════ */}
        <View style={styles.overviewCard}>
          {/* Decorative rings */}
          <View style={styles.ovRing1} pointerEvents="none" />
          <View style={styles.ovRing2} pointerEvents="none" />
          <View style={styles.ovBlob} pointerEvents="none" />

          {/* Header row */}
          <View style={styles.ovHeader}>
            <Text style={styles.ovTitle}>My Overview</Text>
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => void handleEyeTap()}
              disabled={gateLoading}
              activeOpacity={0.8}
            >
              <FontAwesome
                name={balanceVisible ? 'eye-slash' : 'eye'}
                size={18}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>

          {/* Savings progress bar */}
          <View style={styles.ovProgressTrack}>
            <View
              style={[
                styles.ovProgressFill,
                { width: `${Math.min(100, Math.max(0, savingsProgress))}%` as const },
              ]}
            />
          </View>
          <View style={styles.ovProgressMeta}>
            <Text style={styles.ovProgressLabel}>Savings progress</Text>
            <Text style={styles.ovProgressPct}>
              {balanceVisible ? `${savingsProgress.toFixed(0)}%` : '···'}
            </Text>
          </View>

          {/* Three stats — flat, no glass */}
          <View style={styles.ovStatsRow}>
            <TouchableOpacity
              style={styles.ovStatCol}
              onPress={() => router.push('/(main)/groups')}
              activeOpacity={0.8}
            >
              <FontAwesome name="group" size={26} color="rgba(255,255,255,0.85)" />
              <Text style={styles.ovStatVal}>{groupCount}</Text>
              <Text style={styles.ovStatLbl}>Osusu Groups</Text>
            </TouchableOpacity>

            <View style={styles.ovStatDiv} />

            <TouchableOpacity
              style={styles.ovStatCol}
              onPress={() => router.push('/(main)/savings')}
              activeOpacity={0.8}
            >
              <MaterialIcons name="savings" size={26} color="rgba(255,255,255,0.85)" />
              <Text style={styles.ovStatVal}>{activeGoalCount}</Text>
              <Text style={styles.ovStatLbl}>Active Goals</Text>
            </TouchableOpacity>

            <View style={styles.ovStatDiv} />

            <TouchableOpacity
              style={styles.ovStatCol}
              onPress={() => router.push('/(main)/vault')}
              activeOpacity={0.8}
            >
              <FontAwesome name="bank" size={26} color="rgba(255,255,255,0.85)" />
              <Text style={styles.ovStatVal} numberOfLines={1} adjustsFontSizeToFit>
                {balanceVisible
                  ? `NLe ${vaultBalance.toLocaleString('en-SL', { maximumFractionDigits: 0 })}`
                  : '• • •'}
              </Text>
              <Text style={styles.ovStatLbl}>Vault Balance</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ══════════════════════════════════════════════
            QUICK ACTIONS
        ══════════════════════════════════════════════ */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Actions Hub</Text>
        </View>

        <View style={styles.actionCardsRow}>
          <ActionCard
            iconBg="transparent"
            icon={<FontAwesome name="group" size={26} color="#111827" />}
            title="Osusu"
            subtitle="Manage your contributions"
            arrowColor="#111827"
            cardBg={C.card}
            titleColor={C.text}
            cardBorder={C.border}
            onPress={() => router.push('/(main)/groups')}
          />
          <ActionCard
            iconBg="transparent"
            icon={<MaterialIcons name="savings" size={26} color="#111827" />}
            title="Savings"
            subtitle="Grow your money safely"
            arrowColor="#111827"
            cardBg={C.card}
            titleColor={C.text}
            cardBorder={C.border}
            onPress={() => router.push('/(main)/savings')}
          />
          <ActionCard
            iconBg="transparent"
            icon={<FontAwesome name="bank" size={24} color="#111827" />}
            title="Vault"
            subtitle="Secure your future"
            arrowColor="#111827"
            cardBg={C.card}
            titleColor={C.text}
            cardBorder={C.border}
            onPress={() => router.push('/(main)/vault')}
          />
        </View>

        {/* ══════════════════════════════════════════════
            BANNER CAROUSEL
        ══════════════════════════════════════════════ */}
        <View style={styles.bannerWrapper}>
          <FlatList
            ref={bannerRef}
            data={BANNER_SLIDES}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH - 32,
              offset: (SCREEN_WIDTH - 32) * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (SCREEN_WIDTH - 32));
              setActiveBanner(idx);
              if (bannerTimer.current) clearInterval(bannerTimer.current);
              bannerTimer.current = setInterval(() => {
                setActiveBanner((prev) => {
                  const next = (prev + 1) % BANNER_SLIDES.length;
                  bannerRef.current?.scrollToIndex({ index: next, animated: true });
                  return next;
                });
              }, 3500);
            }}
            renderItem={({ item }) => {
              const IconComp = item.icon;
              return (
                <View style={[styles.bannerSlide, { backgroundColor: item.bg }]}>
                  <View style={styles.bannerRing1} pointerEvents="none" />
                  <View style={styles.bannerRing2} pointerEvents="none" />
                  <View style={styles.bannerContent}>
                    <View style={styles.bannerPinCircle}>
                      <IconComp size={20} color={item.iconColor} />
                    </View>
                    <Text style={styles.bannerTitle}>{item.title}</Text>
                    <Text style={styles.bannerSub}>{item.sub}</Text>
                    <TouchableOpacity style={styles.bannerBtn} activeOpacity={0.85}>
                      <Text style={styles.bannerBtnText}>{item.btn}</Text>
                      <ChevronRight size={14} color="#1E2B5A" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
          {/* Dot indicators */}
          <View style={styles.bannerDots}>
            {BANNER_SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.bannerDot,
                  i === activeBanner ? styles.bannerDotActive : styles.bannerDotInactive,
                ]}
              />
            ))}
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ── Floating action buttons (stacked) ────────────────── */}
      <View style={styles.fabStack}>
        <TouchableOpacity
          style={styles.fabSend}
          onPress={() => setSendSheetVisible(true)}
          activeOpacity={0.85}
        >
          <ArrowUpRight size={20} color="#FFFFFF" strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.fabStatement} onPress={openStatement} activeOpacity={0.85}>
          <MoreHorizontal size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* ══════════════════════════════════════════════
          SEND BOTTOM SHEET
      ══════════════════════════════════════════════ */}
      <Modal
        visible={sendSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSendSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setSendSheetVisible(false)}
        />
        <View style={[styles.sheet, { backgroundColor: C.card }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: C.text }]}>Send Money To</Text>
          <Text style={styles.sheetSub}>Choose where you want to send your money</Text>

          <TouchableOpacity
            style={styles.sheetOption}
            onPress={() => openSendFlow('group')}
            activeOpacity={0.88}
          >
            <View style={[styles.sheetOptionIcon, { backgroundColor: '#FFF7ED' }]}>
              <FontAwesome name="group" size={28} color="#111827" />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Osusu Group</Text>
              <Text style={styles.sheetOptionSub}>Contribute to one of your savings circles</Text>
            </View>
            <View style={styles.sheetOptionArrow}>
              <ArrowUpRight size={18} color="#F97316" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sheetOption}
            onPress={() => openSendFlow('savings')}
            activeOpacity={0.88}
          >
            <View style={[styles.sheetOptionIcon, { backgroundColor: '#ECFDF5' }]}>
              <MaterialIcons name="savings" size={28} color="#111827" />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={[styles.sheetOptionTitle, { color: C.text }]}>Savings Goal</Text>
              <Text style={styles.sheetOptionSub}>Deposit into one of your savings goals</Text>
            </View>
            <View style={styles.sheetOptionArrow}>
              <ArrowUpRight size={18} color="#10B981" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => setSendSheetVisible(false)}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════════
          STATEMENT SHEET
      ══════════════════════════════════════════════ */}
      <Modal
        visible={statementOpen}
        transparent
        animationType="slide"
        onRequestClose={closeStatement}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={closeStatement}
        />
        <View style={[styles.sheet, stmtStyles.sheet, { backgroundColor: C.card }]}>
          <View style={styles.sheetHandle} />

          <View style={stmtStyles.header}>
            {selectedMonthKey ? (
              <TouchableOpacity
                style={stmtStyles.backBtn}
                onPress={() => setSelectedMonthKey(null)}
              >
                <ArrowLeft size={18} color="#F97316" />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 34 }} />
            )}
            <Text style={[stmtStyles.title, { color: C.text }]} numberOfLines={1}>
              {selectedEntry
                ? `${selectedEntry.label} ${selectedEntry.year}`
                : 'Transaction Statement'}
            </Text>
            <TouchableOpacity style={stmtStyles.closeBtn} onPress={closeStatement}>
              <Text style={stmtStyles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {selectedEntry ? (
            <ScrollView style={stmtStyles.listScroll} showsVerticalScrollIndicator={false}>
              {selectedEntry.transactions.length === 0 ? (
                <Text style={stmtStyles.emptyText}>No transactions this month.</Text>
              ) : (
                selectedEntry.transactions.map((tx) => {
                  const isOut = tx.type === 'withdrawal';
                  return (
                    <View key={tx.id} style={stmtStyles.txRow}>
                      <View style={[stmtStyles.txDot, isOut ? stmtStyles.dotOut : stmtStyles.dotIn]}>
                        {isOut
                          ? <ArrowUpRight size={13} color="#EF4444" />
                          : <ArrowDownLeft size={13} color="#10B981" />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={stmtStyles.txDesc} numberOfLines={1}>{tx.description}</Text>
                        <Text style={stmtStyles.txDate}>
                          {new Date(tx.occurredAt).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[stmtStyles.txAmt, isOut && stmtStyles.txAmtOut]}>
                          {isOut ? '-' : '+'}NLe {tx.amount.toFixed(2)}
                        </Text>
                        <Text style={stmtStyles.txStatus}>{tx.status}</Text>
                      </View>
                    </View>
                  );
                })
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          ) : (
            <ScrollView style={stmtStyles.listScroll} showsVerticalScrollIndicator={false}>
              {statementData.length === 0 ? (
                <Text style={stmtStyles.emptyText}>No transactions recorded yet.</Text>
              ) : (
                statementData.map((yg) => (
                  <View key={yg.year} style={stmtStyles.yearBlock}>
                    <Text style={stmtStyles.yearLabel}>{yg.year}</Text>
                    {yg.months.map((me) => (
                      <TouchableOpacity
                        key={`${me.year}-${me.month}`}
                        style={stmtStyles.monthRow}
                        onPress={() => setSelectedMonthKey(`${me.year}-${me.month}`)}
                        activeOpacity={0.82}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={stmtStyles.monthLabel}>{me.label}</Text>
                          <Text style={stmtStyles.monthCount}>
                            {me.transactions.length} transaction
                            {me.transactions.length !== 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Text style={[stmtStyles.monthNet, me.net < 0 && stmtStyles.monthNetOut]}>
                          {me.net >= 0 ? '+' : ''}NLe {me.net.toFixed(2)}
                        </Text>
                        <ChevronRight size={15} color="#D1D5DB" style={{ marginLeft: 8 }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ))
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingBottom: 100 },

  /* ── Overview card ──────────────────────────────────────────── */
  overviewCard: {
    marginHorizontal: 16,
    backgroundColor: '#F97316',
    borderRadius: 24,
    padding: 20,
    marginBottom: 28,
    overflow: 'hidden',
    position: 'relative',
  },
  ovRing1: {
    position: 'absolute', top: -80, right: -80,
    width: 220, height: 220, borderRadius: 110,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
  },
  ovRing2: {
    position: 'absolute', top: -30, right: -30,
    width: 130, height: 130, borderRadius: 65,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  ovBlob: {
    position: 'absolute', bottom: -50, left: -50,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },

  ovHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  ovTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  eyeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
  },

  /* Progress bar */
  ovProgressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    marginBottom: 10,
  },
  ovProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  ovProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  ovProgressLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '500',
  },
  ovProgressPct: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /* Flat stats row — no glass */
  ovStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    paddingTop: 16,
  },
  ovStatCol: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  ovStatVal: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  ovStatLbl: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
  },
  ovStatDiv: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  /* ── Section header ─────────────────────────────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E2B5A',
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F97316',
  },

  /* ── Quick action cards ─────────────────────────────────────── */
  actionCardsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 28,
  },
  actionCard: {
    flex: 1,
  },
  actionCardInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    minHeight: 160,
  },
  actionIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  actionCardSub: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
    flex: 1,
  },
  actionArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginTop: 12,
  },

  /* ── Banner carousel ────────────────────────────────────────── */
  bannerWrapper: {
    marginHorizontal: 16,
    marginBottom: 0,
  },
  bannerSlide: {
    width: SCREEN_WIDTH - 32,
    borderRadius: 24,
    padding: 22,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 190,
  },
  bannerRing1: {
    position: 'absolute', top: -60, right: -60,
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  bannerRing2: {
    position: 'absolute', top: 20, right: 20,
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  bannerContent: {
    maxWidth: '70%',
  },
  bannerPinCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  bannerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 27,
    marginBottom: 8,
  },
  bannerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
    marginBottom: 16,
  },
  bannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 4,
  },
  bannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  bannerDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  bannerDot: { height: 6, borderRadius: 3 },
  bannerDotActive: { width: 20, backgroundColor: '#F97316' },
  bannerDotInactive: { width: 6, backgroundColor: '#D1D5DB' },

  /* ── Floating FAB stack ─────────────────────────────────────── */
  fabStack: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    gap: 10,
    alignItems: 'center',
  },
  fabSend: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 7,
  },
  fabStatement: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1E2B5A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },

  /* ── Shared sheet ───────────────────────────────────────────── */
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
  sheetTitle: { fontSize: 22, fontWeight: '800', color: '#1E2B5A', marginBottom: 4 },
  sheetSub: { fontSize: 13, color: '#9CA3AF', marginBottom: 22 },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8FAFC', borderRadius: 18,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  sheetOptionIcon: {
    width: 58, height: 58, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  sheetOptionText: { flex: 1 },
  sheetOptionTitle: { fontSize: 16, fontWeight: '800', color: '#1E2B5A', marginBottom: 3 },
  sheetOptionSub: { fontSize: 12, color: '#9CA3AF', lineHeight: 17 },
  sheetOptionArrow: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelBtnText: { color: '#9CA3AF', fontSize: 15, fontWeight: '700' },
});

const stmtStyles = StyleSheet.create({
  sheet: { paddingBottom: 40 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    flex: 1, textAlign: 'center',
    fontSize: 17, fontWeight: '800', color: '#1E2B5A', marginHorizontal: 6,
  },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 14, color: '#6B7280', fontWeight: '700' },
  listScroll: { maxHeight: 430 },
  emptyText: { textAlign: 'center', color: '#9CA3AF', fontSize: 14, paddingVertical: 32 },
  yearBlock: { marginBottom: 8 },
  yearLabel: {
    fontSize: 12, fontWeight: '800', color: '#9CA3AF',
    letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: 6, paddingHorizontal: 2,
  },
  monthRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8FAFC', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  monthLabel: { fontSize: 15, fontWeight: '700', color: '#1E2B5A', marginBottom: 2 },
  monthCount: { fontSize: 11, color: '#9CA3AF' },
  monthNet: { fontSize: 14, fontWeight: '800', color: '#10B981' },
  monthNetOut: { color: '#EF4444' },
  txRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6', gap: 10,
  },
  txDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dotIn: { backgroundColor: '#DCFCE7' },
  dotOut: { backgroundColor: '#FEE2E2' },
  txDesc: { fontSize: 13, fontWeight: '600', color: '#1F2937', marginBottom: 2 },
  txDate: { fontSize: 11, color: '#9CA3AF' },
  txAmt: { fontSize: 13, fontWeight: '700', color: '#10B981', marginBottom: 2 },
  txAmtOut: { color: '#EF4444' },
  txStatus: { fontSize: 9, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5 },
});
