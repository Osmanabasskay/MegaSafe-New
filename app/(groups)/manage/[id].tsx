import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  Check,
  ClipboardList,
  Hash,
  MessageCircle,
  Phone,
  Search,
  Send,
  Shield,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react-native';
import { useAuthStore } from '../../../src/store/authStore';
import {
  fetchGroupAdminContacts,
  fetchGroupContributions,
  fetchGroupMembers,
  fetchActiveCollectorsForGroup,
  assignContributor,
  deactivateCollector,
  deleteGroup,
  getGroupById,
  type ActiveCollectorInfo,
  type GroupAdminContact,
  type GroupContributionSummary,
  type GroupMemberSummary,
} from '../../../src/services/groupService';
import { getGroupSummary } from '../../../src/api/reportApi';
import type { OsusuGroup } from '../../../src/types/group';

// ─── Tab types ─────────────────────────────────────────────────
type ActiveTab = 'overview' | 'members' | 'contributions' | 'collector';

// ─── Collector record ──────────────────────────────────────────
type CollectorRecord = {
  id: string;
  memberId: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  active: boolean;
  assignedAt: string;
};

// ─── Helpers ───────────────────────────────────────────────────
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getStatusColors(status: GroupContributionSummary['status']): { bg: string; text: string } {
  if (status === 'verified') return { bg: '#DCFCE7', text: '#166534' };
  if (status === 'collected') return { bg: '#FEF3C7', text: '#92400E' };
  if (status === 'disputed') return { bg: '#FED7AA', text: '#C2410C' };
  if (status === 'refunded') return { bg: '#E5E7EB', text: '#374151' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

// ─── Assign Collector Modal ─────────────────────────────────────
type AssignCollectorModalProps = {
  visible: boolean;
  groupId: string;
  addedBy: string;
  members: GroupMemberSummary[];
  onClose: () => void;
  onAssigned: () => void; // refresh parent after successful assignment
};

function AssignCollectorModal({ visible, groupId, addedBy, members, onClose, onAssigned }: AssignCollectorModalProps) {
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAssign = async () => {
    const member = members.find((m) => m.userId === selectedMemberId);
    if (!member) {
      Alert.alert('Select member', 'Choose a member to assign as collector.');
      return;
    }
    setSubmitting(true);
    const { success, secretCode, collectorPasscode, error } = await assignContributor({
      groupId,
      userId:    member.userId,
      addedBy,
    });
    setSubmitting(false);

    if (!success || error) {
      Alert.alert('Assignment failed', error?.message ?? 'Could not assign collector. Please try again.');
      return;
    }

    onClose();
    // Refresh the collector list from the server before showing codes.
    onAssigned();

    // Show server-generated credentials to the admin.
    const lines: string[] = [`${member.displayName} is now the collector for this group.`];
    if (collectorPasscode) lines.push(`\nCollector Passcode: ${collectorPasscode}`);
    if (secretCode)       lines.push(`Member Secret Code: ${secretCode}`);
    if (collectorPasscode || secretCode) {
      lines.push('\nSave these codes — they cannot be retrieved again.');
    }
    Alert.alert('Collector Assigned', lines.join('\n'));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Assign Collector</Text>
              <Text style={styles.modalSub}>Pick a member to collect payments</Text>
            </View>
            <TouchableOpacity style={styles.modalClose} onPress={onClose}>
              <X size={18} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Select Member</Text>
            {members.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[styles.memberPickRow, selectedMemberId === m.userId && styles.memberPickRowActive]}
                onPress={() => setSelectedMemberId(m.userId)}
              >
                <View style={styles.memberPickAvatar}>
                  <Text style={styles.memberPickAvatarText}>{getInitials(m.displayName)}</Text>
                </View>
                <View style={styles.memberPickInfo}>
                  <Text style={styles.memberPickName}>{m.displayName}</Text>
                  {m.phone ? <Text style={styles.memberPickPhone}>{m.phone}</Text> : null}
                </View>
                {selectedMemberId === m.userId && <Check size={18} color="#10B981" />}
              </TouchableOpacity>
            ))}

            <View style={styles.noteCard}>
              <Shield size={14} color="#10B981" />
              <Text style={styles.noteCardText}>
                The collector will be notified and given access to record physical payments on behalf of the group.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, (!selectedMemberId || submitting) && styles.primaryBtnDisabled]}
              disabled={!selectedMemberId || submitting}
              onPress={() => void handleAssign()}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <UserCheck size={16} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Assign Collector</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Members Modal ─────────────────────────────────────────
type AddMembersModalProps = {
  visible: boolean;
  groupId: string;
  groupName: string;
  onClose: () => void;
};

type DeviceContact = {
  id: string;
  name: string;
  phone: string;
  initials: string;
};

function normPhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, '');
}

function contactInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function AddMembersModal({ visible, groupId, groupName, onClose }: AddMembersModalProps) {
  const [search, setSearch] = useState('');
  const [allContacts, setAllContacts] = useState<DeviceContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Allow MegaSafe to access your contacts to invite group members.');
      onClose();
      return;
    }
    setLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      const mapped: DeviceContact[] = [];
      for (const c of data) {
        const name = c.name?.trim() || 'Unknown';
        for (const p of c.phoneNumbers ?? []) {
          const raw = p.number ?? '';
          if (!raw) continue;
          mapped.push({ id: `${c.id ?? ''}-${raw}`, name, phone: normPhone(raw), initials: contactInitials(name) });
        }
      }
      const seen = new Set<string>();
      setAllContacts(mapped.filter((c) => { if (seen.has(c.phone)) return false; seen.add(c.phone); return true; }));
    } catch {
      Alert.alert('Error', 'Could not load contacts.');
    } finally {
      setLoading(false);
    }
  }, [onClose]);

  useEffect(() => {
    if (visible) { setSearch(''); setInvitedIds(new Set()); void loadContacts(); }
  }, [visible, loadContacts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allContacts;
    return allContacts.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [allContacts, search]);

  const handleInvite = async (contact: DeviceContact) => {
    setInvitingId(contact.id);
    await new Promise((r) => setTimeout(r, 700));
    setInvitingId(null);
    setInvitedIds((prev) => new Set(prev).add(contact.id));
    Alert.alert('Invite sent', `Invitation sent to ${contact.name} (${contact.phone}).`);
  };

  const renderItem = ({ item }: { item: DeviceContact }) => {
    const invited = invitedIds.has(item.id);
    const isLoading = invitingId === item.id;
    return (
      <View style={styles.contactRow}>
        <View style={styles.contactAvatar}>
          <Text style={styles.contactAvatarText}>{item.initials}</Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.contactPhone}>{item.phone}</Text>
        </View>
        <TouchableOpacity
          style={[styles.inviteBtn, invited && styles.inviteBtnDone]}
          disabled={invited || isLoading}
          onPress={() => void handleInvite(item)}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : invited ? (
            <Check size={14} color="#10B981" />
          ) : (
            <Text style={styles.inviteBtnText}>Invite</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.fullScreenModal}>
        <View style={styles.fullModalHeader}>
          <TouchableOpacity style={styles.fullModalBackBtn} onPress={onClose}>
            <ArrowLeft size={22} color="#1E2B5A" />
          </TouchableOpacity>
          <View style={styles.fullModalTitleWrap}>
            <Text style={styles.fullModalTitle}>Add Members</Text>
            <Text style={styles.fullModalSub} numberOfLines={1}>{groupName}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.searchRow}>
          <Search size={16} color="#9CA3AF" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or number…"
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}><X size={14} color="#9CA3AF" /></TouchableOpacity>
          )}
        </View>
        {loading ? (
          <View style={styles.fullModalLoading}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={styles.fullModalLoadingText}>Loading contacts…</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}
            ListEmptyComponent={
              <View style={styles.fullModalEmpty}>
                <Users size={48} color="#D1D5DB" />
                <Text style={styles.emptyInlineText}>
                  {search ? `No results for "${search}"` : 'No contacts found'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Main Screen ───────────────────────────────────────────────
export default function ManageGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; ledgerRefresh?: string }>();
  const groupId = params.id != null ? String(params.id) : '';
  const ledgerRefresh = params.ledgerRefresh != null ? String(params.ledgerRefresh) : '';
  const { user } = useAuthStore();

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [group, setGroup] = useState<OsusuGroup | null>(null);
  const [adminContacts, setAdminContacts] = useState<GroupAdminContact[]>([]);
  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [contributions, setContributions] = useState<GroupContributionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [collectors, setCollectors] = useState<CollectorRecord[]>([]);
  const [groupSummary, setGroupSummary] = useState<Record<string, unknown> | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [addMembersVisible, setAddMembersVisible] = useState(false);
  const [suspendedIds, setSuspendedIds] = useState<Set<string>>(new Set());

  const isCreator = group?.created_by === user?.id;

  const loadDashboard = async () => {
    if (!groupId) { setLoadError('Missing group id.'); setIsLoading(false); return; }
    setLoadError(null);
    const { group: loadedGroup, error: groupError } = await getGroupById(groupId);
    if (groupError) setLoadError(groupError.message);
    if (!loadedGroup) { setGroup(null); setIsLoading(false); return; }
    setGroup(loadedGroup);

    const [contactResult, memberResult, contributionResult, summaryResult] = await Promise.all([
      fetchGroupAdminContacts(loadedGroup),
      fetchGroupMembers(loadedGroup.id),
      fetchGroupContributions(loadedGroup.id),
      getGroupSummary(loadedGroup.id),
    ]);
    if (summaryResult.summary) setGroupSummary(summaryResult.summary);
    const collectorResult = await fetchActiveCollectorsForGroup(loadedGroup.id);
    setAdminContacts(contactResult.contacts);
    setMembers(memberResult.members);
    setContributions(contributionResult.contributions);
    setCollectors(collectorResult.collectors.map((collector: ActiveCollectorInfo) => ({
      id: collector.id,
      memberId: collector.profileId,
      name: collector.displayName,
      phone: memberResult.members.find((member) => member.userId === collector.profileId)?.phone ?? '',
      photoUrl: collector.photoUrl,
      active: collector.isActive,
      assignedAt: new Date().toISOString(),
    })));
    const firstError = contactResult.error ?? memberResult.error ?? contributionResult.error ?? collectorResult.error ?? null;
    if (firstError) setLoadError(firstError.message);
    setIsLoading(false);
  };

  useEffect(() => { void loadDashboard(); }, [groupId, ledgerRefresh]);

  const onRefresh = async () => { setRefreshing(true); await loadDashboard(); setRefreshing(false); };

  // Financial totals from server summary — never recalculated on the client.
  const totalCollected = Number(groupSummary?.total_collected ?? 0);
  const pendingCount   = Number(groupSummary?.pending_count ?? 0);
  // myContributions is a structural filter (display only), not a financial calculation.
  const myContributions = useMemo(() => contributions.filter((c) => c.memberId === user?.id), [contributions, user?.id]);

  const primaryAdminPhone = adminContacts[0]?.phone ?? null;

  const toggleCollector = (collectorId: string) => {
    const collector = collectors.find((c) => c.id === collectorId);
    if (!collector || !group || !user) return;
    if (!collector.active) return;
    Alert.alert(
      'Remove collector',
      `${collector.name} will no longer be authorized to collect physical payments. Members will be notified immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deactivateCollector({
              groupId: group.id,
              collectorProfileId: collector.memberId,
              deactivatedBy: user.id,
            });
            if (error) {
              Alert.alert('Remove failed', error.message);
              return;
            }
            setCollectors((prev) => prev.map((c) => (c.id === collectorId ? { ...c, active: false } : c)));
          },
        },
      ]
    );
  };

  const handleDeleteGroup = () => {
    if (!group || !user) return;
    Alert.alert(
      'Delete group?',
      `"${group.name}" will be deleted if it has no members. If it has members, a super-admin review request will be created.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingGroup(true);
            const { success, outcome, error } = await deleteGroup({ groupId: group.id, userId: user.id });
            setIsDeletingGroup(false);
            if (!success || error) {
              Alert.alert('Not deleted', error?.message ?? 'Unable to delete this group.');
              return;
            }
            if (outcome === 'pending_super_admin') {
              Alert.alert('Deletion pending', 'This group has members. A super admin will review the deletion request.');
              await loadDashboard();
              return;
            }
            Alert.alert('Group deleted', `"${group.name}" was deleted.`, [
              { text: 'OK', onPress: () => router.replace('/(main)/groups') },
            ]);
          },
        },
      ]
    );
  };

  const allTabs: { id: ActiveTab; label: string; adminOnly?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'contributions', label: 'My Payments' },
    { id: 'collector', label: 'Activity', adminOnly: true },
  ];
  const visibleTabs = allTabs.filter((t) => !t.adminOnly || isCreator);

  // ─── Overview Tab ──────────────────────────────────────────
  const renderOverview = () => (
    <View style={styles.sectionStack}>
      {/* Admin contact section */}
      <View>
        <Text style={styles.sectionTitle}>Admin contact</Text>
        {adminContacts.length > 0 ? (
          adminContacts.map((contact) => (
            <View key={`${contact.id}-${contact.phone}`} style={styles.adminContactRow}>
              <View style={styles.adminContactIcon}>
                <Phone size={16} color="#F97316" />
              </View>
              <View style={styles.adminContactBody}>
                <Text style={styles.adminContactLabel}>{contact.label}</Text>
                <Text style={styles.adminContactPhone}>{contact.phone}</Text>
              </View>
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>{contact.role}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No admin collection number configured yet.</Text>
        )}
      </View>

      {/* Divider */}
      <View style={styles.sectionDivider} />

      {/* Latest contributions */}
      <View>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Latest contributions</Text>
          <Text style={styles.sectionMeta}>{pendingCount} pending</Text>
        </View>
        {contributions.length > 0 ? (
          contributions.slice(0, 6).map((entry) => {
            const colors = getStatusColors(entry.status);
            const member = members.find((m) => m.userId === entry.memberId);
            return (
              <View key={entry.id} style={styles.ledgerRow}>
                <View style={styles.ledgerAvatar}>
                  <Text style={styles.ledgerAvatarText}>{getInitials(member?.displayName ?? 'M')}</Text>
                </View>
                <View style={styles.ledgerBody}>
                  <Text style={styles.ledgerName}>{member?.displayName ?? 'Member'}</Text>
                  <Text style={styles.ledgerMeta}>{entry.contributionPeriod} · {entry.collectionMethod.replace(/_/g, ' ')}</Text>
                </View>
                <View style={styles.ledgerRight}>
                  <Text style={styles.ledgerAmount}>NLe {entry.amount.toFixed(2)}</Text>
                  <View style={[styles.statusPill, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.statusPillText, { color: colors.text }]}>{entry.status.replace(/_/g, ' ')}</Text>
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyBoxIcon}>📦</Text>
            <Text style={styles.emptyText}>No contribution records yet.</Text>
          </View>
        )}
      </View>
    </View>
  );

  // ─── Members Tab ───────────────────────────────────────────
  const toggleSuspend = (memberId: string, name: string) => {
    const isSuspended = suspendedIds.has(memberId);
    Alert.alert(
      isSuspended ? 'Reactivate member' : 'Suspend member',
      isSuspended
        ? `Allow ${name} to contribute and participate again?`
        : `Suspend ${name}? They will not be able to contribute or participate until reactivated.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSuspended ? 'Reactivate' : 'Suspend',
          style: isSuspended ? 'default' : 'destructive',
          onPress: () => {
            setSuspendedIds((prev) => {
              const next = new Set(prev);
              if (next.has(memberId)) { next.delete(memberId); } else { next.add(memberId); }
              return next;
            });
          },
        },
      ],
    );
  };

  const renderMembers = () => (
    <View style={styles.sectionStack}>
      {isCreator && (
        <TouchableOpacity style={styles.outlineBtn} onPress={() => setAddMembersVisible(true)}>
          <UserPlus size={16} color="#F97316" />
          <Text style={styles.outlineBtnText}>Add Members from Contacts</Text>
        </TouchableOpacity>
      )}

      {/* Suspended count banner */}
      {isCreator && suspendedIds.size > 0 && (
        <View style={styles.suspendBanner}>
          <UserX size={14} color="#991B1B" />
          <Text style={styles.suspendBannerText}>
            {suspendedIds.size} member{suspendedIds.size > 1 ? 's' : ''} currently suspended
          </Text>
        </View>
      )}

      <View>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Member roster</Text>
          <Text style={styles.sectionMeta}>{members.length} members</Text>
        </View>
        {members.length > 0 ? (
          members.map((m, idx) => {
            const isSuspended = suspendedIds.has(m.userId);
            return (
              <View
                key={m.id}
                style={[
                  styles.memberRow,
                  idx < members.length - 1 && styles.memberRowBorder,
                  isSuspended && styles.memberRowSuspended,
                ]}
              >
                {/* Avatar */}
                <View style={[styles.memberAvatar, isSuspended && styles.memberAvatarSuspended]}>
                  <Text style={[styles.memberAvatarText, isSuspended && { color: '#9CA3AF' }]}>
                    {getInitials(m.displayName)}
                  </Text>
                </View>

                {/* Info */}
                <View style={styles.memberInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.memberRowName, isSuspended && { color: '#9CA3AF' }]}>
                      {m.displayName}
                    </Text>
                    {isSuspended && (
                      <View style={styles.suspendedBadge}>
                        <Text style={styles.suspendedBadgeText}>Suspended</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.memberRowMeta}>
                    #{m.payoutPosition ?? idx + 1}{m.phone ? ` · ${m.phone}` : ''}
                  </Text>
                </View>

                {/* Admin deactivate toggle — creator only, not self */}
                {isCreator && m.userId !== user?.id && (
                  <TouchableOpacity
                    style={[styles.memberActionBtn, isSuspended ? styles.memberActionBtnActivate : styles.memberActionBtnSuspend]}
                    onPress={() => toggleSuspend(m.userId, m.displayName)}
                  >
                    {isSuspended
                      ? <ShieldCheck size={15} color="#166534" />
                      : <UserX size={15} color="#991B1B" />
                    }
                    <Text style={[styles.memberActionBtnText, { color: isSuspended ? '#166534' : '#991B1B' }]}>
                      {isSuspended ? 'Activate' : 'Suspend'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        ) : (
          <Text style={styles.emptyText}>No members linked to this group yet.</Text>
        )}
      </View>

      {isCreator && (
        <View style={styles.infoCard}>
          <Shield size={14} color="#F97316" />
          <Text style={styles.infoCardText}>
            Suspended members cannot contribute or access group features until reactivated by an admin.
          </Text>
        </View>
      )}
    </View>
  );

  // ─── My Contributions Tab ──────────────────────────────────
  const renderContributions = () => (
    <View style={styles.sectionStack}>
      {/* Payment route card — keep dark bg as it's a prominent CTA */}
      <View style={styles.paymentRouteCard}>
        <Text style={styles.paymentRouteLabel}>Next payment route</Text>
        <Text style={styles.paymentRouteValue}>
          {primaryAdminPhone ?? 'Admin number not configured'}
        </Text>
        <Text style={styles.paymentRouteMeta}>
          Amount due: NLe {(group?.contribution_amount ?? 0).toFixed(2)}
        </Text>
      </View>

      <View>
        <Text style={styles.sectionTitle}>My contribution history</Text>
        {myContributions.length > 0 ? (
          myContributions.map((entry, idx) => {
            const colors = getStatusColors(entry.status);
            return (
              <View key={entry.id} style={[styles.historyRow, idx < myContributions.length - 1 && styles.memberRowBorder]}>
                <View style={styles.historyLeft}>
                  <Text style={styles.historyTitle}>{entry.contributionPeriod}</Text>
                  <Text style={styles.historyMeta}>{new Date(entry.createdAt).toLocaleString()}</Text>
                </View>
                <View style={styles.historyRight}>
                  <Text style={styles.historyAmount}>NLe {entry.amount.toFixed(2)}</Text>
                  <View style={[styles.statusPill, { backgroundColor: colors.bg }]}>
                    <Text style={[styles.statusPillText, { color: colors.text }]}>{entry.status.replace(/_/g, ' ')}</Text>
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <Text style={styles.emptyText}>You have not made a contribution yet.</Text>
        )}
      </View>
    </View>
  );

  // ─── Collector Tab (admin only) ────────────────────────────
  const renderCollector = () => (
    <View style={styles.sectionStack}>
      {/* Physical collection CTA */}
      <TouchableOpacity
        style={styles.physCollectBtn}
        onPress={() => router.push(`/(groups)/collector?groupId=${groupId}`)}
      >
        <View style={styles.physCollectBtnIcon}>
          <ClipboardList size={20} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.physCollectBtnTitle}>Physical Collection</Text>
          <Text style={styles.physCollectBtnSub}>Record cash payments from members</Text>
        </View>
        <View style={styles.physCollectArrow}>
          <Text style={{ color: '#FFFFFF', fontSize: 18 }}>›</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.outlineBtn} onPress={() => router.push(`/(groups)/assign-contributors?id=${groupId}`)}>
        <UserCheck size={16} color="#1D4ED8" />
        <Text style={[styles.outlineBtnText, { color: '#1D4ED8' }]}>Assign New Collector</Text>
      </TouchableOpacity>

      {collectors.length === 0 ? (
        <Text style={[styles.emptyText, { marginTop: 8 }]}>
          No collectors assigned yet. Assign a member above to allow them to collect payments on your behalf.
        </Text>
      ) : (
        collectors.map((c) => (
          <View key={c.id} style={[styles.collectorRow, !c.active && { opacity: 0.65 }]}>
            <View style={[styles.collectorAvatar, { backgroundColor: c.active ? '#FFF7ED' : '#F3F4F6' }]}>
              {c.photoUrl ? (
                <Image source={{ uri: c.photoUrl }} style={styles.collectorAvatarImage} />
              ) : (
                <Text style={[styles.collectorAvatarText, { color: c.active ? '#F97316' : '#9CA3AF' }]}>
                  {getInitials(c.name)}
                </Text>
              )}
            </View>
            <View style={styles.collectorInfo}>
              <Text style={styles.collectorName}>{c.name}</Text>
              {c.phone ? <Text style={styles.collectorPhone}>{c.phone}</Text> : null}
              <View style={[styles.collectorStatusPill, { backgroundColor: c.active ? '#DCFCE7' : '#FEE2E2' }]}>
                {c.active
                  ? <ShieldCheck size={11} color="#166534" />
                  : <ShieldOff size={11} color="#991B1B" />
                }
                <Text style={[styles.collectorStatusText, { color: c.active ? '#166534' : '#991B1B' }]}>
                  {c.active ? 'Active collector' : 'Deactivated'}
                </Text>
              </View>
            </View>
            <Switch
              value={c.active}
              onValueChange={() => toggleCollector(c.id)}
              trackColor={{ false: '#FECACA', true: '#BBF7D0' }}
              thumbColor={c.active ? '#10B981' : '#EF4444'}
            />
          </View>
        ))
      )}

      <View style={styles.infoCard}>
        <Shield size={14} color="#1D4ED8" />
        <Text style={styles.infoCardText}>
          Collectors can record physical payments from members and send instant verification. Deactivate immediately if fraud is suspected.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.dangerBtn, isDeletingGroup && { opacity: 0.65 }]}
        onPress={handleDeleteGroup}
        disabled={isDeletingGroup}
      >
        {isDeletingGroup ? (
          <ActivityIndicator color="#991B1B" />
        ) : (
          <>
            <UserX size={16} color="#991B1B" />
            <Text style={styles.dangerBtnText}>Delete Group</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  // ─── Loading / Error ───────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator color="#F97316" size="large" />
        <Text style={styles.loadingText}>Loading group…</Text>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.emptyTitle}>Group not found</Text>
        <Text style={styles.emptyText}>{loadError ?? 'Could not load this group.'}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top bar ─────────────────────────────────────── */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.topBarBtn}>
            <ArrowLeft size={22} color="#F97316" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBarBtnBell}>
            <Bell size={20} color="#1E2B5A" />
          </TouchableOpacity>
        </View>

        {/* ── Hero — flat layout ──────────────────────────── */}
        <View style={styles.heroSection}>
          <View style={styles.heroRow}>
            {/* Avatar */}
            <View style={styles.heroLogo}>
              {group.avatar_url ? (
                <Image source={{ uri: group.avatar_url }} style={styles.heroLogoImage} />
              ) : (
                <Text style={styles.heroLogoText}>{getInitials(group.name)}</Text>
              )}
            </View>

            {/* Info */}
            <View style={styles.heroInfo}>
              <Text style={styles.heroTitle} numberOfLines={2}>{group.name}</Text>
              <Text style={styles.heroMetaText}>
                {members.length || group.max_members} member{(members.length || group.max_members) !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.heroMetaText}>
                NLe {group.contribution_amount.toFixed(0)} / {group.frequency}
              </Text>
              <Text style={[styles.heroMetaText, { color: '#10B981', fontWeight: '700' }]}>
                NLe {totalCollected.toFixed(0)} collected
              </Text>
            </View>

            {/* Right: payout */}
            <View style={styles.heroRight}>
              <Text style={styles.nextPayoutLabel}>Next payout</Text>
              <Text style={styles.nextPayoutValue}>{group.cycle_start_date ?? 'Pending'}</Text>
            </View>
          </View>

          {group.description ? (
            <Text style={styles.heroDescription}>{group.description}</Text>
          ) : null}

          {/* Chat FAB */}
          <TouchableOpacity
            style={styles.chatFab}
            onPress={() => router.push(`/(groups)/chat/${group.id}`)}
            activeOpacity={0.88}
          >
            <MessageCircle size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Error banner */}
        {loadError ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>Sync issue</Text>
            <Text style={styles.warningText}>{loadError}</Text>
          </View>
        ) : null}

        {/* ── Tabs — underline style ───────────────────────── */}
        <View style={styles.tabBar}>
          {visibleTabs.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.tabBtn}
              onPress={() => setActiveTab(t.id)}
            >
              <Text style={[styles.tabLabel, activeTab === t.id && styles.tabLabelActive]}>
                {t.label}
              </Text>
              {activeTab === t.id && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Tab content ──────────────────────────────────── */}
        <View style={styles.tabContent}>
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'members' && renderMembers()}
          {activeTab === 'contributions' && renderContributions()}
          {activeTab === 'collector' && isCreator && renderCollector()}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <AssignCollectorModal
        visible={assignModalVisible}
        groupId={group.id}
        addedBy={user?.id ?? ''}
        members={members}
        onClose={() => setAssignModalVisible(false)}
        onAssigned={() => void loadDashboard()}
      />

      <AddMembersModal
        visible={addMembersVisible}
        groupId={group.id}
        groupName={group.name}
        onClose={() => setAddMembersVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 14 },

  /* ── Top bar ────────────────────────────────────────────── */
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  topBarBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBtnBell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Hero — flat ────────────────────────────────────────── */
  heroSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    position: 'relative',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  heroLogo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#FFF3E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    overflow: 'hidden',
  },
  heroLogoImage: { width: '100%', height: '100%' },
  heroLogoText: { fontSize: 26, fontWeight: '800', color: '#F97316' },
  heroInfo: { flex: 1 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#1E2B5A', marginBottom: 8, lineHeight: 28 },
  heroMetaText: { color: '#6B7280', fontSize: 13, fontWeight: '500', marginBottom: 5 },
  heroRight: {
    alignItems: 'flex-end',
    paddingTop: 4,
    minWidth: 90,
  },
  nextPayoutLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '600', letterSpacing: 0.2 },
  nextPayoutValue: { marginTop: 4, color: '#1E2B5A', fontSize: 14, fontWeight: '800' },
  heroDescription: { color: '#6B7280', fontSize: 13, lineHeight: 19, marginTop: 4 },

  /* Chat FAB */
  chatFab: {
    position: 'absolute',
    right: 20,
    bottom: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },

  /* ── Warning card ───────────────────────────────────────── */
  warningCard: { backgroundColor: '#FFF7ED', borderRadius: 14, padding: 14, marginHorizontal: 20, marginBottom: 14 },
  warningTitle: { color: '#9A3412', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  warningText: { color: '#9A3412', fontSize: 13, lineHeight: 19 },

  /* ── Tabs — underline style ─────────────────────────────── */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 20,
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
    left: '10%',
    right: '10%',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#F97316',
  },

  /* ── Tab content ────────────────────────────────────────── */
  tabContent: { paddingHorizontal: 20 },

  /* ── Section helpers ─────────────────────────────────────── */
  sectionStack: { gap: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1E2B5A', marginBottom: 14 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionMeta: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },
  sectionDivider: { height: 1, backgroundColor: '#F3F4F6' },

  /* ── Admin contact ───────────────────────────────────────── */
  adminContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  adminContactIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF3E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  adminContactBody: { flex: 1 },
  adminContactLabel: { color: '#1E2B5A', fontSize: 14, fontWeight: '700' },
  adminContactPhone: { marginTop: 2, color: '#6B7280', fontSize: 13 },
  roleBadge: {
    paddingHorizontal: 4,
  },
  roleBadgeText: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },

  /* ── Ledger ──────────────────────────────────────────────── */
  ledgerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  ledgerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  ledgerAvatarText: { color: '#1E3A8A', fontSize: 12, fontWeight: '800' },
  ledgerBody: { flex: 1 },
  ledgerName: { color: '#1E2B5A', fontSize: 14, fontWeight: '700' },
  ledgerMeta: { marginTop: 2, color: '#6B7280', fontSize: 12 },
  ledgerRight: { alignItems: 'flex-end' },
  ledgerAmount: { color: '#1E2B5A', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  /* ── Empty wrap ──────────────────────────────────────────── */
  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyBoxIcon: { fontSize: 44 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1E2B5A', marginBottom: 8 },
  emptyText: { color: '#9CA3AF', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyInlineText: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', paddingVertical: 16 },

  /* ── Members ─────────────────────────────────────────────── */
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  memberRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF3E8', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  memberAvatarText: { color: '#F97316', fontSize: 14, fontWeight: '800' },
  memberInfo: { flex: 1 },
  memberRowName: { color: '#1E2B5A', fontSize: 14, fontWeight: '700' },
  memberRowMeta: { marginTop: 2, color: '#6B7280', fontSize: 12 },

  /* ── Outline button ──────────────────────────────────────── */
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#F97316',
    borderRadius: 14,
    paddingVertical: 13,
    backgroundColor: 'transparent',
  },
  outlineBtnText: { color: '#F97316', fontSize: 14, fontWeight: '700' },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 14,
    paddingVertical: 13,
    backgroundColor: '#FEF2F2',
  },
  dangerBtnText: { color: '#991B1B', fontSize: 14, fontWeight: '800' },

  /* ── Payment route card ──────────────────────────────────── */
  paymentRouteCard: { backgroundColor: '#1E2B5A', borderRadius: 20, padding: 18 },
  paymentRouteLabel: { color: '#BFDBFE', fontSize: 11, textTransform: 'uppercase', fontWeight: '700' },
  paymentRouteValue: { marginTop: 8, color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  paymentRouteMeta: { marginTop: 6, color: '#DBEAFE', fontSize: 13 },

  /* ── Contribution history ────────────────────────────────── */
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  historyLeft: { flex: 1 },
  historyTitle: { color: '#1E2B5A', fontSize: 14, fontWeight: '700' },
  historyMeta: { marginTop: 2, color: '#6B7280', fontSize: 12 },
  historyRight: { alignItems: 'flex-end' },
  historyAmount: { color: '#1E2B5A', fontSize: 14, fontWeight: '700', marginBottom: 4 },

  /* ── Collector tab ───────────────────────────────────────── */
  collectorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  collectorAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginRight: 14, overflow: 'hidden' },
  collectorAvatarImage: { width: '100%', height: '100%' },
  collectorAvatarText: { fontSize: 16, fontWeight: '800' },
  collectorInfo: { flex: 1 },
  collectorName: { color: '#1E2B5A', fontSize: 15, fontWeight: '700' },
  collectorPhone: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  collectorStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginTop: 6, alignSelf: 'flex-start' },
  collectorStatusText: { fontSize: 11, fontWeight: '700' },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#EFF6FF', borderRadius: 14, padding: 14 },
  infoCardText: { flex: 1, color: '#1E40AF', fontSize: 12, lineHeight: 18 },

  /* ── Modals ──────────────────────────────────────────────── */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 36, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E2B5A' },
  modalSub: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  modalClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },

  /* Member picker */
  memberPickRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6, backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: 'transparent' },
  memberPickRowActive: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  memberPickAvatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  memberPickAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  memberPickInfo: { flex: 1 },
  memberPickName: { fontSize: 14, fontWeight: '700', color: '#1E2B5A' },
  memberPickPhone: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12, marginVertical: 14 },
  noteCardText: { flex: 1, fontSize: 12, color: '#374151', lineHeight: 18 },

  /* Primary button (modal actions) */
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F97316', borderRadius: 16, paddingVertical: 14, marginTop: 4 },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  /* Add Members full-screen modal */
  fullScreenModal: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: Platform.OS === 'ios' ? 54 : 20 },
  fullModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  fullModalBackBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  fullModalTitleWrap: { flex: 1, alignItems: 'center' },
  fullModalTitle: { fontSize: 17, fontWeight: '700', color: '#1E2B5A' },
  fullModalSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  fullModalLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullModalLoadingText: { marginTop: 14, fontSize: 14, color: '#6B7280' },
  fullModalEmpty: { paddingVertical: 80, alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 14, marginHorizontal: 16, marginVertical: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 9, gap: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  searchInput: { flex: 1, fontSize: 14, color: '#1E2B5A' },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  contactAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  contactAvatarText: { color: '#3B82F6', fontSize: 15, fontWeight: '800' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '700', color: '#1E2B5A' },
  contactPhone: { fontSize: 12, color: '#9CA3AF', marginTop: 3 },
  inviteBtn: { backgroundColor: '#F97316', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, minWidth: 64, alignItems: 'center' },
  inviteBtnDone: { backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#BBF7D0' },
  inviteBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  /* Member suspension */
  memberRowSuspended:     { opacity: 0.7, backgroundColor: '#FEF2F2' },
  memberAvatarSuspended:  { backgroundColor: '#F3F4F6' },
  suspendedBadge:         { backgroundColor: '#FEE2E2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  suspendedBadgeText:     { fontSize: 10, fontWeight: '700', color: '#991B1B' },
  memberActionBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  memberActionBtnSuspend: { backgroundColor: '#FEE2E2' },
  memberActionBtnActivate:{ backgroundColor: '#DCFCE7' },
  memberActionBtnText:    { fontSize: 11, fontWeight: '700' },
  suspendBanner:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#FECACA' },
  suspendBannerText:      { fontSize: 13, color: '#991B1B', fontWeight: '600' },

  /* Physical collection CTA */
  physCollectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1E2B5A', borderRadius: 14, padding: 14,
  },
  physCollectBtnIcon:  { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  physCollectBtnTitle: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  physCollectBtnSub:   { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  physCollectArrow:    { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  /* Fields */
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
});
