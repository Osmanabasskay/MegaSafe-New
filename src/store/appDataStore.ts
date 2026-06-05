import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { secureJsonStorage } from '../services/secureJsonStorage';
import {
  getCredentialDisplayName,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../utils/profileName';

export type NotificationType =
  | 'collection_reminder'
  | 'payment_received'
  | 'group_invite'
  | 'join_approved'
  | 'dispute_update'
  | 'payout_scheduled'
  | 'system_alert'
  | 'savings_update'
  | 'achievement';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  actionPath?: string;
}

export interface ProfileData {
  fullName: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  verificationStatus: 'Verified' | 'Pending';
  memberSince: string;
  referralCode: string;
}

export interface PreferencesData {
  notificationsEnabled: boolean;
  darkMode: boolean;
  biometricAuth: boolean;
  twoFactorAuth: boolean;
}

export interface LinkedBankAccountRecord {
  id: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  createdAt: string;
}

// qmoney intentionally excluded — not supported via Monime (see paymentService.SupportedPaymentMethod)
export type MobileMoneyNetwork = 'orange_money' | 'afrimoney';

export interface LinkedMobileMoneyRecord {
  id: string;
  network: MobileMoneyNetwork;
  phone: string;
  createdAt: string;
}

export type SavingsGoalStatus = 'active' | 'completed' | 'withdrawn' | 'cancelled';

export interface SavingsGoalRecord {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  category: string;
  contributors: number;
  status: SavingsGoalStatus;
  autoSaveEnabled: boolean;
  autoSaveAmount: number;
  autoSaveInterval: 'daily' | 'weekly' | 'monthly';
  autoSaveNextDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptRecord {
  id: string;
  transactionId: string;
  receiptNumber: string;
  amount: number;
  groupName: string;
  payerName?: string;
  paymentMethod: string;
  phoneNumber: string;
  paidAt: string;
  status: 'verified' | 'pending' | 'failed';
}

export interface VaultTransactionRecord {
  id: string;
  type: 'deposit' | 'withdrawal' | 'contribution' | 'auto_save';
  amount: number;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  occurredAt: string;
  groupName?: string;
}

export interface GroupLedgerEntryRecord {
  id: string;
  groupId: string;
  groupName: string;
  contributorUserId: string | null;
  contributorName: string;
  amount: number;
  contributedAt: string;
  transactionReference: string;
  paymentMethod: string;
}

export interface GroupContributionStatusRecord {
  id: string;
  groupId: string;
  groupName: string;
  contributorUserId: string | null;
  contributorName: string;
  lastContributionAmount: number;
  lastContributionAt: string;
  lastTransactionReference: string;
  status: 'up_to_date';
}

export type VaultFlowErrorCode =
  | 'invalid_amount'
  | 'insufficient_balance'
  | 'savings_goal_not_found'
  | 'group_not_found'
  | 'membership_error'
  | 'transaction_failed';

export type VaultFlowResult =
  | {
      ok: true;
      message: string;
      transactionReference?: string;
      receipt?: ReceiptRecord;
    }
  | {
      ok: false;
      code: VaultFlowErrorCode;
      message: string;
    };

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'escalated';
export type DisputeType =
  | 'missing_payment'
  | 'collector_misconduct'
  | 'incorrect_amount'
  | 'unauthorized_transaction'
  | 'other';

export interface DisputeRecord {
  id: string;
  title: string;
  description: string;
  type: DisputeType;
  status: DisputeStatus;
  groupName: string;
  createdAt: string;
  updatedAt: string;
  resolutionNote?: string;
}

interface AppDataState {
  initializedUserId: string | null;
  profile: ProfileData;
  preferences: PreferencesData;
  notifications: AppNotification[];
  receipts: ReceiptRecord[];
  savingsGoals: SavingsGoalRecord[];
  vaultTransactions: VaultTransactionRecord[];
  disputes: DisputeRecord[];
  linkedPhoneNumbers: string[];
  linkedMobileMoneyAccounts: LinkedMobileMoneyRecord[];
  linkedBankAccounts: LinkedBankAccountRecord[];
  initializeForUser: (user: User | null) => void;
  updateProfile: (partial: Partial<ProfileData>) => void;
  setProfileAvatar: (avatarUrl: string | null) => void;
  updatePreferences: (partial: Partial<PreferencesData>) => void;
  addNotification: (item: Omit<AppNotification, 'id' | 'createdAt' | 'read'> & { read?: boolean }) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  removeNotification: (id: string) => void;
  createDispute: (payload: {
    id?: string;
    title: string;
    description: string;
    type: DisputeType;
    groupName: string;
  }) => void;
  updateDisputeStatus: (id: string, status: DisputeStatus, resolutionNote?: string) => void;
  linkPhoneNumber: (phone: string, network?: MobileMoneyNetwork) => { ok: boolean; message?: string };
  unlinkPhoneNumber: (phone: string, network?: MobileMoneyNetwork) => void;
  linkBankAccount: (payload: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  }) => { ok: boolean; message?: string };
  unlinkBankAccount: (id: string) => void;
}

const nowIso = (): string => new Date().toISOString();

const createId = (prefix: string): string => {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand); // crypto is available in all supported runtimes (browser, Node 15+, RN 0.70+)
  return `${prefix}-${Date.now()}-${rand[0]!.toString(16)}`;
};

const toDateOnly = (iso: string): string => iso.slice(0, 10);

const addDays = (dateIso: string, days: number): string => {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return toDateOnly(nowIso());
  date.setDate(date.getDate() + days);
  return toDateOnly(date.toISOString());
};

const nextIntervalDate = (
  currentDate: string,
  interval: 'daily' | 'weekly' | 'monthly'
): string => {
  if (interval === 'daily') return addDays(currentDate, 1);
  if (interval === 'weekly') return addDays(currentDate, 7);
  return addDays(currentDate, 30);
};

const buildDefaultProfile = (): ProfileData => ({
  fullName: 'Member',
  email: '',
  phone: '',
  avatarUrl: null,
  verificationStatus: 'Pending',
  memberSince: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  referralCode: (() => {
    const rand = new Uint32Array(1);
    crypto.getRandomValues(rand);
    return `MSF-${100000 + (rand[0]! % 900000)}`;
  })(),
});

const defaultPreferences: PreferencesData = {
  notificationsEnabled: true,
  darkMode: false,
  biometricAuth: false,
  twoFactorAuth: false,
};

const seedSavingsGoals = (): SavingsGoalRecord[] => [];
const seedVaultTransactions = (): VaultTransactionRecord[] => [];
const seedNotifications = (): AppNotification[] => [];
const seedDisputes = (): DisputeRecord[] => [];
const seedReceipts = (): ReceiptRecord[] => [];
const seedLinkedPhones = (): string[] => [];
const seedLinkedMobileMoneyAccounts = (): LinkedMobileMoneyRecord[] => [];
const seedLinkedBanks = (): LinkedBankAccountRecord[] => [];

export const useAppDataStore = create<AppDataState>()(
  persist(
    (set, get) => ({
      initializedUserId: null,
      profile: buildDefaultProfile(),
      preferences: defaultPreferences,
      notifications: seedNotifications(),
      receipts: seedReceipts(),
      savingsGoals: seedSavingsGoals(),
      vaultTransactions: seedVaultTransactions(),
      disputes: seedDisputes(),
      linkedPhoneNumbers: seedLinkedPhones(),
      linkedMobileMoneyAccounts: seedLinkedMobileMoneyAccounts(),
      linkedBankAccounts: seedLinkedBanks(),

      initializeForUser: (user) => {
        const state = get();
        const userId = user?.id ?? null;

        const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
        const fullNameCandidate =
          (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
          (typeof metadata.name === 'string' && metadata.name.trim()) ||
          [metadata.first_name, metadata.last_name]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .join(' ');

        const currentName = normalizeProfileName(state.profile.fullName);
        const metadataName = normalizeProfileName(fullNameCandidate);
        const credentialName = getCredentialDisplayName(
          user?.email ?? state.profile.email,
          user?.phone ?? state.profile.phone
        );
        const fullName = !isPlaceholderProfileName(metadataName)
          ? metadataName
          : !isPlaceholderProfileName(currentName)
            ? currentName
            : credentialName;

        const nextPhone = user?.phone ?? state.profile.phone;
        const nextLinkedPhones =
          nextPhone && !state.linkedPhoneNumbers.includes(nextPhone)
            ? [nextPhone, ...state.linkedPhoneNumbers]
            : state.linkedPhoneNumbers;

        set({
          initializedUserId: userId,
          profile: {
            ...state.profile,
            fullName,
            email: user?.email ?? state.profile.email,
            phone: nextPhone,
            verificationStatus: user ? state.profile.verificationStatus : 'Pending',
          },
          linkedPhoneNumbers: nextLinkedPhones,
        });
      },

      updateProfile: (partial) => {
        set((state) => ({
          profile: {
            ...state.profile,
            ...partial,
            fullName:
              partial.fullName !== undefined
                ? normalizeProfileName(partial.fullName) || state.profile.fullName
                : state.profile.fullName,
          },
          linkedPhoneNumbers:
            typeof partial.phone === 'string' &&
            partial.phone.trim() &&
            !state.linkedPhoneNumbers.includes(partial.phone.trim())
              ? [partial.phone.trim(), ...state.linkedPhoneNumbers]
              : state.linkedPhoneNumbers,
        }));
      },

      setProfileAvatar: (avatarUrl) => {
        set((state) => ({
          profile: {
            ...state.profile,
            avatarUrl,
          },
        }));
      },

      updatePreferences: (partial) => {
        set((state) => ({
          preferences: {
            ...state.preferences,
            ...partial,
          },
        }));
      },

      addNotification: (item) => {
        set((state) => ({
          notifications: state.preferences.notificationsEnabled
            ? [
                {
                  id: createId('notif'),
                  type: item.type,
                  title: item.title,
                  message: item.message,
                  actionPath: item.actionPath,
                  createdAt: nowIso(),
                  read: item.read ?? false,
                },
                ...state.notifications,
              ]
            : state.notifications,
        }));
      },

      markNotificationRead: (id) => {
        set((state) => ({
          notifications: state.notifications.map((item) =>
            item.id === id ? { ...item, read: true } : item
          ),
        }));
      },

      markAllNotificationsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((item) => ({ ...item, read: true })),
        }));
      },

      removeNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((item) => item.id !== id),
        }));
      },

      createDispute: (payload) => {
        const createdAt = nowIso();
        const dispute: DisputeRecord = {
          id: payload.id ?? createId('dispute'),
          title: payload.title,
          description: payload.description,
          type: payload.type,
          status: 'open',
          groupName: payload.groupName,
          createdAt,
          updatedAt: createdAt,
        };

        set((state) => ({
          disputes: [dispute, ...state.disputes],
          notifications: state.preferences.notificationsEnabled
            ? [
                {
                  id: createId('notif'),
                  type: 'dispute_update',
                  title: 'Dispute Submitted',
                  message: `${dispute.title} is now under review.`,
                  createdAt,
                  read: false,
                  actionPath: '/components/disputes',
                },
                ...state.notifications,
              ]
            : state.notifications,
        }));
      },

      updateDisputeStatus: (id, status, resolutionNote) => {
        const updatedAt = nowIso();
        set((state) => {
          let title = '';
          const nextDisputes = state.disputes.map((dispute) => {
            if (dispute.id !== id) return dispute;
            title = dispute.title;
            return {
              ...dispute,
              status,
              updatedAt,
              resolutionNote: resolutionNote ?? dispute.resolutionNote,
            };
          });

          if (!title) return { disputes: state.disputes };
          return {
            disputes: nextDisputes,
            notifications: state.preferences.notificationsEnabled
              ? [
                  {
                    id: createId('notif'),
                    type: 'dispute_update',
                    title: 'Dispute Status Updated',
                    message: `"${title}" is now ${status.replace('_', ' ')}.`,
                    createdAt: updatedAt,
                    read: false,
                    actionPath: '/components/disputes',
                  },
                  ...state.notifications,
                ]
              : state.notifications,
          };
        });
      },

      linkPhoneNumber: (phone, network) => {
        const normalized = phone.trim();
        if (!normalized) return { ok: false, message: 'Phone number is required.' };

        const state = get();
        if (network) {
          const duplicate = state.linkedMobileMoneyAccounts.some(
            (item) => item.phone === normalized && item.network === network
          );
          if (duplicate) {
            return { ok: false, message: 'This number is already linked to that mobile money network.' };
          }

          const account: LinkedMobileMoneyRecord = {
            id: createId('momo'),
            network,
            phone: normalized,
            createdAt: nowIso(),
          };

          set((current) => ({
            linkedPhoneNumbers: current.linkedPhoneNumbers.includes(normalized)
              ? current.linkedPhoneNumbers
              : [normalized, ...current.linkedPhoneNumbers],
            linkedMobileMoneyAccounts: [account, ...current.linkedMobileMoneyAccounts],
          }));
          return { ok: true };
        }

        if (state.linkedPhoneNumbers.includes(normalized)) {
          return { ok: false, message: 'Phone number is already linked.' };
        }

        set((current) => ({
          linkedPhoneNumbers: [normalized, ...current.linkedPhoneNumbers],
        }));
        return { ok: true };
      },

      unlinkPhoneNumber: (phone, network) => {
        set((state) => {
          const nextMobileMoneyAccounts = network
            ? state.linkedMobileMoneyAccounts.filter((item) => !(item.phone === phone && item.network === network))
            : state.linkedMobileMoneyAccounts.filter((item) => item.phone !== phone);
          const stillUsed = nextMobileMoneyAccounts.some((item) => item.phone === phone);
          return {
            linkedMobileMoneyAccounts: nextMobileMoneyAccounts,
            linkedPhoneNumbers: stillUsed
              ? state.linkedPhoneNumbers
              : state.linkedPhoneNumbers.filter((item) => item !== phone),
          };
        });
      },

      linkBankAccount: ({ bankName, accountName, accountNumber }) => {
        const sanitizedBankName = bankName.trim();
        const sanitizedAccountName = accountName.trim();
        const digits = accountNumber.replace(/\D/g, '');

        if (!sanitizedBankName || !sanitizedAccountName || digits.length < 6) {
          return { ok: false, message: 'Provide valid bank name, account name, and account number.' };
        }

        const mask = `${digits.slice(0, 2)}******${digits.slice(-2)}`;
        const state = get();
        const duplicate = state.linkedBankAccounts.some(
          (item) => item.bankName.toLowerCase() === sanitizedBankName.toLowerCase() &&
            item.accountNumberMasked === mask
        );
        if (duplicate) return { ok: false, message: 'Bank account is already linked.' };

        const record: LinkedBankAccountRecord = {
          id: createId('bank'),
          bankName: sanitizedBankName,
          accountName: sanitizedAccountName,
          accountNumberMasked: mask,
          createdAt: nowIso(),
        };

        set((current) => ({
          linkedBankAccounts: [record, ...current.linkedBankAccounts],
        }));
        return { ok: true };
      },

      unlinkBankAccount: (id) => {
        set((state) => ({
          linkedBankAccounts: state.linkedBankAccounts.filter((item) => item.id !== id),
        }));
      },
    }),
    {
      name: 'miosusu-app-data-v1',
      version: 3,
      storage: createJSONStorage(() => secureJsonStorage),
      migrate: (persistedState) => {
        const state = persistedState as Partial<AppDataState> | undefined;
        return {
          ...state,
          profile: state?.profile ?? buildDefaultProfile(),
          preferences: state?.preferences ?? defaultPreferences,
          notifications: [],
          receipts: [],
          savingsGoals: [],
          vaultTransactions: [],
          disputes: [],
          linkedPhoneNumbers: Array.isArray(state?.linkedPhoneNumbers) ? state.linkedPhoneNumbers : [],
          linkedMobileMoneyAccounts: Array.isArray(state?.linkedMobileMoneyAccounts)
            ? state.linkedMobileMoneyAccounts
            : [],
          linkedBankAccounts: Array.isArray(state?.linkedBankAccounts) ? state.linkedBankAccounts : [],
        };
      },
      partialize: (state) => ({
        initializedUserId: state.initializedUserId,
        profile: state.profile,
        preferences: state.preferences,
        notifications: state.notifications,
        receipts: state.receipts,
        savingsGoals: state.savingsGoals,
        vaultTransactions: state.vaultTransactions,
        disputes: state.disputes,
        linkedPhoneNumbers: state.linkedPhoneNumbers,
        linkedMobileMoneyAccounts: state.linkedMobileMoneyAccounts,
        linkedBankAccounts: state.linkedBankAccounts,
      }),
    }
  )
);
