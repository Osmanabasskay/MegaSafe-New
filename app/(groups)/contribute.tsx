import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  DollarSign,
  Calendar,
  CreditCard,
  Smartphone,
  Building,
  CheckCircle,
  AlertCircle,
} from 'lucide-react-native';
import { getGroupById } from '../../lib/groupService';

interface PaymentMethod {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
}

export default function ContributeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = params.groupId != null ? String(params.groupId) : '';
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState('+232 76 123 456');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [groupData, setGroupData] = useState({
    name: 'Family Savings Circle',
    contributionAmount: '100.00',
    dueDate: 'Pending',
  });

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      if (!groupId) return;
      const { group } = await getGroupById(groupId);
      if (!mounted || !group) return;
      setGroupData({
        name: group.name,
        contributionAmount: group.contribution_amount.toFixed(2),
        dueDate: group.cycle_start_date,
      });
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [groupId]);

  const paymentMethods: PaymentMethod[] = [
    {
      id: 'orange_money',
      name: 'Orange Money',
      icon: <Smartphone size={24} color="#FF6900" />,
      color: '#FF6900',
    },
    {
      id: 'afrimoney',
      name: 'AfriMoney',
      icon: <Smartphone size={24} color="#00A652" />,
      color: '#00A652',
    },
    {
      id: 'qmoney',
      name: 'Q Money',
      icon: <Smartphone size={24} color="#7C3AED" />,
      color: '#7C3AED',
    },
    {
      id: 'bank_transfer',
      name: 'Bank Transfer',
      icon: <Building size={24} color="#1D4ED8" />,
      color: '#1D4ED8',
    },
    {
      id: 'card',
      name: 'Debit/Credit Card',
      icon: <CreditCard size={24} color="#6B7280" />,
      color: '#6B7280',
    },
  ];

  const handlePayment = async () => {
    if (!selectedMethod) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }

    if (!phoneNumber.trim()) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }

    setIsProcessing(true);

    try {
      // Simulate a payment processing handoff until edge function wiring is added.
      await new Promise(resolve => setTimeout(resolve, 2000));

      setIsProcessing(false);
      setShowSuccess(true);

      // Navigate to success screen after 2 seconds
      setTimeout(() => {
        router.push({
          pathname: '/(groups)/payment-success',
          params: {
            groupId: groupId || '1',
            method: selectedMethod,
            phone: phoneNumber,
            amount: groupData.contributionAmount,
          },
        });
      }, 2000);

    } catch (error) {
      setIsProcessing(false);
      Alert.alert('Payment Failed', 'Unable to process payment. Please try again.');
    }
  };

  if (showSuccess) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <CheckCircle size={64} color="#10B981" />
          </View>
          <Text style={styles.successTitle}>Payment Successful!</Text>
          <Text style={styles.successMessage}>
            Your contribution of NLe {groupData.contributionAmount} to {groupData.name} has been processed.
          </Text>
          <Text style={styles.successSubtext}>
            You will receive a receipt shortly via SMS and in-app notification.
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => router.replace(`/(groups)/manage/${groupId || '1'}`)}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Make Contribution</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Group Info */}
        <View style={styles.groupInfo}>
          <Text style={styles.groupName}>{groupData.name}</Text>
          <View style={styles.contributionInfo}>
            <View style={styles.infoItem}>
              <DollarSign size={16} color="#F97316" />
              <Text style={styles.infoLabel}>Amount</Text>
              <Text style={styles.infoValue}>NLe {groupData.contributionAmount}</Text>
            </View>
            <View style={styles.infoItem}>
              <Calendar size={16} color="#1D4ED8" />
              <Text style={styles.infoLabel}>Due Date</Text>
              <Text style={styles.infoValue}>{groupData.dueDate}</Text>
            </View>
          </View>
        </View>

        {/* Payment Methods */}
        <View style={styles.paymentSection}>
          <Text style={styles.sectionTitle}>Select Payment Method</Text>
          <View style={styles.methodsGrid}>
            {paymentMethods.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodCard,
                  selectedMethod === method.id && styles.selectedMethodCard,
                  { borderColor: method.color }
                ]}
                onPress={() => setSelectedMethod(method.id)}
              >
                <View style={styles.methodIcon}>
                  {method.icon}
                </View>
                <Text style={styles.methodName}>{method.name}</Text>
                {selectedMethod === method.id && (
                  <View style={styles.selectedIndicator}>
                    <CheckCircle size={16} color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Phone Number */}
        <View style={styles.phoneSection}>
          <Text style={styles.sectionTitle}>Phone Number</Text>
          <Text style={styles.sectionSubtitle}>
            Enter the phone number associated with your {selectedMethod ? paymentMethods.find(m => m.id === selectedMethod)?.name : 'payment method'}
          </Text>
          <View style={styles.phoneInputContainer}>
            <Text style={styles.phoneInput}>{phoneNumber}</Text>
          </View>
        </View>

        {/* Security Notice */}
        <View style={styles.securityNotice}>
          <AlertCircle size={20} color="#F59E0B" />
          <View style={styles.noticeContent}>
            <Text style={styles.noticeTitle}>Security Notice</Text>
            <Text style={styles.noticeText}>
              Payment amount is set by group configuration and cannot be modified. All transactions are encrypted and secure.
            </Text>
          </View>
        </View>

        {/* Pay Button */}
        <TouchableOpacity
          style={[
            styles.payButton,
            (!selectedMethod || isProcessing) && styles.payButtonDisabled
          ]}
          onPress={handlePayment}
          disabled={!selectedMethod || isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.payButtonText}>
              Pay NLe {groupData.contributionAmount}
            </Text>
          )}
        </TouchableOpacity>

        {/* Terms */}
        <Text style={styles.termsText}>
          By proceeding, you agree to MegaSafe's terms of service and privacy policy.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
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
    padding: 24,
  },
  groupInfo: {
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
  groupName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
    textAlign: 'center',
  },
  contributionInfo: {
    gap: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 12,
    flex: 1,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E2B5A',
    marginLeft: 12,
  },
  paymentSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 20,
  },
  methodsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  methodCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    position: 'relative',
  },
  selectedMethodCard: {
    backgroundColor: '#F9FAFB',
  },
  methodIcon: {
    marginBottom: 8,
  },
  methodName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    textAlign: 'center',
  },
  selectedIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 2,
  },
  phoneSection: {
    marginBottom: 24,
  },
  phoneInputContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
  },
  phoneInput: {
    fontSize: 16,
    color: '#1F2937',
  },
  securityNotice: {
    flexDirection: 'row',
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  noticeContent: {
    flex: 1,
    marginLeft: 12,
  },
  noticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 4,
  },
  noticeText: {
    fontSize: 14,
    color: '#78350F',
    lineHeight: 20,
  },
  payButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  payButtonDisabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  payButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  termsText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  successIcon: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 12,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  successSubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  doneButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

