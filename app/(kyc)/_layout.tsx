import { Stack } from 'expo-router';

export default function KYCLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="id-photos" />
      <Stack.Screen name="selfie" />
      <Stack.Screen name="details" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="guarantor" />
    </Stack>
  );
}
