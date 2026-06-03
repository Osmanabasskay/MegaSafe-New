import { Redirect, useLocalSearchParams } from 'expo-router';

export default function PhysicalCollectRedirect() {
  const { groupId, id } = useLocalSearchParams<{ groupId?: string; id?: string }>();
  const targetGroupId = groupId ?? id;

  return (
    <Redirect
      href={{
        pathname: '/(groups)/collector',
        params: targetGroupId ? { groupId: targetGroupId } : undefined,
      }}
    />
  );
}
