import React, { useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, Calendar, Download, ShieldCheck, Trash2, Users } from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { deleteGroup, listGroupsForUser } from '../../src/services/groupService';
import { getGroupAdminReport } from '../../src/api/reportApi';

interface CreatorGroup {
  id: string;
  name: string;
  members: number;
  contributionAmount: number;
  nextPayout: string;
  status: string;
}

export default function CreatorDashboardScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [groups, setGroups] = useState<CreatorGroup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState({ pendingCount: 0, openDisputes: 0, projectedCycle: 0 });

  const loadCreatorGroups = async () => {
    if (!user?.id) {
      setGroups([]);
      return;
    }

    const { groups: managed } = await listGroupsForUser(user.id);
    const creatorGroups = managed
      .filter((group) => group.role === 'creator' || group.createdBy === user.id)
      .map((group) => ({
        id: group.id,
        name: group.name,
        members: group.members,
        contributionAmount: group.contributionAmount,
        nextPayout: group.nextPayout,
        status: group.status,
      }));
    setGroups(creatorGroups);

    // Fetch server-side aggregates for first group (multi-group support: extend as needed)
    if (creatorGroups.length > 0) {
      const { report } = await getGroupAdminReport(creatorGroups[0].id);
      setServerStats({
        pendingCount: Number(report?.pending_count ?? 0),
        openDisputes: Number(report?.open_disputes ?? 0),
        projectedCycle: Number(report?.projected_cycle_total ?? 0),
      });
    }
  };

  useEffect(() => {
    void loadCreatorGroups();
  }, [user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCreatorGroups();
    setRefreshing(false);
  };

  const handleDeleteGroup = (group: CreatorGroup) => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again before deleting this group.');
      return;
    }

    Alert.alert(
      'Delete group?',
      `If "${group.name}" has no members, it will be deleted now. If it has members, the request will be sent to a super admin for approval.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingGroupId(group.id);
            const { success, outcome, error } = await deleteGroup({ groupId: group.id, userId: user.id });
            setDeletingGroupId(null);

            if (!success || error) {
              Alert.alert('Group not deleted', error?.message ?? 'Unable to delete this group.');
              return;
            }

            if (outcome === 'pending_super_admin') {
              setGroups((current) =>
                current.map((item) => (item.id === group.id ? { ...item, status: 'pending' } : item))
              );
              Alert.alert(
                'Deletion pending',
                'This group has members, so the deletion request is pending super admin approval.'
              );
              return;
            }

            setGroups((current) => current.filter((item) => item.id !== group.id));
          },
        },
      ]
    );
  };

  const exportReport = async () => {
    const lines = [
      'Mi Osusu Creator Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Groups managed: ${groups.length}`,
      `Projected cycle volume: NLe ${serverStats.projectedCycle.toFixed(2)}`,
      `Pending verifications: ${serverStats.pendingCount}`,
      `Open disputes: ${serverStats.openDisputes}`,
      '',
      'Groups:',
      ...groups.map(
        (group) =>
          `- ${group.name} | members=${group.members} | contribution=NLe ${group.contributionAmount.toFixed(
            2
          )} | next payout=${group.nextPayout}`
      ),
    ];
    await Share.share({
      title: 'Mi Osusu Creator Report',
      message: lines.join('\n'),
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Creator Dashboard</Text>
        <TouchableOpacity onPress={() => void exportReport()} style={styles.iconButton}>
          <Download size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Users size={18} color="#1D4ED8" />
            <Text style={styles.summaryLabel}>Groups</Text>
            <Text style={styles.summaryValue}>{groups.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <ShieldCheck size={18} color="#10B981" />
            <Text style={styles.summaryLabel}>Pending Verify</Text>
            <Text style={styles.summaryValue}>{serverStats.pendingCount}</Text>
          </View>
          <View style={styles.summaryCard}>
            <AlertTriangle size={18} color="#EF4444" />
            <Text style={styles.summaryLabel}>Open Disputes</Text>
            <Text style={styles.summaryValue}>{serverStats.openDisputes}</Text>
          </View>
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalTitle}>Projected Collection (Current Cycle)</Text>
          <Text style={styles.totalValue}>NLe {serverStats.projectedCycle.toFixed(2)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Collection Verifications</Text>
          <View style={styles.sectionCard}>
            {serverStats.pendingCount > 0 ? (
              <Text style={styles.listTitle}>{serverStats.pendingCount} collection(s) awaiting verification</Text>
            ) : (
              <Text style={styles.emptyText}>No pending verifications.</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payout Schedule</Text>
          <View style={styles.sectionCard}>
            {groups.length > 0 ? (
              groups.map((group) => (
                <View key={group.id} style={styles.listItem}>
                  <TouchableOpacity
                    style={styles.listBody}
                    onPress={() => router.push(`/(groups)/manage/${group.id}`)}
                  >
                    <Text style={styles.listTitle}>{group.name}</Text>
                    <Text style={styles.listMeta}>
                      Members: {group.members}
                      {group.status === 'pending' ? ' • pending delete' : ''}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.scheduleRight}>
                    <Calendar size={14} color="#6B7280" />
                    <Text style={styles.scheduleDate}>{group.nextPayout}</Text>
                  </View>
                  {group.status !== 'pending' ? (
                    <TouchableOpacity
                      style={[styles.deleteButton, deletingGroupId === group.id && styles.actionButtonDisabled]}
                      disabled={deletingGroupId === group.id}
                      onPress={() => handleDeleteGroup(group)}
                    >
                      <Trash2 size={18} color="#DC2626" strokeWidth={2.6} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No groups created yet.</Text>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconButton: {
    width: 28,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 30,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  summaryLabel: {
    marginTop: 4,
    fontSize: 11,
    color: '#6B7280',
  },
  summaryValue: {
    marginTop: 2,
    fontSize: 15,
    color: '#1E2B5A',
    fontWeight: '700',
  },
  totalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  totalTitle: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 4,
  },
  totalValue: {
    color: '#1E2B5A',
    fontSize: 26,
    fontWeight: '700',
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
  },
  listItem: {
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listBody: {
    flex: 1,
    marginRight: 8,
  },
  listTitle: {
    color: '#1E2B5A',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  listMeta: {
    color: '#6B7280',
    fontSize: 12,
  },
  listAmount: {
    color: '#F97316',
    fontSize: 13,
    fontWeight: '700',
  },
  scheduleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  scheduleDate: {
    marginLeft: 4,
    color: '#6B7280',
    fontSize: 12,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 14,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
});


