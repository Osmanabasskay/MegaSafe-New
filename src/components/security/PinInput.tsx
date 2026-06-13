import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

interface PinInputProps {
  value: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
}

export function PinInput({ value, onChangeText, autoFocus = false }: PinInputProps) {
  const digits = value.padEnd(4, ' ').slice(0, 4).split('');
  const previousValue = useRef(value);
  const [visibleIndex, setVisibleIndex] = useState<number | null>(null);

  useEffect(() => {
    const previous = previousValue.current;
    previousValue.current = value;

    if (value.length > previous.length) {
      setVisibleIndex(value.length - 1);
      const timer = setTimeout(() => setVisibleIndex(null), 800);
      return () => clearTimeout(timer);
    }

    setVisibleIndex(null);
  }, [value]);

  const displayDigits = useMemo(
    () =>
      digits.map((digit, index) => {
        if (!digit.trim()) return '';
        return index === visibleIndex ? digit : '*';
      }),
    [digits, visibleIndex],
  );

  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        secureTextEntry
        maxLength={4}
        autoFocus={autoFocus}
        style={styles.hiddenInput}
        accessibilityLabel="Transaction PIN"
      />
      <View style={styles.cells} pointerEvents="none">
        {digits.map((digit, index) => (
          <View key={index} style={[styles.cell, digit.trim() ? styles.cellFilled : null]}>
            <Text style={styles.cellText}>{displayDigits[index]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 56,
    justifyContent: 'center',
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    color: 'transparent',
    opacity: 0.02,
  },
  cells: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  cell: {
    width: 42,
    height: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  cellFilled: {
    borderColor: '#F97316',
    backgroundColor: '#FFF7ED',
  },
  cellText: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 48,
  },
});
