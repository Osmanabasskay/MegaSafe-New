import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  Eye,
  EyeOff,
  MoreVertical,
  TrendingUp,
  Users,
} from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { listGroupsForUser } from '../../lib/groupService';

export default function VaultScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { vaultTransactions } = useAppDataStore();
  const [showBalance, setShowBalance] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupNames, setGroupNames] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!user?.id) return;
      const { groups } = await listGroupsForUser(user.id);
      if (!mounted) return;
      setGroupNames(groups.map((group) => group.name));
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const completedTransactions = useMemo(
    () => vaultTransactions.filter((transaction) => transaction.status === 'completed'),
    [vaultTransactions]
  );

  const totals = useMemo(() => {
    const deposited = completedTransactions
      .filter((transaction) => transaction.type !== 'withdrawal')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const withdrawn = completedTransactions
      .filter((transaction) => transaction.type === 'withdrawal')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const balance = Math.max(0, deposited - withdrawn);
    return {
      balance,
      deposited,
      withdrawn,
      pending: vaultTransactions
        .filter((transaction) => transaction.status === 'pending')
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    };
  }, [completedTransactions, vaultTransactions]);

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Vault</Text>
        <TouchableOpacity onPress={() => setShowBalance((prev) => !prev)} style={styles.eyeButton}>
          {showBalance ? <Eye size={20} color="#6B7280" /> : <EyeOff size={20} color="#6B7280" />}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Balance</Text>
          <Text style={styles.balanceValue}>
            {showBalance ? `NLe ${totals.balance.toFixed(2)}` : '••••••'}
          </Text>

          <View style={styles.balanceBreakdown}>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Deposited</Text>
              <Text style={styles.breakdownValue}>
                {showBalance ? `NLe ${totals.deposited.toFixed(2)}` : '••••'}
              </Text>
            </View>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Pending</Text>
              <Text style={styles.breakdownValue}>
                {showBalance ? `NLe ${totals.pending.toFixed(2)}` : '••••'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryAction} onPress={() => router.push('/(main)/savings')}>
            <ArrowDownLeft size={18} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>Add Money</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryAction} onPress={() => router.push('/(main)/groups')}>
            <ArrowUpRight size={18} color="#F97316" />
            <Text style={styles.secondaryActionText}>Withdraw</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <TrendingUp size={18} color="#10B981" />
            <Text style={styles.statLabel}>Transactions</Text>
            <Text style={styles.statValue}>{vaultTransactions.length}</Text>
          </View>
          <View style={styles.statCard}>
            <DollarSign size={18} color="#F97316" />
            <Text style={styles.statLabel}>Contributions</Text>
            <Text style={styles.statValue}>
              {vaultTransactions.filter((transaction) => transaction.type === 'contribution').length}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Users size={18} color="#1D4ED8" />
            <Text style={styles.statLabel}>Active Groups</Text>
            <Text style={styles.statValue}>{groupNames.length}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <TouchableOpacity onPress={() => router.push('/components/notifications')}>
              <Text style={styles.sectionLink}>See Alerts</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.listCard}>
            {vaultTransactions.length > 0 ? (
              vaultTransactions.slice(0, 8).map((transaction) => {
                const isOut = transaction.type === 'withdrawal';
                return (
                  <View key={transaction.id} style={styles.transactionRow}>
                    <View style={styles.transactionLeft}>
                      <View style={[styles.transactionIcon, isOut ? styles.iconOut : styles.iconIn]}>
                        {isOut ? (
                          <ArrowUpRight size={16} color="#EF4444" />
                        ) : (
                          <ArrowDownLeft size={16} color="#10B981" />
                        )}
                      </View>
                      <View style={styles.transactionBody}>
                        <Text style={styles.transactionTitle}>{transaction.description}</Text>
                        <Text style={styles.transactionTime}>
                          {new Date(transaction.occurredAt).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.transactionRight}>
                      <Text style={[styles.transactionAmount, isOut && styles.transactionAmountOut]}>
                        {isOut ? '-' : '+'}NLe {transaction.amount.toFixed(2)}
                      </Text>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusText}>{transaction.status}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyText}>No transactions recorded yet.</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Managed Groups</Text>
            <TouchableOpacity onPress={() => router.push('/(main)/groups')}>
              <MoreVertical size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>
          <View style={styles.listCard}>
            {groupNames.length > 0 ? (
              groupNames.map((name) => (
                <View key={name} style={styles.groupRow}>
                  <Text style={styles.groupName}>{name}</Text>
                  <TouchableOpacity onPress={() => router.push('/(main)/groups')}>
                    <Text style={styles.groupLink}>Open</Text>
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>Create a group to start contributions.</Text>
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  eyeButton: {
    padding: 6,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 36,
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
  },
  balanceLabel: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 6,
  },
  balanceValue: {
    color: '#1E2B5A',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 14,
  },
  balanceBreakdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownItem: {
    flex: 1,
  },
  breakdownLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  breakdownValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 16,
  },
  primaryAction: {
    flex: 1,
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 13,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    marginLeft: 6,
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryAction: {
    flex: 1,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    paddingVertical: 13,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    marginLeft: 6,
    color: '#F97316',
    fontWeight: '700',
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statLabel: {
    marginTop: 5,
    fontSize: 11,
    color: '#6B7280',
  },
  statValue: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  section: {
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 9,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F97316',
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
  },
  transactionRow: {
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  transactionLeft: {
    flexDirection: 'row',
    flex: 1,
    marginRight: 8,
  },
  transactionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  iconIn: {
    backgroundColor: '#DCFCE7',
  },
  iconOut: {
    backgroundColor: '#FEE2E2',
  },
  transactionBody: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  transactionTime: {
    fontSize: 11,
    color: '#6B7280',
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  transactionAmountOut: {
    color: '#EF4444',
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  groupRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  groupName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  groupLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F97316',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
});

