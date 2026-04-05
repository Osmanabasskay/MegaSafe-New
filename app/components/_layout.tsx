import { Stack } from 'expo-router';

export default function ComponentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Component screens will be registered here automatically */}
    </Stack>
  );
}
