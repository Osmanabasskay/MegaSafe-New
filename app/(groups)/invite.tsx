import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  StyleSheet,
  Alert,
  Share,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Contacts from 'expo-contacts';
import {
  ArrowLeft,
  UserPlus,
  Users,
  Share2,
  Copy,
  X,
  Search,
  Check,
  Phone,
  ChevronRight,
  HelpCircle,
  Link2,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useGroupCreationStore } from '../../src/store/groupCreationStore';
import {
  buildGroupConfiguration,
  createGroup,
  generateInviteCode,
} from '../../src/services/groupService';

interface ContactItem {
  id: string;
  name: string;
  phone: string;
  initials: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function normalisePhone(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/-/g, '');
}

export default function InviteMembersScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    draft,
    addInvite,
    removeInvite,
    setInviteCode: setDraftInviteCode,
    resetDraft,
  } = useGroupCreationStore();

  const [inviteCode, setInviteCode] = useState(draft.inviteCode);
  const [isSaving, setIsSaving] = useState(false);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [allContacts, setAllContacts] = useState<ContactItem[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const inviteLink = useMemo(
    () => `https://miosusu.app/join/${inviteCode}`,
    [inviteCode],
  );
  const invitedMembers = draft.invites;

  useEffect(() => {
    if (inviteCode) return;
    const generated = generateInviteCode();
    setInviteCode(generated);
    setDraftInviteCode(generated);
  }, [inviteCode, setDraftInviteCode]);

  const shareText = async (message: string) => {
    try {
      await Share.share({ message });
    } catch {
      Alert.alert('Share failed', 'Unable to open the share sheet right now.');
    }
  };

  const openContactPicker = useCallback(async () => {
    setPickerVisible(true);
    setLoadingContacts(true);
    setContactSearch('');
    setSelected(new Set());

    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      setLoadingContacts(false);
      setPickerVisible(false);
      Alert.alert(
        'Permission Required',
        'Mi Osusu needs access to your contacts to invite members. Please enable it in Settings.',
        [{ text: 'OK' }],
      );
      return;
    }

    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });

      const mapped: ContactItem[] = [];
      for (const c of data) {
        const name = c.name?.trim() || 'Unknown';
        const phones = c.phoneNumbers ?? [];
        for (const p of phones) {
          const raw = p.number ?? '';
          if (!raw) continue;
          const phone = normalisePhone(raw);
          mapped.push({ id: `${c.id ?? ''}-${phone}`, name, phone, initials: getInitials(name) });
        }
      }

      const seen = new Set<string>();
      const deduped = mapped.filter((c) => {
        if (seen.has(c.phone)) return false;
        seen.add(c.phone);
        return true;
      });

      setAllContacts(deduped);
    } catch {
      Alert.alert('Error', 'Could not load contacts. Please try again.');
      setPickerVisible(false);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase().trim();
    if (!q) return allContacts;
    return allContacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [allContacts, contactSearch]);

  const toggleContact = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmSelectedContacts = () => {
    const toAdd = allContacts.filter((c) => selected.has(c.id));
    for (const c of toAdd) {
      const alreadyAdded = invitedMembers.some((m) => m.phone === c.phone);
      if (alreadyAdded) continue;
      addInvite({
        id: `invite-contact-${c.id}-${Date.now()}`,
        name: c.name,
        email: '',
        phone: c.phone,
        status: 'pending',
      });
    }
    setPickerVisible(false);
    setSelected(new Set());
  };

  const handleContinue = async () => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again to create this group.');
      return;
    }
    if (!draft.name.trim()) {
      Alert.alert('Missing details', 'Please go back and provide a group name.');
      return;
    }
    if (draft.contributionAmount <= 0) {
      Alert.alert('Missing details', 'Please go back and enter a valid contribution amount.');
      return;
    }

    setIsSaving(true);
    const rulesSummary = JSON.stringify({
      rules: draft.rules,
      invites: draft.invites.map((i) => ({ name: i.name, email: i.email, phone: i.phone })),
    });
    const configuration = buildGroupConfiguration({
      adminCollectionPhone: draft.adminCollectionPhone,
      invites: draft.invites.map((i) => ({ name: i.name, email: i.email, phone: i.phone })),
      rules: draft.rules as unknown as Record<string, unknown>,
    });

    const { group, error } = await createGroup({
      userId: user.id,
      name: draft.name,
      description: draft.description || null,
      logoUri: draft.logoUri,
      adminCollectionPhone: draft.adminCollectionPhone || null,
      contributionAmount: draft.contributionAmount,
      frequency: draft.frequency,
      maxMembers: draft.maxMembers,
      cycleStartDate: draft.cycleStartDate,
      totalCycles: draft.totalCycles,
      payoutOrder: draft.payoutOrder,
      isPublic: true,
      joinRequiresApproval: draft.rules.requireApproval,
      customRules: configuration || rulesSummary,
      inviteCode,
    });
    setIsSaving(false);

    if (error || !group) {
      Alert.alert('Unable to create group', error?.message ?? 'Please try again.');
      return;
    }

    resetDraft();
    router.push({ pathname: '/(groups)/setup-complete', params: { groupId: group.id } });
  };

  const renderContactRow = ({ item }: { item: ContactItem }) => {
    const isSelected = selected.has(item.id);
    return (
      <TouchableOpacity
        style={styles.contactRow}
        onPress={() => toggleContact(item.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.contactAvatar, isSelected && styles.contactAvatarSelected]}>
          {isSelected ? (
            <Check size={18} color="#FFFFFF" />
          ) : (
            <Text style={styles.contactAvatarText}>{item.initials}</Text>
          )}
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.contactPhone}>{item.phone}</Text>
        </View>
        {isSelected && (
          <View style={styles.selectedDot}>
            <Check size={13} color="#FFFFFF" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite Members</Text>
        <TouchableOpacity style={styles.helpButton}>
          <HelpCircle size={22} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <View style={styles.headerDivider} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Share Invite Code ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconBadge, { backgroundColor: '#FFF7ED' }]}>
              <Share2 size={18} color="#F97316" />
            </View>
            <Text style={styles.sectionTitle}>Share Invite Code</Text>
          </View>

          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{inviteCode}</Text>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={() => shareText(`Join my Mi Osusu group using invite code: ${inviteCode}`)}
              activeOpacity={0.75}
            >
              <Copy size={16} color="#6B7280" />
              <Text style={styles.copyBtnText}>Copy</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.orDivider}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>OR</Text>
          <View style={styles.orLine} />
        </View>

        {/* ── Share Invite Link ── */}
        <View style={styles.section}>
          <Text style={styles.linkLabel}>Share Invite Link</Text>
          <Text style={styles.linkSubtitle}>Anyone with this link can request to join</Text>
          <View style={styles.linkRow}>
            <View style={styles.linkIconWrap}>
              <Link2 size={16} color="#9CA3AF" />
            </View>
            <Text style={styles.linkText} numberOfLines={1}>{inviteLink}</Text>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => shareText(`Join my Mi Osusu group: ${inviteLink}`)}
              activeOpacity={0.75}
            >
              <Share2 size={16} color="#F97316" />
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── Add Members ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.iconBadge, { backgroundColor: '#EFF6FF' }]}>
              <UserPlus size={18} color="#1D4ED8" />
            </View>
            <Text style={styles.sectionTitle}>Add Members</Text>
          </View>

          <TouchableOpacity style={styles.contactPickerBtn} onPress={openContactPicker} activeOpacity={0.88}>
            <Phone size={18} color="#FFFFFF" />
            <Text style={styles.contactPickerBtnText}>Choose from Contacts</Text>
            <ChevronRight size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* ── Invited Members List ── */}
        {invitedMembers.length > 0 && (
          <>
            <View style={styles.divider} />
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.iconBadge, { backgroundColor: '#FFF7ED' }]}>
                  <Users size={18} color="#F97316" />
                </View>
                <Text style={styles.sectionTitle}>Members to Invite</Text>
                <View style={styles.badgePill}>
                  <Text style={styles.badgePillText}>{invitedMembers.length}</Text>
                </View>
              </View>

              {invitedMembers.map((member, index) => (
                <React.Fragment key={member.id}>
                  {index > 0 && <View style={styles.rowDivider} />}
                  <View style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>{getInitials(member.name)}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      <Text style={styles.memberPhone}>{member.phone || member.email}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => removeInvite(member.id)}
                    >
                      <X size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </>
        )}

        <View style={styles.divider} />

        {/* ── Create Group Button ── */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[styles.createGroupBtn, isSaving && { opacity: 0.7 }]}
            onPress={handleContinue}
            disabled={isSaving}
            activeOpacity={0.88}
          >
            {isSaving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.createGroupBtnText}>Create Group</Text>
            )}
          </TouchableOpacity>

          <View style={styles.noteRow}>
            <Text style={styles.noteIcon}>🔒</Text>
            <Text style={styles.noteText}>
              You can always invite more members after the group is created.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Contact Picker Modal ── */}
      <Modal
        visible={pickerVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setPickerVisible(false)}
      >
        <SafeAreaView style={styles.pickerScreen} edges={['top', 'bottom']}>
          <View style={styles.pickerHeader}>
            <TouchableOpacity
              onPress={() => setPickerVisible(false)}
              style={styles.pickerBackBtn}
            >
              <ArrowLeft size={22} color="#1E2B5A" />
            </TouchableOpacity>
            <View style={styles.pickerHeaderCenter}>
              <Text style={styles.pickerTitle}>Select Contacts</Text>
              {allContacts.length > 0 && (
                <Text style={styles.pickerSubtitle}>{allContacts.length} contacts</Text>
              )}
            </View>
            {selected.size > 0 ? (
              <TouchableOpacity style={styles.pickerDoneBtn} onPress={confirmSelectedContacts}>
                <Text style={styles.pickerDoneText}>Add ({selected.size})</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.pickerDoneBtn} />
            )}
          </View>

          <View style={styles.searchBar}>
            <Search size={16} color="#9CA3AF" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or phone…"
              placeholderTextColor="#9CA3AF"
              value={contactSearch}
              onChangeText={setContactSearch}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              autoFocus={false}
            />
            {contactSearch.length > 0 && (
              <TouchableOpacity onPress={() => setContactSearch('')}>
                <X size={16} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          {loadingContacts ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#F97316" />
              <Text style={styles.loadingText}>Loading contacts…</Text>
            </View>
          ) : (
            <FlatList
              data={filteredContacts}
              keyExtractor={(item) => item.id}
              renderItem={renderContactRow}
              style={styles.contactList}
              contentContainerStyle={styles.contactListContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Users size={48} color="#D1D5DB" />
                  <Text style={styles.emptyText}>
                    {contactSearch ? `No results for "${contactSearch}"` : 'No contacts found'}
                  </Text>
                </View>
              }
            />
          )}

          {selected.size > 0 && (
            <View style={styles.pickerFooter}>
              <TouchableOpacity style={styles.addSelectedBtn} onPress={confirmSelectedContacts}>
                <Check size={18} color="#FFFFFF" />
                <Text style={styles.addSelectedBtnText}>
                  Add {selected.size} Contact{selected.size !== 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#FFFFFF' },
  scrollView:   { flex: 1 },
  scrollContent: { paddingBottom: 48 },

  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  backButton:   { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#1E2B5A', letterSpacing: -0.3 },
  helpButton:   { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center' },
  headerDivider: { height: 1, backgroundColor: '#F3F4F6' },

  pageSubtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 19, paddingHorizontal: 32, paddingTop: 16, paddingBottom: 4 },

  section:           { paddingHorizontal: 20, paddingVertical: 18 },
  sectionHeader:     { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  iconBadge:         { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sectionTitleGroup: { flex: 1 },
  sectionTitle:      { fontSize: 15, fontWeight: '700', color: '#1E2B5A' },
  sectionSubtitle:   { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  divider:    { height: 1, backgroundColor: '#F3F4F6' },
  rowDivider: { height: 1, backgroundColor: '#F9FAFB', marginVertical: 8 },

  // Invite code
  codeBox:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF7ED', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 16 },
  codeText:     { flex: 1, fontSize: 22, fontWeight: '800', color: '#F97316', letterSpacing: 4 },
  copyBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  copyBtnText:  { fontSize: 13, fontWeight: '700', color: '#374151' },

  // OR separator
  orDivider: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginVertical: 4 },
  orLine:    { flex: 1, height: 1, backgroundColor: '#F3F4F6' },
  orText:    { marginHorizontal: 12, fontSize: 12, fontWeight: '700', color: '#9CA3AF' },

  // Share link
  linkLabel:    { fontSize: 15, fontWeight: '700', color: '#1E2B5A', marginBottom: 4 },
  linkSubtitle: { fontSize: 12, color: '#9CA3AF', marginBottom: 12 },
  linkRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  linkIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  linkText:     { flex: 1, fontSize: 13, color: '#6B7280' },
  shareBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
  shareBtnText: { fontSize: 13, fontWeight: '700', color: '#F97316' },

  // Contacts button
  contactPickerBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 20, gap: 10 },
  contactPickerBtnText: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  // Badge
  badgePill:     { backgroundColor: '#F97316', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' },
  badgePillText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },

  // Member row
  memberRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  memberAvatar:   { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  memberAvatarText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  memberInfo:     { flex: 1 },
  memberName:     { fontSize: 15, fontWeight: '600', color: '#1E2B5A', marginBottom: 2 },
  memberPhone:    { fontSize: 13, color: '#6B7280' },
  removeBtn:      { padding: 8, borderRadius: 8, backgroundColor: '#FEE2E2' },

  // Create Group button
  actionSection:      { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  createGroupBtn:     { backgroundColor: '#F97316', borderRadius: 16, paddingVertical: 16, alignItems: 'center', shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 },
  createGroupBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  noteRow:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 6 },
  noteIcon:           { fontSize: 13 },
  noteText:           { fontSize: 12, color: '#9CA3AF', textAlign: 'center', lineHeight: 17, flex: 1 },

  // Contact picker — full screen
  pickerScreen:       { flex: 1, backgroundColor: '#FFFFFF' },
  pickerHeader:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  pickerBackBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  pickerHeaderCenter: { flex: 1, alignItems: 'center' },
  pickerTitle:        { fontSize: 17, fontWeight: '700', color: '#1E2B5A' },
  pickerSubtitle:     { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  pickerDoneBtn:      { minWidth: 80, alignItems: 'flex-end', justifyContent: 'center' },
  pickerDoneText:     { fontSize: 15, fontWeight: '700', color: '#F97316' },

  searchBar:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 14, marginHorizontal: 16, marginTop: 12, marginBottom: 4, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 9, gap: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  searchInput: { flex: 1, fontSize: 15, color: '#1E2B5A' },

  contactList:        { flex: 1 },
  contactListContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  contactRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  contactAvatar:      { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  contactAvatarSelected: { backgroundColor: '#F97316' },
  contactAvatarText:  { fontSize: 16, fontWeight: '700', color: '#3B82F6' },
  contactInfo:        { flex: 1 },
  contactName:        { fontSize: 15, fontWeight: '600', color: '#1E2B5A', marginBottom: 3 },
  contactPhone:       { fontSize: 13, color: '#6B7280' },
  selectedDot:        { width: 22, height: 22, borderRadius: 11, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  loadingText: { marginTop: 14, fontSize: 14, color: '#6B7280' },
  emptyWrap:   { paddingVertical: 80, alignItems: 'center' },
  emptyText:   { marginTop: 14, fontSize: 14, color: '#9CA3AF', textAlign: 'center' },

  pickerFooter:    { padding: 16, paddingBottom: Platform.OS === 'ios' ? 8 : 16, borderTopWidth: 1, borderTopColor: '#F1F5F9', backgroundColor: '#FFFFFF' },
  addSelectedBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 14, paddingVertical: 15, gap: 8, shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 },
  addSelectedBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
