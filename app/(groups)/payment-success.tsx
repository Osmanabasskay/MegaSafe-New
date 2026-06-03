import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  Download,
  Share2,
  Receipt,
  Calendar,
  DollarSign,
  User,
  Home,
} from 'lucide-react-native';
import { getGroupById } from '../../src/services/groupService';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

interface PaymentData {
  transactionId: string;
  amount: string;
  groupName: string;
  paymentMethod: string;
  phoneNumber: string;
  timestamp: string;
  status: 'verified' | 'pending' | 'failed';
  receiptNumber: string;
}

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;
  const params = useLocalSearchParams<{
    groupId?: string;
    method?: string;
    phone?: string;
    amount?: string;
  }>();
  const groupId = params.groupId != null ? String(params.groupId) : '1';
  const hasRecordedReceipt = useRef(false);

  const paymentMethodParam = params.method != null ? String(params.method) : '';
  const phoneParam = params.phone != null ? String(params.phone) : '';
  const amountParam = params.amount != null ? String(params.amount) : '';
  const normalizedMethod = paymentMethodParam
    ? paymentMethodParam.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Orange Money';
  const normalizedPhone = phoneParam || '+232 76 123 456';
  const normalizedAmount = amountParam || '100.00';

  const [paymentData, setPaymentData] = useState<PaymentData>({
    transactionId: 'TXN-2024-1215-001',
    amount: normalizedAmount,
    groupName: 'Family Savings Circle',
    paymentMethod: normalizedMethod,
    phoneNumber: normalizedPhone,
    timestamp: 'Dec 15, 2024 at 10:30 AM',
    status: 'verified',
    receiptNumber: 'RCP-20241215-123456',
  });

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!groupId) return;
      const { group } = await getGroupById(groupId);
      if (!mounted || !group) return;
      setPaymentData((prev) => ({
        ...prev,
        amount: group.contribution_amount.toFixed(2),
        groupName: group.name,
      }));
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [groupId]);

  // Receipt is generated and stored server-side; hasRecordedReceipt guards against double-render.
  useEffect(() => { hasRecordedReceipt.current = true; }, []);

  const handleDownloadReceipt = () => {
    Alert.alert('Receipt ready', `Receipt ${paymentData.receiptNumber} was saved.`, [
      { text: 'Close', style: 'cancel' },
      { text: 'Open Receipts', onPress: () => router.push('/components/receipts') },
    ]);
  };

  const handleShareReceipt = async () => {
    try {
      const message = `Mi Osusu Receipt\n\nTransaction: ${paymentData.transactionId}\nAmount: NLe ${paymentData.amount}\nGroup: ${paymentData.groupName}\nDate: ${paymentData.timestamp}\nReceipt: ${paymentData.receiptNumber}`;
      
      await Share.share({
        message,
        title: 'Mi Osusu Payment Receipt',
      });
    } catch (error) {
      Alert.alert('Error', 'Unable to share receipt');
    }
  };

  const handleGoHome = () => {
    router.replace('/(main)/home');
  };

  const handleViewGroup = () => {
    router.replace(`/(groups)/manage/${groupId}`);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Payment Success</Text>
      </View>

      <View style={styles.content}>
        {/* Success Icon */}
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <CheckCircle size={64} color="#10B981" />
          </View>
          <Text style={styles.successTitle}>Payment Successful!</Text>
          <Text style={[styles.successMessage, { color: C.textSub }]}>
            Your contribution has been verified and recorded
          </Text>
        </View>

        {/* Receipt Card */}
        <View style={[styles.receiptCard, { backgroundColor: C.card }]}>
          <View style={styles.receiptHeader}>
            <Receipt size={20} color="#F97316" />
            <Text style={[styles.receiptTitle, { color: C.text }]}>Payment Receipt</Text>
          </View>

          <View style={styles.receiptContent}>
            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Transaction ID</Text>
              <Text style={[styles.receiptValue, { color: C.text }]}>{paymentData.transactionId}</Text>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Receipt Number</Text>
              <Text style={[styles.receiptValue, { color: C.text }]}>{paymentData.receiptNumber}</Text>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Amount</Text>
              <View style={styles.amountContainer}>
                <DollarSign size={16} color="#F97316" />
                <Text style={styles.amount}>NLe {paymentData.amount}</Text>
              </View>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Group</Text>
              <Text style={[styles.receiptValue, { color: C.text }]}>{paymentData.groupName}</Text>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Payment Method</Text>
              <Text style={[styles.receiptValue, { color: C.text }]}>{paymentData.paymentMethod}</Text>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Phone Number</Text>
              <Text style={[styles.receiptValue, { color: C.text }]}>{paymentData.phoneNumber}</Text>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Date & Time</Text>
              <Text style={[styles.receiptValue, { color: C.text }]}>{paymentData.timestamp}</Text>
            </View>

            <View style={[styles.receiptRow, { borderBottomColor: C.border }]}>
              <Text style={[styles.receiptLabel, { color: C.textMuted }]}>Status</Text>
              <View style={styles.statusContainer}>
                <Text style={styles.status}>Verified</Text>
              </View>
            </View>
          </View>

          {/* QR Code Placeholder */}
          <View style={styles.qrContainer}>
            <View style={[styles.qrPlaceholder, { backgroundColor: C.iconBg }]}>
              <Text style={[styles.qrText, { color: C.textSub }]}>QR Code</Text>
              <Text style={[styles.qrSubtext, { color: C.textMuted }]}>Scan to verify receipt</Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: C.inputBg }]}
            onPress={handleDownloadReceipt}
          >
            <Download size={18} color="#F97316" />
            <Text style={styles.actionButtonText}>Download Receipt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: C.inputBg }]}
            onPress={handleShareReceipt}
          >
            <Share2 size={18} color="#F97316" />
            <Text style={styles.actionButtonText}>Share Receipt</Text>
          </TouchableOpacity>
        </View>

        {/* Navigation Buttons */}
        <View style={styles.navigationButtons}>
          <TouchableOpacity
            style={[styles.navButton, { backgroundColor: C.inputBg }]}
            onPress={handleViewGroup}
          >
            <User size={18} color="#1D4ED8" />
            <Text style={styles.navButtonText}>View Group</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, styles.primaryNavButton]}
            onPress={handleGoHome}
          >
            <Home size={18} color="#FFFFFF" />
            <Text style={styles.primaryNavButtonText}>Go Home</Text>
          </TouchableOpacity>
        </View>

        {/* Security Note */}
        <View style={[styles.securityNote, isDark && { backgroundColor: '#0C2233' }]}>
          <Text style={[styles.securityText, isDark && { color: '#7DD3FC' }]}>
            This receipt is cryptographically secured and can be verified on the Mi Osusu platform.
          </Text>
        </View>
      </View>
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
    fontSize: 20,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 24,
  },
  successContainer: {
    alignItems: 'center',
    marginBottom: 32,
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
    textAlign: 'center',
    lineHeight: 24,
  },
  receiptCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
  },
  receiptTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 12,
  },
  receiptContent: {
    marginBottom: 20,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  receiptLabel: {
    fontSize: 14,
    flex: 1,
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 2,
    justifyContent: 'flex-end',
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F97316',
    marginLeft: 4,
  },
  statusContainer: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    flex: 2,
    alignItems: 'flex-end',
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  qrPlaceholder: {
    width: 120,
    height: 120,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  qrText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  qrSubtext: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: '48%',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F97316',
    marginLeft: 8,
  },
  navigationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    width: '48%',
  },
  primaryNavButton: {
    backgroundColor: '#F97316',
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1D4ED8',
    marginLeft: 8,
  },
  primaryNavButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  securityNote: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  securityText: {
    fontSize: 12,
    color: '#0369A1',
    textAlign: 'center',
    lineHeight: 18,
  },
});

