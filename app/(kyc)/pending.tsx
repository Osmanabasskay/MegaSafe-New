import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { fetchProfile, type KycStatus } from '../../src/services/profileService';
import { useKycDraftStore } from '../../src/store/kycDraftStore';
import { KycProgress } from '../../src/components/kyc/KycProgress';
import { useAppDataStore } from '../../src/store/appDataStore';
import { darkColors, lightColors } from '../../src/theme/colors';

export default function PendingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const resetDraft = useKycDraftStore((s) => s.reset);
  const { preferences } = useAppDataStore();
  const isDark = preferences.darkMode;
  const C = isDark ? darkColors : lightColors;

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
      void load();
    }, [load])
  );

  const goResubmit = () => {
    resetDraft();
    router.replace('/(kyc)/id-photos');
  };

  const goHome = () => router.replace('/(main)/home');

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]}>
        <View style={[styles.center, { backgroundColor: C.bg }]}>
          <ActivityIndicator size="large" color="#F97316" />
        </View>
      </SafeAreaView>
    );
  }

  const approved = status === 'approved';
  const rejected = status === 'rejected';
  // 'submitted' is a legacy value written by the old RPC; treat it the same as 'pending'
  const pending  = status === 'pending' || status === 'submitted';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]}>
      <KycProgress currentStep={5} label="Status" />
      <View style={styles.content}>
        <Text style={styles.emoji}>{approved ? '✅' : rejected ? '❌' : '⏳'}</Text>
        <Text style={[styles.title, { color: C.text }]}>
          {approved ? 'KYC approved' : rejected ? 'KYC needs attention' : pending ? 'Under review' : 'Complete your KYC'}
        </Text>
        <Text style={[styles.body, { color: C.textSub }]}>
          {approved
            ? 'Your identity is verified. You can use all Mi Osusu features.'
            : rejected
              ? reason || 'Please resubmit your documents with clearer images.'
              : pending
                ? 'Your documents were submitted. We will notify you when review is complete.'
                : 'Start the verification flow to unlock groups and payments.'}
        </Text>

        {rejected ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={goResubmit}>
            <Text style={styles.primaryBtnText}>Resubmit KYC</Text>
          </TouchableOpacity>
        ) : null}

        {!approved && !rejected && !pending ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={goResubmit}>
            <Text style={styles.primaryBtnText}>Start KYC</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.secondaryBtn, { backgroundColor: approved ? '#F97316' : C.iconBg }]}
          onPress={goHome}
        >
          <Text style={[styles.secondaryBtnText, { color: approved ? '#FFFFFF' : C.textSub }]}>
            {approved ? 'Go to dashboard' : 'Back to dashboard'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emoji:   { fontSize: 60, marginBottom: 16 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  primaryBtn: {
    backgroundColor: '#F97316',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    marginBottom: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    marginBottom: 8,
  },
  secondaryBtnText: { fontWeight: '600', fontSize: 15 },
});
