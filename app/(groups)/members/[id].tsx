import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ImageStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, Search, UserCheck, UserMinus, UserX, X } from 'lucide-react-native';
import {
  demoteGroupAdmin,
  fetchGroupMembers,
  getCurrentUserGroupRole,
  promoteGroupAdmin,
  reactivateGroupMember,
  removeGroupMember,
  suspendGroupMember,
  type GroupMemberSummary,
} from '../../../src/services/groupService';
import { useAuthStore } from '../../../src/store/authStore';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';

type ViewerRole = 'creator' | 'admin' | 'member';
type FilterKey = 'all' | 'paid' | 'pending' | 'missed' | 'admin';

function initials(name: string): string {
  return name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function payStatusStyle(s: string): { bg: string; text: string } {
  if (s === 'paid') return { bg: '#DCFCE7', text: '#166534' };
  if (s === 'missed') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#FEF3C7', text: '#92400E' };
}

export default function MembersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [viewerRole, setViewerRole] = useState<ViewerRole>('member');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [actionTarget, setActionTarget] = useState<GroupMemberSummary | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const isManager = viewerRole === 'creator' || viewerRole === 'admin';

  const load = useCallback(async () => {
    if (!groupId) return;
    const [memberRes, roleRes] = await Promise.all([
      fetchGroupMembers(groupId),
      user?.id ? getCurrentUserGroupRole(groupId, user.id) : Promise.resolve({ role: 'member' as ViewerRole, error: null }),
    ]);
    setMembers(memberRes.members);
    setViewerRole(roleRes.role);
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(() => {
    let list = members;
    if (filter === 'admin') list = list.filter((m) => m.role === 'admin' || m.role === 'creator');
    else if (filter !== 'all') list = list.filter((m) => m.paymentStatus === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.displayName.toLowerCase().includes(q) || (m.phone ?? '').includes(q));
    }
    return list;
  }, [members, filter, search]);

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'paid', label: 'Paid' },
    { key: 'pending', label: 'Pending' },
    { key: 'missed', label: 'Missed' },
    { key: 'admin', label: 'Admins' },
  ];

  const doAction = async (action: string) => {
    if (!actionTarget) return;
    setActionLoading(true);
    let result: { success: boolean; error: Error | null } = { success: false, error: new Error('Unknown action') };

    if (action === 'promote') result = await promoteGroupAdmin(groupId, actionTarget.userId);
    else if (action === 'demote') result = await demoteGroupAdmin(groupId, actionTarget.userId);
    else if (action === 'suspend') result = await suspendGroupMember(groupId, actionTarget.id);
    else if (action === 'reactivate') result = await reactivateGroupMember(groupId, actionTarget.id);
    else if (action === 'remove') result = await removeGroupMember(groupId, actionTarget.id);

    setActionLoading(false);
    setActionTarget(null);

    if (!result.success) {
      Alert.alert('Action failed', result.error?.message ?? 'Something went wrong.');
      return;
    }
    void load();
  };

  const confirmAction = (action: string, label: string, destructive = false) => {
    if (!actionTarget) return;
    Alert.alert(
      label,
      `${label} for ${actionTarget.displayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: label, style: destructive ? 'destructive' : 'default', onPress: () => void doAction(action) },
      ],
    );
  };

  const renderMember = ({ item }: { item: GroupMemberSummary }) => {
    const ps = payStatusStyle(item.paymentStatus);
    const roleLabel = item.role === 'creator' ? 'Creator' : item.role === 'admin' ? 'Admin' : 'Member';
    return (
      <View style={styles.memberCard}>
        {item.avatarUrl
          ? <Image source={{ uri: item.avatarUrl }} style={styles.avatar as ImageStyle} />
          : <View style={styles.avatarFallback}><Text style={styles.avatarTxt}>{initials(item.displayName)}</Text></View>
        }
        <View style={styles.memberInfo}>
          <Text style={styles.memberName} numberOfLines={1}>{item.displayName}</Text>
          <Text style={styles.memberPhone} numberOfLines={1}>{item.phone ?? 'Mi Osusu member'}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, item.role !== 'member' && { backgroundColor: '#FFF7ED' }]}>
              <Text style={[styles.badgeTxt, item.role !== 'member' && { color: ORANGE }]}>{roleLabel}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: ps.bg }]}>
              <Text style={[styles.badgeTxt, { color: ps.text }]}>{item.paymentStatus.toUpperCase()}</Text>
            </View>
          </View>
        </View>
        {isManager && item.userId !== user?.id && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => setActionTarget(item)}>
            <ChevronDown size={17} color={MUTED} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isManager ? 'Members Management' : 'Members'}</Text>
        <View style={[styles.countBadge]}>
          <Text style={styles.countBadgeTxt}>{members.length}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Search size={15} color={MUTED} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or phone…"
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <X size={15} color={MUTED} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipTxt, filter === f.key && styles.filterChipTxtActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderMember}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No members found</Text>
              <Text style={styles.emptyBody}>
                {search ? `No results for "${search}"` : 'Members will appear after they join.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Admin Action Sheet */}
      <Modal visible={actionTarget !== null} transparent animationType="slide" onRequestClose={() => setActionTarget(null)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            {actionTarget && (
              <>
                <Text style={styles.sheetTitle}>{actionTarget.displayName}</Text>
                <Text style={styles.sheetSub}>{actionTarget.phone ?? 'Mi Osusu member'} · {actionTarget.role}</Text>

                {actionLoading ? (
                  <ActivityIndicator color={ORANGE} style={{ marginVertical: 24 }} />
                ) : (
                  <View style={styles.sheetActions}>
                    {actionTarget.role === 'member' && (
                      <SheetAction icon={<UserCheck size={18} color={ORANGE} />} label="Promote to Admin" onPress={() => confirmAction('promote', 'Promote to Admin')} />
                    )}
                    {actionTarget.role === 'admin' && (
                      <SheetAction icon={<UserMinus size={18} color={MUTED} />} label="Remove Admin Role" onPress={() => confirmAction('demote', 'Remove Admin Role')} />
                    )}
                    <SheetAction icon={<UserX size={18} color="#F59E0B" />} label="Suspend Member" onPress={() => confirmAction('suspend', 'Suspend Member')} />
                    <SheetAction icon={<UserCheck size={18} color="#10B981" />} label="Reactivate Member" onPress={() => confirmAction('reactivate', 'Reactivate Member')} />
                    <SheetAction icon={<UserMinus size={18} color="#EF4444" />} label="Remove from Group" danger onPress={() => confirmAction('remove', 'Remove from Group', true)} />
                  </View>
                )}

                <TouchableOpacity style={styles.sheetCancel} onPress={() => setActionTarget(null)}>
                  <Text style={styles.sheetCancelTxt}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SheetAction({ icon, label, danger, onPress }: { icon: React.ReactNode; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.sheetActionRow} onPress={onPress} activeOpacity={0.78}>
      <View style={[styles.sheetActionIcon, danger && { backgroundColor: '#FEF2F2' }]}>{icon}</View>
      <Text style={[styles.sheetActionLabel, danger && { color: '#EF4444' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED', marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '900', color: NAVY },
  countBadge: { backgroundColor: ORANGE, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countBadgeTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: SOFT, borderRadius: 14, marginHorizontal: 18, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 11, gap: 10, borderWidth: 1, borderColor: BORDER },
  searchInput: { flex: 1, fontSize: 14, color: NAVY },
  filterRow: { flexDirection: 'row', paddingHorizontal: 18, gap: 8, marginBottom: 12 },
  filterChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: SOFT, borderWidth: 1, borderColor: BORDER },
  filterChipActive: { backgroundColor: NAVY, borderColor: NAVY },
  filterChipTxt: { color: MUTED, fontSize: 12, fontWeight: '700' },
  filterChipTxtActive: { color: '#FFFFFF' },
  listContent: { paddingHorizontal: 18, paddingBottom: 32 },
  memberCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  avatar: { width: 50, height: 50, borderRadius: 25, marginRight: 12 },
  avatarFallback: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarTxt: { color: ORANGE, fontSize: 15, fontWeight: '900' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { color: NAVY, fontSize: 14, fontWeight: '800' },
  memberPhone: { color: MUTED, fontSize: 12, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#E2E8F0' },
  badgeTxt: { color: '#475569', fontSize: 10, fontWeight: '900' },
  actionBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: SOFT, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  empty: { paddingVertical: 48, alignItems: 'center' },
  emptyTitle: { color: NAVY, fontSize: 16, fontWeight: '900', marginBottom: 6 },
  emptyBody: { color: MUTED, fontSize: 13, textAlign: 'center' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: NAVY, textAlign: 'center' },
  sheetSub: { fontSize: 13, color: MUTED, textAlign: 'center', marginTop: 4, marginBottom: 18 },
  sheetActions: { gap: 4 },
  sheetActionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4 },
  sheetActionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  sheetActionLabel: { color: NAVY, fontSize: 15, fontWeight: '700' },
  sheetCancel: { marginTop: 16, paddingVertical: 14, borderRadius: 16, backgroundColor: SOFT, alignItems: 'center' },
  sheetCancelTxt: { color: MUTED, fontSize: 15, fontWeight: '700' },
});
