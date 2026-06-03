import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { secureJsonStorage } from '../services/secureJsonStorage';

interface ComplianceState {
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  acceptTerms: () => void;
  acceptPrivacy: () => void;
  resetCompliance: () => void;
}

export const useComplianceStore = create<ComplianceState>()(
  persist(
    (set) => ({
      termsAcceptedAt: null,
      privacyAcceptedAt: null,
      acceptTerms: () => set({ termsAcceptedAt: new Date().toISOString() }),
      acceptPrivacy: () => set({ privacyAcceptedAt: new Date().toISOString() }),
      resetCompliance: () => set({ termsAcceptedAt: null, privacyAcceptedAt: null }),
    }),
    {
      name: 'miosusu-compliance-v1',
      storage: createJSONStorage(() => secureJsonStorage),
      partialize: (state) => ({
        termsAcceptedAt: state.termsAcceptedAt,
        privacyAcceptedAt: state.privacyAcceptedAt,
      }),
    }
  )
);
