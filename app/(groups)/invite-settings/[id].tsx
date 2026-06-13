import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Copy, RefreshCw, Share2 } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import {
  getCurrentUserGroupRole,
  getGroupInviteSettings,
  regenerateGroupInviteLink,
  updateGroupInviteSettings,
  type GroupInviteSettingsData,
} from '../../../src/services/groupService';
import { useAuthStore } from '../../../src/store/authStore';

const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';

export default function InviteSettingsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [settings, setSettings] = useState<GroupInviteSettingsData | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingApproval, setSavingApproval] = useState(false);
  const [savingPublic, setSavingPublic] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    if (!groupId) return;
    const [settingsRes, roleRes] = await Promise.all([
      getGroupInviteSettings(groupId),
      user?.id ? getCurrentUserGroupRole(groupId, user.id) : Promise.resolve({ role: 'member' as const, error: null }),
    ]);
    setSettings(settingsRes.settings);
    setIsAdmin(roleRes.role === 'creator' || roleRes.role === 'admin');
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const copyCode = async () => {
    if (!settings?.inviteCode) return;
    await Clipboard.setStringAsync(settings.inviteCode);
    Alert.alert('Copied', 'Invite code copied to clipboard.');
  };

  const shareLink = async () => {
    if (!settings?.inviteLink) return;
    await Share.share({ message: `Join my Mi Osusu group!\n${settings.inviteLink}` });
  };

  const handleRegenerate = () => {
    Alert.alert(
      'Regenerate Invite Link',
      'The old link and code will stop working immediately. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            setRegenerating(true);
            const res = await regenerateGroupInviteLink(groupId);
            setRegenerating(false);
            if (res.error) { Alert.alert('Error', res.error.message); return; }
            void load();
          },
        },
      ],
    );
  };

  const toggleApproval = async (value: boolean) => {
    if (!settings) return;
    setSavingApproval(true);
    setSettings({ ...settings, requireApproval: value });
    const res = await updateGroupInviteSettings(groupId, { requireApproval: value });
    setSavingApproval(false);
    if (res.error) {
      Alert.alert('Error', res.error.message);
      setSettings({ ...settings, requireApproval: !value });
    }
  };

  const togglePublic = async (value: boolean) => {
    if (!settings) return;
    setSavingPublic(true);
    setSettings({ ...settings, isEnabled: value });
    const res = await updateGroupInviteSettings(groupId, { isPublic: value });
    setSavingPublic(false);
    if (res.error) {
      Alert.alert('Error', res.error.message);
      setSettings({ ...settings, isEnabled: !value });
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={ORANGE} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite Settings</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {settings ? (
          <>
            {/* Invite Code */}
            <SectionCard title="Invite Code">
              <View style={styles.codeRow}>
                <Text style={styles.codeText}>{settings.inviteCode}</Text>
                <TouchableOpacity style={styles.iconBtn} onPress={copyCode}>
                  <Copy size={16} color={ORANGE} />
                </TouchableOpacity>
              </View>
              <Text style={styles.codeHint}>Share this code so people can join the group directly.</Text>
            </SectionCard>

            {/* Invite Link */}
            <SectionCard title="Invite Link">
              <Text style={styles.linkText} numberOfLines={2}>{settings.inviteLink}</Text>
              <View style={styles.linkBtnRow}>
                <TouchableOpacity style={styles.linkBtn} onPress={copyCode}>
                  <Copy size={15} color={NAVY} />
                  <Text style={styles.linkBtnTxt}>Copy Link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.linkBtn, { backgroundColor: ORANGE }]} onPress={shareLink}>
                  <Share2 size={15} color="#FFFFFF" />
                  <Text style={[styles.linkBtnTxt, { color: '#FFFFFF' }]}>Share</Text>
                </TouchableOpacity>
              </View>
            </SectionCard>

            {/* QR Code placeholder */}
            <SectionCard title="QR Code">
              <View style={styles.qrPlaceholder}>
                <Text style={styles.qrTxt}>QR code feature coming soon</Text>
              </View>
            </SectionCard>

            {/* Usage Stats */}
            <SectionCard title="Usage">
              <SettingRow label="Members Joined" value={`${settings.currentMembers} / ${settings.maxMembers}`} />
              <SettingRow label="Link Uses" value={`${settings.usageCount}${settings.usageLimit ? ` / ${settings.usageLimit}` : ''}`} />
              {settings.expiresAt && <SettingRow label="Expires" value={new Date(settings.expiresAt).toLocaleDateString()} last />}
            </SectionCard>

            {/* Settings (admin only) */}
            {isAdmin && (
              <SectionCard title="Join Rules">
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Require Approval</Text>
                    <Text style={styles.toggleSub}>New members wait for admin approval before joining</Text>
                  </View>
                  <Switch
                    value={settings.requireApproval}
                    onValueChange={toggleApproval}
                    disabled={savingApproval}
                    trackColor={{ true: ORANGE, false: '#E2E8F0' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Allow Invite by Members</Text>
                    <Text style={styles.toggleSub}>Any member can share the invite link</Text>
                  </View>
                  <Switch
                    value={settings.isEnabled}
                    onValueChange={togglePublic}
                    disabled={savingPublic}
                    trackColor={{ true: ORANGE, false: '#E2E8F0' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </SectionCard>
            )}

            {/* Regenerate (admin only) */}
            {isAdmin && (
              <SectionCard title="Danger">
                <TouchableOpacity style={styles.regenBtn} onPress={handleRegenerate} disabled={regenerating}>
                  {regenerating
                    ? <ActivityIndicator size="small" color="#EF4444" />
                    : <RefreshCw size={17} color="#EF4444" />
                  }
                  <Text style={styles.regenTxt}>Regenerate Invite Link</Text>
                </TouchableOpacity>
                <Text style={styles.regenHint}>This will invalidate the current code and link immediately.</Text>
              </SectionCard>
            )}
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Settings unavailable</Text>
            <Text style={styles.emptyBody}>Unable to load invite settings. Pull down to retry.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.settingRow, !last && { borderBottomWidth: 1, borderBottomColor: BORDER }]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: NAVY },
  scroll: { paddingHorizontal: 18, paddingBottom: 48 },
  section: { marginBottom: 20 },
  sectionTitle: { color: MUTED, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sectionCard: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 6 },
  codeText: { color: ORANGE, fontSize: 24, fontWeight: '900', letterSpacing: 5 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  codeHint: { color: MUTED, fontSize: 12, paddingHorizontal: 18, paddingBottom: 16 },
  linkText: { color: NAVY, fontSize: 13, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12 },
  linkBtnRow: { flexDirection: 'row', paddingHorizontal: 18, paddingBottom: 16, gap: 10 },
  linkBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 14, backgroundColor: SOFT, borderWidth: 1, borderColor: BORDER },
  linkBtnTxt: { color: NAVY, fontSize: 13, fontWeight: '700' },
  qrPlaceholder: { height: 120, alignItems: 'center', justifyContent: 'center' },
  qrTxt: { color: MUTED, fontSize: 13 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  settingLabel: { color: MUTED, fontSize: 13, fontWeight: '600' },
  settingValue: { color: NAVY, fontSize: 13, fontWeight: '800' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 12 },
  toggleLabel: { color: NAVY, fontSize: 14, fontWeight: '700' },
  toggleSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 16 },
  regenTxt: { color: '#EF4444', fontSize: 14, fontWeight: '800' },
  regenHint: { color: MUTED, fontSize: 12, paddingHorizontal: 18, paddingBottom: 16 },
  empty: { paddingVertical: 48, alignItems: 'center' },
  emptyTitle: { color: NAVY, fontSize: 16, fontWeight: '900', marginBottom: 6 },
  emptyBody: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
