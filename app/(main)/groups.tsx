import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Users,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  DollarSign,
  Calendar,
} from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { listGroupsForUser, type GroupListItem } from '../../lib/groupService';

export default function GroupsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [groups, setGroups] = useState<GroupListItem[]>([]);

  const loadGroups = async () => {
    if (!user?.id) {
      setGroups([]);
      setIsLoading(false);
      return;
    }

    const { groups: loaded } = await listGroupsForUser(user.id);
    setGroups(loaded);
    setIsLoading(false);
  };

  React.useEffect(() => {
    void loadGroups();
  }, [user?.id]);

  const filteredGroups = groups.filter(group => 
    group.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalSaved = groups.reduce((sum, group) => sum + group.totalCollected, 0);
  const totalExpectedPerCycle = groups.reduce(
    (sum, group) => sum + group.contributionAmount * Math.max(1, group.members),
    0
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadGroups();
    setRefreshing(false);
  };

  const renderGroup = (group: GroupListItem) => (
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
            <Text style={styles.detailText}>
              NLe {group.contributionAmount.toFixed(2)}/{group.frequency}
            </Text>
          </View>
        </View>
        <View style={styles.groupStats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Total Collected</Text>
            <Text style={styles.statValue}>NLe {group.totalCollected.toFixed(2)}</Text>
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
          <Text style={styles.statCardValue}>NLe {totalSaved.toFixed(2)}</Text>
        </View>
        <View style={styles.statCard}>
          <Calendar size={20} color="#1D4ED8" />
          <Text style={styles.statCardTitle}>Per Cycle</Text>
          <Text style={styles.statCardValue}>NLe {totalExpectedPerCycle.toFixed(2)}</Text>
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
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#F97316" />
            <Text style={styles.loadingText}>Loading your groups...</Text>
          </View>
        ) : filteredGroups.length > 0 ? (
          filteredGroups.map(renderGroup)
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptyDescription}>
              Create your first Osusu group to start collecting contributions.
            </Text>
          </View>
        )}
        
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
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
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
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 20,
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
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 10,
    color: '#6B7280',
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 6,
  },
  emptyDescription: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
  },
});

