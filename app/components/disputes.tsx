import React, { useMemo, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock4, Plus } from 'lucide-react-native';
import { useAppDataStore, type DisputeStatus, type DisputeType } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import {
  createDispute as createRemoteDispute,
  updateDisputeStatus as updateRemoteDisputeStatus,
} from '../../src/services/disputeService';

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

export default function DisputesScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | DisputeStatus>('all');
  const [showComposer, setShowComposer] = useState(false);
  const [draftType, setDraftType] = useState<DisputeType>('missing_payment');
  const [draftGroupName, setDraftGroupName] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { disputes, createDispute, updateDisputeStatus, preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const filteredDisputes = useMemo(() => {
    if (filter === 'all') return disputes;
    return disputes.filter((dispute) => dispute.status === filter);
  }, [disputes, filter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRefreshing(false);
  };

  const resetComposer = () => {
    setDraftType('missing_payment');
    setDraftGroupName('');
    setDraftTitle('');
    setDraftDescription('');
  };

  const submitDispute = async () => {
    if (draftGroupName.trim().length < 2) {
      Alert.alert('Missing group', 'Enter the group name connected to this dispute.');
      return;
    }

    if (draftTitle.trim().length < 3) {
      Alert.alert('Missing title', 'Enter a short title for the dispute.');
      return;
    }

    if (draftDescription.trim().length < 10) {
      Alert.alert('Missing details', 'Add a bit more detail so the review team can act on it.');
      return;
    }

    setSubmitting(true);
    const { error, disputeId } = await createRemoteDispute(
      draftTitle.trim(),
      draftDescription.trim(),
      draftType
    );

    if (error) {
      setSubmitting(false);
      Alert.alert('Could not submit', error.message);
      return;
    }

    createDispute({
      id: disputeId,
      title: draftTitle.trim(),
      description: draftDescription.trim(),
      type: draftType,
      groupName: draftGroupName.trim(),
    });
    resetComposer();
    setShowComposer(false);
    setSubmitting(false);
  };

  const advanceStatus = async (id: string, status: DisputeStatus) => {
    if (status === 'resolved') {
      Alert.alert('Resolved', 'This dispute is already resolved.');
      return;
    }
    const targetStatus = nextStatus[status];
    const resolutionNote =
      targetStatus === 'resolved'
        ? 'Resolved after review and ledger reconciliation.'
        : undefined;
    const { error } = await updateRemoteDisputeStatus(
      id,
      targetStatus,
      resolutionNote
    );

    if (error) {
      Alert.alert('Status not updated', error.message);
      return;
    }

    updateDisputeStatus(
      id,
      targetStatus,
      resolutionNote
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Disputes & Support</Text>
        <TouchableOpacity style={styles.iconButton} onPress={() => setShowComposer((prev) => !prev)}>
          <Plus size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      {showComposer ? (
        <View style={[styles.composerCard, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
          <Text style={[styles.composerTitle, { color: C.text }]}>Raise a dispute</Text>
          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            value={draftGroupName}
            onChangeText={setDraftGroupName}
            placeholder="Group name"
            placeholderTextColor={C.textMuted}
          />
          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="Short title"
            placeholderTextColor={C.textMuted}
          />
          <TextInput
            style={[styles.input, styles.textarea, { backgroundColor: C.inputBg, color: C.text }]}
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="Describe what happened"
            placeholderTextColor={C.textMuted}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.typeRow}>
            {(['missing_payment', 'incorrect_amount', 'collector_misconduct', 'unauthorized_transaction'] as const).map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.typeChip, { backgroundColor: C.card }, draftType === item && styles.typeChipActive]}
                onPress={() => setDraftType(item)}
              >
                <Text style={[styles.typeChipText, { color: C.textSub }, draftType === item && styles.typeChipTextActive]}>
                  {item.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={() => void submitDispute()}
            disabled={submitting}
          >
            <Text style={styles.submitButtonText}>{submitting ? 'Submitting...' : 'Submit dispute'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.filterRow, { backgroundColor: C.bg }]}>
        {(['all', 'open', 'under_review', 'resolved'] as const).map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.filterChip, { backgroundColor: C.iconBg }, filter === item && styles.filterChipActive]}
            onPress={() => setFilter(item)}
          >
            <Text style={[styles.filterText, { color: C.textSub }, filter === item && styles.filterTextActive]}>
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
          <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
            <AlertTriangle size={32} color={C.textMuted} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>No disputes yet</Text>
            <Text style={[styles.emptyText, { color: C.textSub }]}>Tap + to raise a payment or collection dispute.</Text>
          </View>
        ) : (
          filteredDisputes.map((dispute) => (
            <TouchableOpacity
              key={dispute.id}
              style={[styles.card, { backgroundColor: C.card }]}
              onPress={() => advanceStatus(dispute.id, dispute.status)}
            >
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, { color: C.text }]}>{dispute.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[dispute.status] }]}>
                  <Text style={styles.statusText}>{dispute.status.replace('_', ' ')}</Text>
                </View>
              </View>
              <Text style={[styles.cardDescription, { color: C.textSub }]}>{dispute.description}</Text>
              <Text style={[styles.cardMeta, { color: C.textMuted }]}>
                {dispute.groupName} • {dispute.type.replace(/_/g, ' ')}
              </Text>
              <View style={styles.cardFooter}>
                <View style={styles.footerItem}>
                  <Clock4 size={14} color={C.textMuted} />
                  <Text style={[styles.footerText, { color: C.textMuted }]}>{new Date(dispute.updatedAt).toLocaleString()}</Text>
                </View>
                <View style={styles.footerItem}>
                  <CheckCircle2 size={14} color="#10B981" />
                  <Text style={[styles.footerText, { color: C.textMuted }]}>Tap to progress status</Text>
                </View>
              </View>
              {dispute.resolutionNote ? (
                <Text style={[styles.resolution, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5', color: isDark ? '#34D399' : '#065F46' }]}>
                  {dispute.resolutionNote}
                </Text>
              ) : null}
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
  composerCard: {
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 6,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
  },
  composerTitle: {
    color: '#1E2B5A',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#1F2937',
    marginBottom: 10,
  },
  textarea: {
    minHeight: 92,
    paddingTop: 12,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  typeChipActive: {
    backgroundColor: '#F97316',
  },
  typeChipText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  typeChipTextActive: {
    color: '#FFFFFF',
  },
  submitButton: {
    borderRadius: 10,
    backgroundColor: '#F97316',
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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


