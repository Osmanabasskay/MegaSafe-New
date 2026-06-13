import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PinInput } from './PinInput';

interface EnterTransactionPinModalProps {
  visible: boolean;
  title?: string;
  subtitle: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
}

export function EnterTransactionPinModal({
  visible,
  title = 'Confirm Transaction',
  subtitle,
  loading = false,
  error,
  onCancel,
  onConfirm,
}: EnterTransactionPinModalProps) {
  const router = useRouter();
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!visible) setPin('');
  }, [visible]);

  const canSubmit = pin.length === 4 && !loading;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <PinInput value={pin} onChangeText={setPin} autoFocus={visible} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={styles.forgot}
            onPress={() => {
              onCancel();
              router.push('/(settings)/reset-transaction-pin');
            }}
          >
            <Text style={styles.forgotText}>Forgot PIN?</Text>
          </TouchableOpacity>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={loading}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !canSubmit ? styles.confirmButtonDisabled : null]}
              onPress={() => onConfirm(pin)}
              disabled={!canSubmit}
            >
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmText}>Confirm</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
    textAlign: 'center',
  },
  error: {
    marginTop: 12,
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
  },
  forgot: {
    alignSelf: 'center',
    paddingVertical: 12,
  },
  forgotText: {
    color: '#F97316',
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: '#374151',
    fontWeight: '700',
  },
  confirmButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.45,
  },
  confirmText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
});
