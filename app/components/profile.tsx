import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Calendar,
  Camera,
  Edit,
  Mail,
  Phone,
} from 'lucide-react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { listGroupsForUser } from '../../src/services/groupService';
import {
  getCredentialDisplayName,
  getProfileInitials,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../src/utils/profileName';

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, savingsGoals, vaultTransactions, initializeForUser, preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const [groupCount, setGroupCount] = useState(0);

  useEffect(() => {
    initializeForUser(user);
  }, [initializeForUser, user]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!user?.id) return;
      const { groups } = await listGroupsForUser(user.id);
      if (mounted) setGroupCount(groups.length);
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const totalSaved = useMemo(
    () =>
      vaultTransactions
        .filter((transaction) => transaction.status === 'completed')
        .reduce((sum, transaction) => {
          if (transaction.type === 'withdrawal') return sum - transaction.amount;
          return sum + transaction.amount;
        }, 0),
    [vaultTransactions]
  );

  const activeGoals = useMemo(
    () => savingsGoals.filter((goal) => goal.status === 'active').length,
    [savingsGoals]
  );

  // Phase 3: icons removed from stats — clean text-only layout
  const profileStats = [
    { label: 'Groups', value: String(groupCount) },
    { label: 'Active Goals', value: String(activeGoals) },
    { label: 'Total Saved', value: `NLe ${Math.max(0, totalSaved).toFixed(2)}` },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Profile</Text>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/components/profile-edit')}>
          <Edit size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, { backgroundColor: C.card }]}>
          <View style={styles.avatarWrap}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>
                  {getProfileInitials(
                    profile.fullName,
                    getCredentialDisplayName(profile.email, profile.phone)
                  )}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.cameraButton} onPress={() => router.push('/components/profile-edit')}>
              <Camera size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <Text style={[styles.name, { color: C.text }]}>
            {isPlaceholderProfileName(profile.fullName)
              ? getCredentialDisplayName(profile.email, profile.phone)
              : normalizeProfileName(profile.fullName)}
          </Text>
          <View style={[styles.verifyBadge, { backgroundColor: isDark ? '#065F46' : '#D1FAE5' }]}>
            <Text style={styles.verifyText}>{profile.verificationStatus}</Text>
          </View>
          <Text style={[styles.memberSince, { color: C.textSub }]}>Member since {profile.memberSince}</Text>
        </View>

        <View style={[styles.section, { marginTop: 20 }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Contact</Text>
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.row}>
              <Mail size={18} color={C.textSub} />
              <Text style={[styles.rowText, { color: C.text }]}>{profile.email || 'No email available'}</Text>
            </View>
            <View style={styles.row}>
              <Phone size={18} color={C.textSub} />
              <Text style={[styles.rowText, { color: C.text }]}>{profile.phone || 'No phone number set'}</Text>
            </View>
            <View style={styles.row}>
              <Calendar size={18} color={C.textSub} />
              <Text style={[styles.rowText, { color: C.text }]}>Referral code: {profile.referralCode}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.section, { marginTop: 20 }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Stats</Text>
          <View style={styles.statsGrid}>
            {profileStats.map((item) => (
              <View style={[styles.statCard, { backgroundColor: C.card }]} key={item.label}>
                <Text style={[styles.statValue, { color: C.text }]}>{item.value}</Text>
                <Text style={[styles.statLabel, { color: C.textSub }]}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.section, { marginTop: 20 }]}>
          <TouchableOpacity style={styles.ctaButton} onPress={() => router.push('/components/settings')}>
            <Text style={styles.ctaText}>Manage Profile & Security</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 36,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  heroCard: {
    marginHorizontal: 24,
    marginTop: 20,
    borderRadius: 18,
    alignItems: 'center',
    padding: 20,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  cameraButton: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E2B5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  verifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginBottom: 6,
  },
  verifyText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
  },
  memberSince: {
    fontSize: 13,
  },
  section: {
    marginHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  card: {
    borderRadius: 14,
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowText: {
    marginLeft: 10,
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
  ctaButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 26,
  },
  ctaText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
