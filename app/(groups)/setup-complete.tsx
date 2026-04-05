import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { 
  ArrowLeft, 
  CheckCircle, 
  Users, 
  DollarSign, 
  Calendar,
  Shield,
  ArrowRight,
  Home,
  List,
  Settings
} from 'lucide-react-native';

export default function SetupCompleteScreen() {
  const router = useRouter();

  const groupData = {
    name: 'Family Savings Circle',
    members: 5,
    contributionAmount: '100.00',
    frequency: 'Weekly',
    startDate: 'Dec 15, 2024',
    inviteCode: 'MSF-ABC123',
  };

  const handleGoToDashboard = () => {
    // TODO: Navigate to group dashboard
    router.replace('/(groups)/manage/1');
  };

  const handleViewGroup = () => {
    // TODO: Navigate to group details
    router.replace('/(groups)/manage/1');
  };

  const handleInviteMore = () => {
    // TODO: Navigate back to invite screen
    router.push('/(groups)/invite');
  };

  const features = [
    {
      icon: <Users size={24} color="#F97316" />,
      title: '5 Members',
      description: 'All members have joined the group',
    },
    {
      icon: <DollarSign size={24} color="#F97316" />,
      title: 'NLe 100.00',
      description: 'Weekly contribution amount',
    },
    {
      icon: <Calendar size={24} color="#F97316" />,
      title: 'Weekly Schedule',
      description: 'Contributions due every Friday',
    },
    {
      icon: <Shield size={24} color="#F97316" />,
      title: 'Secure & Insured',
      description: 'All transactions are protected',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Setup Complete</Text>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Message */}
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <CheckCircle size={64} color="#10B981" />
          </View>
          <Text style={styles.successTitle}>Group Created Successfully!</Text>
          <Text style={styles.successMessage}>
            Your Osusu group "{groupData.name}" is now ready. Members can start contributing according to the schedule.
          </Text>
        </View>

        {/* Group Summary */}
        <View style={styles.summaryContainer}>
          <Text style={styles.summaryTitle}>Group Summary</Text>
          
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Group Name</Text>
            <Text style={styles.summaryValue}>{groupData.name}</Text>
          </View>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Invite Code</Text>
            <View style={styles.codeContainer}>
              <Text style={styles.codeText}>{groupData.inviteCode}</Text>
            </View>
          </View>

          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Start Date</Text>
            <Text style={styles.summaryValue}>{groupData.startDate}</Text>
          </View>
        </View>

        {/* Features Grid */}
        <View style={styles.featuresContainer}>
          <Text style={styles.featuresTitle}>What's Included</Text>
          <View style={styles.featuresGrid}>
            {features.map((feature, index) => (
              <View key={index} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  {feature.icon}
                </View>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={handleGoToDashboard}
          >
            <Text style={styles.primaryButtonText}>Go to Group Dashboard</Text>
            <ArrowRight size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.secondaryButtons}>
            <TouchableOpacity 
              style={styles.secondaryButton} 
              onPress={handleViewGroup}
            >
              <List size={18} color="#F97316" />
              <Text style={styles.secondaryButtonText}>View Group Details</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.secondaryButton} 
              onPress={handleInviteMore}
            >
              <Users size={18} color="#F97316" />
              <Text style={styles.secondaryButtonText}>Invite More Members</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tips Section */}
        <View style={styles.tipsContainer}>
          <Text style={styles.tipsTitle}>Quick Tips</Text>
          
          <View style={styles.tipItem}>
            <View style={styles.tipBullet}>
              <Text style={styles.tipBulletText}>1</Text>
            </View>
            <Text style={styles.tipText}>
              Share the invite code with trusted members only
            </Text>
          </View>

          <View style={styles.tipItem}>
            <View style={styles.tipBullet}>
              <Text style={styles.tipBulletText}>2</Text>
            </View>
            <Text style={styles.tipText}>
              Set up payment reminders to avoid late fees
            </Text>
          </View>

          <View style={styles.tipItem}>
            <View style={styles.tipBullet}>
              <Text style={styles.tipBulletText}>3</Text>
            </View>
            <Text style={styles.tipText}>
              All members can view the transaction history for transparency
            </Text>
          </View>
        </View>

        {/* Bottom Navigation */}
        <View style={styles.bottomNav}>
          <TouchableOpacity 
            style={styles.navItem}
            onPress={() => router.replace('/(main)/home')}
          >
            <Home size={20} color="#6B7280" />
            <Text style={styles.navText}>Home</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navItem, styles.navItemActive]}
            onPress={handleGoToDashboard}
          >
            <List size={20} color="#F97316" />
            <Text style={[styles.navText, styles.navTextActive]}>Groups</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.navItem}
            onPress={() => router.replace('/(main)/profile')}
          >
            <Settings size={20} color="#6B7280" />
            <Text style={styles.navText}>Profile</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

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
    borderBottomColor: '#F3F4F6',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 100,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 8,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  summaryContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  codeContainer: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F97316',
  },
  codeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F97316',
    letterSpacing: 1,
  },
  featuresContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  featureCard: {
    width: '48%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  featureIcon: {
    marginBottom: 8,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
    textAlign: 'center',
  },
  featureDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  actionsContainer: {
    marginBottom: 16,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    marginBottom: 16,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginRight: 8,
  },
  secondaryButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    width: '48%',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F97316',
    marginLeft: 8,
  },
  tipsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tipBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tipBulletText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    paddingTop: 2,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingVertical: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  navItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#F97316',
  },
  navText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 4,
  },
  navTextActive: {
    color: '#F97316',
  },
});
