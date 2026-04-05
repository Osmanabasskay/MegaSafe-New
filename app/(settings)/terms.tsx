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
  FileText,
  Calendar,
  User,
  Shield,
  CreditCard,
  AlertTriangle,
} from 'lucide-react-native';

export default function TermsOfServiceScreen() {
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
        <Text style={styles.headerTitle}>Terms of Service</Text>
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
          <Text style={styles.sectionTitle}>Introduction</Text>
          <Text style={styles.sectionText}>
            Welcome to MegaSafe. These Terms of Service ("Terms") govern your use of MegaSafe's financial services platform and mobile application. By accessing or using MegaSafe, you agree to be bound by these Terms.
          </Text>
          <Text style={styles.sectionText}>
            MegaSafe is a digital financial platform designed to facilitate secure money transfers, group collections, and payment services within Sierra Leone.
          </Text>
        </View>

        {/* Acceptance of Terms */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <User size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Acceptance of Terms</Text>
          </View>
          <Text style={styles.sectionText}>
            By creating an account and using MegaSafe, you represent that you are at least 18 years old and have the legal capacity to enter into these Terms. You also confirm that all information you provide is accurate and complete.
          </Text>
        </View>

        {/* Services */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <CreditCard size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Services Provided</Text>
          </View>
          <Text style={styles.sectionText}>
            MegaSafe provides the following services:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Digital wallet and money storage</Text>
            <Text style={styles.listItem}>• Peer-to-peer money transfers</Text>
            <Text style={styles.listItem}>• Group collection management</Text>
            <Text style={styles.listItem}>• Bill payment services</Text>
            <Text style={styles.listItem}>• Mobile money integration</Text>
            <Text style={styles.listItem}>• Transaction history and reporting</Text>
          </View>
        </View>

        {/* User Responsibilities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Shield size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>User Responsibilities</Text>
          </View>
          <Text style={styles.sectionText}>
            As a MegaSafe user, you agree to:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Maintain accurate account information</Text>
            <Text style={styles.listItem}>• Keep your login credentials secure</Text>
            <Text style={styles.listItem}>• Use the service for legitimate transactions only</Text>
            <Text style={styles.listItem}>• Comply with all applicable laws and regulations</Text>
            <Text style={styles.listItem}>• Not engage in fraudulent activities</Text>
            <Text style={styles.listItem}>• Report suspicious activity immediately</Text>
          </View>
        </View>

        {/* Prohibited Activities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AlertTriangle size={20} color="#F97316" />
            <Text style={styles.sectionTitle}>Prohibited Activities</Text>
          </View>
          <Text style={styles.sectionText}>
            You may not use MegaSafe for:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Illegal activities or transactions</Text>
            <Text style={styles.listItem}>• Money laundering or terrorist financing</Text>
            <Text style={styles.listItem}>• Fraudulent or deceptive practices</Text>
            <Text style={styles.listItem}>• Unauthorized access to others' accounts</Text>
            <Text style={styles.listItem}>• Violation of intellectual property rights</Text>
            <Text style={styles.listItem}>• Interference with service operations</Text>
          </View>
        </View>

        {/* Fees and Charges */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fees and Charges</Text>
          <Text style={styles.sectionText}>
            MegaSafe charges transparent fees for various services:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>• Transfer fees: 1% of transaction amount</Text>
            <Text style={styles.listItem}>• Group collection fees: 2% of collected amount</Text>
            <Text style={styles.listItem}>• Bill payment fees: Variable by service provider</Text>
            <Text style={styles.listItem}>• Withdrawal fees: NLe 5.00 per withdrawal</Text>
          </View>
          <Text style={styles.sectionText}>
            All fees are clearly displayed before transaction confirmation. MegaSafe reserves the right to modify fees with 30 days' notice.
          </Text>
        </View>

        {/* Privacy and Data Protection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy and Data Protection</Text>
          <Text style={styles.sectionText}>
            Your privacy is important to us. MegaSafe collects and processes personal data in accordance with our Privacy Policy and applicable data protection laws. We implement industry-standard security measures to protect your information.
          </Text>
          <Text style={styles.sectionText}>
            By using MegaSafe, you consent to the collection, use, and sharing of your information as described in our Privacy Policy.
          </Text>
        </View>

        {/* Account Security */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Security</Text>
          <Text style={styles.sectionText}>
            You are responsible for maintaining the security of your account. MegaSafe will never ask for your password or PIN through unsolicited communications. If you suspect unauthorized access, contact us immediately.
          </Text>
          <Text style={styles.sectionText}>
            We recommend enabling two-factor authentication and using strong, unique passwords.
          </Text>
        </View>

        {/* Limitation of Liability */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Limitation of Liability</Text>
          <Text style={styles.sectionText}>
            MegaSafe provides services "as is" and makes no warranties regarding the accuracy, reliability, or availability of our services. We shall not be liable for any indirect, incidental, or consequential damages arising from your use of MegaSafe.
          </Text>
          <Text style={styles.sectionText}>
            Our total liability for any claims shall not exceed the amount of fees paid by you in the six months preceding the claim.
          </Text>
        </View>

        {/* Termination */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Termination</Text>
          <Text style={styles.sectionText}>
            You may terminate your account at any time by contacting customer support or using the account closure feature in the app. MegaSafe may suspend or terminate accounts for violations of these Terms or suspicious activity.
          </Text>
          <Text style={styles.sectionText}>
            Upon termination, you must withdraw any remaining funds within 90 days. After this period, unclaimed funds may be escheated to the government.
          </Text>
        </View>

        {/* Dispute Resolution */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dispute Resolution</Text>
          <Text style={styles.sectionText}>
            Any disputes arising from these Terms or your use of MegaSafe shall be resolved through:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>1. Direct negotiation between parties</Text>
            <Text style={styles.listItem}>2. Mediation through a neutral third party</Text>
            <Text style={styles.listItem}>3. Binding arbitration in Freetown, Sierra Leone</Text>
          </View>
          <Text style={styles.sectionText}>
            These Terms shall be governed by the laws of Sierra Leone.
          </Text>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information</Text>
          <Text style={styles.sectionText}>
            For questions about these Terms of Service, please contact us:
          </Text>
          <View style={styles.listContainer}>
            <Text style={styles.listItem}>Email: legal@megasafe.sl</Text>
            <Text style={styles.listItem}>Phone: +232 76 123 456</Text>
            <Text style={styles.listItem}>Address: 42 Circular Road, Freetown, Sierra Leone</Text>
          </View>
        </View>

        {/* Changes to Terms */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Changes to Terms</Text>
          <Text style={styles.sectionText}>
            MegaSafe reserves the right to modify these Terms at any time. We will notify users of significant changes via email, in-app notifications, or website announcements. Continued use of the service constitutes acceptance of modified Terms.
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
