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
  Shield,
  Calendar,
  Database,
  Eye,
  Lock,
  User,
  Mail,
  Phone,
  Globe,
  Cookie,
  Trash2,
  Download,
} from 'lucide-react-native';

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const lastUpdated = 'November 1, 2024';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Last Updated */}
        <View style={styles.updateCard}>
          <Calendar size={16} color="#6B7280" />
          <Text style={styles.updateText}>Last updated: {lastUpdated}</Text>
        </View>

        {/* Introduction */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our Privacy Commitment</Text>
          <Text style={styles.sectionText}>
            At MegaSafe, we are committed to protecting your privacy and safeguarding your personal information. This Privacy Policy explains how we collect, use, share, and protect your data when you use our financial services platform.
          </Text>
          <Text style={styles.sectionText}>
            We believe in transparency and giving you control over your personal information. This policy applies to all users of MegaSafe in Sierra Leone.
          </Text>
        </View>

        {/* Information We Collect */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Database size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Information We Collect</Text>
          </View>
          
          <Text style={styles.subsectionTitle}>Personal Information</Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Full name and date of birth</Text>
            <Text style={styles.listItem}>• Government-issued ID details</Text>
            <Text style={styles.listItem}>• Phone number and email address</Text>
            <Text style={styles.listItem}>• Residential address</Text>
            <Text style={styles.listItem}>• Occupation and income information</Text>
          </View>

          <Text style={styles.subsectionTitle}>Financial Information</Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Bank account details</Text>
            <Text style={styles.listItem}>• Mobile money account information</Text>
            <Text style={styles.listItem}>• Transaction history and amounts</Text>
            <Text style={styles.listItem}>• Credit and debit card information</Text>
          </View>

          <Text style={styles.subsectionTitle}>Technical Information</Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Device information and unique identifiers</Text>
            <Text style={styles.listItem}>• IP address and location data</Text>
            <Text style={styles.listItem}>• App usage patterns and session data</Text>
            <Text style={styles.listItem}>• Biometric authentication data</Text>
          </View>
        </View>

        {/* How We Use Your Information */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Eye size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>How We Use Your Information</Text>
          </View>
          <Text style={styles.sectionText}>
            We use your personal information to:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Provide and maintain our financial services</Text>
            <Text style={styles.listItem}>• Verify your identity and prevent fraud</Text>
            <Text style={styles.listItem}>• Process transactions and manage your account</Text>
            <Text style={styles.listItem}>• Comply with legal and regulatory requirements</Text>
            <Text style={styles.listItem}>• Improve our services and user experience</Text>
            <Text style={styles.listItem}>• Communicate with you about your account</Text>
            <Text style={styles.listItem}>• Detect and prevent security threats</Text>
          </View>
        </View>

        {/* Information Sharing */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Globe size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Information Sharing</Text>
          </View>
          <Text style={styles.sectionText}>
            We may share your information in the following circumstances:
          </Text>
          
          <Text style={styles.subsectionTitle}>Service Providers</Text>
          <Text style={styles.sectionText}>
            We share information with trusted third-party service providers who help us operate our platform, including payment processors, cloud infrastructure providers, and security services.
          </Text>

          <Text style={styles.subsectionTitle}>Legal Requirements</Text>
          <Text style={styles.sectionText}>
            We may disclose your information when required by law, court order, or government regulation. This includes anti-money laundering and counter-terrorism financing obligations.
          </Text>

          <Text style={styles.subsectionTitle}>Business Transfers</Text>
          <Text style={styles.sectionText}>
            In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of the business transaction.
          </Text>
        </View>

        {/* Data Security */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Lock size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Data Security</Text>
          </View>
          <Text style={styles.sectionText}>
            We implement industry-standard security measures to protect your information:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• End-to-end encryption for all transactions</Text>
            <Text style={styles.listItem}>• Secure socket layer (SSL) technology</Text>
            <Text style={styles.listItem}>• Multi-factor authentication requirements</Text>
            <Text style={styles.listItem}>• Regular security audits and penetration testing</Text>
            <Text style={styles.listItem}>• Employee background checks and training</Text>
            <Text style={styles.listItem}>• Secure data centers with 24/7 monitoring</Text>
          </View>
        </View>

        {/* Cookies and Tracking */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Cookie size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Cookies and Tracking</Text>
          </View>
          <Text style={styles.sectionText}>
            We use cookies and similar technologies to:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Remember your preferences and settings</Text>
            <Text style={styles.listItem}>• Analyze app usage and performance</Text>
            <Text style={styles.listItem}>• Provide personalized experiences</Text>
            <Text style={styles.listItem}>• Detect and prevent fraudulent activities</Text>
          </View>
          <Text style={styles.sectionText}>
            You can control cookie settings through your device preferences.
          </Text>
        </View>

        {/* Your Rights */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <User size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Your Privacy Rights</Text>
          </View>
          <Text style={styles.sectionText}>
            You have the following rights regarding your personal information:
          </Text>
          
          <Text style={styles.subsectionTitle}>Access and Correction</Text>
          <Text style={styles.sectionText}>
            You can access and update your personal information through the app settings or by contacting our support team.
          </Text>

          <Text style={styles.subsectionTitle}>Data Portability</Text>
          <Text style={styles.sectionText}>
            You can request a copy of your personal data in a structured, machine-readable format.
          </Text>

          <Text style={styles.subsectionTitle}>Deletion</Text>
          <Text style={styles.sectionText}>
            You can request deletion of your personal information, subject to legal and regulatory requirements.
          </Text>

          <Text style={styles.subsectionTitle}>Objection</Text>
          <Text style={styles.sectionText}>
            You can object to certain uses of your personal information, such as direct marketing.
          </Text>
        </View>

        {/* Data Retention */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Trash2 size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Data Retention</Text>
          </View>
          <Text style={styles.sectionText}>
            We retain your personal information only as long as necessary for the purposes outlined in this policy, unless required by law to retain it longer.
          </Text>
          <Text style={styles.sectionText}>
            Transaction records are typically retained for 7 years to comply with financial regulations. Account information is retained until account closure, after which it may be stored for additional periods as required by law.
          </Text>
        </View>

        {/* International Data Transfers */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Download size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>International Data Transfers</Text>
          </View>
          <Text style={styles.sectionText}>
            Your information is primarily stored and processed within Sierra Leone. We may transfer data to international service providers who adhere to equivalent privacy protections.
          </Text>
          <Text style={styles.sectionText}>
            All international transfers are conducted in accordance with applicable data protection laws and regulations.
          </Text>
        </View>

        {/* Children's Privacy */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Children's Privacy</Text>
          <Text style={styles.sectionText}>
            MegaSafe is not intended for use by individuals under 18 years of age. We do not knowingly collect personal information from children. If we become aware that we have collected information from a minor, we will take steps to delete such information immediately.
          </Text>
        </View>

        {/* Changes to This Policy */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Changes to This Policy</Text>
          <Text style={styles.sectionText}>
            We may update this Privacy Policy from time to time to reflect changes in our practices or applicable law. We will notify users of significant changes through in-app notifications, email, or other appropriate means.
          </Text>
          <Text style={styles.sectionText}>
            Your continued use of MegaSafe after such changes constitutes acceptance of the updated policy.
          </Text>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Us</Text>
          <Text style={styles.sectionText}>
            If you have questions about this Privacy Policy or need to exercise your privacy rights, please contact us:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>Email: privacy@megasafe.sl</Text>
            <Text style={styles.listItem}>Phone: +232 76 123 456</Text>
            <Text style={styles.listItem}>Address: 42 Circular Road, Freetown, Sierra Leone</Text>
          </View>
          <Text style={styles.sectionText}>
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
  updateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    margin: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  updateText: {
    fontSize: 14,
    color: '#6B7280',
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
    color: '#1E2B5A',
    marginBottom: 12,
    marginLeft: 8,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginTop: 20,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    marginBottom: 16,
  },
  listContainer: {
    marginVertical: 8,
  },
  listItem: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    marginBottom: 4,
    paddingLeft: 8,
  },
});
