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
  Bell,
  CheckCircle,
  AlertTriangle,
  Info,
  Users,
  TrendingUp,
  Gift,
  Shield,
  Calendar,
  DollarSign,
  X,
  Check,
} from 'lucide-react-native';

interface Notification {
  id: string;
  type: 'payment' | 'group' | 'referral' | 'system' | 'achievement' | 'reminder';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action?: string;
  data?: any;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: '1',
      type: 'payment',
      title: 'Payment Received',
      message: 'Your contribution of NLe 100 to Family Savings Circle has been verified',
      timestamp: '2 hours ago',
      read: false,
      action: 'view_ledger',
      data: { groupId: '1' },
    },
    {
      id: '2',
      type: 'group',
      title: 'New Group Invitation',
      message: 'Sarah Miller invited you to join "Business Savings Group"',
      timestamp: '5 hours ago',
      read: false,
      action: 'view_invitation',
      data: { groupId: '2' },
    },
    {
      id: '3',
      type: 'referral',
      title: 'Referral Success!',
      message: 'Your friend James joined MegaSafe. You earned NLe 50!',
      timestamp: '1 day ago',
      read: true,
      action: 'view_earnings',
    },
    {
      id: '4',
      type: 'achievement',
      title: 'Achievement Unlocked!',
      message: 'Congratulations! You earned the "Super Saver" badge',
      timestamp: '2 days ago',
      read: true,
      action: 'view_profile',
    },
    {
      id: '5',
      type: 'reminder',
      title: 'Payment Reminder',
      message: 'Your weekly contribution to Family Savings Circle is due tomorrow',
      timestamp: '3 days ago',
      read: true,
      action: 'make_payment',
      data: { groupId: '1' },
    },
    {
      id: '6',
      type: 'system',
      title: 'System Update',
      message: 'MegaSafe has been updated with new features and improvements',
      timestamp: '1 week ago',
      read: true,
    },
  ]);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  };

  const markAsRead = (notificationId: string) => {
    setNotifications(prev =>
      prev.map(notification =>
        notification.id === notificationId ? { ...notification, read: true } : notification
      )
    );
  };

  const markAllAsRead = () => {
    setNotifications(prev =>
      prev.map(notification => ({ ...notification, read: true }))
    );
  };

  const deleteNotification = (notificationId: string) => {
    setNotifications(prev =>
      prev.filter(notification => notification.id !== notificationId)
    );
  };

  const handleNotificationPress = (notification: Notification) => {
    markAsRead(notification.id);
    
    switch (notification.action) {
      case 'view_ledger':
        router.push(`/groups/manage/${notification.data?.groupId}`);
        break;
      case 'view_invitation':
        router.push(`/groups/invite/${notification.data?.groupId}`);
        break;
      case 'view_earnings':
        router.push('/settings/referral-history');
        break;
      case 'view_profile':
        router.push('/components/profile');
        break;
      case 'make_payment':
        router.push(`/groups/contribute/${notification.data?.groupId}`);
        break;
      default:
        // Handle other actions or do nothing
        break;
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'payment':
        return <DollarSign size={20} color="#10B981" />;
      case 'group':
        return <Users size={20} color="#F97316" />;
      case 'referral':
        return <Gift size={20} color="#8B5CF6" />;
      case 'achievement':
        return <Award size={20} color="#F59E0B" />;
      case 'reminder':
        return <Calendar size={20} color="#EF4444" />;
      case 'system':
        return <Info size={20} color="#6B7280" />;
      default:
        return <Bell size={20} color="#6B7280" />;
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'payment':
        return '#10B981';
      case 'group':
        return '#F97316';
      case 'referral':
        return '#8B5CF6';
      case 'achievement':
        return '#F59E0B';
      case 'reminder':
        return '#EF4444';
      case 'system':
        return '#6B7280';
      default:
        return '#6B7280';
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const renderNotification = (notification: Notification) => {
    const icon = getNotificationIcon(notification.type);
    const color = getNotificationColor(notification.type);

    return (
      <View key={notification.id} style={[styles.notificationCard, !notification.read && styles.unreadCard]}>
        <TouchableOpacity
          style={styles.notificationContent}
          onPress={() => handleNotificationPress(notification)}
        >
          <View style={[styles.notificationIcon, { backgroundColor: `${color}20` }]}>
            {icon}
          </View>
          <View style={styles.notificationInfo}>
            <View style={styles.notificationHeader}>
              <Text style={[styles.notificationTitle, !notification.read && styles.unreadTitle]}>
                {notification.title}
              </Text>
              {!notification.read && <View style={styles.unreadDot} />}
            </View>
            <Text style={styles.notificationMessage} numberOfLines={2}>
              {notification.message}
            </Text>
            <Text style={styles.notificationTimestamp}>{notification.timestamp}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => deleteNotification(notification.id)}
        >
          <X size={16} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderFilterButton = (filter: string, label: string, count: number) => (
    <TouchableOpacity style={styles.filterButton}>
      <Text style={styles.filterText}>{label}</Text>
      <View style={styles.filterCount}>
        <Text style={styles.filterCountText}>{count}</Text>
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
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={markAllAsRead} style={styles.markAllButton}>
          <Check size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {renderFilterButton('all', 'All', notifications.length)}
          {renderFilterButton('unread', 'Unread', unreadCount)}
          {renderFilterButton('payment', 'Payments', 1)}
          {renderFilterButton('group', 'Groups', 1)}
          {renderFilterButton('referral', 'Referrals', 1)}
        </ScrollView>
      </View>

      {/* Notifications List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <Bell size={48} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyMessage}>You're all caught up!</Text>
          </View>
        ) : (
          notifications.map(renderNotification)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const Award = ({ size, color }: { size: number; color: string }) => (
  <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: size * 0.8, color, fontWeight: 'bold' }}>🏆</Text>
  </View>
);

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
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  badge: {
    backgroundColor: '#EF4444',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  markAllButton: {
    padding: 8,
  },
  filtersContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 12,
  },
  filterText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  filterCount: {
    backgroundColor: '#F97316',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  notificationCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#F97316',
  },
  notificationContent: {
    flex: 1,
    flexDirection: 'row',
  },
  notificationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  notificationInfo: {
    flex: 1,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    flex: 1,
  },
  unreadTitle: {
    color: '#1E2B5A',
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F97316',
  },
  notificationMessage: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
    lineHeight: 20,
  },
  notificationTimestamp: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1E2B5A',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});
