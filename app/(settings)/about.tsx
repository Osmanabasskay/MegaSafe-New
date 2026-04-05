import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Info,
  Globe,
  Mail,
  Phone,
  MapPin,
  Users,
  Shield,
  Award,
  Star,
  Github,
  Twitter,
  Facebook,
  Instagram,
} from 'lucide-react-native';

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const appVersion = '1.0.0';
  const buildNumber = '2024.11.01';
  const launchDate = 'January 15, 2024';

  const teamMembers = [
    { name: 'Sarah Conteh', role: 'CEO & Founder' },
    { name: 'James Kamara', role: 'CTO' },
    { name: 'Aminata Bangura', role: 'Head of Operations' },
    { name: 'Michael Turay', role: 'Lead Developer' },
    { name: 'Fatmata Kabbah', role: 'Customer Success Manager' },
  ];

  const features = [
    { icon: <Shield size={20} color="#F97316" />, text: 'Bank-level security' },
    { icon: <Users size={20} color="#F97316" />, text: 'Group collections' },
    { icon: <Award size={20} color="#F97316" />, text: 'Regulated by Bank of Sierra Leone' },
    { icon: <Star size={20} color="#F97316" />, text: '4.8/5 user rating' },
  ];

  const handleContactEmail = () => {
    Linking.openURL('mailto:info@megasafe.sl');
  };

  const handleContactPhone = () => {
    Linking.openURL('tel:+23276123456');
  };

  const handleVisitWebsite = () => {
    Linking.openURL('https://www.megasafe.sl');
  };

  const handleSocialPress = (platform: string) => {
    const urls = {
      twitter: 'https://twitter.com/megasafesierraleone',
      facebook: 'https://facebook.com/megasafesierraleone',
      instagram: 'https://instagram.com/megasafesierraleone',
      github: 'https://github.com/megasafe',
    };
    Linking.openURL(urls[platform as keyof typeof urls] || '#');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About MegaSafe</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* App Logo and Version */}
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>MS</Text>
          </View>
          <Text style={styles.appName}>MegaSafe</Text>
          <Text style={styles.version}>Version {appVersion}</Text>
          <Text style={styles.buildInfo}>Build {buildNumber}</Text>
          <Text style={styles.launchInfo}>Launched: {launchDate}</Text>
        </View>

        {/* Mission Statement */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our Mission</Text>
          <Text style={styles.sectionText}>
            MegaSafe is revolutionizing financial services in Sierra Leone by providing secure, accessible, and innovative digital banking solutions. We empower individuals and communities to achieve financial freedom through technology.
          </Text>
        </View>

        {/* Key Features */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Features</Text>
          <View style={styles.featuresGrid}>
            {features.map((feature, index) => (
              <View key={index} style={styles.featureItem}>
                <View style={styles.featureIcon}>{feature.icon}</View>
                <Text style={styles.featureText}>{feature.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Statistics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our Impact</Text>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>50K+</Text>
              <Text style={styles.statLabel}>Active Users</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>NLe 10M+</Text>
              <Text style={styles.statLabel}>Transactions</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={statNumber}>1K+</Text>
              <Text style={styles.statLabel}>Groups</Text>
            </View>
          </View>
        </View>

        {/* Team */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our Team</Text>
          <Text style={styles.sectionText}>
            Meet the passionate team behind MegaSafe, dedicated to transforming financial services in Sierra Leone.
          </Text>
          <View style={styles.teamContainer}>
            {teamMembers.map((member, index) => (
              <View key={index} style={styles.teamMember}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {member.name.split(' ').map(n => n[0]).join('')}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.name}</Text>
                  <Text style={styles.memberRole}>{member.role}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Us</Text>
          
          <TouchableOpacity style={styles.contactItem} onPress={handleContactEmail}>
            <Mail size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={styles.contactLabel}>Email</Text>
              <Text style={styles.contactValue}>info@megasafe.sl</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.contactItem} onPress={handleContactPhone}>
            <Phone size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={styles.contactLabel}>Phone</Text>
              <Text style={styles.contactValue}>+232 76 123 456</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.contactItem} onPress={handleVisitWebsite}>
            <Globe size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={styles.contactLabel}>Website</Text>
              <Text style={styles.contactValue}>www.megasafe.sl</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.contactItem}>
            <MapPin size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={styles.contactLabel}>Address</Text>
              <Text style={styles.contactValue}>42 Circular Road, Freetown, Sierra Leone</Text>
            </View>
          </View>
        </View>

        {/* Social Media */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Follow Us</Text>
          <View style={styles.socialContainer}>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialPress('twitter')}
            >
              <Twitter size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialPress('facebook')}
            >
              <Facebook size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialPress('instagram')}
            >
              <Instagram size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.socialButton}
              onPress={() => handleSocialPress('github')}
            >
              <Github size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Legal Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal Information</Text>
          <Text style={styles.sectionText}>
            MegaSafe is licensed and regulated by the Bank of Sierra Leone. We comply with all applicable financial regulations and anti-money laundering requirements.
          </Text>
          <Text style={styles.sectionText}>
            License Number: BSL/DFI/2024/001
          </Text>
          <Text style={styles.sectionText}>
            Registered Office: 42 Circular Road, Freetown, Sierra Leone
          </Text>
        </View>

        {/* Acknowledgments */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Acknowledgments</Text>
          <Text style={styles.sectionText}>
            Special thanks to the Bank of Sierra Leone for their guidance and support. We also thank our early users and partners who helped shape MegaSafe into what it is today.
          </Text>
        </View>

        {/* Copyright */}
        <View style={styles.footer}>
          <Text style={styles.copyright}>
            © 2024 MegaSafe Financial Services Ltd. All rights reserved.
          </Text>
          <Text style={styles.footerText}>
            Made with ❤️ in Sierra Leone
          </Text>
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
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  logoSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  version: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  buildInfo: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  launchInfo: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  sectionText: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    marginBottom: 16,
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  featureItem: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  featureIcon: {
    marginRight: 12,
  },
  featureText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F97316',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  teamContainer: {
    marginTop: 16,
  },
  teamMember: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6B7280',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginBottom: 4,
  },
  memberRole: {
    fontSize: 14,
    color: '#6B7280',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  contactContent: {
    marginLeft: 16,
    flex: 1,
  },
  contactLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  contactValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
  },
  socialContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  socialButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  copyright: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 8,
  },
  footerText: {
    fontSize: 14,
    color: '#F97316',
    textAlign: 'center',
  },
});
