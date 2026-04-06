import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  Image,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Users,
  BookOpen,
  History,
  Settings,
  TrendingUp,
  Calendar,
  DollarSign,
  Shield,
  Bell,
  ChevronRight,
  CheckCircle,
} from 'lucide-react-native';
import { getGroupById } from '../../../lib/groupService';
import type { OsusuGroup } from '../../../types/group';

export default function ManageGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = params.id != null ? String(params.id) : '';
  const [activeTab, setActiveTab] = useState<'ledger' | 'members' | 'contributions'>('ledger');
  const [group, setGroup] = useState<OsusuGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!groupId) {
        setIsLoading(false);
        return;
      }
      const { group: loaded } = await getGroupById(groupId);
      if (mounted) {
        setGroup(loaded);
        setIsLoading(false);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [groupId]);

  const groupData = useMemo(
    () => ({
      name: group?.name ?? 'Family Savings Circle',
      members: group?.max_members ?? 5,
      totalCollected: '0.00',
      nextPayout: group?.cycle_start_date ?? 'Pending',
      myNextDue: group?.cycle_start_date ?? 'Pending',
      contributionAmount: (group?.contribution_amount ?? 0).toFixed(2),
    }),
    [group]
  );

  const ledgerData = [
    {
      id: '1',
      memberName: 'John Doe',
      amount: '100.00',
      period: 'Week 51',
      method: 'Orange Money',
      collector: 'Sarah Miller',
      status: 'verified',
      date: 'Dec 8, 2024',
    },
    {
      id: '2',
      memberName: 'Jane Smith',
      amount: '100.00',
      period: 'Week 51',
      method: 'Cash',
      collector: 'Sarah Miller',
      status: 'collected',
      date: 'Dec 8, 2024',
    },
    {
      id: '3',
      memberName: 'Mike Johnson',
      amount: '100.00',
      period: 'Week 51',
      method: 'Pending',
      collector: '-',
      status: 'pending',
      date: 'Dec 15, 2024',
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return '#10B981';
      case 'collected': return '#F59E0B';
      case 'pending': return '#EF4444';
      case 'disputed': return '#F97316';
      default: return '#6B7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'verified': return 'Verified';
      case 'collected': return 'Collected';
      case 'pending': return 'Pending';
      case 'disputed': return 'Disputed';
      default: return 'Unknown';
    }
  };

  const renderLedgerTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.summaryCards}>
        <View style={styles.summaryCard}>
          <DollarSign size={20} color="#F97316" />
          <Text style={styles.summaryLabel}>Total Collected</Text>
          <Text style={styles.summaryValue}>NLe {groupData.totalCollected}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Calendar size={20} color="#1D4ED8" />
          <Text style={styles.summaryLabel}>Next Payout</Text>
          <Text style={styles.summaryValue}>{groupData.nextPayout}</Text>
        </View>
      </View>

      <View style={styles.ledgerHeader}>
        <Text style={styles.ledgerTitle}>Group Payment Ledger</Text>
        <TouchableOpacity style={styles.exportButton}>
          <Text style={styles.exportButtonText}>Export PDF</Text>
        </TouchableOpacity>
      </View>

      {ledgerData.map((entry) => (
        <View key={entry.id} style={styles.ledgerItem}>
          <View style={styles.memberInfo}>
            <View style={styles.memberAvatar}>
              <Text style={styles.avatarText}>
                {entry.memberName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </Text>
            </View>
            <View>
              <Text style={styles.memberName}>{entry.memberName}</Text>
              <Text style={styles.periodText}>{entry.period}</Text>
            </View>
          </View>
          <View style={styles.paymentInfo}>
            <Text style={styles.amount}>NLe {entry.amount}</Text>
            <Text style={styles.method}>{entry.method}</Text>
          </View>
          <View style={styles.statusContainer}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(entry.status) }]}>
              <Text style={styles.statusText}>{getStatusText(entry.status)}</Text>
            </View>
            <Text style={styles.date}>{entry.date}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerGroup}>
          <View style={styles.groupIcon}>
            <Image 
              source={require('../../../assets/MegaSafe Logo.png')} 
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <View>
            <Text style={styles.headerTitle}>{groupData.name}</Text>
            <Text style={styles.headerSubtitle}>
              {isLoading ? 'Loading...' : `${groupData.members} members`}
            </Text>
          </View>
        </View>
      </View>

      {/* Quick Stats */}
      <View style={styles.quickStats}>
        <View style={styles.statItem}>
          <TrendingUp size={20} color="#10B981" />
          <Text style={styles.statLabel}>My Next Due</Text>
          <Text style={styles.statValue}>{groupData.myNextDue}</Text>
        </View>
        <View style={styles.statItem}>
          <DollarSign size={20} color="#F97316" />
          <Text style={styles.statLabel}>My Amount</Text>
          <Text style={styles.statValue}>NLe {groupData.contributionAmount}</Text>
        </View>
        <TouchableOpacity style={styles.notificationButton}>
          <Bell size={20} color="#1D4ED8" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'ledger' && styles.activeTab]}
          onPress={() => setActiveTab('ledger')}
        >
          <BookOpen size={18} color={activeTab === 'ledger' ? '#F97316' : '#6B7280'} />
          <Text style={[styles.tabText, activeTab === 'ledger' && styles.activeTabText]}>
            Payment Ledger
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'members' && styles.activeTab]}
          onPress={() => setActiveTab('members')}
        >
          <Users size={18} color={activeTab === 'members' ? '#F97316' : '#6B7280'} />
          <Text style={[styles.tabText, activeTab === 'members' && styles.activeTabText]}>
            Members
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'contributions' && styles.activeTab]}
          onPress={() => setActiveTab('contributions')}
        >
          <History size={18} color={activeTab === 'contributions' ? '#F97316' : '#6B7280'} />
          <Text style={[styles.tabText, activeTab === 'contributions' && styles.activeTabText]}>
            My Contributions
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'ledger' && renderLedgerTab()}
        {activeTab === 'members' && (
          <View style={styles.tabContent}>
            <Text style={styles.tabTitle}>Group Members</Text>
            <Text style={styles.tabSubtitle}>5 active members</Text>
            
            {['John Doe', 'Jane Smith', 'Mike Johnson', 'Sarah Williams', 'Tom Brown'].map((name, index) => (
              <View key={index} style={styles.memberItem}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.avatarText}>
                    {name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                  </Text>
                </View>
                <View style={styles.memberDetails}>
                  <Text style={styles.memberName}>{name}</Text>
                  <Text style={styles.memberRole}>Member</Text>
                </View>
                <ChevronRight size={20} color="#6B7280" />
              </View>
            ))}
          </View>
        )}
        {activeTab === 'contributions' && (
          <View style={styles.tabContent}>
            <View style={styles.upcomingSection}>
              <Text style={styles.sectionTitle}>My Next Contribution</Text>
              <View style={styles.dueCard}>
                <View style={styles.dueInfo}>
                  <Text style={styles.dueLabel}>Due Date</Text>
                  <Text style={styles.dueDate}>{groupData.myNextDue}</Text>
                </View>
                <View style={styles.dueAmount}>
                  <Text style={styles.dueLabel}>Amount</Text>
                  <Text style={styles.amount}>NLe {groupData.contributionAmount}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.payButton}
                onPress={() =>
                  router.push({
                    pathname: '/(groups)/contribute',
                    params: { groupId: groupId || group?.id || '1' },
                  })
                }
              >
                <Text style={styles.payButtonText}>Pay Now</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.historySection}>
              <Text style={styles.sectionTitle}>My Contribution History</Text>
              {ledgerData.slice(0, 2).map((entry) => (
                <View key={entry.id} style={styles.historyItem}>
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyDate}>{entry.date}</Text>
                    <Text style={styles.historyPeriod}>{entry.period}</Text>
                  </View>
                  <View style={styles.historyPayment}>
                    <Text style={styles.historyAmount}>NLe {entry.amount}</Text>
                    <Text style={styles.historyMethod}>{entry.method}</Text>
                  </View>
                  <View style={[styles.historyStatus, { backgroundColor: getStatusColor(entry.status) }]}>
                    <Text style={styles.statusText}>{getStatusText(entry.status)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7F7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    padding: 8,
  },
  headerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    marginRight: 8,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666666',
  },
  quickStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 14,
    color: '#666666',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  notificationButton: {
    padding: 8,
  },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  tab: {
    padding: 8,
  },
  activeTab: {
  },
  tabText: {
    fontSize: 14,
    color: '#666666',
  },
  activeTabText: {
    color: '#F97316',
  },
  content: {
    padding: 16,
  },
  scrollContent: {
    padding: 16,
  },
  tabContent: {
    padding: 16,
  },
  summaryCards: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666666',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  ledgerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  ledgerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  exportButton: {
    padding: 8,
  },
  exportButtonText: {
    fontSize: 14,
    color: '#666666',
  },
  ledgerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 8,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  memberName: {
    fontSize: 16,
    color: '#333333',
  },
  periodText: {
    fontSize: 14,
    color: '#666666',
  },
  paymentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  method: {
    fontSize: 14,
    color: '#666666',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    padding: 4,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  date: {
    fontSize: 14,
    color: '#666666',
  },
  memberItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },
  memberDetails: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  memberRole: {
    fontSize: 14,
    color: '#666666',
  },
  upcomingSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  dueCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },
  dueInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  dueLabel: {
    fontSize: 14,
    color: '#666666',
  },
  dueDate: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  dueAmount: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  payButton: {
    padding: 16,
    backgroundColor: '#F97316',
    borderRadius: 10,
  },
  payButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  historySection: {
    padding: 16,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },
  historyInfo: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  historyDate: {
    fontSize: 14,
    color: '#666666',
  },
  historyPeriod: {
    fontSize: 14,
    color: '#666666',
  },
  historyPayment: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  historyAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  historyMethod: {
    fontSize: 14,
    color: '#666666',
  },
  historyStatus: {
    padding: 4,
    borderRadius: 10,
  },
  tabTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  tabSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
});
