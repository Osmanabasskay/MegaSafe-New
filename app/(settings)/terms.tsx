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
  User,
  Shield,
  CreditCard,
  AlertTriangle,
} from 'lucide-react-native';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function TermsOfServiceScreen() {
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
        <Text style={[styles.headerTitle, { color: C.text }]}>Terms of Service</Text>
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
          <Text style={[styles.sectionTitle, { color: C.text }]}>Introduction</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Welcome to Mi Osusu. These Terms of Service ("Terms") govern your use of Mi Osusu's financial services platform and mobile application. By accessing or using Mi Osusu, you agree to be bound by these Terms.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu is a digital financial platform designed to facilitate secure money transfers, group collections, and payment services within Sierra Leone.
          </Text>
        </View>

        {/* Acceptance of Terms */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <User size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Acceptance of Terms</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            By creating an account and using Mi Osusu, you represent that you are at least 18 years old and have the legal capacity to enter into these Terms. You also confirm that all information you provide is accurate and complete.
          </Text>
        </View>

        {/* Services */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <CreditCard size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Services Provided</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu provides the following services:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Digital wallet and money storage</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Peer-to-peer money transfers</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Group collection management</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Bill payment services</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Mobile money integration</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Transaction history and reporting</Text>
          </View>
        </View>

        {/* User Responsibilities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Shield size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>User Responsibilities</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            As a Mi Osusu user, you agree to:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Maintain accurate account information</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Keep your login credentials secure</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Use the service for legitimate transactions only</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Comply with all applicable laws and regulations</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Not engage in fraudulent activities</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Report suspicious activity immediately</Text>
          </View>
        </View>

        {/* Prohibited Activities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AlertTriangle size={20} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Prohibited Activities</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You may not use Mi Osusu for:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Illegal activities or transactions</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Money laundering or terrorist financing</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Fraudulent or deceptive practices</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Unauthorized access to others' accounts</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Violation of intellectual property rights</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Interference with service operations</Text>
          </View>
        </View>

        {/* Fees and Charges */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Fees and Charges</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu charges transparent fees for various services:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Transfer fees: 1% of transaction amount</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Group collection fees: 2% of collected amount</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Bill payment fees: Variable by service provider</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>- Withdrawal fees: NLe 5.00 per withdrawal</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            All fees are clearly displayed before transaction confirmation. Mi Osusu reserves the right to modify fees with 30 days' notice.
          </Text>
        </View>

        {/* Privacy and Data Protection */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Privacy and Data Protection</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Your privacy is important to us. Mi Osusu collects and processes personal data in accordance with our Privacy Policy and applicable data protection laws. We implement industry-standard security measures to protect your information.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            By using Mi Osusu, you consent to the collection, use, and sharing of your information as described in our Privacy Policy.
          </Text>
        </View>

        {/* Account Security */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Account Security</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You are responsible for maintaining the security of your account. Mi Osusu will never ask for your password or PIN through unsolicited communications. If you suspect unauthorized access, contact us immediately.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            We recommend enabling two-factor authentication and using strong, unique passwords.
          </Text>
        </View>

        {/* Limitation of Liability */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Limitation of Liability</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu provides services "as is" and makes no warranties regarding the accuracy, reliability, or availability of our services. We shall not be liable for any indirect, incidental, or consequential damages arising from your use of Mi Osusu.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Our total liability for any claims shall not exceed the amount of fees paid by you in the six months preceding the claim.
          </Text>
        </View>

        {/* Termination */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Account Termination</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            You may terminate your account at any time by contacting customer support or using the account closure feature in the app. Mi Osusu may suspend or terminate accounts for violations of these Terms or suspicious activity.
          </Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Upon termination, you must withdraw any remaining funds within 90 days. After this period, unclaimed funds may be escheated to the government.
          </Text>
        </View>

        {/* Dispute Resolution */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Dispute Resolution</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Any disputes arising from these Terms or your use of Mi Osusu shall be resolved through:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>1. Direct negotiation between parties</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>2. Mediation through a neutral third party</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>3. Binding arbitration in Freetown, Sierra Leone</Text>
          </View>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            These Terms shall be governed by the laws of Sierra Leone.
          </Text>
        </View>

        {/* Contact Information */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Contact Information</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            For questions about these Terms of Service, please contact us:
          </Text>
          <View style={styles.listContainer}>
            <Text style={[styles.listItem, { color: C.textSub }]}>Email: legal@miosusu.sl</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>Phone: +232 88 938 326</Text>
            <Text style={[styles.listItem, { color: C.textSub }]}>Address: 25 York Road, Waterloo, Sierra Leone</Text>
          </View>
        </View>

        {/* Changes to Terms */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Changes to Terms</Text>
          <Text style={[styles.sectionText, { color: C.textSub }]}>
            Mi Osusu reserves the right to modify these Terms at any time. We will notify users of significant changes via email, in-app notifications, or website announcements. Continued use of the service constitutes acceptance of modified Terms.
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
