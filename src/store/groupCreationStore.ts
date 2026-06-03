import { create } from 'zustand';
import type { Frequency, PayoutOrder } from '../types/group';

export interface GroupRulesConfig {
  requireApproval: boolean;
  allowLatePayments: boolean;
  latePaymentFee: number;
  maxMissedPayments: number;
  emergencyWithdrawal: boolean;
  withdrawalLimit: number;
  meetingFrequency: 'weekly' | 'monthly' | 'quarterly';
  digitalOnly: boolean;
  autoReminders: boolean;
  reminderDays: number;
}

export interface GroupInviteDraft {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface GroupCreationDraft {
  name: string;
  description: string;
  logoUri: string | null;
  adminCollectionPhone: string;
  contributionAmount: number;
  frequency: Frequency;
  maxMembers: number;
  cycleStartDate: string;
  totalCycles: number;
  payoutOrder: PayoutOrder;
  inviteCode: string;
  contributionNumber: string;
  rules: GroupRulesConfig;
  invites: GroupInviteDraft[];
}

const DEFAULT_RULES: GroupRulesConfig = {
  requireApproval: true,
  allowLatePayments: true,
  latePaymentFee: 5,
  maxMissedPayments: 2,
  emergencyWithdrawal: false,
  withdrawalLimit: 50,
  meetingFrequency: 'monthly',
  digitalOnly: true,
  autoReminders: true,
  reminderDays: 3,
};

function generateContributionNumber(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 6; i++) randomBytes[i] = Math.floor(Math.random() * 256);
  }
  let seq = '';
  for (let i = 0; i < 6; i++) {
    seq += chars[randomBytes[i]! % chars.length];
  }
  return `OSU-${datePart}-${seq}`;
}

const createDefaultDraft = (): GroupCreationDraft => ({
  name: '',
  description: '',
  logoUri: null,
  adminCollectionPhone: '',
  contributionAmount: 0,
  frequency: 'weekly',
  maxMembers: 5,
  cycleStartDate: new Date().toISOString().slice(0, 10),
  totalCycles: 5,
  payoutOrder: 'sequential',
  inviteCode: '',
  contributionNumber: generateContributionNumber(),
  rules: { ...DEFAULT_RULES },
  invites: [],
});

interface GroupCreationState {
  draft: GroupCreationDraft;
  updateBaseConfig: (payload: {
    contributionAmount: number;
    frequency: Frequency;
    maxMembers: number;
    cycleStartDate: string;
    totalCycles?: number;
    payoutOrder: PayoutOrder;
  }) => void;
  updateDetails: (payload: {
    name: string;
    description: string;
    logoUri?: string | null;
    adminCollectionPhone?: string;
  }) => void;
  updateRules: (rules: GroupRulesConfig) => void;
  setInviteCode: (code: string) => void;
  setLogoUri: (logoUri: string | null) => void;
  setAdminCollectionPhone: (phone: string) => void;
  addInvite: (invite: GroupInviteDraft) => void;
  removeInvite: (inviteId: string) => void;
  resetInvites: () => void;
  resetDraft: () => void;
}

export const useGroupCreationStore = create<GroupCreationState>()((set) => ({
  draft: createDefaultDraft(),
  updateBaseConfig: (payload) =>
    set((state) => ({
      draft: {
        ...state.draft,
        contributionAmount: payload.contributionAmount,
        frequency: payload.frequency,
        maxMembers: payload.maxMembers,
        cycleStartDate: payload.cycleStartDate,
        totalCycles: payload.totalCycles ?? payload.maxMembers,
        payoutOrder: payload.payoutOrder,
      },
    })),
  updateDetails: (payload) =>
    set((state) => ({
      draft: {
        ...state.draft,
        name: payload.name,
        description: payload.description,
        logoUri: payload.logoUri !== undefined ? payload.logoUri : state.draft.logoUri,
        adminCollectionPhone:
          payload.adminCollectionPhone !== undefined
            ? payload.adminCollectionPhone
            : state.draft.adminCollectionPhone,
      },
    })),
  setLogoUri: (logoUri) =>
    set((state) => ({
      draft: {
        ...state.draft,
        logoUri,
      },
    })),
  setAdminCollectionPhone: (phone) =>
    set((state) => ({
      draft: {
        ...state.draft,
        adminCollectionPhone: phone,
      },
    })),
  updateRules: (rules) =>
    set((state) => ({
      draft: {
        ...state.draft,
        rules,
      },
    })),
  setInviteCode: (code) =>
    set((state) => ({
      draft: {
        ...state.draft,
        inviteCode: code,
      },
    })),
  addInvite: (invite) =>
    set((state) => ({
      draft: {
        ...state.draft,
        invites: [invite, ...state.draft.invites.filter((item) => item.id !== invite.id)],
      },
    })),
  removeInvite: (inviteId) =>
    set((state) => ({
      draft: {
        ...state.draft,
        invites: state.draft.invites.filter((item) => item.id !== inviteId),
      },
    })),
  resetInvites: () =>
    set((state) => ({
      draft: {
        ...state.draft,
        invites: [],
      },
    })),
  resetDraft: () => set({ draft: createDefaultDraft() }),
}));
