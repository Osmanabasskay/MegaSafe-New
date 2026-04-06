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
  contributionAmount: number;
  frequency: Frequency;
  maxMembers: number;
  cycleStartDate: string;
  totalCycles: number;
  payoutOrder: PayoutOrder;
  inviteCode: string;
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

const createDefaultDraft = (): GroupCreationDraft => ({
  name: '',
  description: '',
  contributionAmount: 0,
  frequency: 'weekly',
  maxMembers: 5,
  cycleStartDate: new Date().toISOString().slice(0, 10),
  totalCycles: 5,
  payoutOrder: 'sequential',
  inviteCode: '',
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
  updateDetails: (payload: { name: string; description: string }) => void;
  updateRules: (rules: GroupRulesConfig) => void;
  setInviteCode: (code: string) => void;
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
