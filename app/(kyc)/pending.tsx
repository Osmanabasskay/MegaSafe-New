import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { fetchProfile, type KycStatus } from '../../lib/profileService';
import { useKycDraftStore } from '../../stores/kycDraftStore';
import { KycProgress } from '../../components/kyc/KycProgress';

export default function PendingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const resetDraft = useKycDraftStore((s) => s.reset);

  const [status, setStatus] = useState<KycStatus | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { profile, error } = await fetchProfile(user.id);
    setLoading(false);
    if (error || !profile) {
      setStatus('pending');
      setReason(null);
      return;
    }
    setStatus((profile.kyc_status as KycStatus) ?? 'pending');
    setReason(profile.kyc_rejection_reason);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goResubmit = () => {
    resetDraft();
    router.replace('/(kyc)/id-photos');
  };

  const goHome = () => router.replace('/(main)/home');

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    );
  }

  const approved = status === 'approved';
  const rejected = status === 'rejected';
  const submitted = status === 'submitted';

  return (
    <View className="flex-1 bg-white">
      <KycProgress currentStep={5} label="Status" />
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-6xl mb-4">{approved ? '✅' : rejected ? '❌' : '⏳'}</Text>
        <Text className="text-2xl font-bold text-primary mb-2 text-center">
          {approved ? 'KYC approved' : rejected ? 'KYC needs attention' : submitted ? 'Under review' : 'Complete your KYC'}
        </Text>
        <Text className="text-gray-600 text-center mb-6 px-2">
          {approved
            ? 'Your identity is verified. You can use all MegaSafe features.'
            : rejected
              ? reason || 'Please resubmit your documents with clearer images.'
              : submitted
                ? 'Your documents were submitted. We will notify you when review is complete.'
                : 'Start the verification flow to unlock groups and payments.'}
        </Text>

        {rejected ? (
          <TouchableOpacity className="bg-primary px-8 py-3 rounded-full mb-3" onPress={goResubmit}>
            <Text className="text-white font-bold">Resubmit KYC</Text>
          </TouchableOpacity>
        ) : null}

        {!approved && !rejected && !submitted ? (
          <TouchableOpacity className="bg-primary px-8 py-3 rounded-full mb-3" onPress={goResubmit}>
            <Text className="text-white font-bold">Start KYC</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          className={`px-8 py-3 rounded-full border ${approved ? 'bg-secondary border-secondary' : 'border-gray-300'}`}
          onPress={goHome}
        >
          <Text className={`font-semibold ${approved ? 'text-white' : 'text-gray-700'}`}>
            {approved ? 'Go to dashboard' : 'Back to dashboard'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
