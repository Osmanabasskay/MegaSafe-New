import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, X } from 'lucide-react-native';
import {
  fetchGroupContributions,
  getGroupLedgerSummary,
  getCurrentUserGroupRole,
  type GroupContributionSummary,
  type GroupLedgerSummary,
} from '../../../src/services/groupService';
import { useAuthStore } from '../../../src/store/authStore';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';

type FilterKey = 'all' | 'collected' | 'pending' | 'disputed' | 'refunded';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function txStatusStyle(s: string): { bg: string; text: string } {
  if (s === 'verified' || s === 'collected') return { bg: '#DCFCE7', text: '#166534' };
  if (s === 'disputed' || s === 'refunded') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#FEF3C7', text: '#92400E' };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

export default function LedgerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [summary, setSummary] = useState<GroupLedgerSummary | null>(null);
  const [transactions, setTransactions] = useState<GroupContributionSummary[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<GroupContributionSummary | null>(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    const [summaryRes, txRes, roleRes] = await Promise.all([
      getGroupLedgerSummary(groupId),
      fetchGroupContributions(groupId),
      user?.id ? getCurrentUserGroupRole(groupId, user.id) : Promise.resolve({ role: 'member' as const, error: null }),
    ]);
    setSummary(summaryRes.summary);
    setTransactions(txRes.contributions);
    setIsManager(roleRes.role === 'creator' || roleRes.role === 'admin');
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((tx) => {
      if (filter === 'collected') return tx.status === 'collected' || tx.status === 'verified';
      return tx.status === filter;
    });
  }, [transactions, filter]);

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'collected', label: 'Collected' },
    { key: 'pending', label: 'Pending' },
    { key: 'disputed', label: 'Disputed' },
    { key: 'refunded', label: 'Refunded' },
  ];

  const SummaryCard = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
    <View style={[styles.summaryCard, accent && { backgroundColor: ORANGE }]}>
      <Text style={[styles.summaryLabel, accent && { color: 'rgba(255,255,255,0.8)' }]}>{label}</Text>
      <Text style={[styles.summaryValue, accent && { color: '#FFFFFF' }]}>{value}</Text>
    </View>
  );

  const renderTx = ({ item }: { item: GroupContributionSummary }) => {
    const ss = txStatusStyle(item.status);
    return (
      <TouchableOpacity style={styles.txCard} onPress={() => setSelected(item)} activeOpacity={0.8}>
        <View style={styles.txTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.txName} numberOfLines={1}>{item.memberName}</Text>
            <Text style={styles.txDate}>{fmtDate(item.createdAt)}</Text>
          </View>
          <Text style={styles.txAmount}>NLe {item.amount.toFixed(2)}</Text>
        </View>
        <View style={styles.txBottom}>
          <Text style={styles.txMethod} numberOfLines={1}>{item.collectionMethod.replace(/_/g, ' ')}</Text>
          <View style={[styles.badge, { backgroundColor: ss.bg }]}>
            <Text style={[styles.badgeTxt, { color: ss.text }]}>{capitalize(item.status)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ledger</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={ORANGE} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderTx}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Summary Cards */}
              {summary && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.summaryScroll} contentContainerStyle={styles.summaryRow}>
                  <SummaryCard label="Group Balance" value={`NLe ${summary.groupBalance.toFixed(0)}`} accent />
                  <SummaryCard label="Total Received" value={`NLe ${summary.totalReceived.toFixed(0)}`} />
                  <SummaryCard label="Total Expected" value={`NLe ${summary.totalExpected.toFixed(0)}`} />
                  <SummaryCard label="Outstanding" value={`NLe ${summary.outstanding.toFixed(0)}`} />
                  <SummaryCard label="Total Payouts" value={`NLe ${summary.totalPayouts.toFixed(0)}`} />
                  <SummaryCard label="Pending Payouts" value={`NLe ${summary.pendingPayouts.toFixed(0)}`} />
                  {isManager && <SummaryCard label="Penalties" value={`NLe ${summary.latePaymentPenalties.toFixed(0)}`} />}
                  {isManager && <SummaryCard label="Platform Fees" value={`NLe ${summary.platformFees.toFixed(0)}`} />}
                </ScrollView>
              )}

              {/* Filter chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={styles.filterRow}>
                {FILTERS.map((f) => (
                  <TouchableOpacity key={f.key} style={[styles.chip, filter === f.key && styles.chipActive]} onPress={() => setFilter(f.key)}>
                    <Text style={[styles.chipTxt, filter === f.key && styles.chipTxtActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.resultCount}>{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</Text>
            </>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No transactions</Text>
              <Text style={styles.emptyBody}>Contributions will appear here once members start paying.</Text>
            </View>
          }
        />
      )}

      {/* Transaction Detail Modal */}
      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {selected && (
              <>
                <View style={styles.sheetHeader}>
                  <Text style={styles.sheetTitle}>Transaction Detail</Text>
                  <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
                    <X size={18} color={MUTED} />
                  </TouchableOpacity>
                </View>
                {[
                  { label: 'Member', value: selected.memberName },
                  { label: 'Amount', value: `NLe ${selected.amount.toFixed(2)}` },
                  { label: 'Date', value: fmtDateTime(selected.createdAt) },
                  { label: 'Method', value: selected.collectionMethod.replace(/_/g, ' ') },
                  { label: 'Status', value: capitalize(selected.status) },
                  { label: 'Reference', value: selected.receiptNumber ?? selected.id },
                  { label: 'Cycle', value: selected.contributionPeriod },
                ].map((row) => (
                  <View key={row.label} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{row.label}</Text>
                    <Text style={styles.detailValue} numberOfLines={2}>{row.value}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  summaryScroll: { marginBottom: 14 },
  summaryRow: { paddingHorizontal: 18, gap: 10, paddingRight: 18 },
  summaryCard: { backgroundColor: SOFT, borderRadius: 16, padding: 14, minWidth: 130 },
  summaryLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 },
  summaryValue: { color: NAVY, fontSize: 16, fontWeight: '900' },
  filterRow: { paddingHorizontal: 18, gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: SOFT, borderWidth: 1, borderColor: BORDER },
  chipActive: { backgroundColor: NAVY, borderColor: NAVY },
  chipTxt: { color: MUTED, fontSize: 12, fontWeight: '700' },
  chipTxtActive: { color: '#FFFFFF' },
  resultCount: { color: MUTED, fontSize: 12, fontWeight: '700', paddingHorizontal: 18, marginBottom: 8 },
  listContent: { paddingBottom: 32 },
  txCard: { marginHorizontal: 18, marginBottom: 10, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, borderWidth: 1, borderColor: BORDER, shadowColor: NAVY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  txTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  txName: { color: NAVY, fontSize: 14, fontWeight: '800' },
  txDate: { color: MUTED, fontSize: 12, marginTop: 2 },
  txAmount: { color: ORANGE, fontSize: 16, fontWeight: '900' },
  txBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  txMethod: { color: MUTED, fontSize: 12, flex: 1, textTransform: 'capitalize' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 10, fontWeight: '900' },
  empty: { paddingVertical: 48, paddingHorizontal: 18, alignItems: 'center' },
  emptyTitle: { color: NAVY, fontSize: 16, fontWeight: '900', marginBottom: 6 },
  emptyBody: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: SOFT, alignItems: 'center', justifyContent: 'center' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: BORDER },
  detailLabel: { color: MUTED, fontSize: 13, fontWeight: '600' },
  detailValue: { color: NAVY, fontSize: 13, fontWeight: '800', textAlign: 'right', flexShrink: 1, marginLeft: 12 },
});
