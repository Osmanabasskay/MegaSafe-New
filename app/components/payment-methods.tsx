import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Building2, Phone, Trash2 } from 'lucide-react-native';
import { normalizePhoneE164, isValidE164 } from '../../lib/auth/phone';
import { useAppDataStore } from '../../stores/appDataStore';

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const {
    linkedPhoneNumbers,
    linkedBankAccounts,
    linkPhoneNumber,
    unlinkPhoneNumber,
    linkBankAccount,
    unlinkBankAccount,
  } = useAppDataStore();

  const [phoneInput, setPhoneInput] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  const handleAddPhone = () => {
    const normalized = normalizePhoneE164(phoneInput);
    if (!isValidE164(normalized)) {
      Alert.alert('Invalid phone', 'Use full country code format, e.g. +23276123456');
      return;
    }

    const result = linkPhoneNumber(normalized);
    if (!result.ok) {
      Alert.alert('Phone not linked', result.message ?? 'Could not link phone number.');
      return;
    }

    setPhoneInput('');
    Alert.alert('Phone linked', 'Your phone number can now be used for transactions.');
  };

  const handleAddBank = () => {
    const result = linkBankAccount({ bankName, accountName, accountNumber });
    if (!result.ok) {
      Alert.alert('Bank not linked', result.message ?? 'Could not link bank account.');
      return;
    }

    setBankName('');
    setAccountName('');
    setAccountNumber('');
    Alert.alert('Bank linked', 'Your bank account is ready for withdrawals and transfers.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Methods</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Phone size={18} color="#F97316" />
            <Text style={styles.sectionTitle}>Linked Phone Numbers</Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="+23276123456"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            value={phoneInput}
            onChangeText={setPhoneInput}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleAddPhone}>
            <Text style={styles.primaryButtonText}>Link Phone Number</Text>
          </TouchableOpacity>

          {linkedPhoneNumbers.length > 0 ? (
            linkedPhoneNumbers.map((phone) => (
              <View key={phone} style={styles.itemRow}>
                <Text style={styles.itemText}>{phone}</Text>
                <TouchableOpacity onPress={() => unlinkPhoneNumber(phone)}>
                  <Trash2 size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No linked phone numbers yet.</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Building2 size={18} color="#F97316" />
            <Text style={styles.sectionTitle}>Linked Bank Accounts</Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Bank Name"
            placeholderTextColor="#9CA3AF"
            value={bankName}
            onChangeText={setBankName}
          />
          <TextInput
            style={styles.input}
            placeholder="Account Name"
            placeholderTextColor="#9CA3AF"
            value={accountName}
            onChangeText={setAccountName}
          />
          <TextInput
            style={styles.input}
            placeholder="Account Number"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            value={accountNumber}
            onChangeText={setAccountNumber}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleAddBank}>
            <Text style={styles.primaryButtonText}>Link Bank Account</Text>
          </TouchableOpacity>

          {linkedBankAccounts.length > 0 ? (
            linkedBankAccounts.map((bank) => (
              <View key={bank.id} style={styles.itemRow}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemText}>{bank.bankName}</Text>
                  <Text style={styles.itemSubText}>{bank.accountName} • {bank.accountNumberMasked}</Text>
                </View>
                <TouchableOpacity onPress={() => unlinkBankAccount(bank.id)}>
                  <Trash2 size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No linked bank accounts yet.</Text>
          )}
        </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  iconButton: {
    width: 32,
    alignItems: 'center',
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
    padding: 20,
    paddingBottom: 34,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    marginLeft: 8,
    color: '#1E2B5A',
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#1F2937',
    fontSize: 14,
    marginBottom: 8,
  },
  primaryButton: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  itemRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemBody: {
    flex: 1,
    marginRight: 8,
  },
  itemText: {
    color: '#1F2937',
    fontSize: 14,
    fontWeight: '600',
  },
  itemSubText: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
  },
});
