import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, RotateCcwKey } from 'lucide-react-native';
import { PinInput } from '../../src/components/security/PinInput';
import { completeTransactionPinReset, requestTransactionPinReset } from '../../src/services/transactionPinService';

export default function ResetTransactionPinScreen() {
  const router = useRouter();
  const [otpCode, setOtpCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  const requestReset = async () => {
    setLoading(true);
    const result = await requestTransactionPinReset('email_otp');
    setLoading(false);
    if (!result.success) {
      Alert.alert('Reset unavailable', result.error?.message ?? 'Please try again.');
      return;
    }
    setRequested(true);
    Alert.alert('OTP required', 'Enter the verification code sent to your account to complete the reset.');
  };

  const completeReset = async () => {
    if (otpCode.trim().length < 6 || newPin.length !== 4 || confirmNewPin.length !== 4) {
      Alert.alert('Missing details', 'Enter the OTP and your new 4-digit Transaction PIN.');
      return;
    }
    setLoading(true);
    const result = await completeTransactionPinReset(otpCode, newPin, confirmNewPin);
    setLoading(false);
    if (!result.success) {
      Alert.alert('Could not reset PIN', result.error?.message ?? 'Please try again.');
      return;
    }
    Alert.alert('Transaction PIN reset', 'Your Transaction PIN has been updated.', [
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reset Transaction PIN</Text>
        <View style={styles.iconButton} />
      </View>
      <View style={styles.content}>
        <RotateCcwKey size={34} color="#F97316" />
        <Text style={styles.title}>Reset Transaction PIN</Text>
        <Text style={styles.copy}>Reset requires OTP verification before a new Transaction PIN can protect payments and withdrawals.</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={requestReset} disabled={loading}>
          <Text style={styles.secondaryText}>{requested ? 'Send OTP Again' : 'Request OTP'}</Text>
        </TouchableOpacity>
        <Text style={styles.label}>OTP Code</Text>
        <TextInput
          value={otpCode}
          onChangeText={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 8))}
          keyboardType="number-pad"
          style={styles.otpInput}
          placeholder="Enter OTP"
          placeholderTextColor="#9CA3AF"
        />
        <Text style={styles.label}>New PIN</Text>
        <PinInput value={newPin} onChangeText={setNewPin} />
        <Text style={styles.label}>Confirm New PIN</Text>
        <PinInput value={confirmNewPin} onChangeText={setConfirmNewPin} />
        <TouchableOpacity style={styles.primaryButton} onPress={completeReset} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Reset PIN</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  content: { flex: 1, padding: 24 },
  title: { marginTop: 18, fontSize: 26, fontWeight: '900', color: '#111827' },
  copy: { marginTop: 10, marginBottom: 18, fontSize: 15, lineHeight: 22, color: '#6B7280' },
  label: { marginTop: 18, marginBottom: 10, fontSize: 13, fontWeight: '800', color: '#374151' },
  otpInput: { height: 50, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', paddingHorizontal: 14, fontSize: 18, letterSpacing: 0, color: '#111827' },
  secondaryButton: { height: 48, borderRadius: 8, borderWidth: 1, borderColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#F97316', fontWeight: '800' },
  primaryButton: { marginTop: 30, height: 52, borderRadius: 8, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});
