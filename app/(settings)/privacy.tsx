import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Calendar,
  Database,
  Eye,
  Lock,
  User,
  Globe,
  Cookie,
  Trash2,
  Download,
} from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const lastUpdated = 'November 1, 2024';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Privacy Policy</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Last Updated */}
        <View style={[styles.updateCard, { backgroundColor: C.iconBg }]}>
          <Calendar size={16} color={C.textMuted} />
          <Text style={[styles.updateText, { color: C.textSub }]}>Last updated: {lastUpdated}</Text>
        </View>

        {/* Introduction */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Our Privacy Commitment</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            At Mi Osusu, we are committed to protecting your privacy and safeguarding your personal information. This Privacy Policy explains how we collect, use, share, and protect your data when you use our financial services platform.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We believe in transparency and giving you control over your personal information. This policy applies to all users of Mi Osusu in Sierra Leone.
          </Text>
        </View>

        {/* Information We Collect */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Database size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Information We Collect</Text>
          </View>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Personal Information</Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Full name and date of birth</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Government-issued ID details</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Phone number and email address</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Residential address</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Occupation and income information</Text>
          </View>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Financial Information</Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Bank account details</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Mobile money account information</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Transaction history and amounts</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Credit and debit card information</Text>
          </View>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Technical Information</Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Device information and unique identifiers</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- IP address and location data</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- App usage patterns and session data</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Biometric authentication data</Text>
          </View>
        </View>

        {/* How We Use Your Information */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Eye size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>How We Use Your Information</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We use your personal information to:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Provide and maintain our financial services</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Verify your identity and prevent fraud</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Process transactions and manage your account</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Comply with legal and regulatory requirements</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Improve our services and user experience</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Communicate with you about your account</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Detect and prevent security threats</Text>
          </View>
        </View>

        {/* Information Sharing */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Globe size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Information Sharing</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We may share your information in the following circumstances:
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Service Providers</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We share information with trusted third-party service providers who help us operate our platform, including payment processors, cloud infrastructure providers, and security services.
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Legal Requirements</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We may disclose your information when required by law, court order, or government regulation. This includes anti-money laundering and counter-terrorism financing obligations.
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Business Transfers</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of the business transaction.
          </Text>
        </View>

        {/* Data Security */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Lock size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Data Security</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We implement industry-standard security measures to protect your information:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- End-to-end encryption for all transactions</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Secure socket layer (SSL) technology</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Multi-factor authentication requirements</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Regular security audits and penetration testing</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Employee background checks and training</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Secure data centers with 24/7 monitoring</Text>
          </View>
        </View>

        {/* Cookies and Tracking */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Cookie size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Cookies and Tracking</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We use cookies and similar technologies to:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Remember your preferences and settings</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Analyze app usage and performance</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Provide personalized experiences</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Detect and prevent fraudulent activities</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You can control cookie settings through your device preferences.
          </Text>
        </View>

        {/* Your Rights */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <User size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Your Privacy Rights</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You have the following rights regarding your personal information:
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Access and Correction</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You can access and update your personal information through the app settings or by contacting our support team.
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Data Portability</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You can request a copy of your personal data in a structured, machine-readable format.
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Deletion</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You can request deletion of your personal information, subject to legal and regulatory requirements.
          </Text>

          <Text style={[styles.subsectionTitle, { color: C.text }]}>Objection</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You can object to certain uses of your personal information, such as direct marketing.
          </Text>
        </View>

        {/* Data Retention */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Trash2 size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Data Retention</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We retain your personal information only as long as necessary for the purposes outlined in this policy, unless required by law to retain it longer.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Transaction records are typically retained for 7 years to comply with financial regulations. Account information is retained until account closure, after which it may be stored for additional periods as required by law.
          </Text>
        </View>

        {/* International Data Transfers */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Download size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>International Data Transfers</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Your information is primarily stored and processed within Sierra Leone. We may transfer data to international service providers who adhere to equivalent privacy protections.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            All international transfers are conducted in accordance with applicable data protection laws and regulations.
          </Text>
        </View>

        {/* Children's Privacy */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Children's Privacy</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu is not intended for use by individuals under 18 years of age. We do not knowingly collect personal information from children. If we become aware that we have collected information from a minor, we will take steps to delete such information immediately.
          </Text>
        </View>

        {/* Changes to This Policy */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Changes to This Policy</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We may update this Privacy Policy from time to time to reflect changes in our practices or applicable law. We will notify users of significant changes through in-app notifications, email, or other appropriate means.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Your continued use of Mi Osusu after such changes constitutes acceptance of the updated policy.
          </Text>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Contact Us</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            If you have questions about this Privacy Policy or need to exercise your privacy rights, please contact us:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>Email: privacy@miosusu.sl</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>Phone: +232 88 938 326</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>Address: 25 York Road, Waterloo, Sierra Leone</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We will respond to your inquiry within 30 days of receipt.
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
  updateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  updateText: {
    fontSize: 14,
    marginLeft: 8,
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    marginLeft: 8,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  listContainer: {
    marginVertical: 8,
  },
  listItem: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 4,
    paddingLeft: 8,
  },
});
