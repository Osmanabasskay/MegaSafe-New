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
  Globe,
  Mail,
  Phone,
  MapPin,
} from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = useAppDataStore((s) => s.preferences.darkMode);
  const C = isDark ? darkColors : lightColors;

  const appVersion = '1.0.0';
  const buildNumber = '2024.11.01';
  const launchDate = 'January 15, 2024';

  // Phase 8: Updated team information
  const teamMembers = [
    { name: 'Osman Abass Kamara', role: 'CEO & Founder' },
    { name: 'Archibald Jarbee', role: 'CTO' },
    { name: 'Mohamed Yorpoi', role: 'Head of Operations' },
    { name: 'Osman Abass Kamara', role: 'Lead Developer' },
    { name: 'Momoh Samura', role: 'Customer Success Manager' },
  ];

  // Phase 7: Icons removed from features — text only
  const features = [
    { text: 'Bank-level security' },
    { text: 'Group collections' },
    { text: 'Regulated by Bank of Sierra Leone' },
    { text: '4.8/5 user rating' },
  ];

  const handleContactEmail = () => {
    void Linking.openURL('mailto:info@miosusu.sl');
  };

  // Phase 6: Updated phone number
  const handleContactPhone = () => {
    void Linking.openURL('tel:+23288938326');
  };

  const handleVisitWebsite = () => {
    void Linking.openURL('https://www.miosusu.sl');
  };

  const handleSocialPress = (platform: string) => {
    const urls: Record<string, string> = {
      twitter: 'https://twitter.com/miosususierraleone',
      facebook: 'https://facebook.com/miosususierraleone',
      instagram: 'https://instagram.com/miosususierraleone',
      github: 'https://github.com/miosusu',
    };
    const url = urls[platform];
    if (url) void Linking.openURL(url);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>About Mi Osusu</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Logo and Version */}
        <View style={styles.logoSection}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>MS</Text>
          </View>
          <Text style={[styles.appName, { color: C.text }]}>Mi Osusu</Text>
          <Text style={[styles.version, { color: C.textSub }]}>Version {appVersion}</Text>
          <Text style={[styles.buildInfo, { color: C.textMuted }]}>Build {buildNumber}</Text>
          <Text style={[styles.launchInfo, { color: C.textMuted }]}>Launched: {launchDate}</Text>
        </View>

        {/* Mission Statement */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Our Mission</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu is revolutionizing financial services in Sierra Leone by providing secure, accessible, and innovative digital banking solutions. We empower individuals and communities to achieve financial freedom through technology.
          </Text>
        </View>

        {/* Key Features — Phase 7: icons removed, text only */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Key Features</Text>
          <View style={styles.featuresGrid}>
            {features.map((feature, index) => (
              <View key={index} style={[styles.featureItem, { backgroundColor: C.card }]}>
                <Text style={[styles.featureText, { color: C.text }]}>{feature.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Impact Statistics */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Our Impact</Text>
          <View style={[styles.statsContainer, { backgroundColor: C.card }]}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>50K+</Text>
              <Text style={[styles.statLabel, { color: C.textSub }]}>Active Users</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: C.borderStrong }]} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>NLe 10M+</Text>
              <Text style={[styles.statLabel, { color: C.textSub }]}>Transactions</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: C.borderStrong }]} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>1K+</Text>
              <Text style={[styles.statLabel, { color: C.textSub }]}>Groups</Text>
            </View>
          </View>
        </View>

        {/* Phase 8: Updated Team */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Our Team</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Meet the passionate team behind Mi Osusu, dedicated to transforming financial services in Sierra Leone.
          </Text>
          <View style={styles.teamContainer}>
            {teamMembers.map((member, index) => (
              <View key={index} style={[styles.teamMember, { backgroundColor: C.card }]}>
                <View style={[styles.avatar, { backgroundColor: C.iconBg }]}>
                  <Text style={[styles.avatarText, { color: C.textSub }]}>
                    {member.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: C.text }]}>{member.name}</Text>
                  <Text style={[styles.memberRole, { color: C.textSub }]}>{member.role}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Phase 9: Updated Address */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Contact Us</Text>

          <TouchableOpacity style={[styles.contactItem, { backgroundColor: C.card }]} onPress={handleContactEmail}>
            <Mail size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={[styles.contactLabel, { color: C.textSub }]}>Email</Text>
              <Text style={[styles.contactValue, { color: C.text }]}>info@miosusu.sl</Text>
            </View>
          </TouchableOpacity>

          {/* Phase 6: Updated phone number */}
          <TouchableOpacity style={[styles.contactItem, { backgroundColor: C.card }]} onPress={handleContactPhone}>
            <Phone size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={[styles.contactLabel, { color: C.textSub }]}>Phone</Text>
              <Text style={[styles.contactValue, { color: C.text }]}>+232 88 938 326</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.contactItem, { backgroundColor: C.card }]} onPress={handleVisitWebsite}>
            <Globe size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={[styles.contactLabel, { color: C.textSub }]}>Website</Text>
              <Text style={[styles.contactValue, { color: C.text }]}>www.miosusu.sl</Text>
            </View>
          </TouchableOpacity>

          {/* Phase 9: New address — 25 York Road, Waterloo */}
          <View style={[styles.contactItem, { backgroundColor: C.card }]}>
            <MapPin size={20} color="#F97316" />
            <View style={styles.contactContent}>
              <Text style={[styles.contactLabel, { color: C.textSub }]}>Address</Text>
              <Text style={[styles.contactValue, { color: C.text }]}>25 York Road, Waterloo</Text>
            </View>
          </View>
        </View>

        {/* Social Media */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Follow Us</Text>
          <View style={styles.socialContainer}>
            <TouchableOpacity style={styles.socialButton} onPress={() => handleSocialPress('twitter')}>
              <Text style={styles.socialIconText}>X</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialButton} onPress={() => handleSocialPress('facebook')}>
              <Text style={styles.socialIconText}>f</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialButton} onPress={() => handleSocialPress('instagram')}>
              <Text style={styles.socialIconText}>IG</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialButton} onPress={() => handleSocialPress('github')}>
              <Text style={styles.socialIconText}>GH</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Legal Information — Phase 9: updated registered office */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Legal Information</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu is licensed and regulated by the Bank of Sierra Leone. We comply with all applicable financial regulations and anti-money laundering requirements.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            License Number: BSL/DFI/2024/001
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Registered Office: 25 York Road, Waterloo
          </Text>
        </View>

        {/* Acknowledgments */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Acknowledgments</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Special thanks to the Bank of Sierra Leone for their guidance and support. We also thank our early users and partners who helped shape Mi Osusu into what it is today.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.copyright, { color: C.textSub }]}>
            © 2024 Mi Osusu Financial Services Ltd. All rights reserved.
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
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
    marginBottom: 8,
  },
  version: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  buildInfo: {
    fontSize: 14,
    marginBottom: 2,
  },
  launchInfo: {
    fontSize: 14,
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  sectionText: {
    fontSize: 16,
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
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  featureText: {
    fontSize: 14,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 20,
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
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    marginHorizontal: 16,
  },
  teamContainer: {
    marginTop: 16,
  },
  teamMember: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  memberRole: {
    fontSize: 14,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  contactContent: {
    marginLeft: 16,
    flex: 1,
  },
  contactLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  contactValue: {
    fontSize: 16,
    fontWeight: '600',
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
  socialIconText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  copyright: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  footerText: {
    fontSize: 14,
    color: '#F97316',
    textAlign: 'center',
  },
});
