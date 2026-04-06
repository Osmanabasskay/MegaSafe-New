import React, { useMemo, useState } from 'react';
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
  ArrowLeft,
  Bell,
  Calendar,
  Check,
  DollarSign,
  Info,
  ShieldAlert,
  Trash2,
  Users,
} from 'lucide-react-native';
import { useAppDataStore, type NotificationType } from '../../stores/appDataStore';

type NotificationFilter = 'all' | 'unread' | NotificationType;

const iconByType: Record<NotificationType, React.ReactNode> = {
  collection_reminder: <Calendar size={18} color="#F59E0B" />,
  payment_received: <DollarSign size={18} color="#10B981" />,
  group_invite: <Users size={18} color="#F97316" />,
  join_approved: <Users size={18} color="#10B981" />,
  dispute_update: <ShieldAlert size={18} color="#EF4444" />,
  payout_scheduled: <Calendar size={18} color="#1D4ED8" />,
  system_alert: <Info size={18} color="#6B7280" />,
  savings_update: <DollarSign size={18} color="#1D4ED8" />,
  achievement: <Check size={18} color="#8B5CF6" />,
};

const colorByType: Record<NotificationType, string> = {
  collection_reminder: '#F59E0B',
  payment_received: '#10B981',
  group_invite: '#F97316',
  join_approved: '#10B981',
  dispute_update: '#EF4444',
  payout_scheduled: '#1D4ED8',
  system_alert: '#6B7280',
  savings_update: '#1D4ED8',
  achievement: '#8B5CF6',
};

const toRelativeTime = (iso: string): string => {
  const created = new Date(iso).getTime();
  const diffMs = Date.now() - created;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
  } = useAppDataStore();

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications]
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    if (filter === 'unread') return notifications.filter((item) => !item.read);
    return notifications.filter((item) => item.type === filter);
  }, [filter, notifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setRefreshing(false);
  };

  const handlePress = (notificationId: string, actionPath?: string) => {
    markNotificationRead(notificationId);
    if (actionPath) router.push(actionPath as never);
  };

  const filterPills: Array<{ id: NotificationFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: notifications.length },
    { id: 'unread', label: 'Unread', count: unreadCount },
    {
      id: 'payment_received',
      label: 'Payments',
      count: notifications.filter((item) => item.type === 'payment_received').length,
    },
    {
      id: 'dispute_update',
      label: 'Disputes',
      count: notifications.filter((item) => item.type === 'dispute_update').length,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{Math.min(unreadCount, 99)}</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={markAllNotificationsRead}>
          <Check size={18} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal style={styles.filterRow} showsHorizontalScrollIndicator={false}>
        {filterPills.map((pill) => (
          <TouchableOpacity
            key={pill.id}
            style={[styles.filterPill, filter === pill.id && styles.filterPillActive]}
            onPress={() => setFilter(pill.id)}
          >
            <Text style={[styles.filterText, filter === pill.id && styles.filterTextActive]}>
              {pill.label}
            </Text>
            <View style={styles.filterCount}>
              <Text style={styles.filterCountText}>{pill.count}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Bell size={44} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyText}>You are all caught up.</Text>
          </View>
        ) : (
          filtered.map((item) => {
            const icon = iconByType[item.type] ?? <Info size={18} color="#6B7280" />;
            const color = colorByType[item.type] ?? '#6B7280';
            return (
              <View key={item.id} style={[styles.card, !item.read && styles.unreadCard]}>
                <TouchableOpacity
                  style={styles.cardMain}
                  onPress={() => handlePress(item.id, item.actionPath)}
                >
                  <View style={[styles.cardIcon, { backgroundColor: `${color}18` }]}>{icon}</View>
                  <View style={styles.cardBody}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      {!item.read ? <View style={styles.unreadDot} /> : null}
                    </View>
                    <Text style={styles.cardMessage}>{item.message}</Text>
                    <Text style={styles.cardTime}>{toRelativeTime(item.createdAt)}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeNotification(item.id)} style={styles.deleteBtn}>
                  <Trash2 size={15} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            );
          })
        )}
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
  iconBtn: {
    width: 32,
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  badge: {
    marginLeft: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  filterRow: {
    maxHeight: 58,
    paddingVertical: 10,
    paddingLeft: 16,
    backgroundColor: '#FFFFFF',
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    height: 38,
  },
  filterPillActive: {
    backgroundColor: '#F97316',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  filterCount: {
    marginLeft: 7,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterCountText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
  },
  unreadCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#F97316',
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardBody: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E2B5A',
    flex: 1,
    paddingRight: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F97316',
  },
  cardMessage: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 4,
  },
  cardTime: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  deleteBtn: {
    paddingLeft: 8,
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  emptyText: {
    marginTop: 5,
    fontSize: 13,
    color: '#6B7280',
  },
});


