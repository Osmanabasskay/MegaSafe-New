import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Building2, CheckCircle2, Phone, ShieldAlert, Trash2 } from 'lucide-react-native';
import { useAppDataStore, type MobileMoneyNetwork } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';
import { MOBILE_MONEY_METHODS } from '../../src/services/paymentMethodLinks';
import {
  SIERRA_LEONE_DIAL_CODE,
  SIERRA_LEONE_FLAG,
  SIERRA_LEONE_LOCAL_NUMBER_LENGTH,
  validateMobileMoneyProviderPhone,
} from '../../src/services/mobileMoneyConfig';
import {
  getMyPaymentMethods,
  linkPaymentMethod,
  unlinkPaymentMethod,
  verifyPaymentMethod,
  type LinkedPaymentMethod,
} from '../../src/services/paymentMethodService';
import { EnterTransactionPinModal } from '../../src/components/security/EnterTransactionPinModal';

const MOBILE_METHOD_LOGOS: Record<MobileMoneyNetwork, { source: number; title: string }> = {
  orange_money: { source: require('../../assets/payment-providers/orange-money.png'), title: 'Orange Money Logo' },
  afrimoney: { source: require('../../assets/payment-providers/afrimoney.png'), title: 'Afrimoney Logo' },
};

function getMethodLabel(provider: MobileMoneyNetwork) {
  return MOBILE_MONEY_METHODS.find((method) => method.id === provider)?.label ?? provider;
}

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const {
    linkedBankAccounts,
    linkBankAccount,
    unlinkBankAccount,
    preferences,
  } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

  const [selectedNetwork, setSelectedNetwork] = useState<MobileMoneyNetwork>('orange_money');
  const [phoneInput, setPhoneInput] = useState('');
  const [mobileMoneyMethods, setMobileMoneyMethods] = useState<LinkedPaymentMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [linkingPhone, setLinkingPhone] = useState(false);
  const [unlinkingMethodId, setUnlinkingMethodId] = useState<string | null>(null);
  const [pendingVerificationId, setPendingVerificationId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyingMethod, setVerifyingMethod] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pendingPhoneNumber, setPendingPhoneNumber] = useState<string | null>(null);

  const pendingVerificationMethod = useMemo(
    () => mobileMoneyMethods.find((method) => method.id === pendingVerificationId) ?? null,
    [mobileMoneyMethods, pendingVerificationId],
  );

  const loadMobileMoneyMethods = useCallback(async () => {
    setLoadingMethods(true);
    const result = await getMyPaymentMethods();
    setMobileMoneyMethods(result.methods);
    setPendingVerificationId((current) => (
      current && result.methods.some((method) => method.id === current && !method.is_verified)
        ? current
        : result.methods.find((method) => !method.is_verified)?.id ?? null
    ));
    setLoadingMethods(false);
    if (result.error) {
      Alert.alert('Payment methods unavailable', result.error.message);
    }
  }, []);

  useEffect(() => {
    void loadMobileMoneyMethods();
  }, [loadMobileMoneyMethods]);

  useFocusEffect(
    useCallback(() => {
      void loadMobileMoneyMethods();
    }, [loadMobileMoneyMethods])
  );

  const handleAddPhone = async () => {
    const localDigits = phoneInput.replace(/\D/g, '').slice(0, SIERRA_LEONE_LOCAL_NUMBER_LENGTH);
    const fullPhoneNumber = `${SIERRA_LEONE_DIAL_CODE}${localDigits}`;
    const validation = validateMobileMoneyProviderPhone(selectedNetwork, fullPhoneNumber);
    if (!validation.ok) {
      Alert.alert('Invalid phone', validation.message ?? 'Enter a valid Sierra Leone mobile money number.');
      return;
    }

    setPendingPhoneNumber(validation.normalizedPhone);
    setPinError(null);
    setPinModalVisible(true);
  };

  const submitAddPhone = async (transactionPin: string) => {
    if (!pendingPhoneNumber) return;
    setLinkingPhone(true);
    const result = await linkPaymentMethod(selectedNetwork, pendingPhoneNumber, transactionPin);
    setLinkingPhone(false);

    if (!result.success || result.error || !result.methodId) {
      setPinError(result.error?.message ?? 'Could not link phone number.');
      return;
    }

    setPinModalVisible(false);
    setPendingPhoneNumber(null);
    setPhoneInput('');
    setPendingVerificationId(result.methodId);
    await loadMobileMoneyMethods();
    Alert.alert(
      'Mobile money linked',
      `${getMethodLabel(selectedNetwork)} ${result.maskedNumber ?? ''} is ready for vault top-ups.`,
      [{ text: 'Continue', onPress: () => router.back() }]
    );
  };

  const handleVerifyPhone = async () => {
    if (!pendingVerificationMethod) return;
    if (!verificationCode.trim()) {
      Alert.alert('Code required', 'Enter the verification code sent for this mobile money number.');
      return;
    }

    setVerifyingMethod(true);
    const result = await verifyPaymentMethod(pendingVerificationMethod.id, verificationCode);
    setVerifyingMethod(false);

    if (!result.success || result.error) {
      Alert.alert('Verification failed', result.error?.message ?? 'Could not verify this mobile money number.');
      return;
    }

    setVerificationCode('');
    setPendingVerificationId(null);
    await loadMobileMoneyMethods();
    Alert.alert('Mobile money verified', 'This mobile money number is ready for vault top-ups.');
  };

  const handleUnlinkPhone = (method: LinkedPaymentMethod) => {
    Alert.alert('Unlink mobile money', `Remove ${method.masked_number} from linked payment methods?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setUnlinkingMethodId(method.id);
            const result = await unlinkPaymentMethod(method.id);
            setUnlinkingMethodId(null);
            if (!result.success || result.error) {
              Alert.alert('Could not unlink', result.error?.message ?? 'Please try again.');
              return;
            }
            await loadMobileMoneyMethods();
          })();
        },
      },
    ]);
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

          <View style={[styles.phoneField, { backgroundColor: C.inputBg }]}>
            <View style={styles.phonePrefix}>
              <Text style={styles.phoneFlag}>{SIERRA_LEONE_FLAG}</Text>
              <Text style={[styles.phonePrefixText, { color: C.text }]}>{SIERRA_LEONE_DIAL_CODE}</Text>
            </View>
            <TextInput
              style={[styles.phoneInput, { color: C.text }]}
              placeholder="76123456"
              placeholderTextColor={C.textMuted}
              keyboardType="number-pad"
              value={phoneInput}
              onChangeText={(value) => setPhoneInput(value.replace(/\D/g, '').slice(0, SIERRA_LEONE_LOCAL_NUMBER_LENGTH))}
              maxLength={SIERRA_LEONE_LOCAL_NUMBER_LENGTH}
              editable={!linkingPhone}
            />
          </View>
          <TouchableOpacity style={[styles.primaryButton, linkingPhone && styles.buttonDisabled]} onPress={() => void handleAddPhone()} disabled={linkingPhone}>
            {linkingPhone ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Link Mobile Money Number</Text>}
          </TouchableOpacity>

          {pendingVerificationMethod ? (
            <View style={[styles.verifyBox, { backgroundColor: C.bg }]}>
              <View style={styles.verifyHeader}>
                <ShieldAlert size={17} color="#B45309" />
                <Text style={styles.verifyTitle}>Verification required</Text>
              </View>
              <Text style={[styles.verifyCopy, { color: C.textSub }]}>
                {getMethodLabel(pendingVerificationMethod.provider)} {pendingVerificationMethod.masked_number} is linked but not active yet.
              </Text>
              <TextInput
                style={[styles.input, styles.verifyInput, { backgroundColor: C.inputBg, color: C.text }]}
                placeholder="Verification code"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                value={verificationCode}
                onChangeText={(value) => setVerificationCode(value.replace(/\D/g, ''))}
                editable={!verifyingMethod}
              />
              <TouchableOpacity style={[styles.secondaryButton, verifyingMethod && styles.buttonDisabled]} onPress={() => void handleVerifyPhone()} disabled={verifyingMethod}>
                {verifyingMethod ? <ActivityIndicator color="#F97316" /> : <Text style={styles.secondaryButtonText}>Verify Mobile Money</Text>}
              </TouchableOpacity>
            </View>
          ) : null}

          {loadingMethods ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#F97316" />
              <Text style={[styles.emptyText, { color: C.textSub }]}>Loading linked mobile money...</Text>
            </View>
          ) : mobileMoneyMethods.length > 0 ? (
            mobileMoneyMethods.map((method) => {
              const methodLabel = getMethodLabel(method.provider);
              const ready = method.is_active && method.is_verified;
              return (
                <View key={method.id} style={[styles.itemRow, { backgroundColor: C.bg }]}>
                  <View style={styles.itemLogoWrap}>
                    <Image
                      source={MOBILE_METHOD_LOGOS[method.provider].source}
                      style={styles.itemLogo}
                      resizeMode="contain"
                      accessibilityLabel={`${methodLabel} Logo`}
                    />
                  </View>
                  <View style={styles.itemBody}>
                    <Text style={[styles.itemText, { color: C.text }]}>{methodLabel}</Text>
                    <Text style={[styles.itemSubText, { color: C.textSub }]}>{method.masked_number}</Text>
                    <View style={[styles.statusPill, ready ? styles.statusReady : styles.statusPending]}>
                      {ready ? <CheckCircle2 size={12} color="#15803D" /> : <ShieldAlert size={12} color="#B45309" />}
                      <Text style={[styles.statusText, ready ? styles.statusReadyText : styles.statusPendingText]}>
                        {ready ? 'Ready for vault top-ups' : 'Linked, needs verification'}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => handleUnlinkPhone(method)} disabled={unlinkingMethodId === method.id}>
                    {unlinkingMethodId === method.id ? <ActivityIndicator color="#EF4444" /> : <Trash2 size={16} color="#EF4444" />}
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
                  <Text style={[styles.itemSubText, { color: C.textSub }]}>{bank.accountName} - {bank.accountNumberMasked}</Text>
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
      <EnterTransactionPinModal
        visible={pinModalVisible}
        subtitle={`Enter your Transaction PIN to link this ${getMethodLabel(selectedNetwork)} number.`}
        loading={linkingPhone}
        error={pinError}
        onCancel={() => {
          setPinModalVisible(false);
          setPinError(null);
          setPendingPhoneNumber(null);
        }}
        onConfirm={submitAddPhone}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  iconButton: { width: 32, alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1E2B5A' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 34 },
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
  phoneField: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    overflow: 'hidden',
  },
  phonePrefix: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
  },
  phoneFlag: {
    fontSize: 18,
    lineHeight: 22,
  },
  phonePrefixText: {
    fontSize: 14,
    fontWeight: '800',
  },
  phoneInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
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
  networkChipActive: { borderWidth: 1.5 },
  networkLogo: { width: 102, height: 40 },
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
  secondaryButton: {
    borderColor: '#F97316',
    borderWidth: 1.5,
    borderRadius: 12,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#F97316',
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: { opacity: 0.55 },
  verifyBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  verifyHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  verifyTitle: { color: '#B45309', fontSize: 13, fontWeight: '800' },
  verifyCopy: { fontSize: 12, lineHeight: 18, marginBottom: 8 },
  verifyInput: { marginBottom: 8 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
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
  itemBody: { flex: 1, marginRight: 8 },
  itemLogoWrap: {
    width: 68,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  itemLogo: { width: 64, height: 28 },
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
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  statusReady: { backgroundColor: '#DCFCE7' },
  statusPending: { backgroundColor: '#FEF3C7' },
  statusText: { fontSize: 11, fontWeight: '800' },
  statusReadyText: { color: '#15803D' },
  statusPendingText: { color: '#B45309' },
  emptyText: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
  },
});
