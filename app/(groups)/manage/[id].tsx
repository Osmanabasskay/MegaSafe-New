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
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ImageStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CornerUpLeft,
  CornerUpRight,
  History,
  Image as ImageIcon,
  Info,
  Link2,
  Lock,
  LogOut,
  MessageCircle,
  Mic,
  MoreVertical,
  Pause,
  Phone,
  Play,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react-native';
import {
  addMemberToGroup,
  checkLeaveGroupEligibility,
  fetchActiveCollectorForGroup,
  fetchGroupContributions,
  fetchGroupMembers,
  getCurrentUserGroupRole,
  getGroupById,
  getGroupLedgerSummary,
  getGroupSettings,
  leaveGroup,
  listGroupsForUser,
  searchProfiles,
  type ActiveCollectorInfo,
  type GroupContributionSummary,
  type GroupLedgerSummary,
  type GroupListItem,
  type GroupMemberSummary,
  type ProfileSummary,
} from '../../../src/services/groupService';
import { useAuthStore } from '../../../src/store/authStore';
import type { OsusuGroup } from '../../../src/types/group';

// ─── Constants ─────────────────────────────────────────────────
const ORANGE = '#F97316';
const NAVY = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#F8FAFC';
const BORDER = '#F1F5F9';
const WAVE_COUNT = 28;
const EMOJI_LIST = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'];

// ─── Types ──────────────────────────────────────────────────────
type ViewerRole = 'creator' | 'admin' | 'member';
type ActiveTab = 'members' | 'ledger' | 'chat';
type MessageType = 'text' | 'image' | 'voice';
type MemberFilterKey = 'all' | 'paid' | 'pending' | 'missed' | 'admin';
type LedgerFilterKey = 'all' | 'collected' | 'pending' | 'disputed' | 'refunded';

type ReplyRef = {
  id: string;
  senderName: string;
  type: MessageType;
  text?: string;
  voiceDuration?: number;
};

type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  type: MessageType;
  text?: string;
  imageUri?: string;
  voiceDuration?: number;
  voiceUri?: string;
  timestamp: Date;
  isMe: boolean;
  reaction?: string;
  replyTo?: ReplyRef;
};

// ─── Helpers ───────────────────────────────────────────────────
function initials(name: string): string {
  return name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusColors(s: string): { bg: string; text: string } {
  if (s === 'active') return { bg: '#DCFCE7', text: '#166534' };
  if (s === 'paused') return { bg: '#FEF3C7', text: '#92400E' };
  if (s === 'completed') return { bg: '#DBEAFE', text: '#1E40AF' };
  if (s === 'disbanded') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#F1F5F9', text: MUTED };
}

function payStatusStyle(s: string): { bg: string; text: string } {
  if (s === 'paid') return { bg: '#DCFCE7', text: '#166534' };
  if (s === 'missed') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#FEF3C7', text: '#92400E' };
}

function txStatusStyle(s: string): { bg: string; text: string } {
  if (s === 'verified' || s === 'collected') return { bg: '#DCFCE7', text: '#166534' };
  if (s === 'disputed' || s === 'refunded') return { bg: '#FEE2E2', text: '#991B1B' };
  return { bg: '#FEF3C7', text: '#92400E' };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function profileName(p: ProfileSummary): string {
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ');
  return full || p.username || p.email?.split('@')[0] || 'Unknown';
}

function formatChatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function seedMessages(meId: string, meName: string): ChatMessage[] {
  const now = new Date();
  const t = (minAgo: number) => new Date(now.getTime() - minAgo * 60 * 1000);
  return [
    { id: '1', senderId: 'other1', senderName: 'Amara Sesay', type: 'text', text: "Good morning everyone! Ready for this month's contribution?", timestamp: t(32), isMe: false },
    { id: '2', senderId: 'other2', senderName: 'Binta Kamara', type: 'text', text: 'Yes, I will pay by Friday 🙏', timestamp: t(28), isMe: false },
    { id: '3', senderId: meId, senderName: meName, type: 'text', text: 'Same here. I already sent mine to the admin.', timestamp: t(20), isMe: true },
    { id: '4', senderId: 'other1', senderName: 'Amara Sesay', type: 'voice', voiceDuration: 13, timestamp: t(15), isMe: false },
    { id: '5', senderId: 'other3', senderName: 'Cherno Bah', type: 'text', text: "Great! Let's keep this going 💪", timestamp: t(5), isMe: false },
  ];
}

// ─── Chat: Static waveform bars ─────────────────────────────────
function StaticWaveform({ isMe, progress }: { isMe: boolean; progress: number }) {
  const heights = useRef(
    Array.from({ length: 22 }, (_, i) => 5 + Math.abs(Math.sin(i * 0.85 + 0.5)) * 14 + 3)
  ).current;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={{
            width: 3, height: h, borderRadius: 2,
            backgroundColor: i / heights.length <= progress
              ? (isMe ? 'rgba(255,255,255,0.95)' : ORANGE)
              : (isMe ? 'rgba(255,255,255,0.28)' : '#FDBA74'),
          }}
        />
      ))}
    </View>
  );
}

// ─── Chat: Live waveform during recording ───────────────────────
function LiveWaveform({ bars, paused }: { bars: number[]; paused: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1, height: 48 }}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={{
            width: 3,
            height: Math.max(4, h * 44),
            borderRadius: 2,
            backgroundColor: paused ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.82)',
          }}
        />
      ))}
    </View>
  );
}

// ─── Chat: Recording bar ────────────────────────────────────────
function RecordingBar({
  seconds, isPaused, waveBars, onDelete, onTogglePause, onSend,
}: {
  seconds: number; isPaused: boolean; waveBars: number[];
  onDelete: () => void; onTogglePause: () => void; onSend: () => void;
}) {
  return (
    <View style={styles.recBar}>
      <View style={styles.recWaveRow}>
        <Text style={styles.recTimer}>{formatDuration(seconds)}</Text>
        <LiveWaveform bars={waveBars} paused={isPaused} />
      </View>
      <View style={styles.recActionsRow}>
        <TouchableOpacity style={styles.recDeleteBtn} onPress={onDelete}>
          <Trash2 size={20} color="#9CA3AF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.recPauseBtn} onPress={onTogglePause}>
          {isPaused ? (
            <View style={styles.recResumeCircle}><View style={styles.recRecordDot} /></View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 5 }}>
              <View style={styles.recPauseBar} />
              <View style={styles.recPauseBar} />
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.recSendBtn} onPress={onSend}>
          <Send size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Chat: Emoji reaction bar ───────────────────────────────────
function EmojiBar({ onSelect, onDismiss }: { onSelect: (e: string) => void; onDismiss: () => void }) {
  return (
    <TouchableOpacity activeOpacity={1} onPress={onDismiss} style={styles.emojiBarWrap}>
      <TouchableOpacity activeOpacity={1} style={styles.emojiRow}>
        {EMOJI_LIST.map((e) => (
          <TouchableOpacity key={e} onPress={() => onSelect(e)} style={styles.emojiBtn}>
            <Text style={styles.emojiText}>{e}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={onDismiss} style={styles.emojiBtn}>
          <View style={styles.emojiMoreBtn}>
            <Text style={{ fontSize: 13, color: '#E5E7EB', fontWeight: '600' }}>+</Text>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Chat: Message bubble ───────────────────────────────────────
function MessageBubble({
  message, playingId, playProgress,
  onVoicePress, onLongPress,
  isSelected, isSelectionMode, onToggleSelect,
}: {
  message: ChatMessage;
  playingId: string | null;
  playProgress: number;
  onVoicePress: (id: string, duration: number, uri?: string) => void;
  onLongPress: (id: string) => void;
  isSelected: boolean;
  isSelectionMode: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const isPlaying = playingId === message.id;
  const playBtnBg = message.isMe ? 'rgba(255,255,255,0.18)' : '#FFF7ED';
  const playIconColor = message.isMe ? '#FFFFFF' : ORANGE;

  return (
    <View style={[
      styles.bubbleWrap,
      message.isMe ? styles.bubbleWrapMe : styles.bubbleWrapOther,
      isSelected && styles.bubbleWrapSelected,
    ]}>
      {isSelectionMode && (
        <View style={[styles.selCircle, isSelected && styles.selCircleActive]}>
          {isSelected && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
        </View>
      )}
      {!message.isMe && (
        <View style={[styles.bubbleAvatar, isSelectionMode && { opacity: 0.5 }]}>
          <Text style={styles.bubbleAvatarText}>{initials(message.senderName)}</Text>
        </View>
      )}
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => { if (isSelectionMode) onToggleSelect(message.id); }}
        onLongPress={() => onLongPress(message.id)}
        style={[styles.bubble, message.isMe ? styles.bubbleMe : styles.bubbleOther]}
      >
        {!message.isMe && <Text style={styles.bubbleSenderName}>{message.senderName}</Text>}

        {message.replyTo && (
          <View style={[styles.replyQuote, message.isMe ? styles.replyQuoteMe : styles.replyQuoteOther]}>
            <View style={[styles.replyQuoteBar, message.isMe ? styles.replyQuoteBarMe : styles.replyQuoteBarOther]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyQuoteName, message.isMe && { color: 'rgba(255,255,255,0.75)' }]}>
                {message.replyTo.senderName}
              </Text>
              <Text style={[styles.replyQuoteText, message.isMe && { color: 'rgba(255,255,255,0.55)' }]} numberOfLines={1}>
                {message.replyTo.type === 'voice'
                  ? `🎤 Voice · ${formatDuration(message.replyTo.voiceDuration ?? 0)}`
                  : message.replyTo.type === 'image' ? '📷 Photo'
                  : message.replyTo.text ?? ''}
              </Text>
            </View>
          </View>
        )}

        {message.type === 'text' && message.text && (
          <Text style={[styles.bubbleText, message.isMe ? styles.bubbleTextMe : styles.bubbleTextOther]}>
            {message.text}
          </Text>
        )}
        {message.type === 'image' && message.imageUri && (
          <Image source={{ uri: message.imageUri }} style={styles.bubbleImage} resizeMode="cover" />
        )}
        {message.type === 'voice' && (
          <TouchableOpacity
            style={styles.voiceNote}
            onPress={() => !isSelectionMode && onVoicePress(message.id, message.voiceDuration ?? 0, message.voiceUri)}
            activeOpacity={0.8}
          >
            <View style={[styles.voicePlayBtn, { backgroundColor: playBtnBg }]}>
              {isPlaying
                ? <Pause size={13} color={playIconColor} fill={playIconColor} />
                : <Play  size={13} color={playIconColor} fill={playIconColor} />
              }
            </View>
            <StaticWaveform isMe={message.isMe} progress={isPlaying ? playProgress : 0} />
            <Text style={[styles.voiceDuration, message.isMe && { color: 'rgba(255,255,255,0.80)' }]}>
              {formatDuration(message.voiceDuration ?? 0)}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.bubbleFooter}>
          {message.reaction && (
            <View style={styles.reactionBadge}><Text style={{ fontSize: 14 }}>{message.reaction}</Text></View>
          )}
          <Text style={[styles.bubbleTime, message.isMe ? styles.bubbleTimeMe : styles.bubbleTimeOther]}>
            {formatChatTime(message.timestamp)}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// MEMBERS TAB
// ═══════════════════════════════════════════════════════════════
const MEMBER_FILTERS: { key: MemberFilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'pending', label: 'Pending' },
  { key: 'missed', label: 'Missed' },
  { key: 'admin', label: 'Admin' },
];

function MembersTab({ groupId, viewerRole, collector, userId, onManage }: {
  groupId: string; viewerRole: ViewerRole; collector: ActiveCollectorInfo | null;
  userId: string; onManage: () => void;
}) {
  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MemberFilterKey>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<ProfileSummary[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const isManager = viewerRole === 'creator' || viewerRole === 'admin';

  const load = useCallback(async () => {
    const res = await fetchGroupMembers(groupId);
    setMembers(res.members);
    setLoading(false);
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleAddSearch = useCallback(async (q: string) => {
    setAddSearch(q);
    if (q.trim().length < 2) { setAddSearchResults([]); return; }
    setAddSearchLoading(true);
    const res = await searchProfiles(q.trim());
    setAddSearchResults(res.profiles);
    setAddSearchLoading(false);
  }, []);

  const handleAddMember = async (profile: ProfileSummary) => {
    setAddingId(profile.id);
    const res = await addMemberToGroup(groupId, profile.id, userId);
    setAddingId(null);
    if (!res.success) {
      Alert.alert('Error', res.error?.message ?? 'Could not add member.');
      return;
    }
    await load();
    Alert.alert('Added', `${profileName(profile)} has been added to the group.`);
  };

  const existingUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);

  const filtered = useMemo(() => {
    let list = members;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) =>
        m.displayName.toLowerCase().includes(q) || (m.phone ?? '').toLowerCase().includes(q)
      );
    }
    if (filter === 'paid') list = list.filter((m) => m.paymentStatus === 'paid');
    else if (filter === 'pending') list = list.filter((m) => m.paymentStatus === 'pending');
    else if (filter === 'missed') list = list.filter((m) => m.paymentStatus === 'missed');
    else if (filter === 'admin') list = list.filter((m) => m.role === 'creator' || m.role === 'admin');
    return list;
  }, [members, search, filter]);

  if (loading) {
    return (
      <View style={styles.tabLoading}>
        <ActivityIndicator color={ORANGE} />
        <Text style={styles.tabLoadingTxt}>Loading members…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Collector verification card */}
      {collector && (
        <View style={styles.collectorCard}>
          <View style={styles.collectorIconWrap}>
            {collector.avatarUrl
              ? <Image source={{ uri: collector.avatarUrl }} style={styles.collectorAvatar as ImageStyle} />
              : <View style={styles.collectorAvatarFallback}><ShieldCheck size={20} color="#FFFFFF" /></View>
            }
            <View style={styles.collectorVerifiedBadge}><Check size={9} color="#FFFFFF" /></View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.collectorLabel}>Assigned Collector</Text>
            <Text style={styles.collectorName}>{collector.displayName}</Text>
            {collector.phone && (
              <View style={styles.collectorPhoneRow}>
                <Phone size={11} color={MUTED} />
                <Text style={styles.collectorPhone}>{collector.phone}</Text>
              </View>
            )}
          </View>
          <View style={styles.collectorVerifyBadge}>
            <ShieldCheck size={13} color="#166534" />
            <Text style={styles.collectorVerifyTxt}>Verified</Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search members…"
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {MEMBER_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipTxt, filter === f.key && styles.filterChipTxtActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.countTxt}>
        {filtered.length} member{filtered.length !== 1 ? 's' : ''}
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const ps = payStatusStyle(item.paymentStatus);
          return (
            <View style={styles.memberCard}>
              <View style={styles.memberAvatarWrap}>
                {item.avatarUrl
                  ? <Image source={{ uri: item.avatarUrl }} style={styles.memberAvatar as ImageStyle} />
                  : (
                    <View style={styles.memberAvatarFallback}>
                      <Text style={styles.memberAvatarTxt}>{initials(item.displayName)}</Text>
                    </View>
                  )}
                {(item.role === 'creator' || item.role === 'admin') && (
                  <View style={styles.memberAdminBadge}>
                    <UserCheck size={9} color="#FFFFFF" />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{item.displayName}</Text>
                {item.phone && <Text style={styles.memberPhone}>{item.phone}</Text>}
                {item.payoutPosition !== null && (
                  <Text style={styles.memberPosition}>Position #{item.payoutPosition}</Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
                <View style={[styles.badge, { backgroundColor: ps.bg }]}>
                  <Text style={[styles.badgeTxt, { color: ps.text }]}>{capitalize(item.paymentStatus)}</Text>
                </View>
                {(item.role === 'creator' || item.role === 'admin') && (
                  <View style={[styles.badge, { backgroundColor: '#EFF6FF' }]}>
                    <Text style={[styles.badgeTxt, { color: '#1D4ED8' }]}>{capitalize(item.role)}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Users size={32} color="#CBD5E1" />
            <Text style={styles.emptyStateTxt}>No members found</Text>
          </View>
        }
      />

      {isManager && (
        <View style={styles.tabActionBar}>
          <TouchableOpacity style={[styles.tabActionBtn, { flex: 1 }]} onPress={() => setShowAddModal(true)}>
            <UserPlus size={17} color="#FFFFFF" />
            <Text style={styles.tabActionBtnTxt}>Add Member</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabActionBtnOutline} onPress={onManage}>
            <Users size={17} color={ORANGE} />
            <Text style={[styles.tabActionBtnTxt, { color: ORANGE }]}>Manage</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Member Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.txModalOverlay}>
          <View style={[styles.txModalSheet, { maxHeight: '85%' }]}>
            <View style={styles.txModalHandle} />
            <View style={styles.txModalHeader}>
              <Text style={styles.txModalTitle}>Add Member</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); setAddSearch(''); setAddSearchResults([]); }} style={{ padding: 4 }}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name, phone or email…"
                placeholderTextColor="#94A3B8"
                value={addSearch}
                onChangeText={(t) => void handleAddSearch(t)}
                autoFocus
              />
            </View>
            {addSearchLoading ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color={ORANGE} />
              </View>
            ) : (
              <FlatList
                data={addSearchResults.filter((p) => !existingUserIds.has(p.id))}
                keyExtractor={(p) => p.id}
                style={{ maxHeight: 340 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                renderItem={({ item: profile }) => (
                  <View style={[styles.memberCard, { paddingVertical: 10 }]}>
                    <View style={styles.memberAvatarFallback}>
                      <Text style={styles.memberAvatarTxt}>{initials(profileName(profile))}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.memberName}>{profileName(profile)}</Text>
                      {profile.phone && <Text style={styles.memberPhone}>{profile.phone}</Text>}
                      {profile.email && <Text style={styles.memberPhone}>{profile.email}</Text>}
                    </View>
                    <TouchableOpacity
                      style={[styles.tabActionBtn, { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }]}
                      onPress={() => void handleAddMember(profile)}
                      disabled={addingId === profile.id}
                    >
                      {addingId === profile.id
                        ? <ActivityIndicator size="small" color="#FFFFFF" />
                        : (
                          <>
                            <UserPlus size={14} color="#FFFFFF" />
                            <Text style={[styles.tabActionBtnTxt, { fontSize: 12 }]}>Add</Text>
                          </>
                        )
                      }
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Text style={[styles.emptyStateTxt, { textAlign: 'center' }]}>
                      {addSearch.length >= 2 ? 'No users found' : 'Type at least 2 characters to search'}
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// LEDGER TAB
// ═══════════════════════════════════════════════════════════════
const LEDGER_FILTERS: { key: LedgerFilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'collected', label: 'Collected' },
  { key: 'pending', label: 'Pending' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'refunded', label: 'Refunded' },
];

function LedgerTab({ groupId, isManager, isCollector, onRecord }: {
  groupId: string; isManager: boolean; isCollector: boolean; onRecord: () => void;
}) {
  const [summary, setSummary] = useState<GroupLedgerSummary | null>(null);
  const [transactions, setTransactions] = useState<GroupContributionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<LedgerFilterKey>('all');
  const [selected, setSelected] = useState<GroupContributionSummary | null>(null);

  const load = useCallback(async () => {
    const [summaryRes, txRes] = await Promise.all([
      getGroupLedgerSummary(groupId),
      fetchGroupContributions(groupId),
    ]);
    setSummary(summaryRes.summary);
    setTransactions(txRes.contributions);
    setLoading(false);
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter((t) => {
      if (filter === 'collected') return t.status === 'collected' || t.status === 'verified';
      if (filter === 'pending') return t.status === 'pending';
      if (filter === 'disputed') return t.status === 'disputed';
      if (filter === 'refunded') return t.status === 'refunded';
      return true;
    });
  }, [transactions, filter]);

  if (loading) {
    return (
      <View style={styles.tabLoading}>
        <ActivityIndicator color={ORANGE} />
        <Text style={styles.tabLoadingTxt}>Loading ledger…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Summary cards */}
      {summary && (
        <View style={styles.ledgerSummaryRow}>
          <View style={styles.ledgerCard}>
            <Text style={styles.ledgerCardLabel}>Received</Text>
            <Text style={styles.ledgerCardValue}>NLe {summary.totalReceived.toFixed(0)}</Text>
          </View>
          <View style={styles.ledgerCard}>
            <Text style={styles.ledgerCardLabel}>Outstanding</Text>
            <Text style={[styles.ledgerCardValue, { color: '#F59E0B' }]}>NLe {summary.outstanding.toFixed(0)}</Text>
          </View>
          <View style={styles.ledgerCard}>
            <Text style={styles.ledgerCardLabel}>Balance</Text>
            <Text style={[styles.ledgerCardValue, { color: '#10B981' }]}>NLe {summary.groupBalance.toFixed(0)}</Text>
          </View>
        </View>
      )}

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {LEDGER_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipTxt, filter === f.key && styles.filterChipTxtActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={ORANGE} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const ts = txStatusStyle(item.status);
          return (
            <TouchableOpacity style={styles.txCard} onPress={() => setSelected(item)} activeOpacity={0.85}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txName}>{item.memberName}</Text>
                <Text style={styles.txPeriod}>{item.contributionPeriod}</Text>
                <Text style={styles.txMethod}>{capitalize(item.collectionMethod)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={styles.txAmount}>NLe {item.amount.toFixed(0)}</Text>
                <View style={[styles.badge, { backgroundColor: ts.bg }]}>
                  <Text style={[styles.badgeTxt, { color: ts.text }]}>{capitalize(item.status)}</Text>
                </View>
              </View>
              <ChevronRight size={14} color="#CBD5E1" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <BookOpen size={32} color="#CBD5E1" />
            <Text style={styles.emptyStateTxt}>No transactions yet</Text>
          </View>
        }
      />

      {(isManager || isCollector) && (
        <View style={styles.tabActionBar}>
          <TouchableOpacity style={styles.tabActionBtn} onPress={onRecord}>
            <Wallet size={17} color="#FFFFFF" />
            <Text style={styles.tabActionBtnTxt}>Record Collection</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Transaction detail modal */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.txModalOverlay}>
          <View style={styles.txModalSheet}>
            <View style={styles.txModalHandle} />
            <View style={styles.txModalHeader}>
              <Text style={styles.txModalTitle}>Transaction Detail</Text>
              <TouchableOpacity onPress={() => setSelected(null)} style={{ padding: 4 }}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            {selected && (() => {
              const ts = txStatusStyle(selected.status);
              return (
                <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
                  <View style={[styles.badge, { backgroundColor: ts.bg, alignSelf: 'flex-start', marginBottom: 16 }]}>
                    <Text style={[styles.badgeTxt, { color: ts.text }]}>{capitalize(selected.status)}</Text>
                  </View>
                  {[
                    { label: 'Member', value: selected.memberName },
                    { label: 'Amount', value: `NLe ${selected.amount.toFixed(2)}` },
                    { label: 'Method', value: capitalize(selected.collectionMethod) },
                    { label: 'Period', value: selected.contributionPeriod },
                    { label: 'Recorded', value: fmtDate(selected.createdAt) },
                    selected.receiptNumber ? { label: 'Receipt #', value: selected.receiptNumber } : null,
                  ].filter(Boolean).map((row) => row && (
                    <View key={row.label} style={styles.txDetailRow}>
                      <Text style={styles.txDetailLabel}>{row.label}</Text>
                      <Text style={styles.txDetailValue}>{row.value}</Text>
                    </View>
                  ))}
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHAT TAB
// ═══════════════════════════════════════════════════════════════
function ChatTab({ groupId, meId, meName, isAdmin, chatLocked }: {
  groupId: string; meId: string; meName: string; isAdmin: boolean; chatLocked: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>(() => seedMessages(meId, meName));
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [waveBars, setWaveBars] = useState<number[]>(() =>
    Array.from({ length: WAVE_COUNT }, () => 0.15)
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playSeconds, setPlaySeconds] = useState(0);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
  const [replyToMsg, setReplyToMsg] = useState<ChatMessage | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [userGroups, setUserGroups] = useState<GroupListItem[]>([]);
  const [forwardTargetIds, setForwardTargetIds] = useState<Set<string>>(new Set());
  const [forwardingMsgs, setForwardingMsgs] = useState<ChatMessage[]>([]);
  const [loadingForward, setLoadingForward] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const meterHistory = useRef<number[]>(Array.from({ length: WAVE_COUNT }, () => 0.15));

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const playerStatus = useAudioPlayerStatus(player);

  // Waveform metering
  useEffect(() => {
    if (!recorderState.isRecording || isPaused) return;
    setRecordingSeconds(Math.floor(recorderState.durationMillis / 1000));
    const db = recorderState.metering;
    if (db !== undefined && db !== null) {
      const normalized = Math.max(0, Math.min(1, (db + 70) / 70));
      meterHistory.current = [...meterHistory.current.slice(1), normalized];
      setWaveBars([...meterHistory.current]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorderState.durationMillis, recorderState.metering]);

  // Playback progress
  useEffect(() => {
    if (!playingId) return;
    const msg = messages.find((m) => m.id === playingId);
    if (msg?.voiceUri) {
      if (playerStatus.didJustFinish) { setPlayingId(null); setPlaySeconds(0); }
      else if (playerStatus.playing) setPlaySeconds(Math.floor(playerStatus.currentTime));
      return;
    }
    // Seeded message timer fallback
    const duration = msg?.voiceDuration ?? 0;
    const timerId = setInterval(() => {
      setPlaySeconds((prev) => {
        if (prev >= duration) { setPlayingId(null); return 0; }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerStatus.currentTime, playerStatus.playing, playerStatus.didJustFinish, playingId]);

  // Cleanup on unmount — guard both calls: expo-audio may release the
  // SharedObject before our effect runs when the tab switches rapidly.
  useEffect(() => {
    return () => {
      try { recorder.stop().catch(() => {}); } catch {}
      try { player.remove(); } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToBottom = () => flatListRef.current?.scrollToEnd({ animated: true });

  const sendText = () => {
    const text = inputText.trim();
    if (!text) return;
    setMessages((prev) => [...prev, {
      id: Date.now().toString(), senderId: meId, senderName: meName,
      type: 'text', text, timestamp: new Date(), isMe: true,
      replyTo: replyToMsg
        ? { id: replyToMsg.id, senderName: replyToMsg.senderName, type: replyToMsg.type, text: replyToMsg.text, voiceDuration: replyToMsg.voiceDuration }
        : undefined,
    }]);
    setInputText('');
    setReplyToMsg(null);
    setTimeout(scrollToBottom, 100);
  };

  const handlePickImage = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission needed', 'Allow photo library access to share images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, quality: 0.8,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (result.canceled || !result.assets[0]) return;
    setMessages((prev) => [...prev, {
      id: Date.now().toString(), senderId: meId, senderName: meName,
      type: 'image', imageUri: result.assets[0].uri, timestamp: new Date(), isMe: true,
    }]);
    setTimeout(scrollToBottom, 100);
  };

  const startRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone needed', 'Allow microphone access to send voice messages.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      meterHistory.current = Array.from({ length: WAVE_COUNT }, () => 0.15);
      setWaveBars([...meterHistory.current]);
      setRecordingSeconds(0);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setIsPaused(false);
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const cancelRecording = async () => {
    try { await recorder.stop(); } catch {}
    setIsRecording(false);
    setIsPaused(false);
    setRecordingSeconds(0);
  };

  const togglePauseRecording = () => {
    if (!isRecording) return;
    try {
      if (isPaused) { recorder.record(); setIsPaused(false); }
      else { recorder.pause(); setIsPaused(true); }
    } catch {}
  };

  const sendVoiceNote = async () => {
    if (!isRecording || recordingSeconds < 1) { await cancelRecording(); return; }
    try {
      await recorder.stop();
      const uri = recorder.uri;
      setMessages((prev) => [...prev, {
        id: Date.now().toString(), senderId: meId, senderName: meName,
        type: 'voice', voiceDuration: recordingSeconds, voiceUri: uri ?? undefined,
        timestamp: new Date(), isMe: true,
      }]);
      setIsRecording(false);
      setIsPaused(false);
      setRecordingSeconds(0);
      setTimeout(scrollToBottom, 100);
    } catch { await cancelRecording(); }
  };

  const handleVoicePress = async (id: string, _duration: number, uri?: string) => {
    if (playingId === id) {
      player.pause();
      setPlayingId(null);
      setPlaySeconds(0);
      return;
    }
    setPlayingId(id);
    setPlaySeconds(0);
    if (!uri) return;
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: 'duckOthers' });
      player.replace({ uri });
      player.play();
    } catch { setPlayingId(null); }
  };

  const handleLongPress = (id: string) => {
    setIsSelectionMode(true);
    setSelectedIds(new Set([id]));
    setReactionTargetId(id);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      if (next.size === 0) { setIsSelectionMode(false); setReactionTargetId(null); }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setReactionTargetId(null);
  };

  const handleDeleteSelected = () => {
    Alert.alert('Delete messages', `Delete ${selectedIds.size} message${selectedIds.size > 1 ? 's' : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
          exitSelectionMode();
        },
      },
    ]);
  };

  const handleReply = () => {
    const msg = messages.find((m) => selectedIds.has(m.id));
    if (msg) { setReplyToMsg(msg); exitSelectionMode(); }
  };

  const handleForward = async () => {
    const msgs = messages.filter((m) => selectedIds.has(m.id));
    if (!msgs.length) return;
    setForwardingMsgs(msgs);
    setForwardTargetIds(new Set());
    setShowForwardModal(true);
    setLoadingForward(true);
    const { groups } = await listGroupsForUser(meId);
    setUserGroups(groups.filter((g) => g.id !== groupId));
    setLoadingForward(false);
  };

  const confirmForward = () => {
    const names = userGroups.filter((g) => forwardTargetIds.has(g.id)).map((g) => g.name).join(', ');
    Alert.alert('Forwarded', `${forwardingMsgs.length} message${forwardingMsgs.length > 1 ? 's' : ''} forwarded to: ${names}`);
    setShowForwardModal(false);
    exitSelectionMode();
  };

  const handleReaction = (emoji: string) => {
    if (!reactionTargetId) return;
    setMessages((prev) => prev.map((m) => m.id === reactionTargetId ? { ...m, reaction: emoji } : m));
    setReactionTargetId(null);
  };

  const playProgress = (() => {
    if (!playingId) return 0;
    const msg = messages.find((m) => m.id === playingId);
    return Math.min(playSeconds / Math.max(msg?.voiceDuration ?? 1, 1), 1);
  })();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F8FAFC' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Selection mode header */}
      {isSelectionMode && (
        <View style={styles.chatSelHeader}>
          <TouchableOpacity style={styles.chatSelBtn} onPress={exitSelectionMode}>
            <X size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.chatSelCount}>{selectedIds.size}</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity style={styles.chatSelBtn} onPress={handleReply}>
              <CornerUpLeft size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatSelBtn} onPress={() => Alert.alert('Starred', 'Message starred!')}>
              <Star size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatSelBtn} onPress={handleDeleteSelected}>
              <Trash2 size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.chatSelBtn} onPress={() => void handleForward()}>
              <CornerUpRight size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            playingId={playingId}
            playProgress={playProgress}
            onVoicePress={handleVoicePress}
            onLongPress={handleLongPress}
            isSelected={selectedIds.has(item.id)}
            isSelectionMode={isSelectionMode}
            onToggleSelect={toggleSelect}
          />
        )}
        contentContainerStyle={styles.chatMessageList}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={scrollToBottom}
        ListEmptyComponent={
          <View style={styles.chatEmpty}>
            <MessageCircle size={36} color="#CBD5E1" />
            <Text style={styles.chatEmptyTxt}>No messages yet. Start the conversation!</Text>
          </View>
        }
      />

      {/* Emoji bar */}
      {reactionTargetId && (
        <EmojiBar onSelect={handleReaction} onDismiss={() => setReactionTargetId(null)} />
      )}

      {/* Reply preview */}
      {replyToMsg && !isRecording && (
        <View style={styles.replyPreviewBar}>
          <View style={styles.replyPreviewAccent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyPreviewName}>{replyToMsg.senderName}</Text>
            <Text style={styles.replyPreviewText} numberOfLines={1}>
              {replyToMsg.type === 'voice'
                ? `🎤 Voice · ${formatDuration(replyToMsg.voiceDuration ?? 0)}`
                : replyToMsg.type === 'image' ? '📷 Photo'
                : replyToMsg.text ?? ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.replyPreviewClose} onPress={() => setReplyToMsg(null)}>
            <X size={16} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Input / Recording */}
      {chatLocked && !isAdmin ? (
        <View style={[styles.chatLockedBar, { paddingBottom: Math.max(10, insets.bottom) }]}>
          <Lock size={15} color={MUTED} />
          <Text style={styles.chatLockedTxt}>Chat locked — only admins can send messages</Text>
        </View>
      ) : isRecording ? (
        <View style={{ paddingBottom: insets.bottom }}>
          <RecordingBar
            seconds={recordingSeconds}
            isPaused={isPaused}
            waveBars={waveBars}
            onDelete={() => void cancelRecording()}
            onTogglePause={() => void togglePauseRecording()}
            onSend={() => void sendVoiceNote()}
          />
        </View>
      ) : (
        <View style={[styles.chatInputBar, { paddingBottom: Math.max(10, insets.bottom) }]}>
          <TouchableOpacity style={styles.chatInputAction} onPress={() => void handlePickImage()}>
            <ImageIcon size={22} color="#6B7280" />
          </TouchableOpacity>
          <TextInput
            style={styles.chatTextInput}
            placeholder="Type a message…"
            placeholderTextColor="#9CA3AF"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
          />
          {inputText.trim().length > 0 ? (
            <TouchableOpacity style={styles.chatSendBtn} onPress={sendText}>
              <Send size={18} color="#FFFFFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.chatSendBtn} onPress={() => void startRecording()}>
              <Mic size={18} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Forward modal */}
      <Modal
        visible={showForwardModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowForwardModal(false)}
      >
        <View style={styles.fwdOverlay}>
          <View style={styles.fwdSheet}>
            <View style={styles.fwdHandle} />
            <View style={styles.fwdHeader}>
              <Text style={styles.fwdTitle}>Forward to group</Text>
              <TouchableOpacity onPress={() => setShowForwardModal(false)} style={{ padding: 4 }}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.fwdSubtitle}>
              {forwardingMsgs.length} message{forwardingMsgs.length > 1 ? 's' : ''} selected
            </Text>
            {loadingForward ? (
              <View style={styles.fwdLoading}>
                <ActivityIndicator color={ORANGE} size="small" />
                <Text style={styles.fwdLoadingText}>Loading your groups…</Text>
              </View>
            ) : userGroups.length === 0 ? (
              <View style={styles.fwdEmpty}>
                <Text style={styles.fwdEmptyText}>You have no other groups to forward to.</Text>
              </View>
            ) : (
              <ScrollView style={styles.fwdList} showsVerticalScrollIndicator={false}>
                {userGroups.map((g) => {
                  const sel = forwardTargetIds.has(g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.fwdGroupRow, sel && styles.fwdGroupRowSelected]}
                      activeOpacity={0.75}
                      onPress={() => setForwardTargetIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.id)) { next.delete(g.id); } else { next.add(g.id); }
                        return next;
                      })}
                    >
                      <View style={styles.fwdGroupAvatar}>
                        <Text style={styles.fwdGroupAvatarText}>{initials(g.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fwdGroupName} numberOfLines={1}>{g.name}</Text>
                        <Text style={styles.fwdGroupMeta}>{g.members} member{g.members !== 1 ? 's' : ''}</Text>
                      </View>
                      <View style={[styles.fwdCheckCircle, sel && styles.fwdCheckCircleActive]}>
                        {sel && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={[styles.fwdSendBtn, forwardTargetIds.size === 0 && styles.fwdSendBtnDisabled]}
              disabled={forwardTargetIds.size === 0}
              onPress={confirmForward}
            >
              <Send size={16} color="#FFFFFF" />
              <Text style={styles.fwdSendText}>
                Forward{forwardTargetIds.size > 0 ? ` to ${forwardTargetIds.size} group${forwardTargetIds.size > 1 ? 's' : ''}` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN GROUP SCREEN
// ═══════════════════════════════════════════════════════════════
export default function GroupMainScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const groupId = typeof id === 'string' ? id : '';

  const [group, setGroup] = useState<OsusuGroup | null>(null);
  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [viewerRole, setViewerRole] = useState<ViewerRole>('member');
  const [collector, setCollector] = useState<ActiveCollectorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingHeader, setRefreshingHeader] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('members');
  const [lockChat, setLockChat] = useState(false);

  const isManager = viewerRole === 'creator' || viewerRole === 'admin';
  const isCreator = viewerRole === 'creator';
  const isCollector = collector?.profileId === user?.id;
  const canAccessCollector = isManager || isCollector;

  const meId   = user?.id    ?? 'me';
  const meName = user?.email?.split('@')[0] ?? 'You';

  const load = useCallback(async () => {
    if (!groupId) return;
    const [groupRes, memberRes, roleRes, collectorRes, settingsRes] = await Promise.all([
      getGroupById(groupId),
      fetchGroupMembers(groupId),
      user?.id
        ? getCurrentUserGroupRole(groupId, user.id)
        : Promise.resolve({ role: 'member' as ViewerRole, error: null }),
      fetchActiveCollectorForGroup(groupId),
      getGroupSettings(groupId),
    ]);
    setGroup(groupRes.group);
    setMembers(memberRes.members);
    setViewerRole(roleRes.role);
    setCollector(collectorRes.collector);
    if (settingsRes.settings) setLockChat(settingsRes.settings.lockChat);
    setLoading(false);
  }, [groupId, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const refreshHeader = async () => {
    setRefreshingHeader(true);
    await load();
    setRefreshingHeader(false);
  };

  const go = (path: string, extraParams?: Record<string, string>) => {
    setMenuOpen(false);
    router.push({ pathname: path as never, params: { id: groupId, ...extraParams } });
  };

  const handleLeave = () => {
    if (!group || !user?.id) return;
    setMenuOpen(false);
    Alert.alert('Leave Group', `Leave "${group.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          const { eligibility } = await checkLeaveGroupEligibility(groupId, user.id);
          if (!eligibility.canLeave) {
            setLeaving(false);
            Alert.alert('Cannot leave', eligibility.reasons.join('\n') || 'You cannot leave this group right now.');
            return;
          }
          const { success, error } = await leaveGroup(groupId, user.id);
          setLeaving(false);
          if (!success) { Alert.alert('Failed', error?.message ?? 'Could not leave the group.'); return; }
          router.replace('/(main)/groups');
        },
      },
    ]);
  };

  const creatorMember = useMemo(() => members.find((m) => m.userId === group?.created_by), [members, group]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingTxt}>Loading group…</Text>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <Text style={styles.h2}>Group not found</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(main)/groups')}>
          <Text style={styles.primaryBtnTxt}>Back to Groups</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const sc = statusColors(group.status);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Top Bar ─────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.roundBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={NAVY} />
        </TouchableOpacity>

        {/* Compact group identity */}
        <View style={styles.topBarCenter}>
          {group.avatar_url
            ? <Image source={{ uri: group.avatar_url }} style={styles.topBarAvatar as ImageStyle} />
            : (
              <View style={styles.topBarAvatarFallback}>
                <Text style={styles.topBarAvatarTxt}>{initials(group.name)}</Text>
              </View>
            )
          }
          <View style={{ flex: 1 }}>
            <Text style={styles.topBarName} numberOfLines={1}>{group.name}</Text>
            <Text style={styles.topBarSub} numberOfLines={1}>
              {members.length} members · {collector?.displayName ?? creatorMember?.displayName ?? 'No collector'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.roundBtn} onPress={() => setMenuOpen(true)}>
          <MoreVertical size={24} color={NAVY} />
        </TouchableOpacity>
      </View>

      {/* ── Group mini-header (status + role badges) ────────── */}
      <View style={styles.groupMiniHeader}>
        <View style={[styles.badge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.badgeTxt, { color: sc.text }]}>{group.status.toUpperCase()}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: '#FFF7ED' }]}>
          <Text style={[styles.badgeTxt, { color: ORANGE }]}>{viewerRole.toUpperCase()}</Text>
        </View>
        {isCollector && (
          <View style={[styles.badge, { backgroundColor: '#F0FDF4' }]}>
            <Text style={[styles.badgeTxt, { color: '#166534' }]}>COLLECTOR</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {/* Quick stats */}
        <Text style={styles.miniStat}>
          NLe {group.contribution_amount.toFixed(0)} · {group.frequency}
        </Text>
      </View>

      {/* ── Tab Bar ─────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {(['members', 'ledger', 'chat'] as ActiveTab[]).map((tab) => {
          const active = activeTab === tab;
          const label = tab.charAt(0).toUpperCase() + tab.slice(1);
          const Icon =
            tab === 'members' ? Users
            : tab === 'ledger' ? BookOpen
            : MessageCircle;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.75}
            >
              <Icon size={17} color={active ? ORANGE : MUTED} />
              <Text style={[styles.tabBtnTxt, active && styles.tabBtnTxtActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Tab Content ─────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {activeTab === 'members' && (
          <MembersTab
            groupId={groupId}
            viewerRole={viewerRole}
            collector={collector}
            userId={meId}
            onManage={() => router.push({ pathname: '/(groups)/members/[id]' as never, params: { id: groupId } })}
          />
        )}
        {activeTab === 'ledger' && (
          <LedgerTab
            groupId={groupId}
            isManager={isManager}
            isCollector={isCollector}
            onRecord={() => router.push({ pathname: '/(groups)/collector' as never, params: { id: groupId } })}
          />
        )}
        {activeTab === 'chat' && (
          <ChatTab groupId={groupId} meId={meId} meName={meName} isAdmin={isManager} chatLocked={lockChat} />
        )}
      </View>

      {/* ── Settings Menu (three dots) ───────────────────────── */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <MI icon={<Info size={16} color={ORANGE} />} label="Group Info" onPress={() => go('/(groups)/group-info/[id]')} />
            {canAccessCollector && (
              <MI icon={<Wallet size={16} color={ORANGE} />} label="Collector" sub="Record cash contributions" onPress={() => go('/(groups)/collector')} />
            )}
            <MI icon={<Link2 size={16} color={ORANGE} />} label="Invite Settings" onPress={() => go('/(groups)/invite-settings/[id]')} />
            {isManager && (
              <MI icon={<History size={16} color={ORANGE} />} label="Activity Log" onPress={() => go('/(groups)/activity/[id]')} />
            )}
            {isManager && (
              <MI icon={<Settings size={16} color={ORANGE} />} label="Group Settings" onPress={() => go('/(groups)/group-settings/[id]')} />
            )}
            <View style={styles.menuDivider} />
            {isCreator
              ? <MI icon={<Trash2 size={16} color="#EF4444" />} label="Delete Group" danger onPress={() => go('/(groups)/delete-group/[id]')} />
              : <MI icon={<LogOut size={16} color="#EF4444" />} label="Leave Group" danger loading={leaving} onPress={handleLeave} />
            }
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function MI({ icon, label, sub, danger, loading, onPress }: {
  icon: React.ReactNode; label: string; sub?: string;
  danger?: boolean; loading?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.mi} onPress={onPress}>
      <View style={[styles.miIconWrap, danger && { backgroundColor: '#FEF2F2' }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.miLabel, danger && { color: '#EF4444' }]}>{label}</Text>
        {sub && <Text style={styles.miSub}>{sub}</Text>}
      </View>
      {loading
        ? <ActivityIndicator size="small" color="#EF4444" />
        : <ChevronRight size={14} color="#CBD5E1" />
      }
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Layout
  container:    { flex: 1, backgroundColor: '#FFFFFF' },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 12, padding: 24 },
  loadingTxt:   { color: MUTED, fontSize: 14, fontWeight: '600', marginTop: 8 },
  h2:           { color: NAVY, fontSize: 17, fontWeight: '900' },
  primaryBtn:   { backgroundColor: ORANGE, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 12 },
  primaryBtnTxt:{ color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  // Top bar
  topBar:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 10, backgroundColor: '#FFFFFF' },
  topBarCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  topBarAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: '#FDBA74' },
  topBarAvatarFallback: { width: 38, height: 38, borderRadius: 19, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  topBarAvatarTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  topBarName:   { color: NAVY, fontSize: 15, fontWeight: '800' },
  topBarSub:    { color: MUTED, fontSize: 11, marginTop: 1 },
  roundBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED' },

  // Group mini-header
  groupMiniHeader: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    paddingHorizontal: 16, paddingBottom: 10, gap: 6,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  miniStat: { color: MUTED, fontSize: 11, fontWeight: '700' },

  // Badges
  badge:    { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 0.3 },

  // Tab bar
  tabBar: {
    flexDirection: 'row', backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
    borderBottomWidth: 2.5, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: ORANGE },
  tabBtnTxt:    { fontSize: 13, fontWeight: '700', color: MUTED },
  tabBtnTxtActive: { color: ORANGE },

  // Common tab utils
  tabLoading:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  tabLoadingTxt: { color: MUTED, fontSize: 14 },
  searchBar:     { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  searchInput:   {
    backgroundColor: SOFT, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: NAVY, borderWidth: 1, borderColor: BORDER,
  },
  filterScroll:  { maxHeight: 44 },
  filterRow:     { paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: 'center' },
  filterChip:    { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: SOFT, borderWidth: 1, borderColor: BORDER },
  filterChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  filterChipTxt: { fontSize: 12, fontWeight: '700', color: MUTED },
  filterChipTxtActive: { color: '#FFFFFF' },
  countTxt:      { paddingHorizontal: 16, paddingBottom: 6, fontSize: 12, color: MUTED, fontWeight: '600' },
  listContent:   { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 },
  emptyState:    { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyStateTxt: { color: '#94A3B8', fontSize: 14, fontWeight: '600' },

  // Tab action bar (fixed bottom)
  tabActionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 20,
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: BORDER,
  },
  tabActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
  },
  tabActionBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  // Members tab
  memberCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: NAVY, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  memberAvatarWrap:    { position: 'relative' },
  memberAvatar:        { width: 46, height: 46, borderRadius: 23 },
  memberAvatarFallback:{ width: 46, height: 46, borderRadius: 23, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  memberAvatarTxt:     { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  memberAdminBadge:    { position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#1D4ED8', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' },
  memberName:    { color: NAVY, fontSize: 14, fontWeight: '800' },
  memberPhone:   { color: MUTED, fontSize: 12, marginTop: 2 },
  memberPosition:{ color: ORANGE, fontSize: 11, fontWeight: '700', marginTop: 2 },

  // Ledger tab
  ledgerSummaryRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  ledgerCard:       { flex: 1, backgroundColor: SOFT, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER },
  ledgerCardLabel:  { color: '#94A3B8', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', marginBottom: 4 },
  ledgerCardValue:  { color: NAVY, fontSize: 15, fontWeight: '900' },
  txCard: {
    flexDirection: 'row', alignItems: 'center', gap: 0,
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: NAVY, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  txName:   { color: NAVY, fontSize: 14, fontWeight: '800' },
  txPeriod: { color: MUTED, fontSize: 11, marginTop: 2 },
  txMethod: { color: '#94A3B8', fontSize: 11, marginTop: 1 },
  txAmount: { color: NAVY, fontSize: 15, fontWeight: '900' },

  // Transaction detail modal
  txModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  txModalSheet:   { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, maxHeight: '80%' },
  txModalHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  txModalHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  txModalTitle:   { fontSize: 17, fontWeight: '800', color: NAVY },
  txDetailRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  txDetailLabel:  { fontSize: 13, color: MUTED, fontWeight: '600' },
  txDetailValue:  { fontSize: 13, color: NAVY, fontWeight: '700', maxWidth: '60%', textAlign: 'right' },

  // ─── Chat tab ──────────────────────────────────────────────
  chatSelHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111827', paddingHorizontal: 8, paddingVertical: 10, gap: 6,
  },
  chatSelBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chatSelCount: { flex: 1, fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginLeft: 4 },
  chatMessageList: { paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  chatEmpty:    { alignItems: 'center', paddingVertical: 48, gap: 10 },
  chatEmptyTxt: { color: '#9CA3AF', fontSize: 14 },
  chatInputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F3F4F6',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  chatInputAction: { width: 38, height: 38, borderRadius: 19, backgroundColor: SOFT, alignItems: 'center', justifyContent: 'center' },
  chatTextInput:   { flex: 1, backgroundColor: SOFT, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: NAVY, maxHeight: 100 },
  chatSendBtn:     { width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },

  // Bubbles
  bubbleWrap:         { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  bubbleWrapMe:       { justifyContent: 'flex-end' },
  bubbleWrapOther:    { justifyContent: 'flex-start' },
  bubbleWrapSelected: { backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 12, marginHorizontal: -4, paddingHorizontal: 4 },
  bubbleAvatar:       { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  bubbleAvatarText:   { color: ORANGE, fontSize: 9, fontWeight: '800' },
  bubble:             { maxWidth: '78%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe:           { backgroundColor: '#1E2B5A', borderBottomRightRadius: 4 },
  bubbleOther:        { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4, shadowColor: '#1E2B5A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  bubbleSenderName:   { fontSize: 10, fontWeight: '700', color: ORANGE, marginBottom: 3 },
  bubbleText:         { fontSize: 14, lineHeight: 20 },
  bubbleTextMe:       { color: '#FFFFFF' },
  bubbleTextOther:    { color: '#1E2B5A' },
  bubbleImage:        { width: 200, height: 160, borderRadius: 12 },
  bubbleFooter:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 4 },
  bubbleTime:         { fontSize: 10 },
  bubbleTimeMe:       { color: 'rgba(255,255,255,0.50)' },
  bubbleTimeOther:    { color: '#9CA3AF' },
  reactionBadge:      { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 4, paddingVertical: 1 },
  selCircle:          { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center', marginRight: 8, backgroundColor: 'transparent' },
  selCircleActive:    { backgroundColor: ORANGE, borderColor: ORANGE },
  voiceNote:          { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  voicePlayBtn:       { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  voiceDuration:      { fontSize: 11, color: '#6B7280', fontWeight: '600', minWidth: 32 },

  // Reply quote inside bubble
  replyQuote:        { flexDirection: 'row', borderRadius: 8, marginBottom: 6, overflow: 'hidden', paddingVertical: 5, paddingHorizontal: 8, gap: 8 },
  replyQuoteMe:      { backgroundColor: 'rgba(255,255,255,0.12)' },
  replyQuoteOther:   { backgroundColor: 'rgba(249,115,22,0.08)' },
  replyQuoteBar:     { width: 3, borderRadius: 2, flexShrink: 0 },
  replyQuoteBarMe:   { backgroundColor: 'rgba(255,255,255,0.60)' },
  replyQuoteBarOther:{ backgroundColor: ORANGE },
  replyQuoteName:    { fontSize: 11, fontWeight: '700', color: ORANGE, marginBottom: 2 },
  replyQuoteText:    { fontSize: 11, color: '#6B7280' },

  // Reply preview bar (above input)
  replyPreviewBar:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingHorizontal: 14, paddingVertical: 8, gap: 10 },
  replyPreviewAccent: { width: 3, height: 36, borderRadius: 2, backgroundColor: ORANGE },
  replyPreviewName:   { fontSize: 12, fontWeight: '700', color: ORANGE, marginBottom: 2 },
  replyPreviewText:   { fontSize: 12, color: '#6B7280' },
  replyPreviewClose:  { padding: 4 },

  // Recording bar
  recBar:        { backgroundColor: '#111827', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 12 },
  recWaveRow:    { flexDirection: 'row', alignItems: 'center', gap: 14 },
  recTimer:      { color: '#FFFFFF', fontSize: 17, fontWeight: '700', minWidth: 42 },
  recActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  recDeleteBtn:  { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  recPauseBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: 56, height: 44 },
  recPauseBar:   { width: 4, height: 24, backgroundColor: '#EF4444', borderRadius: 2 },
  recResumeCircle:{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  recRecordDot:  { width: 14, height: 14, borderRadius: 7, backgroundColor: '#EF4444' },
  recSendBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },

  // Emoji bar
  emojiBarWrap: { paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  emojiRow: { flexDirection: 'row', backgroundColor: '#1F2937', borderRadius: 32, paddingHorizontal: 12, paddingVertical: 8, gap: 2, shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 8, elevation: 8 },
  emojiBtn:    { paddingHorizontal: 5, paddingVertical: 2 },
  emojiText:   { fontSize: 24 },
  emojiMoreBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center' },

  // Forward modal
  fwdOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  fwdSheet:   { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32, maxHeight: '80%' },
  fwdHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  fwdHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  fwdTitle:   { fontSize: 17, fontWeight: '800', color: NAVY },
  fwdSubtitle:    { fontSize: 12, color: '#9CA3AF', paddingHorizontal: 20, marginBottom: 12 },
  fwdLoading:     { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20 },
  fwdLoadingText: { fontSize: 14, color: '#6B7280' },
  fwdEmpty:       { padding: 24, alignItems: 'center' },
  fwdEmptyText:   { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },
  fwdList:        { maxHeight: 320 },
  fwdGroupRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  fwdGroupRowSelected: { backgroundColor: '#FFF7ED' },
  fwdGroupAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  fwdGroupAvatarText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  fwdGroupName:   { fontSize: 14, fontWeight: '700', color: NAVY },
  fwdGroupMeta:   { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  fwdCheckCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  fwdCheckCircleActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  fwdSendBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, marginHorizontal: 20, marginTop: 16, borderRadius: 14, paddingVertical: 14 },
  fwdSendBtnDisabled: { backgroundColor: '#E5E7EB' },
  fwdSendText:    { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  // Settings menu (⋮)
  overlay:  { flex: 1, backgroundColor: 'rgba(15,23,42,0.18)', alignItems: 'flex-end', paddingTop: 70, paddingRight: 14 },
  menuCard: { width: 240, borderRadius: 18, backgroundColor: '#FFFFFF', paddingVertical: 8, shadowColor: NAVY, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 12 },
  mi:           { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  miIconWrap:   { width: 32, height: 32, borderRadius: 10, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  miLabel:      { color: NAVY, fontSize: 14, fontWeight: '800' },
  miSub:        { color: MUTED, fontSize: 11, marginTop: 1 },
  menuDivider:  { height: 1, backgroundColor: '#F1F5F9', marginVertical: 4, marginHorizontal: 14 },

  // Collector verification card
  collectorCard:           { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F0FDF4', borderRadius: 16, marginHorizontal: 16, marginTop: 12, marginBottom: 4, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' },
  collectorIconWrap:       { position: 'relative' },
  collectorAvatar:         { width: 46, height: 46, borderRadius: 23 },
  collectorAvatarFallback: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  collectorVerifiedBadge:  { position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' },
  collectorLabel:          { fontSize: 10, fontWeight: '900', color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  collectorName:           { fontSize: 14, fontWeight: '800', color: '#14532D' },
  collectorPhoneRow:       { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  collectorPhone:          { fontSize: 12, color: MUTED },
  collectorVerifyBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DCFCE7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 },
  collectorVerifyTxt:      { fontSize: 11, fontWeight: '800', color: '#166534' },

  // Tab action outline button (secondary)
  tabActionBtnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderColor: ORANGE, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18 },

  // Chat locked bar
  chatLockedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F8FAFC', borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingHorizontal: 16, paddingTop: 14 },
  chatLockedTxt: { fontSize: 13, color: MUTED, fontWeight: '600' },
});
