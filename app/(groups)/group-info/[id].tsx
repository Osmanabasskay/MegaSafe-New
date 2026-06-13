import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ImageStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Edit3 } from 'lucide-react-native';
import {
  fetchGroupMembers,
  getCurrentUserGroupRole,
  getGroupById,
  type GroupMemberSummary,
} from '../../../src/services/groupService';
import { useAuthStore } from '../../../src/store/authStore';
import type { OsusuGroup } from '../../../src/types/group';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#F1F5F9';

type ViewerRole = 'creator' | 'admin' | 'member';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function freqLabel(f: string): string {
  return ({ daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly' } as Record<string, string>)[f] ?? f;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export default function GroupInfoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [group, setGroup] = useState<OsusuGroup | null>(null);
  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [viewerRole, setViewerRole] = useState<ViewerRole>('member');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isManager = viewerRole === 'creator' || viewerRole === 'admin';

  const load = useCallback(async () => {
    if (!groupId) return;
    const [groupRes, memberRes, roleRes] = await Promise.all([
      getGroupById(groupId),
      fetchGroupMembers(groupId),
      user?.id ? getCurrentUserGroupRole(groupId, user.id) : Promise.resolve({ role: 'member' as ViewerRole, error: null }),
    ]);
    setGroup(groupRes.group);
    setMembers(memberRes.members);
    setViewerRole(roleRes.role);
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const admins = useMemo(() => members.filter((m) => m.role === 'creator' || m.role === 'admin'), [members]);
  const creatorName = useMemo(() => members.find((m) => m.userId === group?.created_by)?.displayName ?? '—', [members, group]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={ORANGE} />
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.emptyTitle}>Group not found</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
          <Text style={styles.primaryBtnTxt}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group Info</Text>
        {isManager ? (
          <TouchableOpacity
            style={styles.roundBtn}
            onPress={() => router.push({ pathname: '/(groups)/group-settings/[id]' as never, params: { id: groupId } })}
          >
            <Edit3 size={19} color={ORANGE} />
          </TouchableOpacity>
        ) : <View style={{ width: 42 }} />}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <View style={styles.identityCard}>
          {group.avatar_url
            ? <Image source={{ uri: group.avatar_url }} style={styles.avatar as ImageStyle} />
            : <View style={styles.avatarFallback}><Text style={styles.avatarTxt}>{initials(group.name)}</Text></View>
          }
          <Text style={styles.groupName}>{group.name}</Text>
          {group.description ? <Text style={styles.groupDesc}>{group.description}</Text> : null}
        </View>

        {/* Basic Info */}
        <Section title="Basic Information">
          <Row label="Group Type" value={group.is_public ? 'Public' : 'Private'} />
          <Row label="Status" value={capitalize(group.status)} />
          <Row label="Created By" value={creatorName} />
          <Row label="Created Date" value={fmtDate(group.created_at)} />
          <Row label="Member Count" value={`${members.length} / ${group.max_members}`} last />
        </Section>

        {/* Contribution Rules */}
        <Section title="Contribution Rules">
          <Row label="Amount" value={`NLe ${group.contribution_amount.toFixed(2)}`} />
          <Row label="Frequency" value={freqLabel(group.frequency)} />
          <Row label="Total Cycles" value={`${group.total_cycles}`} />
          <Row label="Max Members" value={`${group.max_members}`} last />
        </Section>

        {/* Schedule */}
        <Section title="Schedule">
          <Row label="Cycle Start" value={fmtDate(group.cycle_start_date)} />
          <Row label="Collection Order" value={capitalize(group.payout_order)} />
          <Row label="Join Approval" value={group.join_requires_approval ? 'Required' : 'Not required'} last />
        </Section>

        {/* Rules */}
        {group.custom_rules ? (
          <Section title="Custom Rules">
            <View style={styles.rulesBox}>
              <Text style={styles.rulesText}>{group.custom_rules}</Text>
            </View>
          </Section>
        ) : null}

        {/* Invite Code */}
        <Section title="Invite Code">
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{group.invite_code}</Text>
          </View>
        </Section>

        {/* Admins */}
        <Section title={`Admins & Creator (${admins.length})`}>
          {admins.length === 0
            ? <Text style={styles.emptyNote}>No admins found</Text>
            : admins.map((admin, idx) => (
              <View key={admin.id} style={[styles.adminRow, idx < admins.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
                <View style={styles.adminAvatar}>
                  <Text style={styles.adminAvatarTxt}>{initials(admin.displayName)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adminName}>{admin.displayName}</Text>
                  <Text style={styles.adminRole}>{admin.role === 'creator' ? 'Creator' : 'Admin'}</Text>
                </View>
              </View>
            ))
          }
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 12, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  identityCard: { alignItems: 'center', paddingVertical: 14 },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#FDBA74' },
  avatarFallback: { width: 80, height: 80, borderRadius: 40, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#FFFFFF', fontSize: 26, fontWeight: '900' },
  groupName: { color: NAVY, fontSize: 20, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  groupDesc: { color: MUTED, fontSize: 13, marginTop: 5, textAlign: 'center', lineHeight: 19 },
  section: { marginBottom: 18 },
  sectionTitle: { color: MUTED, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  sectionCard: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { color: MUTED, fontSize: 13, fontWeight: '600', flex: 1 },
  rowValue: { color: NAVY, fontSize: 13, fontWeight: '800', textAlign: 'right', flexShrink: 1, marginLeft: 12 },
  rulesBox: { padding: 16 },
  rulesText: { color: NAVY, fontSize: 13, lineHeight: 20 },
  codeBox: { paddingVertical: 20, alignItems: 'center' },
  codeText: { color: ORANGE, fontSize: 24, fontWeight: '900', letterSpacing: 4 },
  adminRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  adminAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  adminAvatarTxt: { color: ORANGE, fontSize: 14, fontWeight: '900' },
  adminName: { color: NAVY, fontSize: 14, fontWeight: '800' },
  adminRole: { color: MUTED, fontSize: 12, marginTop: 2 },
  emptyNote: { color: MUTED, fontSize: 13, padding: 16, textAlign: 'center' },
  emptyTitle: { color: NAVY, fontSize: 17, fontWeight: '900' },
  primaryBtn: { backgroundColor: ORANGE, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 12 },
  primaryBtnTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
