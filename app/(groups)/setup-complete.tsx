import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Users,
  Calendar,
  ArrowRight,
  UserPlus,
  Copy,
} from 'lucide-react-native';
import { getGroupById } from '../../src/services/groupService';
import type { OsusuGroup } from '../../src/types/group';

interface ConfettiItem {
  top?: number; bottom?: number; left?: number; right?: number;
  color: string; w: number; h: number; rotate: string;
}

const CONFETTI: ConfettiItem[] = [
  { top: -18, left: 18,   color: '#FB923C', w: 8, h: 5, rotate: '20deg'  },
  { top: -10, left: -18,  color: '#A78BFA', w: 6, h: 6, rotate: '45deg'  },
  { top: -22, right: 28,  color: '#60A5FA', w: 7, h: 4, rotate: '-15deg' },
  { top:   8, right: -16, color: '#34D399', w: 9, h: 5, rotate: '60deg'  },
  { bottom: 8, left: 6,   color: '#F472B6', w: 6, h: 6, rotate: '-30deg' },
  { bottom: -8, right: 18,color: '#FBBF24', w: 8, h: 4, rotate: '15deg'  },
  { top: 38, left: -22,   color: '#60A5FA', w: 5, h: 5, rotate: '90deg'  },
  { top: 28, right: -18,  color: '#FB923C', w: 7, h: 4, rotate: '-45deg' },
  { top: -28, left: 56,   color: '#34D399', w: 6, h: 6, rotate: '30deg'  },
  { bottom: 18, left: -12,color: '#FBBF24', w: 5, h: 8, rotate: '-60deg' },
  { top: 14, left: -28,   color: '#F472B6', w: 7, h: 4, rotate: '75deg'  },
  { bottom: -12, left: 36,color: '#A78BFA', w: 6, h: 5, rotate: '-20deg' },
];

export default function SetupCompleteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = params.groupId != null ? String(params.groupId) : '';
  const [groupData, setGroupData] = useState<OsusuGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!groupId) { setIsLoading(false); return; }
      const { group } = await getGroupById(groupId);
      if (mounted) { setGroupData(group); setIsLoading(false); }
    };
    void run();
    return () => { mounted = false; };
  }, [groupId]);

  const resolvedGroup = useMemo(
    () =>
      groupData ?? {
        id: groupId || 'local-unknown',
        created_at: new Date().toISOString(),
        name: 'Your New Group',
        description: null,
        avatar_url: null,
        contribution_amount: 0,
        frequency: 'weekly' as const,
        max_members: 0,
        cycle_start_date: new Date().toISOString().slice(0, 10),
        total_cycles: 0,
        payout_order: 'sequential' as const,
        is_public: true,
        join_requires_approval: true,
        custom_rules: null,
        status: 'active' as const,
        created_by: '',
        invite_code: '',
      },
    [groupData, groupId],
  );

  const handleGoToDashboard = () => {
    router.replace(`/(groups)/manage/${resolvedGroup.id}`);
  };

  const handleInviteMembers = () => {
    router.push('/(groups)/invite');
  };

  const handleCopyCode = async () => {
    const code = resolvedGroup.invite_code || 'Pending';
    try {
      await Share.share({ message: `Join my Mi Osusu group using invite code: ${code}` });
    } catch {
      Alert.alert('Unable to share', 'Please try again.');
    }
  };

  const freqLabel = resolvedGroup.frequency.charAt(0).toUpperCase() + resolvedGroup.frequency.slice(1);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Setup Complete</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.headerDivider} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Success Hero ── */}
        <View style={styles.heroSection}>
          <View style={styles.confettiWrap}>
            {CONFETTI.map((c, i) => (
              <View
                key={i}
                style={[
                  styles.confettiPiece,
                  {
                    width: c.w,
                    height: c.h,
                    backgroundColor: c.color,
                    transform: [{ rotate: c.rotate }],
                    top: c.top,
                    bottom: c.bottom,
                    left: c.left,
                    right: c.right,
                  },
                ]}
              />
            ))}
            <View style={styles.successCircle}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
          </View>

          <Text style={styles.successTitle}>Group created successfully!</Text>
          <Text style={styles.successMessage}>
            Your Osusu group "{resolvedGroup.name}" is now ready.{'\n'}
            Members can start contributing according to the schedule.
          </Text>
        </View>

        <View style={styles.divider} />

        {/* ── Group Summary ── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Group Summary</Text>

          {/* Group Name row */}
          <View style={styles.summaryRow}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#F5F3FF' }]}>
              <Users size={16} color="#7C3AED" />
            </View>
            <Text style={styles.rowLabel}>Group Name</Text>
            <Text style={styles.rowValue}>{resolvedGroup.name}</Text>
          </View>

          <View style={styles.rowDivider} />

          {/* Invite Code row */}
          <View style={styles.summaryRow}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#FFF7ED' }]}>
              <Text style={styles.keyEmoji}>🔑</Text>
            </View>
            <Text style={styles.rowLabel}>Invite Code</Text>
            <View style={styles.codeValueRow}>
              <Text style={styles.codeValue}>{resolvedGroup.invite_code || 'Pending'}</Text>
              {resolvedGroup.invite_code ? (
                <TouchableOpacity onPress={handleCopyCode} style={styles.codeCopyBtn} activeOpacity={0.7}>
                  <Copy size={14} color="#F97316" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.rowDivider} />

          {/* Start Date row */}
          <View style={styles.summaryRow}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#EFF6FF' }]}>
              <Calendar size={16} color="#1D4ED8" />
            </View>
            <Text style={styles.rowLabel}>Start Date</Text>
            <Text style={styles.rowValue}>{resolvedGroup.cycle_start_date}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── What's Included ── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>What's Included</Text>

          <View style={styles.includedGrid}>
            {/* Members */}
            <View style={styles.includedCell}>
              <View style={[styles.includedIconWrap, { backgroundColor: '#FFF7ED' }]}>
                <Users size={22} color="#F97316" />
              </View>
              <Text style={styles.includedValue}>{resolvedGroup.max_members}</Text>
              <Text style={styles.includedLabel}>Members</Text>
            </View>

            <View style={styles.includedCellDivider} />

            {/* Contribution */}
            <View style={styles.includedCell}>
              <View style={[styles.includedIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <Text style={styles.dollarEmoji}>$</Text>
              </View>
              <Text style={styles.includedValue}>
                NLe {resolvedGroup.contribution_amount.toFixed(2)}
              </Text>
              <Text style={styles.includedLabel}>{freqLabel} Contribution</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        {/* ── Actions ── */}
        <View style={styles.actionsSection}>
          <TouchableOpacity
            style={styles.dashboardBtn}
            onPress={handleGoToDashboard}
            activeOpacity={0.88}
          >
            <Text style={styles.dashboardBtnText}>Go to Dashboard</Text>
            <ArrowRight size={18} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.inviteLink}
            onPress={handleInviteMembers}
            activeOpacity={0.7}
          >
            <UserPlus size={16} color="#F97316" />
            <Text style={styles.inviteLinkText}>Invite Members</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#FFFFFF' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 56 },

  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  backButton:   { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: '#1E2B5A', letterSpacing: -0.3 },
  headerSpacer: { width: 40 },
  headerDivider:{ height: 1, backgroundColor: '#F3F4F6' },

  // Hero
  heroSection:   { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 },
  confettiWrap:  { position: 'relative', width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  confettiPiece: { position: 'absolute', borderRadius: 2 },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center', shadowColor: '#10B981', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  checkMark:     { fontSize: 40, color: '#FFFFFF', fontWeight: '700', lineHeight: 52 },
  successTitle:  { fontSize: 22, fontWeight: '800', color: '#10B981', textAlign: 'center', marginBottom: 10, letterSpacing: -0.3 },
  successMessage:{ fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 21 },

  divider: { height: 1, backgroundColor: '#F3F4F6' },

  // Section
  section:       { paddingHorizontal: 20, paddingVertical: 20 },
  sectionHeading:{ fontSize: 16, fontWeight: '800', color: '#1E2B5A', marginBottom: 16, letterSpacing: -0.2 },

  // Summary rows
  summaryRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowIconBadge:  { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowLabel:      { flex: 1, fontSize: 14, fontWeight: '500', color: '#374151' },
  rowValue:      { fontSize: 14, fontWeight: '700', color: '#1E2B5A' },
  keyEmoji:      { fontSize: 16 },
  rowDivider:    { height: 1, backgroundColor: '#F9FAFB' },

  codeValueRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeValue:     { fontSize: 14, fontWeight: '800', color: '#F97316', letterSpacing: 1 },
  codeCopyBtn:   { width: 28, height: 28, borderRadius: 8, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },

  // What's Included
  includedGrid:       { flexDirection: 'row', alignItems: 'stretch' },
  includedCell:       { flex: 1, alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8 },
  includedCellDivider:{ width: 1, backgroundColor: '#F3F4F6' },
  includedIconWrap:   { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  dollarEmoji:        { fontSize: 20, fontWeight: '800', color: '#10B981' },
  includedValue:      { fontSize: 15, fontWeight: '800', color: '#1E2B5A', textAlign: 'center', marginBottom: 4 },
  includedLabel:      { fontSize: 12, color: '#9CA3AF', textAlign: 'center', fontWeight: '500' },

  // Actions
  actionsSection: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8, alignItems: 'center' },
  dashboardBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F97316', borderRadius: 16, paddingVertical: 16, gap: 8, width: '100%', shadowColor: '#F97316', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 4 },
  dashboardBtnText:{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  inviteLink:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingVertical: 4 },
  inviteLinkText: { fontSize: 14, fontWeight: '700', color: '#F97316' },
});
