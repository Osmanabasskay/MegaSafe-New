import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, KeyRound } from 'lucide-react-native';
import { PinInput } from '../../src/components/security/PinInput';
import { changeTransactionPin } from '../../src/services/transactionPinService';

export default function ChangeTransactionPinScreen() {
  const router = useRouter();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if ([currentPin, newPin, confirmNewPin].some((value) => value.length !== 4)) {
      Alert.alert('Invalid PIN', 'Each Transaction PIN field must contain 4 digits.');
      return;
    }
    if (newPin !== confirmNewPin) {
      Alert.alert('PINs do not match', 'Your new PIN and confirmation must be the same.');
      return;
    }
    setLoading(true);
    const result = await changeTransactionPin(currentPin, newPin, confirmNewPin);
    setLoading(false);
    if (!result.success) {
      const raw = result.error?.message ?? 'Please try again.';
      // The backend returns a generic "Invalid Transaction PIN." when the
      // CURRENT pin doesn't match. Make that unambiguous in this screen.
      const message = /invalid transaction pin/i.test(raw)
        ? 'The current PIN you entered is incorrect. Please try again, or reset it from Transaction PIN settings if you have forgotten it.'
        : raw;
      Alert.alert('Could not change PIN', message);
      return;
    }
    Alert.alert('Transaction PIN changed', 'Your Transaction PIN has been updated.', [
      { text: 'Done', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Transaction PIN</Text>
        <View style={styles.iconButton} />
      </View>
      <View style={styles.content}>
        <KeyRound size={34} color="#F97316" />
        <Text style={styles.title}>Change Transaction PIN</Text>
        <Text style={styles.label}>Current PIN</Text>
        <PinInput value={currentPin} onChangeText={setCurrentPin} autoFocus />
        <Text style={styles.label}>New PIN</Text>
        <PinInput value={newPin} onChangeText={setNewPin} />
        <Text style={styles.label}>Confirm New PIN</Text>
        <PinInput value={confirmNewPin} onChangeText={setConfirmNewPin} />
        <TouchableOpacity style={styles.primaryButton} onPress={submit} disabled={loading}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Change PIN</Text>}
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
  title: { marginTop: 18, marginBottom: 12, fontSize: 26, fontWeight: '900', color: '#111827' },
  label: { marginTop: 18, marginBottom: 10, fontSize: 13, fontWeight: '800', color: '#374151' },
  primaryButton: { marginTop: 30, height: 52, borderRadius: 8, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
});
