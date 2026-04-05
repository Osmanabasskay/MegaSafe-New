import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  Shield,
  Edit,
  Camera,
  Award,
  TrendingUp,
  Users,
  Clock,
} from 'lucide-react-native';

export default function ProfileScreen() {
  const router = useRouter();

  const userProfile = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+232 76 123 456',
    joinDate: 'January 15, 2024',
    verificationStatus: 'Verified',
    profileImage: null, // Would be actual image URL
  };

  const stats = {
    totalGroups: 12,
    totalSaved: 'NLe 2,500',
    activeGroups: 8,
    completedGroups: 4,
    memberSince: '15 months',
    referralCount: 8,
    totalEarnings: 'NLe 400',
  };

  const achievements = [
    { id: '1', name: 'Early Adopter', description: 'Joined in the first month', icon: '🌟', earned: true },
    { id: '2', name: 'Group Leader', description: 'Created 5+ groups', icon: '👥', earned: true },
    { id: '3', name: 'Super Saver', description: 'Saved over NLe 2000', icon: '💰', earned: true },
    { id: '4', name: 'Referral Master', description: 'Referred 10+ friends', icon: '🎯', earned: false },
  ];

  const recentActivity = [
    { id: '1', type: 'group_join', title: 'Joined "Business Savings Group"', date: '2 days ago' },
    { id: '2', type: 'contribution', title: 'Contributed NLe 100 to Family Circle', date: '3 days ago' },
    { id: '3', type: 'achievement', title: 'Earned "Super Saver" badge', date: '1 week ago' },
    { id: '4', type: 'referral', title: 'Friend joined using your code', date: '2 weeks ago' },
  ];

  const renderStatCard = (title: string, value: string, icon: any, color: string = '#F97316') => (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${color}20` }]}>
        {icon}
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );

  const renderAchievement = (achievement: any) => (
    <View key={achievement.id} style={[styles.achievementCard, !achievement.earned && styles.achievementLocked]}>
      <Text style={styles.achievementIcon}>{achievement.icon}</Text>
      <View style={styles.achievementInfo}>
        <Text style={styles.achievementName}>{achievement.name}</Text>
        <Text style={styles.achievementDescription}>{achievement.description}</Text>
      </View>
      {achievement.earned ? (
        <Award size={20} color="#10B981" />
      ) : (
        <Lock size={20} color="#9CA3AF" />
      )}
    </View>
  );

  const renderActivityItem = (activity: any) => {
    const getIcon = () => {
      switch (activity.type) {
        case 'group_join':
          return <Users size={16} color="#F97316" />;
        case 'contribution':
          return <TrendingUp size={16} color="#10B981" />;
        case 'achievement':
          return <Award size={16} color="#8B5CF6" />;
        case 'referral':
          return <Gift size={16} color="#F59E0B" />;
        default:
          return <Clock size={16} color="#6B7280" />;
      }
    };

    return (
      <View key={activity.id} style={styles.activityItem}>
        <View style={styles.activityIcon}>
          {getIcon()}
        </View>
        <View style={styles.activityContent}>
          <Text style={styles.activityTitle}>{activity.title}</Text>
          <Text style={styles.activityDate}>{activity.date}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity style={styles.editButton}>
          <Edit size={20} color="#F97316" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            {userProfile.profileImage ? (
              <Image source={{ uri: userProfile.profileImage }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={40} color="#FFFFFF" />
              </View>
            )}
            <TouchableOpacity style={styles.cameraButton}>
              <Camera size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.profileName}>{userProfile.name}</Text>
          <View style={styles.verificationBadge}>
            <Shield size={12} color="#10B981" />
            <Text style={styles.verificationText}>{userProfile.verificationStatus}</Text>
          </View>
          <Text style={styles.memberSince}>Member since {userProfile.joinDate}</Text>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoItem}>
              <Mail size={20} color="#6B7280" />
              <Text style={styles.infoText}>{userProfile.email}</Text>
            </View>
            <View style={styles.infoItem}>
              <Phone size={20} color="#6B7280" />
              <Text style={styles.infoText}>{userProfile.phone}</Text>
            </View>
            <View style={styles.infoItem}>
              <Calendar size={20} color="#6B7280" />
              <Text style={styles.infoText}>Joined {userProfile.joinDate}</Text>
            </View>
          </View>
        </View>

        {/* Statistics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Statistics</Text>
          <View style={styles.statsGrid}>
            {renderStatCard('Total Groups', stats.totalGroups.toString(), <Users size={20} color="#F97316" />)}
            {renderStatCard('Total Saved', stats.totalSaved, <TrendingUp size={20} color="#10B981" />, '#10B981')}
            {renderStatCard('Active Groups', stats.activeGroups.toString(), <Users size={20} color="#8B5CF6" />, '#8B5CF6')}
            {renderStatCard('Referrals', stats.referralCount.toString(), <Gift size={20} color="#F59E0B" />, '#F59E0B')}
          </View>
        </View>

        {/* Achievements */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.achievementsContainer}>
            {achievements.map(renderAchievement)}
          </View>
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.activityContainer}>
            {recentActivity.map(renderActivityItem)}
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.actionButton}>
              <Edit size={20} color="#F97316" />
              <Text style={styles.actionButtonText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <Shield size={20} color="#10B981" />
              <Text style={styles.actionButtonText}>Verification</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <Gift size={20} color="#F59E0B" />
              <Text style={styles.actionButtonText}>Referrals</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const Lock = ({ size, color }: { size: number; color: string }) => (
  <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: size * 0.8, color, fontWeight: 'bold' }}>🔒</Text>
  </View>
);

const Gift = ({ size, color }: { size: number; color: string }) => (
  <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: size * 0.8, color, fontWeight: 'bold' }}>🎁</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
    flex: 1,
  },
  editButton: {
    padding: 8,
  },
  scrollView: {
    flex: 1,
  },
  profileHeader: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
    marginBottom: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  profileName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 8,
  },
  verificationText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '500',
    marginLeft: 4,
  },
  memberSince: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  viewAllText: {
    fontSize: 14,
    color: '#F97316',
    fontWeight: '500',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 24,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  infoText: {
    fontSize: 16,
    color: '#374151',
    marginLeft: 12,
    flex: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    gap: 16,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  statTitle: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  achievementsContainer: {
    paddingHorizontal: 24,
  },
  achievementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  achievementLocked: {
    opacity: 0.6,
  },
  achievementIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  achievementInfo: {
    flex: 1,
  },
  achievementName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  achievementDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
  activityContainer: {
    paddingHorizontal: 24,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  activityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  activityDate: {
    fontSize: 14,
    color: '#6B7280',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginLeft: 8,
  },
});
