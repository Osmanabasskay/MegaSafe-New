import { Stack } from 'expo-router';
import React from 'react';

export default function SendLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#F8FAFC' },
      }}
    />
  );
}
