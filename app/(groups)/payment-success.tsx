import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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

export default function PaymentSuccessScreen() {
  const router = useRouter();

  const paymentData = {
    transactionId: 'TXN-2024-1215-001',
    amount: '100.00',
    groupName: 'Family Savings Circle',
    paymentMethod: 'Orange Money',
    phoneNumber: '+232 76 123 456',
    timestamp: 'Dec 15, 2024 at 10:30 AM',
    status: 'verified',
    receiptNumber: 'RCP-20241215-123456',
  };

  const handleDownloadReceipt = () => {
    // TODO: Download PDF receipt
    Alert.alert('Download', 'Receipt will be downloaded to your device.');
  };

  const handleShareReceipt = async () => {
    try {
      const message = `MegaSafe Receipt\n\nTransaction: ${paymentData.transactionId}\nAmount: NLe ${paymentData.amount}\nGroup: ${paymentData.groupName}\nDate: ${paymentData.timestamp}\nReceipt: ${paymentData.receiptNumber}`;
      
      await Share.share({
        message,
        title: 'MegaSafe Payment Receipt',
      });
    } catch (error) {
      Alert.alert('Error', 'Unable to share receipt');
    }
  };

  const handleGoHome = () => {
    router.replace('/(main)/home');
  };

  const handleViewGroup = () => {
    router.replace('/(groups)/manage/1');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Success</Text>
      </View>

      <View style={styles.content}>
        {/* Success Icon */}
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <CheckCircle size={64} color="#10B981" />
          </View>
          <Text style={styles.successTitle}>Payment Successful!</Text>
          <Text style={styles.successMessage}>
            Your contribution has been verified and recorded
          </Text>
        </View>

        {/* Receipt Card */}
        <View style={styles.receiptCard}>
          <View style={styles.receiptHeader}>
            <Receipt size={20} color="#F97316" />
            <Text style={styles.receiptTitle}>Payment Receipt</Text>
          </View>

          <View style={styles.receiptContent}>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Transaction ID</Text>
              <Text style={styles.receiptValue}>{paymentData.transactionId}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Receipt Number</Text>
              <Text style={styles.receiptValue}>{paymentData.receiptNumber}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Amount</Text>
              <View style={styles.amountContainer}>
                <DollarSign size={16} color="#F97316" />
                <Text style={styles.amount}>NLe {paymentData.amount}</Text>
              </View>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Group</Text>
              <Text style={styles.receiptValue}>{paymentData.groupName}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Payment Method</Text>
              <Text style={styles.receiptValue}>{paymentData.paymentMethod}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Phone Number</Text>
              <Text style={styles.receiptValue}>{paymentData.phoneNumber}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Date & Time</Text>
              <Text style={styles.receiptValue}>{paymentData.timestamp}</Text>
            </View>

            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Status</Text>
              <View style={styles.statusContainer}>
                <Text style={styles.status}>Verified</Text>
              </View>
            </View>
          </View>

          {/* QR Code Placeholder */}
          <View style={styles.qrContainer}>
            <View style={styles.qrPlaceholder}>
              <Text style={styles.qrText}>QR Code</Text>
              <Text style={styles.qrSubtext}>Scan to verify receipt</Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleDownloadReceipt}
          >
            <Download size={18} color="#F97316" />
            <Text style={styles.actionButtonText}>Download Receipt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleShareReceipt}
          >
            <Share2 size={18} color="#F97316" />
            <Text style={styles.actionButtonText}>Share Receipt</Text>
          </TouchableOpacity>
        </View>

        {/* Navigation Buttons */}
        <View style={styles.navigationButtons}>
          <TouchableOpacity
            style={styles.navButton}
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
        <View style={styles.securityNote}>
          <Text style={styles.securityText}>
            This receipt is cryptographically secured and can be verified on the MegaSafe platform.
          </Text>
        </View>
      </View>
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
    color: '#374151',
    textAlign: 'center',
    lineHeight: 24,
  },
  receiptCard: {
    backgroundColor: '#FFFFFF',
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
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  receiptTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
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
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
  },
  receiptLabel: {
    fontSize: 14,
    color: '#6B7280',
    flex: 1,
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1F2937',
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
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  qrPlaceholder: {
    width: 120,
    height: 120,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
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
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    width: '48%',
  },
  primaryNavButton: {
    backgroundColor: '#F97316',
    borderWidth: 0,
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
