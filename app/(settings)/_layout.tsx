import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsLayout() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAFAFC' }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FAFAFC' },
        }}
      />
    </SafeAreaView>
  );
}
