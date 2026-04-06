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
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useAppDataStore } from '../../stores/appDataStore';
import { listGroupsForUser } from '../../lib/groupService';
import {
  getCredentialDisplayName,
  getProfileInitials,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../../lib/profileName';

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, savingsGoals, vaultTransactions, initializeForUser } = useAppDataStore();
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

  const profileStats = [
    { label: 'Groups', value: String(groupCount), icon: <Users size={16} color="#F97316" /> },
    { label: 'Active Goals', value: String(activeGoals), icon: <TrendingUp size={16} color="#1D4ED8" /> },
    { label: 'Total Saved', value: `NLe ${Math.max(0, totalSaved).toFixed(2)}`, icon: <Shield size={16} color="#10B981" /> },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.push('/components/profile-edit')}>
          <Edit size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
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

          <Text style={styles.name}>
            {isPlaceholderProfileName(profile.fullName)
              ? getCredentialDisplayName(profile.email, profile.phone)
              : normalizeProfileName(profile.fullName)}
          </Text>
          <View style={styles.verifyBadge}>
            <Shield size={12} color="#10B981" />
            <Text style={styles.verifyText}>{profile.verificationStatus}</Text>
          </View>
          <Text style={styles.memberSince}>Member since {profile.memberSince}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Mail size={18} color="#6B7280" />
              <Text style={styles.rowText}>{profile.email || 'No email available'}</Text>
            </View>
            <View style={styles.row}>
              <Phone size={18} color="#6B7280" />
              <Text style={styles.rowText}>{profile.phone || 'No phone number set'}</Text>
            </View>
            <View style={styles.row}>
              <Calendar size={18} color="#6B7280" />
              <Text style={styles.rowText}>Referral code: {profile.referralCode}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stats</Text>
          <View style={styles.statsGrid}>
            {profileStats.map((item) => (
              <View style={styles.statCard} key={item.label}>
                <View style={styles.statIcon}>{item.icon}</View>
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
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
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FFFFFF',
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
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  heroCard: {
    marginHorizontal: 24,
    marginTop: 20,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
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
    color: '#1E2B5A',
    marginBottom: 6,
  },
  verifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginBottom: 6,
  },
  verifyText: {
    marginLeft: 4,
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
  },
  memberSince: {
    fontSize: 13,
    color: '#6B7280',
  },
  section: {
    marginTop: 20,
    marginHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
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
    color: '#374151',
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  statIcon: {
    marginBottom: 6,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 3,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
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

