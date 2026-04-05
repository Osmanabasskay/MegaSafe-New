import { Stack } from 'expo-router';

export default function GroupsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="create" />
      <Stack.Screen name="rules" />
      <Stack.Screen name="invite" />
      <Stack.Screen name="setup-complete" />
      <Stack.Screen name="contribute" />
      <Stack.Screen name="payment-success" />
      <Stack.Screen name="collector" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="manage/[id]" />
    </Stack>
  );
}
