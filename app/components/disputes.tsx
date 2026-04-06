import React, { useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock4, Plus } from 'lucide-react-native';
import { useAppDataStore, type DisputeStatus, type DisputeType } from '../../stores/appDataStore';

const STATUS_COLOR: Record<DisputeStatus, string> = {
  open: '#EF4444',
  under_review: '#F59E0B',
  resolved: '#10B981',
  escalated: '#7C3AED',
};

const nextStatus: Record<DisputeStatus, DisputeStatus> = {
  open: 'under_review',
  under_review: 'resolved',
  resolved: 'resolved',
  escalated: 'under_review',
};

const sampleTypes: DisputeType[] = [
  'missing_payment',
  'incorrect_amount',
  'collector_misconduct',
  'unauthorized_transaction',
];

export default function DisputesScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | DisputeStatus>('all');
  const { disputes, createDispute, updateDisputeStatus } = useAppDataStore();

  const filteredDisputes = useMemo(() => {
    if (filter === 'all') return disputes;
    return disputes.filter((dispute) => dispute.status === filter);
  }, [disputes, filter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  };

  const createSampleDispute = () => {
    const index = disputes.length % sampleTypes.length;
    const type = sampleTypes[index];
    createDispute({
      title: `Dispute #${disputes.length + 1}`,
      description: `Please review this ${type.replace(/_/g, ' ')} case.`,
      type,
      groupName: 'Family Savings Circle',
    });
  };

  const advanceStatus = (id: string, status: DisputeStatus) => {
    if (status === 'resolved') {
      Alert.alert('Resolved', 'This dispute is already resolved.');
      return;
    }
    const targetStatus = nextStatus[status];
    updateDisputeStatus(
      id,
      targetStatus,
      targetStatus === 'resolved' ? 'Resolved after review and ledger reconciliation.' : undefined
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Disputes & Support</Text>
        <TouchableOpacity style={styles.iconButton} onPress={createSampleDispute}>
          <Plus size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'open', 'under_review', 'resolved'] as const).map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.filterChip, filter === item && styles.filterChipActive]}
            onPress={() => setFilter(item)}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {item.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredDisputes.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertTriangle size={32} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>No disputes yet</Text>
            <Text style={styles.emptyText}>Tap + to create a dispute test case.</Text>
          </View>
        ) : (
          filteredDisputes.map((dispute) => (
            <TouchableOpacity
              key={dispute.id}
              style={styles.card}
              onPress={() => advanceStatus(dispute.id, dispute.status)}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{dispute.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[dispute.status] }]}>
                  <Text style={styles.statusText}>{dispute.status.replace('_', ' ')}</Text>
                </View>
              </View>
              <Text style={styles.cardDescription}>{dispute.description}</Text>
              <Text style={styles.cardMeta}>
                {dispute.groupName} • {dispute.type.replace(/_/g, ' ')}
              </Text>
              <View style={styles.cardFooter}>
                <View style={styles.footerItem}>
                  <Clock4 size={14} color="#6B7280" />
                  <Text style={styles.footerText}>{new Date(dispute.updatedAt).toLocaleString()}</Text>
                </View>
                <View style={styles.footerItem}>
                  <CheckCircle2 size={14} color="#10B981" />
                  <Text style={styles.footerText}>Tap to progress status</Text>
                </View>
              </View>
              {dispute.resolutionNote ? <Text style={styles.resolution}>{dispute.resolutionNote}</Text> : null}
            </TouchableOpacity>
          ))
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
  iconButton: {
    width: 28,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
  },
  filterChipActive: {
    backgroundColor: '#F97316',
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'capitalize',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 18,
    paddingBottom: 30,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 50,
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 10,
    color: '#1E2B5A',
    fontSize: 18,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 4,
    color: '#6B7280',
    fontSize: 13,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    flex: 1,
    marginRight: 8,
    color: '#1E2B5A',
    fontWeight: '700',
    fontSize: 15,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  cardDescription: {
    color: '#4B5563',
    fontSize: 13,
    marginBottom: 6,
  },
  cardMeta: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 8,
  },
  cardFooter: {
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    marginLeft: 4,
    color: '#6B7280',
    fontSize: 11,
  },
  resolution: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    color: '#065F46',
    fontSize: 12,
  },
});


