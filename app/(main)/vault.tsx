import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  TrendingUp,
  DollarSign,
  Users,
  Calendar,
  Shield,
  Eye,
  EyeOff,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  MoreVertical,
} from 'lucide-react-native';

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'contribution';
  amount: string;
  description: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  group?: string;
}

interface Vault {
  totalBalance: string;
  availableBalance: string;
  pendingTransactions: string;
  totalContributions: string;
  thisMonth: string;
  groupsCount: number;
}

export default function VaultScreen() {
  const router = useRouter();
  const [showBalance, setShowBalance] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const vault: Vault = {
    totalBalance: '2,500.00',
    availableBalance: '2,200.00',
    pendingTransactions: '300.00',
    totalContributions: '5,000.00',
    thisMonth: '500.00',
    groupsCount: 3,
  };

  const transactions: Transaction[] = [
    {
      id: '1',
      type: 'contribution',
      amount: '100.00',
      description: 'Weekly contribution - Family Savings Circle',
      date: 'Today, 10:30 AM',
      status: 'completed',
      group: 'Family Savings Circle',
    },
    {
      id: '2',
      type: 'deposit',
      amount: '200.00',
      description: 'Emergency fund deposit',
      date: 'Yesterday, 2:15 PM',
      status: 'completed',
    },
    {
      id: '3',
      type: 'withdrawal',
      amount: '50.00',
      description: 'Personal withdrawal',
      date: 'Dec 13, 2024',
      status: 'completed',
    },
    {
      id: '4',
      type: 'contribution',
      amount: '150.00',
      description: 'Monthly contribution - Business Group',
      date: 'Dec 12, 2024',
      status: 'pending',
      group: 'Business Savings Group',
    },
    {
      id: '5',
      type: 'contribution',
      amount: '100.00',
      description: 'Weekly contribution - Family Savings Circle',
      date: 'Dec 8, 2024',
      status: 'completed',
      group: 'Family Savings Circle',
    },
  ];

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownLeft size={20} color="#10B981" />;
      case 'withdrawal':
        return <ArrowUpRight size={20} color="#EF4444" />;
      case 'contribution':
        return <Users size={20} color="#F97316" />;
      default:
        return <DollarSign size={20} color="#6B7280" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#10B981';
      case 'pending':
        return '#F59E0B';
      case 'failed':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  const renderTransaction = (transaction: Transaction) => (
    <TouchableOpacity key={transaction.id} style={styles.transactionItem}>
      <View style={styles.transactionIcon}>
        {getTransactionIcon(transaction.type)}
      </View>
      <View style={styles.transactionDetails}>
        <Text style={styles.transactionDescription}>{transaction.description}</Text>
        <Text style={styles.transactionDate}>{transaction.date}</Text>
        {transaction.group && (
          <Text style={styles.transactionGroup}>{transaction.group}</Text>
        )}
      </View>
      <View style={styles.transactionRight}>
        <Text style={[
          styles.transactionAmount,
          transaction.type === 'withdrawal' && styles.withdrawalAmount
        ]}>
          {transaction.type === 'withdrawal' ? '-' : '+'}NLe {transaction.amount}
        </Text>
        <View style={[
          styles.statusBadge,
          { backgroundColor: getStatusColor(transaction.status) }
        ]}>
          <Text style={styles.statusText}>{transaction.status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Vault</Text>
        <TouchableOpacity 
          style={styles.balanceToggle}
          onPress={() => setShowBalance(!showBalance)}
        >
          {showBalance ? (
            <Eye size={20} color="#6B7280" />
          ) : (
            <EyeOff size={20} color="#6B7280" />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeader}>
            <View style={styles.balanceInfo}>
              <Text style={styles.balanceLabel}>Total Balance</Text>
              <Text style={styles.balanceAmount}>
                {showBalance ? `NLe ${vault.totalBalance}` : '••••••'}
              </Text>
            </View>
            <Shield size={24} color="#F97316" />
          </View>
          
          <View style={styles.balanceStats}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Available</Text>
              <Text style={styles.statValue}>
                {showBalance ? `NLe ${vault.availableBalance}` : '••••'}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Pending</Text>
              <Text style={styles.statValue}>
                {showBalance ? `NLe ${vault.pendingTransactions}` : '••••'}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStats}>
          <View style={styles.statCard}>
            <TrendingUp size={20} color="#10B981" />
            <Text style={styles.statCardLabel}>This Month</Text>
            <Text style={styles.statCardValue}>NLe {vault.thisMonth}</Text>
          </View>
          <View style={styles.statCard}>
            <DollarSign size={20} color="#F97316" />
            <Text style={styles.statCardLabel}>Total Contributed</Text>
            <Text style={styles.statCardValue}>NLe {vault.totalContributions}</Text>
          </View>
          <View style={styles.statCard}>
            <Users size={20} color="#1D4ED8" />
            <Text style={styles.statCardLabel}>Active Groups</Text>
            <Text style={styles.statCardValue}>{vault.groupsCount}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/(groups)/contribute')}
          >
            <ArrowDownLeft size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Add Money</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionButton, styles.secondaryActionButton]}
            onPress={() => router.push('/(groups)/contribute')}
          >
            <ArrowUpRight size={20} color="#F97316" />
            <Text style={[styles.actionButtonText, styles.secondaryActionText]}>
              Withdraw
            </Text>
          </TouchableOpacity>
        </View>

        {/* Recent Transactions */}
        <View style={styles.transactionsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <TouchableOpacity onPress={() => router.push('/(main)/groups')}>
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.transactionsList}>
            {transactions.map(renderTransaction)}
          </View>
        </View>

        {/* Groups Overview */}
        <View style={styles.groupsSection}>
          <Text style={styles.sectionTitle}>Group Contributions</Text>
          <View style={styles.groupsList}>
            <TouchableOpacity 
              style={styles.groupItem}
              onPress={() => router.push('/(groups)/manage/1')}
            >
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>Family Savings Circle</Text>
                <Text style={styles.groupContribution}>NLe 100.00/week</Text>
              </View>
              <View style={styles.groupStatus}>
                <Text style={styles.groupStatusText}>Active</Text>
                <MoreVertical size={16} color="#6B7280" />
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.groupItem}
              onPress={() => router.push('/(groups)/manage/2')}
            >
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>Business Savings Group</Text>
                <Text style={styles.groupContribution}>NLe 150.00/month</Text>
              </View>
              <View style={styles.groupStatus}>
                <Text style={styles.groupStatusText}>Active</Text>
                <MoreVertical size={16} color="#6B7280" />
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.groupItem}
              onPress={() => router.push('/(groups)/manage/3')}
            >
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>Emergency Fund</Text>
                <Text style={styles.groupContribution}>NLe 50.00/month</Text>
              </View>
              <View style={styles.groupStatus}>
                <Text style={styles.groupStatusText}>Active</Text>
                <MoreVertical size={16} color="#6B7280" />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  balanceToggle: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  balanceInfo: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  balanceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  quickStats: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 6,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statCardLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  statCardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  actionButtons: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F97316',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginRight: 12,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  secondaryActionButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#F97316',
    marginRight: 0,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  secondaryActionText: {
    color: '#F97316',
  },
  transactionsSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  seeAllText: {
    fontSize: 14,
    color: '#F97316',
    fontWeight: '500',
  },
  transactionsList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  transactionDetails: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
    color: '#6B7280',
  },
  transactionGroup: {
    fontSize: 12,
    color: '#F97316',
    marginTop: 2,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 4,
  },
  withdrawalAmount: {
    color: '#EF4444',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  groupsSection: {
    marginBottom: 24,
  },
  groupsList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  groupContribution: {
    fontSize: 14,
    color: '#6B7280',
  },
  groupStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupStatusText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '500',
    marginRight: 8,
  },
});
