import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import { PinInput } from '../../src/components/security/PinInput';
import { createTransactionPin } from '../../src/services/transactionPinService';

export default function CreateTransactionPinScreen() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    if (pin.length !== 4 || confirmPin.length !== 4) {
      Alert.alert('Invalid PIN', 'Enter a 4-digit Transaction PIN.');
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert('PIN mismatch', 'The confirmation PIN does not match.');
      return;
    }
    setLoading(true);
    const result = await createTransactionPin(pin, confirmPin);
    setLoading(false);
    if (!result.success) {
      Alert.alert('Unable to create Transaction PIN', result.error?.message ?? 'Please try again.');
      return;
    }
    Alert.alert('Transaction PIN created', 'You can now confirm payments and withdrawals.', [
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Transaction PIN</Text>
        <View style={styles.iconButton} />
      </View>
      <View style={styles.content}>
        <ShieldCheck size={34} color="#F97316" />
        <Text style={styles.title}>Create Transaction PIN</Text>
        <Text style={styles.copy}>
          You will use this 4-digit PIN to confirm payments and withdrawals. Do not share it with anyone.
        </Text>
        <Text style={styles.label}>PIN</Text>
        <PinInput value={pin} onChangeText={setPin} autoFocus />
        <Text style={styles.label}>Confirm PIN</Text>
        <PinInput value={confirmPin} onChangeText={setConfirmPin} />
        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Create PIN</Text>}
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
  copy: { marginTop: 10, marginBottom: 26, fontSize: 15, lineHeight: 22, color: '#6B7280' },
  label: { marginTop: 18, marginBottom: 10, fontSize: 13, fontWeight: '800', color: '#374151' },
  primaryButton: { marginTop: 30, height: 52, borderRadius: 8, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  primaryButtonDisabled: { opacity: 0.72 },
  primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});
