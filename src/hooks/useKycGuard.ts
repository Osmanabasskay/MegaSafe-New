/**
 * useKycGuard — KYC enforcement hook
 *
 * Checks the authenticated user's KYC status from the backend (not a cached
 * frontend value) and blocks access to financial actions when KYC is not
 * approved.
 *
 * HOW TO USE:
 *   const { isApproved, requireKyc } = useKycGuard();
 *   // In a button handler:
 *   if (!requireKyc('create Osusu group')) return;
 *   // proceed with action
 *
 * requireKyc() shows an Alert and returns false when KYC is not approved.
 * It returns true when the user is approved and the caller can proceed.
 *
 * SERVER-SIDE ENFORCEMENT:
 * This hook is a UX-layer guard only. All financial RPCs and Edge Functions
 * re-verify KYC status server-side via the user's profile row. A client that
 * bypasses this hook will be rejected by the backend.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { fetchProfile, type KycStatus } from '../services/profileService';
import { supabaseConfigured } from '../services/supabase';
import { fetchTransactionVerificationRequired } from '../services/platformSettingsService';

export interface KycGuardState {
  /** Null while loading, or the DB value once fetched. */
  kycStatus: KycStatus | null;
  /** True only when kycStatus === 'approved'. */
  isApproved: boolean;
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** Backend-controlled setting. Defaults to true when unavailable. */
  verificationRequired: boolean;
  /**
   * Call before any financial action. Returns true if approved (caller may
   * proceed). Returns false and shows an Alert + navigation prompt if blocked.
   *
   * @param actionLabel Human-readable label for the blocked action.
   */
  requireKyc: (actionLabel: string) => boolean;
  /** Manually refresh KYC status from the backend. */
  refreshKyc: () => Promise<void>;
}

export function useKycGuard(): KycGuardState {
  const router = useRouter();
  const { user } = useAuthStore();
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(true);
  const [loading, setLoading]     = useState(true);

  const refreshKyc = useCallback(async () => {
    if (!supabaseConfigured || !user?.id) {
      setKycStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ profile }, required] = await Promise.all([
      fetchProfile(user.id),
      fetchTransactionVerificationRequired(),
    ]);
    setKycStatus((profile?.kyc_status as KycStatus) ?? null);
    setVerificationRequired(required);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void refreshKyc();
  }, [refreshKyc]);

  const isApproved = kycStatus === 'approved';

  const requireKyc = useCallback(
    (actionLabel: string): boolean => {
      if (!supabaseConfigured) {
        // Dev / offline mode — allow action
        return true;
      }

      if (!verificationRequired || isApproved) return true;

      const statusMsg: Record<string, string> = {
        submitted: 'Your KYC documents are under review. You will be notified when approved.',
        rejected:  'Your KYC was rejected. Please resubmit your documents.',
        pending:   'Please complete your KYC verification before using financial features.',
      };

      const detail = kycStatus ? (statusMsg[kycStatus] ?? statusMsg.pending) : statusMsg.pending;

      Alert.alert(
        'KYC Approval Required',
        `KYC approval is required before using this financial feature.\n\n${detail}`,
        [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Complete KYC',
            onPress: () => router.push('/(kyc)/id-photos'),
          },
        ],
      );

      return false;
    },
    [isApproved, kycStatus, router, verificationRequired],
  );

  return { kycStatus, isApproved, loading, verificationRequired, requireKyc, refreshKyc };
}
