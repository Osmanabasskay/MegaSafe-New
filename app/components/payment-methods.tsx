import React, { useState } from 'react';
import {
  Alert,
  Image,
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
import { normalizePhoneE164, isValidE164 } from '../../src/services/auth/phone';
import { useAppDataStore, type MobileMoneyNetwork } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { MOBILE_MONEY_METHODS } from '../../src/services/paymentMethodLinks';

const MOBILE_METHOD_LOGOS: Record<MobileMoneyNetwork, { source: number; title: string }> = {
  orange_money: { source: require('../../Orange Money logo.png'), title: 'Orange Money Logo' },
  afrimoney: { source: require('../../AfriMoney Logo.png'), title: 'Afrimoney Logo' },
  qmoney: { source: require('../../Qmoney logo.png'), title: 'QMoney Logo' },
};

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const {
    linkedMobileMoneyAccounts,
    linkedBankAccounts,
    linkPhoneNumber,
    unlinkPhoneNumber,
    linkBankAccount,
    unlinkBankAccount,
    preferences,
  } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [selectedNetwork, setSelectedNetwork] = useState<MobileMoneyNetwork>('orange_money');
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

    const result = linkPhoneNumber(normalized, selectedNetwork);
    if (!result.ok) {
      Alert.alert('Phone not linked', result.message ?? 'Could not link phone number.');
      return;
    }

    setPhoneInput('');
    const networkLabel = MOBILE_MONEY_METHODS.find((method) => method.id === selectedNetwork)?.label;
    Alert.alert('Mobile money linked', `${networkLabel ?? 'Mobile money'} is ready for transactions.`);
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
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={[styles.header, { backgroundColor: C.bg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
          <ArrowLeft size={22} color="#F97316" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Payment Methods</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.sectionHeader}>
            <Phone size={18} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Linked Mobile Money</Text>
          </View>

          <View style={styles.networkRow}>
            {MOBILE_MONEY_METHODS.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.networkChip,
                  selectedNetwork === method.id && styles.networkChipActive,
                  selectedNetwork === method.id && {
                    borderColor: method.color,
                    backgroundColor: `${method.color}18`,
                  },
                ]}
                onPress={() => setSelectedNetwork(method.id)}
              >
                <Image
                  source={MOBILE_METHOD_LOGOS[method.id].source}
                  style={styles.networkLogo}
                  resizeMode="contain"
                  accessibilityLabel={MOBILE_METHOD_LOGOS[method.id].title}
                />
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            placeholder="Mobile money number, e.g. +23276123456"
            placeholderTextColor={C.textMuted}
            keyboardType="phone-pad"
            value={phoneInput}
            onChangeText={setPhoneInput}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleAddPhone}>
            <Text style={styles.primaryButtonText}>Link Mobile Money Number</Text>
          </TouchableOpacity>

          {linkedMobileMoneyAccounts.length > 0 ? (
            linkedMobileMoneyAccounts.map((account) => {
              const method = MOBILE_MONEY_METHODS.find((item) => item.id === account.network);
              return (
                <View key={account.id} style={[styles.itemRow, { backgroundColor: C.bg }]}>
                  <View style={styles.itemLogoWrap}>
                    <Image
                      source={MOBILE_METHOD_LOGOS[account.network].source}
                      style={styles.itemLogo}
                      resizeMode="contain"
                      accessibilityLabel={MOBILE_METHOD_LOGOS[account.network].title}
                    />
                  </View>
                  <View style={styles.itemBody}>
                    <Text style={[styles.itemText, { color: C.text }]}>{method?.label ?? account.network}</Text>
                    <Text style={[styles.itemSubText, { color: C.textSub }]}>{account.phone}</Text>
                  </View>
                  <TouchableOpacity onPress={() => unlinkPhoneNumber(account.phone, account.network)}>
                    <Trash2 size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              );
            })
          ) : (
            <Text style={[styles.emptyText, { color: C.textSub }]}>No mobile money numbers linked yet.</Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.sectionHeader}>
            <Building2 size={18} color="#F97316" />
            <Text style={[styles.sectionTitle, { color: C.text }]}>Linked Bank Accounts</Text>
          </View>

          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            placeholder="Bank Name"
            placeholderTextColor={C.textMuted}
            value={bankName}
            onChangeText={setBankName}
          />
          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            placeholder="Account Name"
            placeholderTextColor={C.textMuted}
            value={accountName}
            onChangeText={setAccountName}
          />
          <TextInput
            style={[styles.input, { backgroundColor: C.inputBg, color: C.text }]}
            placeholder="Account Number"
            placeholderTextColor={C.textMuted}
            keyboardType="number-pad"
            value={accountNumber}
            onChangeText={setAccountNumber}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={handleAddBank}>
            <Text style={styles.primaryButtonText}>Link Bank Account</Text>
          </TouchableOpacity>

          {linkedBankAccounts.length > 0 ? (
            linkedBankAccounts.map((bank) => (
              <View key={bank.id} style={[styles.itemRow, { backgroundColor: C.bg }]}>
                <View style={styles.itemBody}>
                  <Text style={[styles.itemText, { color: C.text }]}>{bank.bankName}</Text>
                  <Text style={[styles.itemSubText, { color: C.textSub }]}>{bank.accountName} • {bank.accountNumberMasked}</Text>
                </View>
                <TouchableOpacity onPress={() => unlinkBankAccount(bank.id)}>
                  <Trash2 size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={[styles.emptyText, { color: C.textSub }]}>No linked bank accounts yet.</Text>
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
  networkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  networkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 118,
    minHeight: 58,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  networkChipActive: {
    borderWidth: 1.5,
  },
  networkLogo: {
    width: 102,
    height: 40,
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
  itemLogoWrap: {
    width: 68,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  itemLogo: {
    width: 64,
    height: 28,
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
