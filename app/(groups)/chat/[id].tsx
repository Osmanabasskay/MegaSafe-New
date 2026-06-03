import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
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
  Check,
  CornerUpLeft,
  CornerUpRight,
  Image as ImageIcon,
  Mic,
  Pause,
  Play,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react-native';
import { useAuthStore } from '../../../src/store/authStore';
import { getGroupById, listGroupsForUser, type GroupListItem } from '../../../src/services/groupService';

// ─── Constants ─────────────────────────────────────────────────
const WAVE_COUNT = 28;
const EMOJI_LIST = ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'];

// ─── Types ─────────────────────────────────────────────────────
type MessageType = 'text' | 'image' | 'voice';

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
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Seed messages ─────────────────────────────────────────────
function seedMessages(meId: string, meName: string): ChatMessage[] {
  const now = new Date();
  const t = (minAgo: number) => new Date(now.getTime() - minAgo * 60 * 1000);
  return [
    {
      id: '1', senderId: 'other1', senderName: 'Amara Sesay', type: 'text',
      text: "Good morning everyone! Ready for this month's contribution?",
      timestamp: t(32), isMe: false,
    },
    {
      id: '2', senderId: 'other2', senderName: 'Binta Kamara', type: 'text',
      text: 'Yes, I will pay by Friday 🙏', timestamp: t(28), isMe: false,
    },
    {
      id: '3', senderId: meId, senderName: meName, type: 'text',
      text: 'Same here. I already sent mine to the admin.', timestamp: t(20), isMe: true,
    },
    {
      id: '4', senderId: 'other1', senderName: 'Amara Sesay', type: 'voice',
      voiceDuration: 13, timestamp: t(15), isMe: false,
    },
    {
      id: '5', senderId: 'other3', senderName: 'Cherno Bah', type: 'text',
      text: "Great! Let's keep this going 💪", timestamp: t(5), isMe: false,
    },
  ];
}

// ─── Static waveform bars (voice bubbles) ──────────────────────
function StaticWaveform({ isMe, progress }: { isMe: boolean; progress: number }) {
  const heights = useRef(
    Array.from({ length: 22 }, (_, i) => 5 + Math.abs(Math.sin(i * 0.85 + 0.5)) * 14 + 3)
  ).current;
  const activeColor  = isMe ? 'rgba(255,255,255,0.95)' : '#F97316';
  const inactiveColor = isMe ? 'rgba(255,255,255,0.28)' : '#FDBA74';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={{
            width: 3, height: h, borderRadius: 2,
            backgroundColor: i / heights.length <= progress ? activeColor : inactiveColor,
          }}
        />
      ))}
    </View>
  );
}

// ─── Live waveform (during recording, fed by real metering) ────
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

// ─── Recording bar ─────────────────────────────────────────────
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
        {/* Delete / cancel */}
        <TouchableOpacity style={styles.recDeleteBtn} onPress={onDelete}>
          <Trash2 size={20} color="#9CA3AF" />
        </TouchableOpacity>

        {/* Pause / resume — two red bars when active, red dot in ring when paused */}
        <TouchableOpacity style={styles.recPauseBtn} onPress={onTogglePause}>
          {isPaused ? (
            <View style={styles.recResumeCircle}>
              <View style={styles.recRecordDot} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 5 }}>
              <View style={styles.recPauseBar} />
              <View style={styles.recPauseBar} />
            </View>
          )}
        </TouchableOpacity>

        {/* Send — orange */}
        <TouchableOpacity style={styles.recSendBtn} onPress={onSend}>
          <Send size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Emoji reaction bar ────────────────────────────────────────
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

// ─── Message bubble ────────────────────────────────────────────
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
  const isPlaying     = playingId === message.id;
  const playBtnBg     = message.isMe ? 'rgba(255,255,255,0.18)' : '#FFF7ED';
  const playIconColor = message.isMe ? '#FFFFFF' : '#F97316';

  const handlePress = () => {
    if (isSelectionMode) { onToggleSelect(message.id); return; }
  };

  return (
    <View style={[
      styles.bubbleWrap,
      message.isMe ? styles.bubbleWrapMe : styles.bubbleWrapOther,
      isSelected && styles.bubbleWrapSelected,
    ]}>
      {/* Selection circle */}
      {isSelectionMode && (
        <View style={[styles.selCircle, isSelected && styles.selCircleActive]}>
          {isSelected && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
        </View>
      )}

      {!message.isMe && !isSelectionMode && (
        <View style={styles.bubbleAvatar}>
          <Text style={styles.bubbleAvatarText}>{getInitials(message.senderName)}</Text>
        </View>
      )}
      {!message.isMe && isSelectionMode && (
        <View style={[styles.bubbleAvatar, { opacity: 0.5 }]}>
          <Text style={styles.bubbleAvatarText}>{getInitials(message.senderName)}</Text>
        </View>
      )}

      <TouchableOpacity
        activeOpacity={0.88}
        onPress={handlePress}
        onLongPress={() => onLongPress(message.id)}
        style={[styles.bubble, message.isMe ? styles.bubbleMe : styles.bubbleOther]}
      >
        {!message.isMe && (
          <Text style={styles.bubbleSenderName}>{message.senderName}</Text>
        )}

        {/* Reply quote */}
        {message.replyTo ? (
          <View style={[styles.replyQuote, message.isMe ? styles.replyQuoteMe : styles.replyQuoteOther]}>
            <View style={[styles.replyQuoteBar, message.isMe ? styles.replyQuoteBarMe : styles.replyQuoteBarOther]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.replyQuoteName, message.isMe && { color: 'rgba(255,255,255,0.75)' }]}>
                {message.replyTo.senderName}
              </Text>
              <Text style={[styles.replyQuoteText, message.isMe && { color: 'rgba(255,255,255,0.55)' }]} numberOfLines={1}>
                {message.replyTo.type === 'voice'
                  ? `🎤 Voice message · ${formatDuration(message.replyTo.voiceDuration ?? 0)}`
                  : message.replyTo.type === 'image'
                  ? '📷 Photo'
                  : message.replyTo.text ?? ''}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Text */}
        {message.type === 'text' && message.text ? (
          <Text style={[styles.bubbleText, message.isMe ? styles.bubbleTextMe : styles.bubbleTextOther]}>
            {message.text}
          </Text>
        ) : null}

        {/* Image */}
        {message.type === 'image' && message.imageUri ? (
          <Image source={{ uri: message.imageUri }} style={styles.bubbleImage} resizeMode="cover" />
        ) : null}

        {/* Voice note */}
        {message.type === 'voice' ? (
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
        ) : null}

        {/* Footer */}
        <View style={styles.bubbleFooter}>
          {message.reaction ? (
            <View style={styles.reactionBadge}>
              <Text style={{ fontSize: 14 }}>{message.reaction}</Text>
            </View>
          ) : null}
          <Text style={[styles.bubbleTime, message.isMe ? styles.bubbleTimeMe : styles.bubbleTimeOther]}>
            {formatTime(message.timestamp)}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────
export default function GroupChatScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = params.id ? String(params.id) : '';
  const { user } = useAuthStore();

  // Core state
  const [groupName, setGroupName]   = useState('Group Chat');
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [inputText, setInputText]   = useState('');
  const [loadingGroup, setLoadingGroup] = useState(true);

  // Recording state
  const [isRecording, setIsRecording]         = useState(false);
  const [isPaused, setIsPaused]               = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [waveBars, setWaveBars] = useState<number[]>(() =>
    Array.from({ length: WAVE_COUNT }, () => 0.15)
  );

  // Playback state
  const [playingId, setPlayingId]   = useState<string | null>(null);
  const [playSeconds, setPlaySeconds] = useState(0);

  // Selection mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());

  // Emoji reaction
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);

  // Reply
  const [replyToMsg, setReplyToMsg] = useState<ChatMessage | null>(null);

  // Forward
  const [showForwardModal, setShowForwardModal]     = useState(false);
  const [userGroups, setUserGroups]                 = useState<GroupListItem[]>([]);
  const [forwardTargetIds, setForwardTargetIds]     = useState<Set<string>>(new Set());
  const [forwardingMsgs, setForwardingMsgs]         = useState<ChatMessage[]>([]);
  const [loadingForward, setLoadingForward]         = useState(false);

  // Refs
  const flatListRef    = useRef<FlatList>(null);
  const meterHistory   = useRef<number[]>(Array.from({ length: WAVE_COUNT }, () => 0.15));

  // Audio hooks (expo-audio)
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const playerStatus = useAudioPlayerStatus(player);

  const meId   = user?.id    ?? 'me';
  const meName = user?.email ?? 'You';

  // ── Load group ──────────────────────────────────────────────
  useEffect(() => {
    const run = async () => {
      const { group } = await getGroupById(groupId);
      if (group) setGroupName(group.name);
      setMessages(seedMessages(meId, meName));
      setLoadingGroup(false);
    };
    void run();
  }, [groupId]);

  // ── Playback progress timer (fallback for seeded messages) ──
  useEffect(() => {
    if (!playingId) return;
    const msg = messages.find((m) => m.id === playingId);
    if (msg?.voiceUri) return; // real audio handles its own progress via callback
    const duration = msg?.voiceDuration ?? 0;
    const id = setInterval(() => {
      setPlaySeconds((prev) => {
        if (prev >= duration) { setPlayingId(null); return 0; }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playingId, messages]);

  // ── Recording metering → waveform ──────────────────────────
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

  // ── Real-audio playback progress & completion ───────────────
  useEffect(() => {
    if (!playingId) return;
    const msg = messages.find((m) => m.id === playingId);
    if (!msg?.voiceUri) return; // seeded messages use the timer fallback below
    if (playerStatus.didJustFinish) {
      setPlayingId(null);
      setPlaySeconds(0);
    } else if (playerStatus.playing) {
      setPlaySeconds(Math.floor(playerStatus.currentTime));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerStatus.currentTime, playerStatus.playing, playerStatus.didJustFinish]);

  // ── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      recorder.stop().catch(() => {});
      player.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToBottom = () => flatListRef.current?.scrollToEnd({ animated: true });

  // ── Send text ───────────────────────────────────────────────
  const sendText = () => {
    const text = inputText.trim();
    if (!text) return;
    const msg: ChatMessage = {
      id: Date.now().toString(), senderId: meId, senderName: meName,
      type: 'text', text, timestamp: new Date(), isMe: true,
      replyTo: replyToMsg
        ? { id: replyToMsg.id, senderName: replyToMsg.senderName, type: replyToMsg.type, text: replyToMsg.text, voiceDuration: replyToMsg.voiceDuration }
        : undefined,
    };
    setMessages((prev) => [...prev, msg]);
    setInputText('');
    setReplyToMsg(null);
    setTimeout(scrollToBottom, 100);
  };

  // ── Pick image ──────────────────────────────────────────────
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
    const msg: ChatMessage = {
      id: Date.now().toString(), senderId: meId, senderName: meName,
      type: 'image', imageUri: result.assets[0].uri, timestamp: new Date(), isMe: true,
    };
    setMessages((prev) => [...prev, msg]);
    setTimeout(scrollToBottom, 100);
  };

  // ── Start recording ─────────────────────────────────────────
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
      Alert.alert('Error', 'Could not start recording. Please try again.');
    }
  };

  // ── Cancel recording ────────────────────────────────────────
  const cancelRecording = async () => {
    try {
      await recorder.stop();
    } catch {}
    setIsRecording(false);
    setIsPaused(false);
    setRecordingSeconds(0);
  };

  // ── Toggle pause/resume recording ───────────────────────────
  const togglePauseRecording = () => {
    if (!isRecording) return;
    try {
      if (isPaused) {
        recorder.record();
        setIsPaused(false);
      } else {
        recorder.pause();
        setIsPaused(true);
      }
    } catch {}
  };

  // ── Send voice note ─────────────────────────────────────────
  const sendVoiceNote = async () => {
    if (!isRecording || recordingSeconds < 1) {
      await cancelRecording();
      return;
    }
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const msg: ChatMessage = {
        id: Date.now().toString(), senderId: meId, senderName: meName,
        type: 'voice', voiceDuration: recordingSeconds,
        voiceUri: uri ?? undefined, timestamp: new Date(), isMe: true,
      };
      setMessages((prev) => [...prev, msg]);
      setIsRecording(false);
      setIsPaused(false);
      setRecordingSeconds(0);
      setTimeout(scrollToBottom, 100);
    } catch {
      await cancelRecording();
    }
  };

  // ── Play / stop voice note ──────────────────────────────────
  const handleVoicePress = async (id: string, _duration: number, uri?: string) => {
    // Tapping the same message toggles it off
    if (playingId === id) {
      player.pause();
      setPlayingId(null);
      setPlaySeconds(0);
      return;
    }

    setPlayingId(id);
    setPlaySeconds(0);

    if (!uri) return; // seeded messages: timer-only fallback

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
      });
      player.replace({ uri });
      player.play();
    } catch {
      setPlayingId(null);
    }
  };

  // ── Selection mode ──────────────────────────────────────────
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
    Alert.alert(
      'Delete messages',
      `Delete ${selectedIds.size} message${selectedIds.size > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
            exitSelectionMode();
          },
        },
      ],
    );
  };

  // ── Reply ───────────────────────────────────────────────────
  const handleReply = () => {
    const msg = messages.find((m) => selectedIds.has(m.id));
    if (!msg) return;
    setReplyToMsg(msg);
    exitSelectionMode();
  };

  // ── Forward ─────────────────────────────────────────────────
  const handleForward = async () => {
    const msgs = messages.filter((m) => selectedIds.has(m.id));
    if (msgs.length === 0) return;
    setForwardingMsgs(msgs);
    setForwardTargetIds(new Set());
    setShowForwardModal(true);
    setLoadingForward(true);
    const { groups } = await listGroupsForUser(meId);
    setUserGroups(groups.filter((g) => g.id !== groupId));
    setLoadingForward(false);
  };

  const confirmForward = () => {
    const names = userGroups
      .filter((g) => forwardTargetIds.has(g.id))
      .map((g) => g.name)
      .join(', ');
    Alert.alert(
      'Forwarded',
      `${forwardingMsgs.length} message${forwardingMsgs.length > 1 ? 's' : ''} forwarded to: ${names}`,
    );
    setShowForwardModal(false);
    exitSelectionMode();
  };

  // ── Emoji reaction ──────────────────────────────────────────
  const handleReaction = (emoji: string) => {
    if (!reactionTargetId) return;
    setMessages((prev) =>
      prev.map((m) => m.id === reactionTargetId ? { ...m, reaction: emoji } : m)
    );
    setReactionTargetId(null);
  };

  // ── Playback progress (0–1) ─────────────────────────────────
  const playProgress = (() => {
    if (!playingId) return 0;
    const msg = messages.find((m) => m.id === playingId);
    return Math.min(playSeconds / Math.max(msg?.voiceDuration ?? 1, 1), 1);
  })();

  // ── Loading ─────────────────────────────────────────────────
  if (loadingGroup) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top', 'bottom']}>
        <ActivityIndicator color="#F97316" size="large" />
        <Text style={styles.loadingText}>Loading chat…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>

      {/* ── Header: normal or selection mode ──────────────── */}
      {isSelectionMode ? (
        <View style={[styles.selectionHeader, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.selHeaderBtn} onPress={exitSelectionMode}>
            <ArrowLeft size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.selHeaderCount}>{selectedIds.size}</Text>

          <View style={styles.selHeaderActions}>
            <TouchableOpacity style={styles.selHeaderBtn} onPress={handleReply}>
              <CornerUpLeft size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.selHeaderBtn} onPress={() => Alert.alert('Starred', 'Message starred!')}>
              <Star size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.selHeaderBtn} onPress={handleDeleteSelected}>
              <Trash2 size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.selHeaderBtn} onPress={() => void handleForward()}>
              <CornerUpRight size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <ArrowLeft size={22} color="#F97316" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{groupName}</Text>
            <Text style={styles.headerSub}>Group · end-to-end secured</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.onlineDot} />
          </View>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── Messages ──────────────────────────────────────── */}
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
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToBottom}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>No messages yet. Start the conversation!</Text>
            </View>
          }
        />

        {/* ── Emoji reaction bar ─────────────────────────────── */}
        {reactionTargetId ? (
          <EmojiBar onSelect={handleReaction} onDismiss={() => setReactionTargetId(null)} />
        ) : null}

        {/* ── Reply preview bar ─────────────────────────────── */}
        {replyToMsg && !isRecording ? (
          <View style={styles.replyPreviewBar}>
            <View style={styles.replyPreviewAccent} />
            <View style={styles.replyPreviewBody}>
              <Text style={styles.replyPreviewName}>{replyToMsg.senderName}</Text>
              <Text style={styles.replyPreviewText} numberOfLines={1}>
                {replyToMsg.type === 'voice'
                  ? `🎤 Voice message · ${formatDuration(replyToMsg.voiceDuration ?? 0)}`
                  : replyToMsg.type === 'image'
                  ? '📷 Photo'
                  : replyToMsg.text ?? ''}
              </Text>
            </View>
            <TouchableOpacity style={styles.replyPreviewClose} onPress={() => setReplyToMsg(null)}>
              <X size={16} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Input bar or Recording bar ─────────────────────── */}
        {isRecording ? (
          <RecordingBar
            seconds={recordingSeconds}
            isPaused={isPaused}
            waveBars={waveBars}
            onDelete={() => void cancelRecording()}
            onTogglePause={() => void togglePauseRecording()}
            onSend={() => void sendVoiceNote()}
          />
        ) : (
          <View style={styles.inputBar}>
            <TouchableOpacity style={styles.inputAction} onPress={() => void handlePickImage()}>
              <ImageIcon size={22} color="#6B7280" />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Type a message…"
              placeholderTextColor="#9CA3AF"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              returnKeyType="default"
            />
            {inputText.trim().length > 0 ? (
              <TouchableOpacity style={styles.sendBtn} onPress={sendText}>
                <Send size={18} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={() => void startRecording()}>
                <Mic size={18} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ── Forward modal ──────────────────────────────────── */}
      <Modal
        visible={showForwardModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowForwardModal(false)}
      >
        <View style={styles.fwdOverlay}>
          <View style={styles.fwdSheet}>
            {/* Handle */}
            <View style={styles.fwdHandle} />

            {/* Header */}
            <View style={styles.fwdHeader}>
              <Text style={styles.fwdTitle}>Forward to group</Text>
              <TouchableOpacity onPress={() => setShowForwardModal(false)} style={styles.fwdCloseBtn}>
                <X size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.fwdSubtitle}>
              {forwardingMsgs.length} message{forwardingMsgs.length > 1 ? 's' : ''} selected
            </Text>

            {/* Group list */}
            {loadingForward ? (
              <View style={styles.fwdLoading}>
                <ActivityIndicator color="#F97316" size="small" />
                <Text style={styles.fwdLoadingText}>Loading your groups…</Text>
              </View>
            ) : userGroups.length === 0 ? (
              <View style={styles.fwdEmpty}>
                <Text style={styles.fwdEmptyText}>You have no other groups to forward to.</Text>
              </View>
            ) : (
              <ScrollView style={styles.fwdList} showsVerticalScrollIndicator={false}>
                {userGroups.map((g) => {
                  const selected = forwardTargetIds.has(g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[styles.fwdGroupRow, selected && styles.fwdGroupRowSelected]}
                      activeOpacity={0.75}
                      onPress={() => {
                        setForwardTargetIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.id)) { next.delete(g.id); } else { next.add(g.id); }
                          return next;
                        });
                      }}
                    >
                      <View style={styles.fwdGroupAvatar}>
                        <Text style={styles.fwdGroupAvatarText}>{getInitials(g.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fwdGroupName} numberOfLines={1}>{g.name}</Text>
                        <Text style={styles.fwdGroupMeta}>{g.members} member{g.members !== 1 ? 's' : ''}</Text>
                      </View>
                      <View style={[styles.fwdCheckCircle, selected && styles.fwdCheckCircleActive]}>
                        {selected && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Send button */}
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

    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex:             { flex: 1 },
  container:        { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:      { color: '#6B7280', fontSize: 14 },

  // ── Normal header ──────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
    gap: 10,
  },
  backBtn:      { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1 },
  headerTitle:  { fontSize: 17, fontWeight: '800', color: '#1E2B5A' },
  headerSub:    { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  headerRight:  { width: 38, alignItems: 'center', justifyContent: 'center' },
  onlineDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10B981' },

  // ── Selection header ───────────────────────────────────────
  selectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111827',
    paddingHorizontal: 8, paddingVertical: 12,
    gap: 6,
  },
  selHeaderBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  selHeaderCount:   { flex: 1, fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginLeft: 4 },
  selHeaderActions: { flexDirection: 'row', alignItems: 'center' },

  // ── Messages ───────────────────────────────────────────────
  messageList:    { paddingHorizontal: 12, paddingVertical: 16, gap: 6 },
  emptyChat:      { alignItems: 'center', paddingVertical: 40 },
  emptyChatText:  { color: '#9CA3AF', fontSize: 14 },

  // ── Bubbles ────────────────────────────────────────────────
  bubbleWrap:         { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  bubbleWrapMe:       { justifyContent: 'flex-end' },
  bubbleWrapOther:    { justifyContent: 'flex-start' },
  bubbleWrapSelected: { backgroundColor: 'rgba(249,115,22,0.08)', borderRadius: 12, marginHorizontal: -4, paddingHorizontal: 4 },
  bubbleAvatar:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  bubbleAvatarText:   { color: '#F97316', fontSize: 10, fontWeight: '800' },
  bubble:             { maxWidth: '78%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe:           { backgroundColor: '#1E2B5A', borderBottomRightRadius: 4 },
  bubbleOther:        { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4, shadowColor: '#1E2B5A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  bubbleSenderName:   { fontSize: 11, fontWeight: '700', color: '#F97316', marginBottom: 4 },
  bubbleText:         { fontSize: 14, lineHeight: 20 },
  bubbleTextMe:       { color: '#FFFFFF' },
  bubbleTextOther:    { color: '#1E2B5A' },
  bubbleImage:        { width: 200, height: 160, borderRadius: 12 },
  bubbleFooter:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 5, gap: 5 },
  bubbleTime:         { fontSize: 10 },
  bubbleTimeMe:       { color: 'rgba(255,255,255,0.50)' },
  bubbleTimeOther:    { color: '#9CA3AF' },
  reactionBadge:      { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 4, paddingVertical: 1 },

  // ── Selection circle ───────────────────────────────────────
  selCircle: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#9CA3AF',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8, backgroundColor: 'transparent',
  },
  selCircleActive: {
    backgroundColor: '#F97316', borderColor: '#F97316',
  },

  // ── Voice note bubble ──────────────────────────────────────
  voiceNote:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  voicePlayBtn:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  voiceDuration: { fontSize: 11, color: '#6B7280', fontWeight: '600', minWidth: 32 },

  // ── Input bar ──────────────────────────────────────────────
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  inputAction: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
  textInput: {
    flex: 1, backgroundColor: '#F8FAFC', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: '#1E2B5A', maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },

  // ── Recording bar ──────────────────────────────────────────
  recBar: {
    backgroundColor: '#111827',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 12,
  },
  recWaveRow:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  recTimer:        { color: '#FFFFFF', fontSize: 17, fontWeight: '700', minWidth: 42 },
  recActionsRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  recDeleteBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  recPauseBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: 56, height: 44 },
  recPauseBar:     { width: 4, height: 24, backgroundColor: '#EF4444', borderRadius: 2 },
  recResumeCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  recRecordDot:    { width: 14, height: 14, borderRadius: 7, backgroundColor: '#EF4444' },
  recSendBtn:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },

  // ── Reply quote inside bubble ──────────────────────────────
  replyQuote: {
    flexDirection: 'row', borderRadius: 8, marginBottom: 6,
    overflow: 'hidden', paddingVertical: 5, paddingHorizontal: 8, gap: 8,
  },
  replyQuoteMe:    { backgroundColor: 'rgba(255,255,255,0.12)' },
  replyQuoteOther: { backgroundColor: 'rgba(249,115,22,0.08)' },
  replyQuoteBar:        { width: 3, borderRadius: 2, flexShrink: 0 },
  replyQuoteBarMe:      { backgroundColor: 'rgba(255,255,255,0.60)' },
  replyQuoteBarOther:   { backgroundColor: '#F97316' },
  replyQuoteName: { fontSize: 11, fontWeight: '700', color: '#F97316', marginBottom: 2 },
  replyQuoteText: { fontSize: 11, color: '#6B7280' },

  // ── Reply preview bar (above input) ────────────────────────
  replyPreviewBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F3F4F6',
    paddingHorizontal: 14, paddingVertical: 8, gap: 10,
  },
  replyPreviewAccent: { width: 3, height: 36, borderRadius: 2, backgroundColor: '#F97316' },
  replyPreviewBody:   { flex: 1 },
  replyPreviewName:   { fontSize: 12, fontWeight: '700', color: '#F97316', marginBottom: 2 },
  replyPreviewText:   { fontSize: 12, color: '#6B7280' },
  replyPreviewClose:  { padding: 4 },

  // ── Forward modal ──────────────────────────────────────────
  fwdOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  fwdSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 32, maxHeight: '80%',
  },
  fwdHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB',
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  fwdHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  fwdTitle:      { fontSize: 17, fontWeight: '800', color: '#1E2B5A' },
  fwdCloseBtn:   { padding: 4 },
  fwdSubtitle:   { fontSize: 12, color: '#9CA3AF', paddingHorizontal: 20, marginBottom: 12 },
  fwdLoading:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 20 },
  fwdLoadingText:{ fontSize: 14, color: '#6B7280' },
  fwdEmpty:      { padding: 24, alignItems: 'center' },
  fwdEmptyText:  { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },
  fwdList:       { maxHeight: 320 },
  fwdGroupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  fwdGroupRowSelected: { backgroundColor: '#FFF7ED' },
  fwdGroupAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center',
  },
  fwdGroupAvatarText: { color: '#F97316', fontSize: 14, fontWeight: '800' },
  fwdGroupName:       { fontSize: 14, fontWeight: '700', color: '#1E2B5A' },
  fwdGroupMeta:       { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  fwdCheckCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center',
  },
  fwdCheckCircleActive: { backgroundColor: '#F97316', borderColor: '#F97316' },
  fwdSendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#F97316', marginHorizontal: 20, marginTop: 16,
    borderRadius: 14, paddingVertical: 14,
  },
  fwdSendBtnDisabled: { backgroundColor: '#E5E7EB' },
  fwdSendText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },

  // ── Emoji bar ──────────────────────────────────────────────
  emojiBarWrap: { paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  emojiRow: {
    flexDirection: 'row', backgroundColor: '#1F2937',
    borderRadius: 32, paddingHorizontal: 12, paddingVertical: 8, gap: 2,
    shadowColor: '#000000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30, shadowRadius: 8, elevation: 8,
  },
  emojiBtn:    { paddingHorizontal: 5, paddingVertical: 2 },
  emojiText:   { fontSize: 24 },
  emojiMoreBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#374151', alignItems: 'center', justifyContent: 'center' },
});
