import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  Camera,
  DollarSign,
  Calendar,
  User,
  CheckCircle,
  Smartphone,
  Wallet,
  FileText,
} from 'lucide-react-native';

interface MemberAssignment {
  id: string;
  name: string;
  address: string;
  phone: string;
  amountDue: string;
  lastPaidDate: string;
  status: 'pending' | 'collected' | 'verified';
}

export default function CollectorScreen() {
  const router = useRouter();
  const [selectedMember, setSelectedMember] = useState<MemberAssignment | null>(null);
  const [collectionMethod, setCollectionMethod] = useState<'cash' | 'mobile_money'>('cash');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptPhoto, setReceiptPhoto] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const todayAssignments: MemberAssignment[] = [
    {
      id: '1',
      name: 'John Doe',
      address: '123 Main Street, Freetown',
      phone: '+232 76 123 456',
      amountDue: '100.00',
      lastPaidDate: 'Dec 8, 2024',
      status: 'pending',
    },
    {
      id: '2',
      name: 'Jane Smith',
      address: '456 Market Street, Freetown',
      phone: '+232 30 987 654',
      amountDue: '100.00',
      lastPaidDate: 'Dec 1, 2024',
      status: 'pending',
    },
    {
      id: '3',
      name: 'Mike Johnson',
      address: '789 Beach Road, Freetown',
      phone: '+232 88 456 123',
      amountDue: '100.00',
      lastPaidDate: 'Nov 24, 2024',
      status: 'collected',
    },
  ];

  const handleSelectMember = (member: MemberAssignment) => {
    setSelectedMember(member);
    setAmount(member.amountDue);
  };

  const handleTakePhoto = () => {
    // TODO: Implement camera functionality
    Alert.alert('Camera', 'Camera feature will be implemented');
  };

  const handleSubmitCollection = async () => {
    if (!selectedMember) {
      Alert.alert('Error', 'Please select a member');
      return;
    }

    if (!amount.trim()) {
      Alert.alert('Error', 'Please enter the amount collected');
      return;
    }

    if (collectionMethod === 'cash' && !receiptPhoto) {
      Alert.alert('Error', 'Please take a photo of the receipt');
      return;
    }

    setIsProcessing(true);

    try {
      // TODO: Submit collection to API
      // await submitCollection({
      //   memberId: selectedMember.id,
      //   amount,
      //   method: collectionMethod,
      //   notes,
      //   receiptPhoto,
      //   location: currentLocation,
      // });

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));

      setIsProcessing(false);
      Alert.alert(
        'Success',
        `Collection of NLe ${amount} from ${selectedMember.name} has been recorded.`,
        [
          { text: 'OK', onPress: () => router.back() }
        ]
      );

    } catch (error) {
      setIsProcessing(false);
      Alert.alert('Error', 'Failed to submit collection. Please try again.');
    }
  };

  if (selectedMember) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedMember(null)} style={styles.backButton}>
            <ArrowLeft size={24} color="#F97316" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Record Collection</Text>
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Member Info */}
          <View style={styles.memberInfo}>
            <View style={styles.memberHeader}>
              <View style={styles.memberAvatar}>
                <Text style={styles.avatarText}>
                  {selectedMember.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </Text>
              </View>
              <View style={styles.memberDetails}>
                <Text style={styles.memberName}>{selectedMember.name}</Text>
                <Text style={styles.memberPhone}>{selectedMember.phone}</Text>
                <Text style={styles.memberAddress}>{selectedMember.address}</Text>
              </View>
            </View>

            <View style={styles.amountInfo}>
              <Text style={styles.amountLabel}>Amount Due</Text>
              <Text style={styles.amountValue}>NLe {selectedMember.amountDue}</Text>
            </View>

            <View style={styles.lastPaidInfo}>
              <Text style={styles.lastPaidLabel}>Last Paid</Text>
              <Text style={styles.lastPaidDate}>{selectedMember.lastPaidDate}</Text>
            </View>
          </View>

          {/* Collection Method */}
          <View style={styles.methodSection}>
            <Text style={styles.sectionTitle}>Collection Method</Text>
            <View style={styles.methodOptions}>
              <TouchableOpacity
                style={[
                  styles.methodOption,
                  collectionMethod === 'cash' && styles.selectedMethod
                ]}
                onPress={() => setCollectionMethod('cash')}
              >
                <Wallet size={20} color={collectionMethod === 'cash' ? '#F97316' : '#6B7280'} />
                <Text style={[
                  styles.methodText,
                  collectionMethod === 'cash' && styles.selectedMethodText
                ]}>
                  Cash Collection
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.methodOption,
                  collectionMethod === 'mobile_money' && styles.selectedMethod
                ]}
                onPress={() => setCollectionMethod('mobile_money')}
              >
                <Smartphone size={20} color={collectionMethod === 'mobile_money' ? '#F97316' : '#6B7280'} />
                <Text style={[
                  styles.methodText,
                  collectionMethod === 'mobile_money' && styles.selectedMethodText
                ]}>
                  Mobile Money
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Amount Input */}
          <View style={styles.amountSection}>
            <Text style={styles.sectionTitle}>Amount Collected</Text>
            <View style={styles.amountInputContainer}>
              <DollarSign size={20} color="#F97316" />
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Receipt Photo */}
          {collectionMethod === 'cash' && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionTitle}>Receipt Photo</Text>
              <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto}>
                {receiptPhoto ? (
                  <Image source={{ uri: receiptPhoto }} style={styles.photoPreview} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Camera size={32} color="#6B7280" />
                    <Text style={styles.photoText}>Take Photo of Receipt</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Notes */}
          <View style={styles.notesSection}>
            <Text style={styles.sectionTitle}>Notes (Optional)</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add any notes about this collection..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Location Info */}
          <View style={styles.locationSection}>
            <View style={styles.locationInfo}>
              <MapPin size={16} color="#F97316" />
              <Text style={styles.locationText}>
                Location: Freetown, Sierra Leone (Auto-detected)
              </Text>
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              isProcessing && styles.submitButtonDisabled
            ]}
            onPress={handleSubmitCollection}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Text style={styles.submitButtonText}>Processing...</Text>
            ) : (
              <Text style={styles.submitButtonText}>Submit Collection</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
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
        <Text style={styles.headerTitle}>Today's Collections</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Text style={styles.dateTitle}>December 15, 2024</Text>
          <Text style={styles.subtitle}>
            {todayAssignments.filter(m => m.status === 'pending').length} pending collections
          </Text>

          {todayAssignments.map((member) => (
            <TouchableOpacity
              key={member.id}
              style={[
                styles.memberCard,
                member.status === 'collected' && styles.collectedCard
              ]}
              onPress={() => member.status === 'pending' && handleSelectMember(member)}
              disabled={member.status === 'collected'}
            >
              <View style={styles.cardContent}>
                <View style={styles.memberInfo}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.avatarText}>
                      {member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </Text>
                  </View>
                  <View style={styles.memberDetails}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberPhone}>{member.phone}</Text>
                    <Text style={styles.memberAddress}>{member.address}</Text>
                  </View>
                </View>

                <View style={styles.cardRight}>
                  <View style={styles.amountBadge}>
                    <Text style={styles.amountText}>NLe {member.amountDue}</Text>
                  </View>

                  {member.status === 'collected' ? (
                    <View style={styles.collectedBadge}>
                      <CheckCircle size={16} color="#FFFFFF" />
                      <Text style={styles.collectedText}>Collected</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.collectButton}
                      onPress={() => handleSelectMember(member)}
                    >
                      <Text style={styles.collectButtonText}>Collect</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {member.status === 'collected' && (
                <View style={styles.collectedInfo}>
                  <Text style={styles.collectedTime}>Collected at 2:30 PM</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}

          {todayAssignments.length === 0 && (
            <View style={styles.emptyState}>
              <FileText size={48} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No Collections Today</Text>
              <Text style={styles.emptyMessage}>
                You don't have any collections scheduled for today.
              </Text>
            </View>
          )}
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
  content: {
    padding: 24,
  },
  dateTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 24,
  },
  memberCard: {
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
  collectedCard: {
    opacity: 0.7,
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  cardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  memberInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  memberDetails: {
    flex: 1,
  },
  memberName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  memberPhone: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 2,
  },
  memberAddress: {
    fontSize: 14,
    color: '#6B7280',
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardRight: {
    alignItems: 'flex-end',
  },
  amountBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 8,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E2B5A',
  },
  collectButton: {
    backgroundColor: '#F97316',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  collectButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  collectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  collectedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 4,
  },
  collectedInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  collectedTime: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  // Collection detail styles
  memberHeader: {
    marginBottom: 24,
  },
  amountInfo: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F97316',
  },
  lastPaidInfo: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  lastPaidLabel: {
    fontSize: 14,
    color: '#0369A1',
    marginBottom: 4,
  },
  lastPaidDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0369A1',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E2B5A',
    marginBottom: 16,
  },
  methodSection: {
    marginBottom: 24,
  },
  methodOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  methodOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedMethod: {
    backgroundColor: '#FED7AA',
    borderColor: '#F97316',
  },
  methodText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
    marginLeft: 8,
  },
  selectedMethodText: {
    color: '#F97316',
  },
  amountSection: {
    marginBottom: 24,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginLeft: 12,
  },
  photoSection: {
    marginBottom: 24,
  },
  photoButton: {
    alignItems: 'center',
  },
  photoPreview: {
    width: 200,
    height: 150,
    borderRadius: 12,
  },
  photoPlaceholder: {
    width: 200,
    height: 150,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  photoText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },
  notesSection: {
    marginBottom: 24,
  },
  notesInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#1F2937',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    textAlignVertical: 'top',
  },
  locationSection: {
    marginBottom: 24,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 16,
  },
  locationText: {
    fontSize: 14,
    color: '#0369A1',
    marginLeft: 8,
    flex: 1,
  },
  submitButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
