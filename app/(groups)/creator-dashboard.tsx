import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { AlertTriangle, ArrowLeft, Calendar, Download, ShieldCheck, Users } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { listGroupsForUser } from '../../lib/groupService';

interface CreatorGroup {
  id: string;
  name: string;
  members: number;
  contributionAmount: number;
  nextPayout: string;
}

export default function CreatorDashboardScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { disputes, vaultTransactions } = useAppDataStore();
  const [groups, setGroups] = useState<CreatorGroup[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!user?.id) return;
      const { groups: managed } = await listGroupsForUser(user.id);
      if (!mounted) return;
      setGroups(
        managed.map((group) => ({
          id: group.id,
          name: group.name,
          members: group.members,
          contributionAmount: group.contributionAmount,
          nextPayout: group.nextPayout,
        }))
      );
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const pendingCollections = useMemo(
    () =>
      vaultTransactions.filter(
        (transaction) => transaction.type === 'contribution' && transaction.status === 'pending'
      ),
    [vaultTransactions]
  );
  const openDisputes = useMemo(
    () => disputes.filter((dispute) => dispute.status === 'open' || dispute.status === 'under_review'),
    [disputes]
  );
  const totalProjectedCycle = useMemo(
    () => groups.reduce((sum, group) => sum + group.members * group.contributionAmount, 0),
    [groups]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setRefreshing(false);
  };

  const exportReport = async () => {
    const lines = [
      'MegaSafe Creator Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Groups managed: ${groups.length}`,
      `Projected cycle volume: NLe ${totalProjectedCycle.toFixed(2)}`,
      `Pending verifications: ${pendingCollections.length}`,
      `Open disputes: ${openDisputes.length}`,
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
      title: 'MegaSafe Creator Report',
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
            <Text style={styles.summaryValue}>{pendingCollections.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <AlertTriangle size={18} color="#EF4444" />
            <Text style={styles.summaryLabel}>Open Disputes</Text>
            <Text style={styles.summaryValue}>{openDisputes.length}</Text>
          </View>
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalTitle}>Projected Collection (Current Cycle)</Text>
          <Text style={styles.totalValue}>NLe {totalProjectedCycle.toFixed(2)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Collection Verifications</Text>
          <View style={styles.sectionCard}>
            {pendingCollections.length > 0 ? (
              pendingCollections.slice(0, 6).map((transaction) => (
                <View key={transaction.id} style={styles.listItem}>
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{transaction.description}</Text>
                    <Text style={styles.listMeta}>
                      {transaction.groupName || 'General'} • {new Date(transaction.occurredAt).toLocaleString()}
                    </Text>
                  </View>
                  <Text style={styles.listAmount}>NLe {transaction.amount.toFixed(2)}</Text>
                </View>
              ))
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
                <TouchableOpacity
                  key={group.id}
                  style={styles.listItem}
                  onPress={() => router.push(`/(groups)/manage/${group.id}`)}
                >
                  <View style={styles.listBody}>
                    <Text style={styles.listTitle}>{group.name}</Text>
                    <Text style={styles.listMeta}>Members: {group.members}</Text>
                  </View>
                  <View style={styles.scheduleRight}>
                    <Calendar size={14} color="#6B7280" />
                    <Text style={styles.scheduleDate}>{group.nextPayout}</Text>
                  </View>
                </TouchableOpacity>
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
});


