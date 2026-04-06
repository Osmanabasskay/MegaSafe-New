import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, PlusCircle, Search, ShieldAlert, Users } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { listGroupsForUser } from '../../lib/groupService';
import { getCredentialDisplayName, getProfileFirstName } from '../../lib/profileName';

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    profile,
    savingsGoals,
    vaultTransactions,
    disputes,
    initializeForUser,
    runAutoSaveSweep,
  } = useAppDataStore();
  const [groupCount, setGroupCount] = useState(0);

  useEffect(() => {
    initializeForUser(user);
    runAutoSaveSweep();
  }, [initializeForUser, runAutoSaveSweep, user]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!user?.id) return;
      const { groups } = await listGroupsForUser(user.id);
      if (mounted) setGroupCount(groups.length);
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const totalAssets = useMemo(
    () =>
      vaultTransactions
        .filter((transaction) => transaction.status === 'completed')
        .reduce((sum, transaction) => {
          if (transaction.type === 'withdrawal') return sum - transaction.amount;
          return sum + transaction.amount;
        }, 0),
    [vaultTransactions]
  );

  const recentTransactions = useMemo(() => vaultTransactions.slice(0, 4), [vaultTransactions]);
  const activeGoals = useMemo(
    () => savingsGoals.filter((goal) => goal.status === 'active').length,
    [savingsGoals]
  );
  const openDisputes = useMemo(
    () => disputes.filter((dispute) => dispute.status === 'open' || dispute.status === 'under_review').length,
    [disputes]
  );

  const displayName = getProfileFirstName(
    profile.fullName,
    getCredentialDisplayName(profile.email, profile.phone)
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerBlock}>
          <Text style={styles.greeting}>Welcome back</Text>
          <Text style={styles.name}>{displayName}</Text>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Total Secured Assets</Text>
          <Text style={styles.balanceValue}>NLe {Math.max(0, totalAssets).toFixed(2)}</Text>

          <View style={styles.balanceActions}>
            <TouchableOpacity style={styles.actionChip} onPress={() => router.push('/(main)/vault')}>
              <ArrowDownLeft size={16} color="#10B981" />
              <Text style={styles.actionText}>Deposit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionChip} onPress={() => router.push('/(main)/vault')}>
              <ArrowUpRight size={16} color="#F97316" />
              <Text style={styles.actionText}>Withdraw</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.grid}>
          <TouchableOpacity onPress={() => router.push('/(groups)/create')} style={styles.gridCard}>
            <PlusCircle size={22} color="#F97316" />
            <Text style={styles.gridTitle}>Create Group</Text>
            <Text style={styles.gridSubtitle}>Start osusu cycle</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(groups)/discover')} style={styles.gridCard}>
            <Search size={22} color="#1D4ED8" />
            <Text style={styles.gridTitle}>Discover</Text>
            <Text style={styles.gridSubtitle}>Join trusted groups</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(main)/savings')} style={styles.gridCard}>
            <PlusCircle size={22} color="#10B981" />
            <Text style={styles.gridTitle}>Savings</Text>
            <Text style={styles.gridSubtitle}>{activeGoals} active goals</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/components/disputes')} style={styles.gridCard}>
            <ShieldAlert size={22} color="#F59E0B" />
            <Text style={styles.gridTitle}>Disputes</Text>
            <Text style={styles.gridSubtitle}>{openDisputes} active cases</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dashboardCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Creator Dashboard</Text>
            <TouchableOpacity onPress={() => router.push('/(groups)/creator-dashboard')}>
              <Text style={styles.linkText}>Open</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.gridSubtitle}>{groupCount} groups managed. Track approvals and payouts.</Text>
        </View>

        <View style={styles.recentBlock}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Recent Ledger</Text>
            <TouchableOpacity onPress={() => router.push('/(main)/vault')}>
              <Text style={styles.linkText}>View All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.recentCard}>
            {recentTransactions.length > 0 ? (
              recentTransactions.map((transaction) => {
                const isOut = transaction.type === 'withdrawal';
                return (
                  <View key={transaction.id} style={styles.transactionRow}>
                    <View style={styles.transactionLeft}>
                      <View style={styles.iconCircle}>
                        {isOut ? (
                          <ArrowUpRight size={16} color="#F97316" />
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
                    <Text style={[styles.transactionAmount, isOut && styles.transactionAmountOut]}>
                      {isOut ? '-' : '+'}NLe {transaction.amount.toFixed(2)}
                    </Text>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyWrap}>
                <Users size={22} color="#9CA3AF" />
                <Text style={styles.emptyText}>No transactions yet.</Text>
              </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  headerBlock: {
    paddingTop: 12,
    marginBottom: 14,
  },
  greeting: {
    color: '#6B7280',
    fontSize: 13,
  },
  name: {
    color: '#1E2B5A',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 2,
  },
  balanceCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  balanceLabel: {
    color: '#6B7280',
    fontSize: 13,
    marginBottom: 6,
  },
  balanceValue: {
    color: '#1E2B5A',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 14,
  },
  balanceActions: {
    flexDirection: 'row',
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 10,
  },
  actionText: {
    marginLeft: 6,
    color: '#1F2937',
    fontWeight: '600',
    fontSize: 13,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  gridCard: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  gridTitle: {
    color: '#1E2B5A',
    fontWeight: '700',
    fontSize: 14,
    marginTop: 8,
  },
  gridSubtitle: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
  },
  dashboardCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#1E2B5A',
    fontSize: 16,
    fontWeight: '700',
  },
  linkText: {
    color: '#F97316',
    fontWeight: '700',
    fontSize: 12,
  },
  recentBlock: {
    marginTop: 2,
  },
  recentCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 6,
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  transactionLeft: {
    flexDirection: 'row',
    flex: 1,
    marginRight: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  transactionBody: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 13,
    color: '#1F2937',
    fontWeight: '600',
  },
  transactionTime: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  transactionAmount: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '700',
  },
  transactionAmountOut: {
    color: '#F97316',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  emptyText: {
    marginTop: 6,
    color: '#6B7280',
    fontSize: 12,
  },
});
