import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { AlertTriangle, ArrowLeft, Clock4, Plus } from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import {
  createDispute as createRemoteDispute,
  fetchUserDisputes,
  type DisputeRow,
  type RemoteDisputeStatus,
} from '../../src/services/disputeService';

// Status colours are informational only — members cannot change status
const STATUS_COLOR: Record<RemoteDisputeStatus, string> = {
  open:         '#EF4444',
  under_review: '#F59E0B',
  resolved:     '#10B981',
  escalated:    '#7C3AED',
  dismissed:    '#6B7280',
};

const STATUS_LABEL: Record<RemoteDisputeStatus, string> = {
  open:         'Open',
  under_review: 'Under review',
  resolved:     'Resolved',
  escalated:    'Escalated',
  dismissed:    'Dismissed',
};

type DisputeType = 'missing_payment' | 'incorrect_amount' | 'collector_misconduct' | 'unauthorized_transaction' | 'other';

export default function DisputesScreen() {
  const router = useRouter();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [disputes, setDisputes]       = useState<DisputeRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [filter, setFilter]           = useState<'all' | RemoteDisputeStatus>('all');
  const [showComposer, setShowComposer] = useState(false);
  const [draftType, setDraftType]     = useState<DisputeType>('missing_payment');
  const [draftTitle, setDraftTitle]   = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [submitting, setSubmitting]   = useState(false);

  // ── Load from backend ───────────────────────────────────────────────────────

  const loadDisputes = useCallback(async () => {
    const { disputes: rows, error } = await fetchUserDisputes();
    if (!error) setDisputes(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void loadDisputes(); }, [loadDisputes]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadDisputes();
  }, [loadDisputes]);

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filteredDisputes = useMemo(() => {
    if (filter === 'all') return disputes;
    return disputes.filter((d) => d.status === filter);
  }, [disputes, filter]);

  // ── Submit new dispute ──────────────────────────────────────────────────────

  const resetComposer = () => {
    setDraftType('missing_payment');
    setDraftTitle('');
    setDraftDescription('');
  };

  const submitDispute = async () => {
    if (draftTitle.trim().length < 5) {
      Alert.alert('Missing title', 'Title must be at least 5 characters.');
      return;
    }
    if (draftDescription.trim().length < 20) {
      Alert.alert('Missing details', 'Please describe the issue in at least 20 characters.');
      return;
    }

    setSubmitting(true);
    const { error } = await createRemoteDispute(
      draftTitle.trim(),
      draftDescription.trim(),
      draftType
    );

    setSubmitting(false);

    if (error) {
      Alert.alert('Could not submit', error.message);
      return;
    }

    Alert.alert(
      'Dispute submitted',
      'Your dispute has been received. Our support team will review it and update you via notifications.',
      [{ text: 'OK', onPress: () => { resetComposer(); setShowComposer(false); void loadDisputes(); } }]
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Disputes & Support</Text>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => setShowComposer((prev) => !prev)}
          accessibilityLabel="Raise a dispute"
        >
          <Plus size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      {/* New dispute composer */}
      {showComposer ? (
        <View style={[styles.composerCard, { backgroundColor: isDark ? '#431407' : '#FFF7ED' }]}>
          <Text style={[styles.composerTitle, { color: C.text }]}>Raise a dispute</Text>
          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="Short title (min 5 characters)"
            placeholderTextColor={C.textMuted}
            maxLength={120}
          />
          <TextInput
            style={[styles.input, styles.textarea, { backgroundColor: C.inputBg, color: C.text }]}
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="Describe what happened (min 20 characters)"
            placeholderTextColor={C.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={2000}
          />
          <View style={styles.typeRow}>
            {(['missing_payment', 'incorrect_amount', 'collector_misconduct', 'unauthorized_transaction'] as const).map((item) => (
              <TouchableOpacity
                key={item}
                style={[
                  styles.typeChip,
                  { backgroundColor: C.card },
                  draftType === item && styles.typeChipActive,
                ]}
                onPress={() => setDraftType(item)}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    { color: C.textSub },
                    draftType === item && styles.typeChipTextActive,
                  ]}
                >
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
            <Text style={styles.submitButtonText}>
              {submitting ? 'Submitting…' : 'Submit dispute'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Status filter */}
      <View style={[styles.filterRow, { backgroundColor: C.bg }]}>
        {(['all', 'open', 'under_review', 'resolved'] as const).map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.filterChip,
              { backgroundColor: C.iconBg },
              filter === item && styles.filterChipActive,
            ]}
            onPress={() => setFilter(item)}
          >
            <Text
              style={[
                styles.filterText,
                { color: C.textSub },
                filter === item && styles.filterTextActive,
              ]}
            >
              {item.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Dispute list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F97316" />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {filteredDisputes.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
              <AlertTriangle size={32} color={C.textMuted} />
              <Text style={[styles.emptyTitle, { color: C.text }]}>No disputes yet</Text>
              <Text style={[styles.emptyText, { color: C.textSub }]}>
                Tap + to raise a payment or collection dispute.
              </Text>
            </View>
          ) : (
            filteredDisputes.map((dispute) => (
              <View key={dispute.id} style={[styles.card, { backgroundColor: C.card }]}>
                <View style={styles.cardHead}>
                  <Text style={[styles.cardTitle, { color: C.text }]}>{dispute.title}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: STATUS_COLOR[dispute.status] },
                    ]}
                  >
                    <Text style={styles.statusText}>
                      {STATUS_LABEL[dispute.status]}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.cardDescription, { color: C.textSub }]}>
                  {dispute.description}
                </Text>

                <Text style={[styles.cardMeta, { color: C.textMuted }]}>
                  {(dispute.category as string).replace(/_/g, ' ')}
                  {dispute.group_name ? ` · ${dispute.group_name}` : ''}
                </Text>

                <View style={styles.cardFooter}>
                  <View style={styles.footerItem}>
                    <Clock4 size={14} color={C.textMuted} />
                    <Text style={[styles.footerText, { color: C.textMuted }]}>
                      {new Date(dispute.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={[styles.footerNote, { color: C.textMuted }]}>
                    Support team will update you via notifications
                  </Text>
                </View>

                {dispute.resolution_note ? (
                  <Text
                    style={[
                      styles.resolution,
                      {
                        backgroundColor: isDark ? '#064E3B' : '#ECFDF5',
                        color: isDark ? '#34D399' : '#065F46',
                      },
                    ]}
                  >
                    {dispute.resolution_note}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: { width: 28, alignItems: 'center' },
  headerTitle: { fontSize: 21, fontWeight: '700', color: '#1E2B5A' },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  composerCard: {
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 6,
    padding: 14,
    borderRadius: 14,
  },
  composerTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    marginBottom: 10,
  },
  textarea: { minHeight: 92, paddingTop: 12 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999 },
  typeChipActive: { backgroundColor: '#F97316' },
  typeChipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  typeChipTextActive: { color: '#FFFFFF' },
  submitButton: {
    borderRadius: 10,
    backgroundColor: '#F97316',
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  filterChipActive: { backgroundColor: '#F97316' },
  filterText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  filterTextActive: { color: '#FFFFFF' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  list: { flex: 1 },
  listContent: { padding: 18, paddingBottom: 30 },
  emptyCard: { borderRadius: 12, paddingVertical: 50, alignItems: 'center' },
  emptyTitle: { marginTop: 10, fontSize: 18, fontWeight: '700' },
  emptyText: { marginTop: 4, fontSize: 13 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardTitle: { flex: 1, marginRight: 8, fontWeight: '700', fontSize: 15 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  cardDescription: { fontSize: 13, marginBottom: 6 },
  cardMeta: { fontSize: 12, marginBottom: 8, textTransform: 'capitalize' },
  cardFooter: {
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  footerItem: { flexDirection: 'row', alignItems: 'center' },
  footerText: { marginLeft: 4, fontSize: 11 },
  footerNote: { fontSize: 11, fontStyle: 'italic' },
  resolution: { marginTop: 8, padding: 8, borderRadius: 8, fontSize: 12 },
});
