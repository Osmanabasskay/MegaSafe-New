/**
 * GroupDetailScreen — immediate redirect to the real group management screen.
 *
 * This file existed as an early stub. The production implementation lives at
 * app/(groups)/manage/[id].tsx. All navigation that lands here is forwarded.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  useEffect(() => {
    if (id) {
      // Replace so the stub doesn't appear in the back stack
      router.replace({ pathname: '/(groups)/manage/[id]', params: { id } });
    } else {
      router.replace('/(main)/groups');
    }
  }, [id, router]);

  return null;
}
