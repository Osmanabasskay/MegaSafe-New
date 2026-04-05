import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Users,
  MessageCircle,
  Phone,
  MoreVertical,
  Plus,
  Search,
  TrendingUp,
  DollarSign,
  Calendar,
} from 'lucide-react-native';

interface Group {
  id: string;
  name: string;
  members: number;
  contribution: string;
  frequency: string;
  lastActivity: string;
  unreadCount?: number;
  totalCollected: string;
  nextPayout: string;
  role: 'member' | 'admin' | 'creator';
}

export default function GroupsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const groups: Group[] = [
    {
      id: '1',
      name: 'Family Savings Circle',
      members: 5,
      contribution: 'NLe 100',
      frequency: 'Weekly',
      lastActivity: '2 hours ago',
      unreadCount: 3,
      totalCollected: '500.00',
      nextPayout: 'Dec 20, 2024',
      role: 'member',
    },
    {
      id: '2',
      name: 'Business Savings Group',
      members: 8,
      contribution: 'NLe 150',
      frequency: 'Monthly',
      lastActivity: '1 day ago',
      totalCollected: '1,200.00',
      nextPayout: 'Jan 15, 2025',
      role: 'admin',
    },
    {
      id: '3',
      name: 'Emergency Fund',
      members: 12,
      contribution: 'NLe 50',
      frequency: 'Monthly',
      lastActivity: '3 days ago',
      totalCollected: '600.00',
      nextPayout: 'Jan 1, 2025',
      role: 'member',
    },
  ];

  const filteredGroups = groups.filter(group => 
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  const renderGroup = (group: Group) => (
    <TouchableOpacity
      key={group.id}
      style={styles.groupItem}
      onPress={() => router.push(`/(groups)/manage/${group.id}`)}
    >
      <View style={styles.groupInfo}>
        <View style={styles.groupHeader}>
          <Text style={styles.groupName}>{group.name}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{group.role}</Text>
          </View>
        </View>
        <View style={styles.groupDetails}>
          <View style={styles.detailItem}>
            <Users size={14} color="#6B7280" />
            <Text style={styles.detailText}>{group.members} members</Text>
          </View>
          <View style={styles.detailItem}>
            <DollarSign size={14} color="#6B7280" />
            <Text style={styles.detailText}>{group.contribution}/{group.frequency}</Text>
          </View>
        </View>
        <View style={styles.groupStats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Total Collected</Text>
            <Text style={styles.statValue}>NLe {group.totalCollected}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Next Payout</Text>
            <Text style={styles.statValue}>{group.nextPayout}</Text>
          </View>
        </View>
        <Text style={styles.lastActivity}>Last activity: {group.lastActivity}</Text>
      </View>
      
      <View style={styles.groupActions}>
        <TouchableOpacity 
          style={styles.chatButton}
          onPress={() => router.push(`/(groups)/manage/${group.id}`)}
        >
          <MessageCircle size={20} color="#F97316" />
          {group.unreadCount && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadCount}>{group.unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.moreButton}>
          <MoreVertical size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Groups</Text>
        <TouchableOpacity 
          style={styles.createButton}
          onPress={() => router.push('/(groups)/create')}
        >
          <Plus size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Search size={20} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search groups..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Quick Stats */}
      <View style={styles.quickStats}>
        <View style={styles.statCard}>
          <Users size={20} color="#F97316" />
          <Text style={styles.statCardTitle}>Total Groups</Text>
          <Text style={styles.statCardValue}>{groups.length}</Text>
        </View>
        <View style={styles.statCard}>
          <DollarSign size={20} color="#10B981" />
          <Text style={styles.statCardTitle}>Total Saved</Text>
          <Text style={styles.statCardValue}>NLe 2,300</Text>
        </View>
        <View style={styles.statCard}>
          <Calendar size={20} color="#1D4ED8" />
          <Text style={styles.statCardTitle}>This Month</Text>
          <Text style={styles.statCardValue}>NLe 300</Text>
        </View>
      </View>

      {/* Groups List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>Active Groups</Text>
        {filteredGroups.map(renderGroup)}
        
        <TouchableOpacity 
          style={styles.createGroupCard}
          onPress={() => router.push('/(groups)/create')}
        >
          <View style={styles.createGroupContent}>
            <View style={styles.createGroupIcon}>
              <Plus size={24} color="#F97316" />
            </View>
            <View style={styles.createGroupInfo}>
              <Text style={styles.createGroupTitle}>Create New Group</Text>
              <Text style={styles.createGroupDescription}>
                Start a new savings circle with friends and family
              </Text>
            </View>
          </View>
        </TouchableOpacity>
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
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  createButton: {
    backgroundColor: '#F97316',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#374151',
    marginLeft: 12,
  },
  searchPlaceholder: {
    fontSize: 16,
    color: '#9CA3AF',
    marginLeft: 12,
  },
  quickStats: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statCardTitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 4,
  },
  statCardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  groupItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  groupInfo: {
    flex: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  groupName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    flex: 1,
  },
  roleBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  groupDetails: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 4,
  },
  groupStats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  statItem: {
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  lastActivity: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  groupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chatButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#EF4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createGroupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#F97316',
    borderStyle: 'dashed',
    marginTop: 8,
  },
  createGroupContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  createGroupIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  createGroupInfo: {
    flex: 1,
  },
  createGroupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  createGroupDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
});
