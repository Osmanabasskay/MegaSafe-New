import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ImageStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  CreditCard,
  Hash,
  Info,
  Lock,
  MessageSquareOff,
  Phone,
  Shield,
  Trash2,
  Users,
} from 'lucide-react-native';
import {
  getCurrentUserGroupRole,
  getGroupSettings,
  updateGroupSettings,
  type GroupSettingsData,
} from '../../../src/services/groupService';
import { uploadFromUri } from '../../../src/services/storageUpload';
import { useAuthStore } from '../../../src/store/authStore';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';

type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
type PayoutOrder = 'sequential' | 'random' | 'custom';

const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Bi-weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const PAYOUT_ORDERS: { key: PayoutOrder; label: string }[] = [
  { key: 'sequential', label: 'Sequential' },
  { key: 'random', label: 'Random' },
  { key: 'custom', label: 'Custom' },
];

export default function GroupSettingsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [settings, setSettings] = useState<GroupSettingsData | null>(null);
  const [draft, setDraft] = useState<Partial<GroupSettingsData>>({});
  const [isCreator, setIsCreator] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    const [settingsRes, roleRes] = await Promise.all([
      getGroupSettings(groupId),
      user?.id
        ? getCurrentUserGroupRole(groupId, user.id)
        : Promise.resolve({ role: 'member' as const, error: null }),
    ]);
    setSettings(settingsRes.settings);
    setDraft({});
    setIsCreator(roleRes.role === 'creator');
    setIsAdmin(roleRes.role === 'creator' || roleRes.role === 'admin');
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const merged = { ...(settings ?? {}), ...draft } as GroupSettingsData;

  const set = <K extends keyof GroupSettingsData>(key: K, value: GroupSettingsData[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const isDirty = Object.keys(draft).length > 0;

  const handleSave = async () => {
    if (!isDirty) return;
    setSaving(true);
    const res = await updateGroupSettings(groupId, draft);
    setSaving(false);
    if (res.error) {
      Alert.alert('Save failed', res.error.message);
      return;
    }
    setSettings({ ...merged });
    setDraft({});
    Alert.alert('Saved', 'Group settings updated.');
  };

  const handleChangePhoto = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change the group photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingPhoto(true);
    try {
      const { url, error } = await uploadFromUri(result.assets[0].uri, {
        bucket: 'group-avatars',
        folder: groupId,
        contentType: 'image/jpeg',
      });
      if (error || !url) throw error ?? new Error('Upload failed');
      set('avatarUrl', url);
      Alert.alert('Photo updated', 'Tap Save to apply the new group photo.');
    } catch {
      Alert.alert('Upload failed', 'Could not upload the photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator size="large" color={ORANGE} />
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
            <ArrowLeft size={22} color={NAVY} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Group Settings</Text>
          <View style={{ width: 42 }} />
        </View>
        <View style={styles.centered}>
          <Shield size={40} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>Admin access required</Text>
          <Text style={styles.emptyBody}>Only group admins can edit settings.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const avatarUri = (draft.avatarUrl ?? settings?.avatarUrl) ?? null;
  const groupName = merged.name ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group Settings</Text>
        {isDirty ? (
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={styles.saveBtnTxt}>Save</Text>}
          </TouchableOpacity>
        ) : <View style={{ width: 58 }} />}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Group Photo ─────────────────────────────────────────── */}
        <View style={styles.photoSection}>
          <TouchableOpacity style={styles.avatarWrap} onPress={() => void handleChangePhoto()} disabled={uploadingPhoto}>
            {avatarUri
              ? <Image source={{ uri: avatarUri }} style={styles.avatar as ImageStyle} />
              : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>
                    {groupName.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase() || 'GR'}
                  </Text>
                </View>
              )}
            <View style={styles.cameraOverlay}>
              {uploadingPhoto
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Camera size={16} color="#FFFFFF" />}
            </View>
          </TouchableOpacity>
          <Text style={styles.photoHint}>Tap to change group photo</Text>
        </View>

        {/* ── Basic Info ───────────────────────────────────────────── */}
        <SectionHeader icon={<Info size={14} color={ORANGE} />} title="Basic Info" />
        <View style={styles.card}>
          <FieldLabel label="Group Name" />
          <TextInput
            style={[styles.input, merged.lockGroupName && !isCreator && styles.inputDisabled]}
            value={merged.name ?? ''}
            onChangeText={(v) => set('name', v)}
            placeholder="Group name"
            placeholderTextColor="#94A3B8"
            maxLength={60}
            editable={!merged.lockGroupName || isCreator}
          />
          {merged.lockGroupName && !isCreator && (
            <Text style={styles.lockedHint}>Name is locked by the group creator.</Text>
          )}
          <Divider />
          <FieldLabel label="Description (optional)" />
          <TextInput
            style={[styles.input, styles.multiInput]}
            value={merged.description ?? ''}
            onChangeText={(v) => set('description', v)}
            placeholder="Describe the group's purpose"
            placeholderTextColor="#94A3B8"
            multiline
            maxLength={300}
          />
        </View>

        {/* ── Payment Info ─────────────────────────────────────────── */}
        <SectionHeader icon={<CreditCard size={14} color={ORANGE} />} title="Payment Info" />
        <View style={styles.card}>
          <FieldLabel label="Collection Phone (Mobile Money)" />
          <View style={styles.inputRow}>
            <Phone size={15} color={MUTED} style={{ marginRight: 6 }} />
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={merged.adminCollectionPhone ?? ''}
              onChangeText={(v) => set('adminCollectionPhone', v)}
              placeholder="+232 XX XXX XXXX"
              placeholderTextColor="#94A3B8"
              keyboardType="phone-pad"
              maxLength={20}
            />
          </View>
          <Text style={styles.fieldHint}>Members send their contributions to this number.</Text>
          <Divider />
          <FieldLabel label="Contribution Account / Reference" />
          <View style={styles.inputRow}>
            <Hash size={15} color={MUTED} style={{ marginRight: 6 }} />
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={merged.contributionNumber ?? ''}
              onChangeText={(v) => set('contributionNumber', v)}
              placeholder="Account number or reference"
              placeholderTextColor="#94A3B8"
              maxLength={40}
            />
          </View>
          <Text style={styles.fieldHint}>Bank or mobile money account reference for contributions.</Text>
        </View>

        {/* ── Contribution Rules ───────────────────────────────────── */}
        <SectionHeader icon={<CreditCard size={14} color={ORANGE} />} title="Contribution Rules" />
        <View style={styles.card}>
          <FieldLabel label="Contribution Amount (NLe)" />
          <TextInput
            style={styles.input}
            value={merged.contributionAmount != null ? String(merged.contributionAmount) : ''}
            onChangeText={(v) => { const n = parseFloat(v); if (!Number.isNaN(n)) set('contributionAmount', n); }}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor="#94A3B8"
          />
          <Divider />
          <FieldLabel label="Frequency" />
          <View style={styles.chipRow}>
            {FREQUENCIES.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[styles.selectChip, merged.frequency === f.key && styles.selectChipActive]}
                onPress={() => set('frequency', f.key)}
              >
                <Text style={[styles.selectChipTxt, merged.frequency === f.key && styles.selectChipTxtActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Divider />
          <FieldLabel label="Total Cycles" />
          <TextInput
            style={styles.input}
            value={merged.totalCycles != null ? String(merged.totalCycles) : ''}
            onChangeText={(v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) set('totalCycles', n); }}
            keyboardType="number-pad"
            placeholder="Number of cycles"
            placeholderTextColor="#94A3B8"
          />
        </View>

        {/* ── Payout Rules ─────────────────────────────────────────── */}
        <SectionHeader icon={<CreditCard size={14} color={ORANGE} />} title="Payout Rules" />
        <View style={styles.card}>
          <FieldLabel label="Payout Order" />
          <View style={styles.chipRow}>
            {PAYOUT_ORDERS.map((p) => (
              <TouchableOpacity
                key={p.key}
                style={[styles.selectChip, merged.payoutOrder === p.key && styles.selectChipActive]}
                onPress={() => set('payoutOrder', p.key as PayoutOrder)}
              >
                <Text style={[styles.selectChipTxt, merged.payoutOrder === p.key && styles.selectChipTxtActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Member Rules ─────────────────────────────────────────── */}
        <SectionHeader icon={<Users size={14} color={ORANGE} />} title="Member Rules" />
        <View style={styles.card}>
          <FieldLabel label="Maximum Members" />
          <TextInput
            style={styles.input}
            value={merged.maxMembers != null ? String(merged.maxMembers) : ''}
            onChangeText={(v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) set('maxMembers', n); }}
            keyboardType="number-pad"
            placeholder="Max members"
            placeholderTextColor="#94A3B8"
          />
          <Divider />
          <ToggleRow
            label="Public Group"
            sub="Anyone with the link can discover this group"
            value={merged.isPublic ?? false}
            onChange={(v) => set('isPublic', v)}
          />
          <Divider />
          <ToggleRow
            label="Require Join Approval"
            sub="New members must be approved before joining"
            value={merged.joinRequiresApproval ?? false}
            onChange={(v) => set('joinRequiresApproval', v)}
            last
          />
        </View>

        {/* ── Security & Locks (admin/creator) ────────────────────── */}
        <SectionHeader icon={<Lock size={14} color={ORANGE} />} title="Security & Locks" />
        <View style={styles.card}>
          <ToggleRow
            label="Lock Group Name"
            sub="Only the creator can change the group name"
            value={merged.lockGroupName ?? false}
            onChange={(v) => set('lockGroupName', v)}
          />
          <Divider />
          <ToggleRow
            label="Lock Chat"
            sub="Only admins can send messages — members can still read"
            value={merged.lockChat ?? false}
            onChange={(v) => set('lockChat', v)}
            last
            icon={<MessageSquareOff size={16} color={merged.lockChat ? '#EF4444' : MUTED} />}
          />
        </View>

        {/* ── Collector Management ─────────────────────────────────── */}
        <SectionHeader icon={<Shield size={14} color={ORANGE} />} title="Collector" />
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => router.push({ pathname: '/(groups)/assign-contributors' as never, params: { id: groupId } })}
          >
            <View style={styles.navIconWrap}>
              <Shield size={17} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.navLabel}>Assign Collector</Text>
              <Text style={styles.navSub}>Set who collects physical contributions</Text>
            </View>
            <ChevronRight size={16} color="#CBD5E1" />
          </TouchableOpacity>
        </View>

        {/* ── Danger Zone (creator only) ───────────────────────────── */}
        {isCreator && (
          <>
            <SectionHeader icon={<Trash2 size={14} color="#EF4444" />} title="Danger Zone" danger />
            <View style={[styles.card, styles.dangerCard]}>
              <TouchableOpacity
                style={styles.dangerRow}
                onPress={() =>
                  router.push({ pathname: '/(groups)/delete-group/[id]' as never, params: { id: groupId } })
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.dangerLabel}>Delete Group</Text>
                  <Text style={styles.dangerSub}>Permanently close the group and revoke all access</Text>
                </View>
                <ChevronRight size={18} color="#EF4444" />
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────
function SectionHeader({ icon, title, danger }: { icon?: React.ReactNode; title: string; danger?: boolean }) {
  return (
    <View style={styles.sectionHeaderRow}>
      {icon}
      <Text style={[styles.sectionTitle, danger && { color: '#EF4444' }]}>{title}</Text>
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: BORDER, marginVertical: 2 }} />;
}

function ToggleRow({ label, sub, value, onChange, last, icon }: {
  label: string; sub: string; value: boolean;
  onChange: (v: boolean) => void; last?: boolean; icon?: React.ReactNode;
}) {
  return (
    <View style={[styles.toggleRow, last && { paddingBottom: 0 }]}>
      {icon && <View style={{ marginRight: 8 }}>{icon}</View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: ORANGE, false: '#E2E8F0' }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 12, padding: 24 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn:  { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  saveBtn:   { backgroundColor: ORANGE, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14 },
  saveBtnTxt:{ color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  scroll:    { paddingHorizontal: 18, paddingBottom: 60 },

  // Photo section
  photoSection: { alignItems: 'center', paddingVertical: 20 },
  avatarWrap:   { position: 'relative' },
  avatar:       { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#FDBA74' },
  avatarFallback: { width: 88, height: 88, borderRadius: 44, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
  cameraOverlay: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  photoHint: { color: MUTED, fontSize: 12, marginTop: 8, fontWeight: '600' },

  // Section header
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22, marginBottom: 8 },
  sectionTitle: { color: MUTED, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Card
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', paddingHorizontal: 16 },
  fieldLabel: { color: MUTED, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 4 },
  fieldHint:  { color: '#94A3B8', fontSize: 11, marginBottom: 10, lineHeight: 16 },
  lockedHint: { color: '#F59E0B', fontSize: 11, marginBottom: 8 },
  input:      { color: NAVY, fontSize: 15, fontWeight: '700', paddingVertical: 8, marginBottom: 14 },
  inputDisabled: { color: MUTED },
  multiInput: { minHeight: 72, textAlignVertical: 'top' },
  inputRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  selectChip: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: SOFT, borderWidth: 1, borderColor: BORDER },
  selectChipActive:    { backgroundColor: NAVY, borderColor: NAVY },
  selectChipTxt:       { color: MUTED, fontSize: 13, fontWeight: '700' },
  selectChipTxtActive: { color: '#FFFFFF' },
  toggleRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 4 },
  toggleLabel:{ color: NAVY, fontSize: 14, fontWeight: '700' },
  toggleSub:  { color: MUTED, fontSize: 12, marginTop: 2 },

  // Nav row
  navRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  navIconWrap:{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  navLabel:   { color: NAVY, fontSize: 14, fontWeight: '700' },
  navSub:     { color: MUTED, fontSize: 12, marginTop: 2 },

  // Danger zone
  dangerCard: { borderColor: '#FEE2E2' },
  dangerRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
  dangerLabel:{ color: '#EF4444', fontSize: 14, fontWeight: '800' },
  dangerSub:  { color: MUTED, fontSize: 12, marginTop: 2 },

  emptyTitle: { color: NAVY, fontSize: 17, fontWeight: '900' },
  emptyBody:  { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
