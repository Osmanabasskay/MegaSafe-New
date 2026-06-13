import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  DollarSign,
  LogIn,
  LogOut,
  Settings,
  Shield,
  UserCheck,
  UserMinus,
  UserX,
} from 'lucide-react-native';
import { getCurrentUserGroupRole } from '../../../src/services/groupService';
import { supabase } from '../../../src/services/supabase';
import { useAuthStore } from '../../../src/store/authStore';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';

interface ActivityLog {
  id: string;
  type: string;
  actorName: string;
  targetName: string | null;
  description: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function activityIcon(type: string): React.ReactNode {
  const s = type.toLowerCase();
  if (s.includes('payment') || s.includes('contribution') || s.includes('payout')) return <DollarSign size={18} color={ORANGE} />;
  if (s.includes('join') || s.includes('invite')) return <LogIn size={18} color="#10B981" />;
  if (s.includes('leave') || s.includes('remove') || s.includes('suspend')) return <LogOut size={18} color="#EF4444" />;
  if (s.includes('promote') || s.includes('demote') || s.includes('admin')) return <UserCheck size={18} color="#8B5CF6" />;
  if (s.includes('setting') || s.includes('update') || s.includes('change')) return <Settings size={18} color={MUTED} />;
  if (s.includes('kick') || s.includes('ban')) return <UserX size={18} color="#EF4444" />;
  if (s.includes('kyc')) return <Shield size={18} color="#0EA5E9" />;
  return <UserMinus size={18} color={MUTED} />;
}

function activityIconBg(type: string): string {
  const s = type.toLowerCase();
  if (s.includes('payment') || s.includes('contribution') || s.includes('payout')) return '#FFF7ED';
  if (s.includes('join') || s.includes('invite')) return '#ECFDF5';
  if (s.includes('leave') || s.includes('remove') || s.includes('suspend')) return '#FEF2F2';
  if (s.includes('promote') || s.includes('demote') || s.includes('admin')) return '#F5F3FF';
  if (s.includes('kyc')) return '#F0F9FF';
  return SOFT;
}

// TODO: Replace with get_group_activity_log SECURITY DEFINER RPC when available
async function fetchGroupActivity(groupId: string): Promise<{ logs: ActivityLog[]; error: Error | null }> {
  const { data, error } = await supabase
    .from('group_activity_log')
    .select('id, type, actor_name, target_name, description, created_at, metadata')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return { logs: [], error: new Error(error.message) };
  const logs: ActivityLog[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    type: (r.type ?? 'event') as string,
    actorName: (r.actor_name ?? 'Unknown') as string,
    targetName: r.target_name as string | null,
    description: (r.description ?? '') as string,
    createdAt: r.created_at as string,
    metadata: r.metadata as Record<string, unknown> | null,
  }));
  return { logs, error: null };
}

export default function ActivityScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    if (!groupId || !user?.id) { setLoading(false); return; }
    const roleRes = await getCurrentUserGroupRole(groupId, user.id);
    const canView = roleRes.role === 'creator' || roleRes.role === 'admin';
    setIsManager(canView);
    if (!canView) { setAccessDenied(true); setLoading(false); return; }
    const activityRes = await fetchGroupActivity(groupId);
    setLogs(activityRes.logs);
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const renderLog = ({ item }: { item: ActivityLog }) => (
    <View style={styles.logCard}>
      <View style={[styles.iconWrap, { backgroundColor: activityIconBg(item.type) }]}>
        {activityIcon(item.type)}
      </View>
      <View style={styles.logBody}>
        <Text style={styles.logDesc} numberOfLines={2}>{item.description || item.type.replace(/_/g, ' ')}</Text>
        <Text style={styles.logActor}>{item.actorName}{item.targetName ? ` → ${item.targetName}` : ''}</Text>
        <Text style={styles.logDate}>{fmtDateTime(item.createdAt)}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={ORANGE} />
      </SafeAreaView>
    );
  }

  if (accessDenied) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
            <ArrowLeft size={22} color={NAVY} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Activity</Text>
          <View style={{ width: 42 }} />
        </View>
        <View style={styles.deniedWrap}>
          <Shield size={48} color={MUTED} />
          <Text style={styles.deniedTitle}>Admin Only</Text>
          <Text style={styles.deniedBody}>The activity log is only visible to group admins and the creator.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity Log</Text>
        <View style={{ width: 42 }} />
      </View>

      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        renderItem={renderLog}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>Group events will appear here as they happen.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  listContent: { paddingHorizontal: 18, paddingBottom: 40 },
  logCard: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14, flexShrink: 0 },
  logBody: { flex: 1 },
  logDesc: { color: NAVY, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  logActor: { color: MUTED, fontSize: 12, marginTop: 3 },
  logDate: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  empty: { paddingVertical: 48, alignItems: 'center' },
  emptyTitle: { color: NAVY, fontSize: 16, fontWeight: '900', marginBottom: 6 },
  emptyBody: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  deniedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  deniedTitle: { color: NAVY, fontSize: 20, fontWeight: '900' },
  deniedBody: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
