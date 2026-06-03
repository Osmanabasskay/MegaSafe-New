import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Contacts from 'expo-contacts';
import {
  Check,
  Link2,
  Lock,
  Plus,
  Search,
  Send,
  Shield,
  UserPlus,
  X,
} from 'lucide-react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { deleteGroup, listCachedGroupsForUser, listGroupsForUser, type GroupListItem } from '../../src/services/groupService';
import { joinGroupByCode } from '../../src/api/groupApi';
import { darkColors, lightColors, type AppColors } from '../../src/theme/colors';

type Tab = 'created' | 'joined' | 'discover';

// ─── Public group item (discover tab) ─────────────────────────
type DiscoverGroupItem = {
  id: string;
  name: string;
  tag: string;       // invite_code
  amount: number;    // contribution_amount
  frequency: string;
  members: number;   // current member count
  max: number;       // max_members
  color: string;     // derived from id
  popular: boolean;  // members/max >= 0.6
  joined: boolean;   // user is already a member
  location: string;
};

const GROUP_COLORS = ['#6366F1', '#10B981', '#F97316', '#EC4899', '#EAB308', '#14B8A6', '#3B82F6', '#8B5CF6'];

function groupColorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length] ?? '#F97316';
}

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ─── Invite Modal ─────────────────────────────────────────────
type InviteModalProps = {
  visible: boolean;
  group: GroupListItem | null;
  onClose: () => void;
  C: AppColors;
};

type PhoneContact = {
  id: string;
  name: string;
  phone: string;
};

function InviteModal({ visible, group, onClose, C }: InviteModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [sendingPhone, setSendingPhone] = useState(false);
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const inviteLink = `https://miosusu.app/join/${group?.id ?? 'group'}`;

  const loadContacts = useCallback(async () => {
    if (!visible) return;
    setLoadingContacts(true);
    setSearchQuery('');
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Allow Mi Osusu to access your contacts to invite group members.');
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      const seen = new Set<string>();
      const mapped: PhoneContact[] = [];
      for (const contact of data) {
        const name = contact.name?.trim() || 'Unknown';
        for (const phoneNumber of contact.phoneNumbers ?? []) {
          const phone = (phoneNumber.number ?? '').replace(/[\s\-()]/g, '');
          if (!phone || seen.has(phone)) continue;
          seen.add(phone);
          mapped.push({ id: `${contact.id ?? phone}-${phone}`, name, phone });
        }
      }
      setContacts(mapped);
    } catch {
      Alert.alert('Contacts unavailable', 'Could not load phone contacts. Please try again.');
    } finally {
      setLoadingContacts(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setContacts([]);
    setInvitedIds(new Set());
    void loadContacts();
  }, [visible, loadContacts]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [contacts, searchQuery]);

  const openSmsInvite = async (phone: string) => {
    const message = encodeURIComponent(`Join my Osusu group "${group?.name}" on Mi Osusu!\n\n${inviteLink}`);
    const url = `sms:${phone}?body=${message}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return;
    }
    await Share.share({
      message: `Join my Osusu group "${group?.name}" on Mi Osusu!\n\n${inviteLink}`,
      title: 'Join my Osusu group',
    });
  };

  const handleInviteContact = async (contact: PhoneContact) => {
    setInvitingId(contact.id);
    try {
      await openSmsInvite(contact.phone);
      setInvitedIds((prev) => new Set(prev).add(contact.id));
    } catch {
      Alert.alert('Share failed', 'Could not open the invite sheet.');
    } finally {
      setInvitingId(null);
    }
  };

  const handleSendToPhone = async () => {
    if (!phoneInput.trim()) {
      Alert.alert('Enter number', 'Enter a phone number to invite.');
      return;
    }
    setSendingPhone(true);
    try {
      await openSmsInvite(phoneInput.trim());
      setPhoneInput('');
    } catch {
      Alert.alert('Share failed', 'Could not open the invite sheet.');
    } finally {
      setSendingPhone(false);
    }
  };

  const handleShareLink = async () => {
    try {
      await Share.share({
        message: `Join my Osusu group "${group?.name}" on Mi Osusu!\n\n${inviteLink}`,
        title: 'Join my Osusu group',
      });
    } catch {
      Alert.alert('Share failed', 'Could not open the share sheet.');
    }
  };

  const reset = () => {
    setSearchQuery('');
    setInvitedIds(new Set());
    setPhoneInput('');
    setContacts([]);
    onClose();
  };

  const renderContact = ({ item: c }: { item: PhoneContact }) => {
    const invited = invitedIds.has(c.id);
    const loading = invitingId === c.id;
    return (
      <View style={[styles.contactRow, { borderBottomColor: C.border }]}>
        <View style={styles.contactAvatar}>
          <Text style={styles.contactAvatarText}>
            {c.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={[styles.contactName, { color: C.text }]} numberOfLines={1}>{c.name}</Text>
          <Text style={[styles.contactPhone, { color: C.textMuted }]}>{c.phone}</Text>
        </View>
        <TouchableOpacity
          style={[styles.contactInviteBtn, invited && styles.contactInviteBtnDone]}
          disabled={invited || loading}
          onPress={() => void handleInviteContact(c)}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : invited ? (
            <Check size={14} color="#10B981" />
          ) : (
            <Text style={styles.contactInviteBtnText}>Invite</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { maxHeight: '92%', backgroundColor: C.card }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View>
              <Text style={[styles.modalTitle, { color: C.text }]}>Add Members</Text>
              <Text style={[styles.modalSub, { color: C.textSub }]}>{group?.name ?? 'Group'}</Text>
            </View>
            <TouchableOpacity style={[styles.modalClose, { backgroundColor: C.iconBg }]} onPress={reset}>
              <X size={18} color={C.textSub} />
            </TouchableOpacity>
          </View>

          <View style={styles.inviteContactScreen}>
            <Text style={[styles.fieldLabel, { color: C.textSub }]}>Invite by Phone Number</Text>
            <View style={[styles.inputRow, { backgroundColor: C.inputBg }]}>
              <Search size={16} color={C.textMuted} />
              <TextInput
                style={[styles.inputField, { color: C.text }]}
                placeholder="+232 76 000 000"
                placeholderTextColor={C.textMuted}
                keyboardType="phone-pad"
                value={phoneInput}
                onChangeText={setPhoneInput}
              />
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginBottom: 16 }, sendingPhone && styles.primaryBtnDisabled]}
              disabled={sendingPhone}
              onPress={() => void handleSendToPhone()}
            >
              {sendingPhone ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <UserPlus size={16} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Send Invite</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={[styles.fieldLabel, { color: C.textSub }]}>From Your Contacts</Text>
            <View style={[styles.inputRow, { backgroundColor: C.inputBg }]}>
              <Search size={16} color={C.textMuted} />
              <TextInput
                style={[styles.inputField, { color: C.text }]}
                placeholder="Search contacts…"
                placeholderTextColor={C.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <X size={14} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {loadingContacts ? (
              <View style={{ paddingVertical: 18 }}>
                <ActivityIndicator color="#F97316" />
              </View>
            ) : (
              <FlatList
                data={filteredContacts}
                renderItem={renderContact}
                keyExtractor={(item) => item.id}
                style={styles.contactList}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={18}
                maxToRenderPerBatch={24}
                windowSize={9}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={[styles.fieldLabel, { textAlign: 'center', color: '#9CA3AF', marginTop: 8 }]}>
                    {searchQuery ? `No contacts match "${searchQuery}"` : 'No contacts found'}
                  </Text>
                }
              />
            )}

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerLabel}>or share a link</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.linkBox}>
              <Link2 size={14} color="#F97316" />
              <Text style={styles.linkText} numberOfLines={1}>
                {inviteLink}
              </Text>
            </View>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => void handleShareLink()}>
              <Send size={15} color="#F97316" />
              <Text style={styles.outlineBtnText}>Share Invite Link</Text>
            </TouchableOpacity>

            <View style={styles.collectorNote}>
              <Shield size={13} color="#1D4ED8" />
              <Text style={styles.collectorNoteText}>
                New members who request to join will need admin approval before being added.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Group Card ───────────────────────────────────────────────
type GroupCardProps = {
  group: GroupListItem;
  userId: string;
  onOpenInvite: (group: GroupListItem) => void;
  C: AppColors;
};

function GroupCard({ group, userId, onOpenInvite, C }: GroupCardProps) {
  const router = useRouter();
  const isCreator = group.role === 'creator' || group.createdBy === userId;

  return (
    <View style={[styles.groupCard, { backgroundColor: C.bg }]}>
      {/* Top row: avatar · name · badge */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push(`/(groups)/manage/${group.id}`)}
      >
        <View style={styles.groupCardTop}>
          {group.avatarUrl ? (
            <Image source={{ uri: group.avatarUrl }} style={styles.groupAvatar} />
          ) : (
            <View style={styles.groupAvatarFallback}>
              <Text style={styles.groupAvatarText}>{initials(group.name)}</Text>
            </View>
          )}
          <View style={styles.groupCardInfo}>
            <Text style={[styles.groupCardName, { color: C.text }]} numberOfLines={1}>
              {group.name}
            </Text>
            <Text style={[styles.groupCardMeta, { color: C.textSub }]}>
              {group.members} members · NLe {group.contributionAmount.toFixed(0)}/{group.frequency}
            </Text>
          </View>
          {isCreator && (
            <View style={styles.creatorBadge}>
              <Text style={styles.creatorBadgeText}>CREATOR</Text>
            </View>
          )}
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: C.text }]}>NLe {group.totalCollected.toFixed(0)}</Text>
            <Text style={[styles.statLabel, { color: C.textMuted }]}>Collected</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: C.borderStrong }]} />
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: C.text }]}>{group.nextPayout}</Text>
            <Text style={[styles.statLabel, { color: C.textMuted }]}>Next Payout</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: C.borderStrong }]} />
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: C.text }]}>{group.lastActivity}</Text>
            <Text style={[styles.statLabel, { color: C.textMuted }]}>Last Activity</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Action row */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onOpenInvite(group)}>
          <FontAwesome name="user-plus" size={15} color="#111827" />
          <Text style={[styles.actionBtnText, { color: '#111827' }]}>Invite</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.push(`/(groups)/manage/${group.id}`)}
        >
          <FontAwesome name="cog" size={15} color="#111827" />
          <Text style={[styles.actionBtnText, { color: '#111827' }]}>Manage</Text>
        </TouchableOpacity>

      </View>

      {/* Bottom divider */}
      <View style={[styles.cardDivider, { backgroundColor: C.border }]} />
    </View>
  );
}

// ─── Discover Card ────────────────────────────────────────────
function DiscoverCard({ group, userId, C }: { group: DiscoverGroupItem; userId: string; C: AppColors }) {
  const [requested, setRequested] = useState(group.joined);
  const [requesting, setRequesting] = useState(false);

  const stackCount = Math.min(3, group.members);
  const overflow = group.members - stackCount;
  const memberColors = [group.color, group.color + 'BB', group.color + '88'];

  const handleRequest = async () => {
    if (requested) return;
    Alert.alert(
      'Request to Join',
      `Send a join request to "${group.name}"? The Osusu admin will review it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Request',
          onPress: async () => {
            setRequesting(true);
            const { error } = await joinGroupByCode(group.tag, userId);
            setRequesting(false);
            if (error) {
              Alert.alert('Request failed', error.message);
              return;
            }
            setRequested(true);
            Alert.alert('Request sent', 'The admin will approve your request shortly.');
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.discoverCard, { borderBottomColor: C.border }]}>
      <View style={[styles.discoverIcon, { backgroundColor: 'transparent' }]}>
        <FontAwesome name="group" size={26} color="#111827" />
      </View>
      <View style={styles.discoverInfo}>
        <View style={styles.discoverNameRow}>
          <Text style={[styles.discoverName, { color: C.text }]} numberOfLines={1}>{group.name}</Text>
          {group.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>🔥 Popular</Text>
            </View>
          )}
        </View>
        <Text style={[styles.discoverMeta, { color: C.textMuted }]}>
          {group.members} / {group.max} members · NLe {group.amount.toFixed(0)}/{group.frequency}
        </Text>
        <Text style={[styles.discoverTag, { color: C.textMuted }]}>
          📍 {group.location}  ·  ID: {group.tag}
        </Text>
        <View style={styles.memberAvatarStack}>
          {Array.from({ length: stackCount }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.memberAvatarCircle,
                { backgroundColor: memberColors[i] ?? group.color, marginLeft: i === 0 ? 0 : -8, zIndex: stackCount - i },
              ]}
            />
          ))}
          {overflow > 0 && (
            <View style={[styles.memberAvatarCircle, styles.memberAvatarMore, { marginLeft: -8 }]}>
              <Text style={styles.memberAvatarMoreText}>+{overflow}</Text>
            </View>
          )}
        </View>
      </View>
      <TouchableOpacity
        style={[styles.joinBtn, requested && styles.joinBtnDone]}
        onPress={() => void handleRequest()}
        disabled={requested || requesting}
      >
        {requesting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : requested ? (
          <>
            <Check size={13} color="#10B981" />
            <Text style={[styles.joinBtnText, styles.joinBtnTextDone]}>Requested</Text>
          </>
        ) : (
          <Text style={styles.joinBtnText}>Join</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function OsusuScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isDark = useAppDataStore((s) => s.preferences.darkMode);
  const C = isDark ? darkColors : lightColors;

  const [tab, setTab] = useState<Tab>('created');
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [inviteGroup, setInviteGroup] = useState<GroupListItem | null>(null);

  // ── Discover tab: live public groups ──────────────────────
  const [discoverGroups, setDiscoverGroups] = useState<DiscoverGroupItem[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // ── Invite-code join ───────────────────────────────────────
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);

  // Sort state
  type SortKey = 'popular' | 'name' | 'location' | 'joined' | 'amount' | 'members';
  const [sortBy, setSortBy] = useState<SortKey>('popular');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  const SORT_OPTIONS: { key: SortKey; label: string; desc: string }[] = [
    { key: 'popular',  label: '🔥 Popular',   desc: 'Most popular groups first' },
    { key: 'name',     label: '🔤 Name',       desc: 'Alphabetical order (A–Z)' },
    { key: 'location', label: '📍 Location',   desc: 'Groups near you first' },
    { key: 'joined',   label: '✅ Joined',     desc: 'Groups you have joined' },
    { key: 'amount',   label: '💰 Amount',     desc: 'Highest contribution first' },
    { key: 'members',  label: '👥 Members',    desc: 'Most members first' },
  ];

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortBy)?.label ?? 'Sort';

  const TABS: Tab[] = ['created', 'joined', 'discover'];
  const TAB_LABELS: Record<Tab, string> = { created: 'Created', joined: 'Joined', discover: 'Discover' };

  const loadGroups = useCallback(async () => {
    if (!user?.id) {
      setGroups([]);
      setIsLoading(false);
      return;
    }
    const cached = await listCachedGroupsForUser(user.id);
    if (cached.length > 0) {
      setGroups(cached);
      setIsLoading(false);
    }
    const { groups: loaded } = await listGroupsForUser(user.id);
    setGroups(loaded);
    setIsLoading(false);
  }, [user?.id]);

  const loadPublicGroups = useCallback(async () => {
    if (!user?.id) return;
    setDiscoverLoading(true);
    try {
      const { supabase: sb, supabaseConfigured } = await import('../../src/services/supabase');
      if (!supabaseConfigured) { setDiscoverLoading(false); return; }

      // Fetch public groups + member counts in one query
      const { data, error } = await sb
        .from('osusu_groups')
        .select('id, name, invite_code, contribution_amount, frequency, max_members, status')
        .eq('is_public', true)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const groupIds = rows.map((r) => r.id as string);

      // Fetch current member counts for all groups at once
      const memberCountMap = new Map<string, number>();
      if (groupIds.length > 0) {
        const { data: memberData } = await sb
          .from('osusu_group_members')
          .select('group_id')
          .in('group_id', groupIds)
          .eq('is_active', true);
        for (const m of (memberData ?? []) as Array<{ group_id: string }>) {
          memberCountMap.set(m.group_id, (memberCountMap.get(m.group_id) ?? 0) + 1);
        }
      }

      // Fetch groups the current user belongs to (to show "joined" state)
      const { data: myMemberships } = await sb
        .from('osusu_group_members')
        .select('group_id')
        .eq('user_id', user.id)
        .in('group_id', groupIds);
      const myGroupIds = new Set((myMemberships ?? []).map((m: { group_id: string }) => m.group_id));

      const items: DiscoverGroupItem[] = rows.map((r) => {
        const id = r.id as string;
        const members = memberCountMap.get(id) ?? 0;
        const max = typeof r.max_members === 'number' ? r.max_members : 10;
        return {
          id,
          name: typeof r.name === 'string' ? r.name : 'Unnamed Group',
          tag: typeof r.invite_code === 'string' ? r.invite_code : '',
          amount: typeof r.contribution_amount === 'number' ? r.contribution_amount : 0,
          frequency: typeof r.frequency === 'string' ? r.frequency : 'monthly',
          members,
          max,
          color: groupColorFromId(id),
          popular: max > 0 && (members / max) >= 0.6,
          joined: myGroupIds.has(id),
          location: 'Sierra Leone',
        };
      });

      setDiscoverGroups(items);
    } catch {
      // Silently fall back to empty list — user sees an empty discover tab
    } finally {
      setDiscoverLoading(false);
    }
  }, [user?.id]);

  const handleJoinByCode = async () => {
    const code = inviteCodeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert('Enter code', 'Please enter an invite code.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in before joining a group.');
      return;
    }
    setJoiningByCode(true);
    const { error } = await joinGroupByCode(code, user.id);
    setJoiningByCode(false);
    if (error) {
      Alert.alert('Join failed', error.message);
      return;
    }
    setInviteCodeInput('');
    Alert.alert('Request sent', 'Your join request has been submitted. The admin will review it shortly.');
    void loadGroups();
  };

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (tab === 'discover') void loadPublicGroups();
  }, [tab, loadPublicGroups]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadGroups(),
      tab === 'discover' ? loadPublicGroups() : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const createdGroups = useMemo(
    () => groups.filter(
      (g) =>
        (g.role === 'creator' || g.createdBy === user?.id) &&
        g.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [groups, searchQuery, user?.id],
  );

  const joinedGroups = useMemo(
    () => groups.filter(
      (g) =>
        g.role !== 'creator' &&
        g.createdBy !== user?.id &&
        g.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [groups, searchQuery, user?.id],
  );

  const filteredDiscover = useMemo(() => {
    const searched = discoverGroups.filter((g) =>
      g.name.toLowerCase().includes(discoverSearch.toLowerCase())
    );
    switch (sortBy) {
      case 'name':     return [...searched].sort((a, b) => a.name.localeCompare(b.name));
      case 'amount':   return [...searched].sort((a, b) => b.amount - a.amount);
      case 'members':  return [...searched].sort((a, b) => b.members - a.members);
      case 'joined':   return [...searched].sort((a, b) => (b.joined ? 1 : 0) - (a.joined ? 1 : 0));
      case 'location': return [...searched].sort((a, b) => a.location.localeCompare(b.location));
      case 'popular':
      default:         return [...searched].sort((a, b) => (b.popular ? 1 : 0) - (a.popular ? 1 : 0));
    }
  }, [discoverGroups, discoverSearch, sortBy]);

  const handleDeleteGroup = (group: GroupListItem) => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in again before deleting this group.');
      return;
    }
    Alert.alert(
      'Delete group?',
      `"${group.name}" will be deleted if it has no members, otherwise a super-admin request is raised.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingGroupId(group.id);
            const { success, outcome, error } = await deleteGroup({
              groupId: group.id,
              userId: user.id,
            });
            setDeletingGroupId(null);

            if (!success || error) {
              Alert.alert('Not deleted', error?.message ?? 'Unable to delete this group.');
              return;
            }
            if (outcome === 'pending_super_admin') {
              setGroups((cur) =>
                cur.map((g) => (g.id === group.id ? { ...g, status: 'pending' } : g))
              );
              Alert.alert('Deletion pending', 'Super-admin approval is required.');
              return;
            }
            setGroups((cur) => cur.filter((g) => g.id !== group.id));
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]} edges={['bottom']}>
      {/* Page header */}
      <View style={[styles.pageHeader, { backgroundColor: C.bg }]}>
        <View>
          <Text style={[styles.pageTitle, { color: C.text }]}>Osusu</Text>
          <Text style={[styles.pageSubtitle, { color: C.textMuted }]}>Your savings circles</Text>
        </View>
      </View>

      {/* Tabs – underline style */}
      <View style={[styles.tabBar, { backgroundColor: C.bg, borderBottomColor: C.border }]}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t}
            style={styles.tabBtn}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabLabel, { color: C.textMuted }, tab === t && styles.tabLabelActive]}>
              {TAB_LABELS[t]}
            </Text>
            {tab === t && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Search bar (Created / Joined tabs) */}
      {tab !== 'discover' && (
        <View style={[styles.searchBar, { backgroundColor: C.inputBg, borderColor: C.borderStrong }]}>
          <Search size={16} color={C.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: C.text }]}
            placeholder="Search groups..."
            placeholderTextColor={C.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={15} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* CREATED */}
        {tab === 'created' && (
          <>
            {isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#F97316" size="large" />
                <Text style={styles.loadingText}>Loading your groups…</Text>
              </View>
            ) : createdGroups.length > 0 ? (
              createdGroups.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  userId={user?.id ?? ''}
                  onOpenInvite={setInviteGroup}
                  C={C}
                />
              ))
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
                <FontAwesome name="group" size={40} color="#F97316" />
                <Text style={[styles.emptyTitle, { color: C.text }]}>No groups created yet</Text>
                <Text style={[styles.emptyDesc, { color: C.textMuted }]}>
                  Tap the + button to start your first Osusu savings circle.
                </Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => router.push('/(groups)/create')}
                >
                  <Plus size={16} color="#FFFFFF" />
                  <Text style={styles.emptyBtnText}>Create Group</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* JOINED */}
        {tab === 'joined' && (
          <>
            {isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#F97316" size="large" />
                <Text style={styles.loadingText}>Loading joined groups…</Text>
              </View>
            ) : joinedGroups.length > 0 ? (
              joinedGroups.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  userId={user?.id ?? ''}
                  onOpenInvite={setInviteGroup}
                  C={C}
                />
              ))
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
                <Text style={[styles.emptyTitle, { color: C.text }]}>No groups joined yet</Text>
                <Text style={[styles.emptyDesc, { color: C.textMuted }]}>
                  Switch to the Discover tab to find and request to join an Osusu group.
                </Text>
                <TouchableOpacity
                  style={[styles.emptyBtn, { backgroundColor: '#1D4ED8' }]}
                  onPress={() => setTab('discover')}
                >
                  <Text style={styles.emptyBtnText}>Browse Groups</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* DISCOVER */}
        {tab === 'discover' && (
          <>
            {/* Search + filter */}
            <View style={[styles.searchBar, { backgroundColor: C.inputBg, borderColor: C.borderStrong }]}>
              <Search size={16} color={C.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: C.text }]}
                placeholder="Search public groups…"
                placeholderTextColor={C.textMuted}
                value={discoverSearch}
                onChangeText={setDiscoverSearch}
              />
              {discoverSearch.length > 0 && (
                <TouchableOpacity onPress={() => setDiscoverSearch('')}>
                  <X size={15} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>

            {/* Join with invite code — light orange, bordered */}
            <View style={styles.codeCard}>
              <View style={styles.codeCardTop}>
                <View style={styles.codeCardIconWrap}>
                  <Lock size={24} color="#F97316" />
                </View>
                <View style={styles.codeCardTextWrap}>
                  <Text style={styles.codeCardTitle}>Join with Invite Code</Text>
                  <Text style={styles.codeCardSub}>Enter the code to join a private group</Text>
                </View>
              </View>
              <View style={styles.codeRow}>
                <TextInput
                  style={styles.codeInput}
                  placeholder="e.g. MSF-A1B2C3"
                  placeholderTextColor="rgba(249,115,22,0.4)"
                  autoCapitalize="characters"
                  maxLength={12}
                  value={inviteCodeInput}
                  onChangeText={setInviteCodeInput}
                  editable={!joiningByCode}
                />
                <TouchableOpacity
                  style={[styles.codeJoinBtn, joiningByCode && { opacity: 0.6 }]}
                  onPress={() => void handleJoinByCode()}
                  disabled={joiningByCode}
                >
                  {joiningByCode ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Send size={14} color="#FFFFFF" />
                      <Text style={styles.codeJoinText}>Join</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Section header with sort */}
            <View style={styles.discoverSectionRow}>
              <Text style={[styles.discoverSectionLabel, { color: C.text }]}>Available Groups</Text>
              <TouchableOpacity
                style={styles.sortBtn}
                onPress={() => setSortModalVisible(true)}
                activeOpacity={0.75}
              >
                <Text style={[styles.sortBtnText, { color: C.textSub }]}>{sortLabel}</Text>
                <FontAwesome name="chevron-down" size={11} color={C.textSub} />
              </TouchableOpacity>
            </View>

            {discoverLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#F97316" size="large" />
                <Text style={styles.loadingText}>Loading public groups…</Text>
              </View>
            ) : filteredDiscover.length > 0 ? (
              filteredDiscover.map((g) => (
                <DiscoverCard key={g.id} group={g} userId={user?.id ?? ''} C={C} />
              ))
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
                <Text style={[styles.emptyTitle, { color: C.text }]}>No public groups found</Text>
                <Text style={[styles.emptyDesc, { color: C.textMuted }]}>
                  {discoverSearch ? `No groups match "${discoverSearch}"` : 'No public groups are available right now.'}
                </Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <InviteModal
        visible={inviteGroup !== null}
        group={inviteGroup}
        onClose={() => setInviteGroup(null)}
        C={C}
      />

      {/* ── Sort Modal ───────────────────────────────────────── */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.sortBackdrop}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        />
        <View style={[styles.sortSheet, { backgroundColor: C.card }]}>
          <View style={styles.sortHandle} />
          <Text style={[styles.sortSheetTitle, { color: C.text }]}>Sort Groups By</Text>
          {SORT_OPTIONS.map((opt) => {
            const isActive = sortBy === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.sortOptionRow,
                  isActive && styles.sortOptionRowActive,
                ]}
                onPress={() => { setSortBy(opt.key); setSortModalVisible(false); }}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sortOptionLabel, { color: C.text }, isActive && styles.sortOptionLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.sortOptionDesc, { color: C.textMuted }]}>{opt.desc}</Text>
                </View>
                {isActive && (
                  <View style={styles.sortCheckCircle}>
                    <FontAwesome name="check" size={12} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.sortCancelBtn}
            onPress={() => setSortModalVisible(false)}
          >
            <Text style={styles.sortCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Floating Create Button ── */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(groups)/create')}
        activeOpacity={0.88}
      >
        <Plus size={26} color="#FFFFFF" strokeWidth={2.5} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  /* Page header */
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  pageTitle: { fontSize: 28, fontWeight: '800', color: '#1E2B5A' },
  pageSubtitle: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 10,
  },

  /* Tabs – underline style */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    position: 'relative',
  },
  tabLabel: { fontSize: 14, fontWeight: '600', color: '#9CA3AF' },
  tabLabelActive: { color: '#F97316', fontWeight: '700' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: '15%',
    right: '15%',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#F97316',
  },

  /* Search */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#1E2B5A' },

  /* Scroll */
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 20 },

  /* ── Group Card ── */
  groupCard: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 0,
  },
  groupCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  groupAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 14,
    borderWidth: 2,
    borderColor: '#F97316',
  },
  groupAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  groupAvatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  groupCardInfo: { flex: 1 },
  groupCardName: { fontSize: 17, fontWeight: '700', color: '#1E2B5A', marginBottom: 3 },
  groupCardMeta: { fontSize: 13, color: '#6B7280' },

  /* CREATOR badge – outline only, no background fill */
  creatorBadge: {
    borderWidth: 1.5,
    borderColor: '#F97316',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  creatorBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#F97316',
    letterSpacing: 0.5,
  },

  /* Stats row */
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 13, fontWeight: '700', color: '#1E2B5A' },
  statLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: '#E5E7EB' },

  /* Action row */
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 6,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },

  /* Card divider */
  cardDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 0,
  },

  /* ── Discover ── */
  discoverSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 4,
    marginTop: 4,
  },
  discoverSectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortBtnText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },

  discoverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  discoverIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  discoverInfo: { flex: 1 },
  discoverNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 3 },
  discoverName: { fontSize: 15, fontWeight: '700', color: '#1E2B5A' },
  discoverMeta: { fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  discoverTag: { fontSize: 11, color: '#9CA3AF', marginBottom: 8 },
  popularBadge: { backgroundColor: '#FFF7ED', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  popularBadgeText: { fontSize: 11, color: '#F97316', fontWeight: '700' },
  memberAvatarStack: { flexDirection: 'row', alignItems: 'center' },
  memberAvatarCircle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#FFFFFF' },
  memberAvatarMore: { backgroundColor: '#E5E7EB', alignItems: 'center' as const, justifyContent: 'center' as const },
  memberAvatarMoreText: { fontSize: 9, fontWeight: '700', color: '#6B7280' },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F97316',
    minWidth: 72,
    alignSelf: 'center' as const,
  },
  joinBtnDone: { backgroundColor: '#DCFCE7' },
  joinBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  joinBtnTextDone: { color: '#10B981' },

  /* Join code card — light orange, bordered */
  codeCard: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    marginHorizontal: 20,
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5,
    borderColor: '#F97316',
  },
  codeCardTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  codeCardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFEDD5',
    borderWidth: 1,
    borderColor: '#FDBA74',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCardTextWrap: { flex: 1 },
  codeCardTitle: { fontSize: 15, fontWeight: '800', color: '#1E2B5A', marginBottom: 3 },
  codeCardSub: { fontSize: 12, color: '#9CA3AF', lineHeight: 18 },
  codeRow: { flexDirection: 'row', gap: 10 },
  codeInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDBA74',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1E2B5A',
    fontWeight: '800',
    letterSpacing: 3,
  },
  codeJoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  codeJoinText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

  /* Empty / loading */
  loadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loadingText: { color: '#9CA3AF', fontSize: 14 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginTop: 8,
    marginHorizontal: 20,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1E2B5A', marginTop: 14, marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F97316',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 11,
    marginTop: 18,
  },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  /* ── Modals ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E2B5A' },
  modalSub: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Modal fields */
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  inputField: { flex: 1, paddingVertical: 13, fontSize: 15, color: '#1E2B5A' },
  inviteContactScreen: { flexGrow: 1, minHeight: 360 },
  contactList: { maxHeight: 300 },

  /* Contact row */
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  contactAvatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 14, fontWeight: '700', color: '#1E2B5A' },
  contactPhone: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  contactInviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F97316',
    minWidth: 60,
    alignItems: 'center',
  },
  contactInviteBtnDone: { backgroundColor: '#D1FAE5' },
  contactInviteBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },

  /* Primary button */
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F97316',
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 4,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  /* Outline button */
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 13,
    borderWidth: 1.5,
    borderColor: '#FDBA74',
    marginTop: 8,
  },
  outlineBtnText: { color: '#F97316', fontSize: 14, fontWeight: '700' },

  /* Divider */
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#F3F4F6' },
  dividerLabel: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },

  /* Invite link */
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  linkText: { flex: 1, fontSize: 12, color: '#C2410C', fontWeight: '600' },

  /* Collector note */
  collectorNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 12,
    marginVertical: 14,
  },
  collectorNoteText: { flex: 1, fontSize: 12, color: '#374151', lineHeight: 18 },

  /* ── Sort Modal ── */
  sortBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)' },
  sortSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 6,
  },
  sortHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center', marginTop: 10, marginBottom: 20,
  },
  sortSheetTitle: {
    fontSize: 20, fontWeight: '800', color: '#1E2B5A', marginBottom: 16,
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: '#F9FAFB',
  },
  sortOptionRowActive: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5,
    borderColor: '#F97316',
  },
  sortOptionLabel: { fontSize: 15, fontWeight: '700', color: '#1E2B5A', marginBottom: 2 },
  sortOptionLabelActive: { color: '#F97316' },
  sortOptionDesc: { fontSize: 12, color: '#9CA3AF' },
  sortCheckCircle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#F97316',
    alignItems: 'center', justifyContent: 'center',
  },
  sortCancelBtn: {
    alignItems: 'center', paddingVertical: 16, marginTop: 4,
  },
  sortCancelText: { fontSize: 15, fontWeight: '700', color: '#9CA3AF' },
});
