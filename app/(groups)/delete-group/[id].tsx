import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, CheckCircle, XCircle } from 'lucide-react-native';
import {
  checkGroupDeleteEligibility,
  deleteGroup,
  getCurrentUserGroupRole,
  getGroupById,
} from '../../../src/services/groupService';
import { useAuthStore } from '../../../src/store/authStore';
import type { OsusuGroup } from '../../../src/types/group';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';
const RED = '#EF4444';
const RED_BG = '#FEF2F2';

type Step = 'eligibility' | 'confirm' | 'deleted';

export default function DeleteGroupScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [group, setGroup] = useState<OsusuGroup | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [blockingReasons, setBlockingReasons] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('eligibility');
  const [nameInput, setNameInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    if (!groupId || !user?.id) { setLoading(false); return; }
    const [groupRes, roleRes] = await Promise.all([
      getGroupById(groupId),
      getCurrentUserGroupRole(groupId, user.id),
    ]);

    if (roleRes.role !== 'creator') { setAccessDenied(true); setLoading(false); return; }
    setGroup(groupRes.group);

    const eligRes = await checkGroupDeleteEligibility(groupId);
    setCanDelete(eligRes.eligibility.canDelete);
    setBlockingReasons(eligRes.eligibility.reasons);
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async () => {
    if (nameInput.trim() !== group?.name?.trim()) {
      Alert.alert('Name does not match', 'Type the group name exactly to confirm deletion.');
      return;
    }
    Alert.alert(
      'Final confirmation',
      'This will permanently delete the group and revoke all member access. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const res = await deleteGroup({ groupId, userId: user!.id });
            setDeleting(false);
            if (res.error) {
              Alert.alert('Deletion failed', res.error.message);
              return;
            }
            setStep('deleted');
          },
        },
      ],
    );
  };

  const nameMatches = nameInput.trim() === group?.name?.trim();

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={ORANGE} />
      </SafeAreaView>
    );
  }

  if (accessDenied) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
            <ArrowLeft size={22} color={NAVY} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete Group</Text>
          <View style={{ width: 42 }} />
        </View>
        <View style={styles.centered}>
          <XCircle size={52} color={RED} />
          <Text style={styles.deniedTitle}>Creator Only</Text>
          <Text style={styles.deniedBody}>Only the group creator can delete this group.</Text>
        </View>
      </SafeAreaView>
    );
  }

  /* DELETED */
  if (step === 'deleted') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <CheckCircle size={56} color="#10B981" />
        <Text style={styles.deletedTitle}>Group Deleted</Text>
        <Text style={styles.deletedBody}>
          The group has been permanently deleted and all members have lost access.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(main)/groups' as never)}>
          <Text style={styles.primaryBtnTxt}>Back to Groups</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete Group</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Warning banner */}
        <View style={styles.warningBanner}>
          <AlertTriangle size={22} color="#92400E" style={{ flexShrink: 0 }} />
          <Text style={styles.warningText}>
            Deleting a group is permanent and cannot be reversed. All contributions, payout history, and member records will be archived and access revoked.
          </Text>
        </View>

        {/* Eligibility */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Eligibility Check</Text>
          <View style={styles.card}>
            {canDelete ? (
              <View style={styles.eligRow}>
                <CheckCircle size={20} color="#10B981" />
                <Text style={styles.eligOk}>This group is eligible for deletion.</Text>
              </View>
            ) : (
              <>
                <View style={styles.eligRow}>
                  <XCircle size={20} color={RED} />
                  <Text style={styles.eligFail}>This group cannot be deleted yet.</Text>
                </View>
                {blockingReasons.map((r, i) => (
                  <View key={i} style={styles.reasonRow}>
                    <View style={styles.reasonDot} />
                    <Text style={styles.reasonTxt}>{r}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </View>

        {/* Confirmation form — only shown when eligible */}
        {canDelete && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Confirm Deletion</Text>
            <View style={styles.card}>
              <Text style={styles.confirmInstructions}>
                Type the group name exactly to enable deletion:
              </Text>
              <Text style={styles.confirmGroupName}>{group?.name}</Text>
              <TextInput
                style={[styles.confirmInput, nameMatches && styles.confirmInputMatch]}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Type group name here"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <TouchableOpacity
              style={[styles.deleteBtn, !nameMatches && styles.deleteBtnDisabled]}
              onPress={handleDelete}
              disabled={!nameMatches || deleting}
            >
              {deleting
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Text style={styles.deleteBtnTxt}>Delete Group Permanently</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 14, paddingHorizontal: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  scroll: { paddingHorizontal: 18, paddingBottom: 60 },
  warningBanner: { flexDirection: 'row', backgroundColor: '#FFFBEB', borderRadius: 16, borderWidth: 1, borderColor: '#FDE68A', padding: 14, marginTop: 8, marginBottom: 20, gap: 12, alignItems: 'flex-start' },
  warningText: { flex: 1, color: '#78350F', fontSize: 13, lineHeight: 19 },
  section: { marginBottom: 20 },
  sectionTitle: { color: MUTED, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', padding: 16 },
  eligRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eligOk: { color: '#166534', fontSize: 14, fontWeight: '700', flex: 1 },
  eligFail: { color: RED, fontSize: 14, fontWeight: '700', flex: 1 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
  reasonDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: RED, marginTop: 5 },
  reasonTxt: { color: NAVY, fontSize: 13, flex: 1, lineHeight: 19 },
  confirmInstructions: { color: MUTED, fontSize: 13, marginBottom: 8 },
  confirmGroupName: { color: NAVY, fontSize: 15, fontWeight: '900', marginBottom: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: SOFT, borderRadius: 12, textAlign: 'center' },
  confirmInput: { backgroundColor: SOFT, borderRadius: 14, borderWidth: 2, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 12, color: NAVY, fontSize: 15, fontWeight: '700' },
  confirmInputMatch: { borderColor: RED },
  deleteBtn: { backgroundColor: RED, borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  deleteBtnDisabled: { backgroundColor: '#FCA5A5', opacity: 0.6 },
  deleteBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  deniedTitle: { color: NAVY, fontSize: 20, fontWeight: '900' },
  deniedBody: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  deletedTitle: { color: NAVY, fontSize: 22, fontWeight: '900' },
  deletedBody: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  primaryBtn: { backgroundColor: ORANGE, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 16, marginTop: 6 },
  primaryBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});
