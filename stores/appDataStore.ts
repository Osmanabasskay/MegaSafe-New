import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  getCredentialDisplayName,
  isPlaceholderProfileName,
  normalizeProfileName,
} from '../lib/profileName';

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
  linkedBankAccounts: LinkedBankAccountRecord[];
  initializeForUser: (user: User | null) => void;
  updateProfile: (partial: Partial<ProfileData>) => void;
  setProfileAvatar: (avatarUrl: string | null) => void;
  updatePreferences: (partial: Partial<PreferencesData>) => void;
  addNotification: (item: Omit<AppNotification, 'id' | 'createdAt' | 'read'> & { read?: boolean }) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  removeNotification: (id: string) => void;
  recordPaymentReceipt: (payload: {
    amount: number;
    groupName: string;
    paymentMethod: string;
    phoneNumber: string;
    status: 'verified' | 'pending' | 'failed';
  }) => ReceiptRecord;
  addVaultTransaction: (payload: Omit<VaultTransactionRecord, 'id' | 'occurredAt'> & { occurredAt?: string }) => void;
  createSavingsGoal: (payload: {
    title: string;
    targetAmount: number;
    targetDate: string;
    category: string;
    autoSaveEnabled?: boolean;
    autoSaveAmount?: number;
    autoSaveInterval?: 'daily' | 'weekly' | 'monthly';
  }) => void;
  addToSavingsGoal: (goalId: string, amount: number) => void;
  runAutoSaveSweep: () => number;
  createDispute: (payload: {
    title: string;
    description: string;
    type: DisputeType;
    groupName: string;
  }) => void;
  updateDisputeStatus: (id: string, status: DisputeStatus, resolutionNote?: string) => void;
  linkPhoneNumber: (phone: string) => { ok: boolean; message?: string };
  unlinkPhoneNumber: (phone: string) => void;
  linkBankAccount: (payload: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  }) => { ok: boolean; message?: string };
  unlinkBankAccount: (id: string) => void;
}

const nowIso = (): string => new Date().toISOString();

const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString(16)}`;

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
  referralCode: `MSF-${Math.floor(100000 + Math.random() * 900000)}`,
});

const defaultPreferences: PreferencesData = {
  notificationsEnabled: true,
  darkMode: false,
  biometricAuth: false,
  twoFactorAuth: false,
};

const seedSavingsGoals = (): SavingsGoalRecord[] => {
  const baseDate = toDateOnly(nowIso());
  return [
    {
      id: createId('goal'),
      title: 'Emergency Fund',
      targetAmount: 5000,
      currentAmount: 800,
      targetDate: addDays(baseDate, 180),
      category: 'Personal',
      contributors: 1,
      status: 'active',
      autoSaveEnabled: true,
      autoSaveAmount: 50,
      autoSaveInterval: 'weekly',
      autoSaveNextDate: addDays(baseDate, 7),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];
};

const seedVaultTransactions = (): VaultTransactionRecord[] => [
  {
    id: createId('txn'),
    type: 'deposit',
    amount: 300,
    description: 'Initial vault deposit',
    status: 'completed',
    occurredAt: nowIso(),
  },
];

const seedNotifications = (): AppNotification[] => [
  {
    id: createId('notif'),
    type: 'system_alert',
    title: 'Welcome to MegaSafe',
    message: 'Your secure savings dashboard is ready.',
    createdAt: nowIso(),
    read: false,
    actionPath: '/(main)/home',
  },
];

const seedDisputes = (): DisputeRecord[] => [];
const seedReceipts = (): ReceiptRecord[] => [];
const seedLinkedPhones = (): string[] => [];
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

      recordPaymentReceipt: (payload) => {
        const paidAt = nowIso();
        const receipt: ReceiptRecord = {
          id: createId('receipt'),
          transactionId: `TXN-${Date.now()}`,
          receiptNumber: `RCP-${Date.now()}`,
          amount: payload.amount,
          groupName: payload.groupName,
          paymentMethod: payload.paymentMethod,
          phoneNumber: payload.phoneNumber,
          paidAt,
          status: payload.status,
        };

        set((state) => ({
          receipts: [receipt, ...state.receipts],
          vaultTransactions: [
            {
              id: createId('txn'),
              type: 'contribution',
              amount: payload.amount,
              description: `Contribution paid to ${payload.groupName}`,
              groupName: payload.groupName,
              status: payload.status === 'failed' ? 'failed' : 'completed',
              occurredAt: paidAt,
            },
            ...state.vaultTransactions,
          ],
          notifications: state.preferences.notificationsEnabled
            ? [
                {
                  id: createId('notif'),
                  type: payload.status === 'failed' ? 'system_alert' : 'payment_received',
                  title: payload.status === 'failed' ? 'Payment Failed' : 'Payment Received',
                  message:
                    payload.status === 'failed'
                      ? `Payment for ${payload.groupName} failed. Please retry.`
                      : `NLe ${payload.amount.toFixed(2)} verified for ${payload.groupName}.`,
                  createdAt: paidAt,
                  read: false,
                  actionPath: '/components/notifications',
                },
                ...state.notifications,
              ]
            : state.notifications,
        }));

        return receipt;
      },

      addVaultTransaction: (payload) => {
        set((state) => ({
          vaultTransactions: [
            {
              ...payload,
              id: createId('txn'),
              occurredAt: payload.occurredAt ?? nowIso(),
            },
            ...state.vaultTransactions,
          ],
        }));
      },

      createSavingsGoal: (payload) => {
        const createdAt = nowIso();
        const autoSaveEnabled = payload.autoSaveEnabled ?? false;
        const autoSaveInterval = payload.autoSaveInterval ?? 'weekly';
        const autoSaveNextDate = autoSaveEnabled
          ? nextIntervalDate(toDateOnly(createdAt), autoSaveInterval)
          : null;

        const goal: SavingsGoalRecord = {
          id: createId('goal'),
          title: payload.title,
          targetAmount: payload.targetAmount,
          currentAmount: 0,
          targetDate: payload.targetDate,
          category: payload.category,
          contributors: 1,
          status: 'active',
          autoSaveEnabled,
          autoSaveAmount: payload.autoSaveAmount ?? 0,
          autoSaveInterval,
          autoSaveNextDate,
          createdAt,
          updatedAt: createdAt,
        };

        set((state) => ({
          savingsGoals: [goal, ...state.savingsGoals],
          notifications: state.preferences.notificationsEnabled
            ? [
                {
                  id: createId('notif'),
                  type: 'savings_update',
                  title: 'New Savings Goal Created',
                  message: `${goal.title} target set at NLe ${goal.targetAmount.toFixed(2)}.`,
                  createdAt,
                  read: false,
                  actionPath: '/(main)/savings',
                },
                ...state.notifications,
              ]
            : state.notifications,
        }));
      },

      addToSavingsGoal: (goalId, amount) => {
        if (!(amount > 0)) return;
        const updatedAt = nowIso();

        set((state) => {
          let updatedGoalTitle = '';
          const nextGoals = state.savingsGoals.map((goal) => {
            if (goal.id !== goalId) return goal;
            const nextAmount = Math.min(goal.currentAmount + amount, goal.targetAmount);
            const status: SavingsGoalStatus =
              nextAmount >= goal.targetAmount ? 'completed' : goal.status;
            updatedGoalTitle = goal.title;
            return {
              ...goal,
              currentAmount: nextAmount,
              status,
              updatedAt,
            };
          });

          if (!updatedGoalTitle) return { savingsGoals: state.savingsGoals };

          return {
            savingsGoals: nextGoals,
            vaultTransactions: [
              {
                id: createId('txn'),
                type: 'deposit',
                amount,
                description: `Added to goal: ${updatedGoalTitle}`,
                status: 'completed',
                occurredAt: updatedAt,
              },
              ...state.vaultTransactions,
            ],
            notifications: state.preferences.notificationsEnabled
              ? [
                  {
                    id: createId('notif'),
                    type: 'savings_update',
                    title: 'Savings Goal Updated',
                    message: `NLe ${amount.toFixed(2)} added to ${updatedGoalTitle}.`,
                    createdAt: updatedAt,
                    read: false,
                    actionPath: '/(main)/savings',
                  },
                  ...state.notifications,
                ]
              : state.notifications,
          };
        });
      },

      runAutoSaveSweep: () => {
        const state = get();
        const today = toDateOnly(nowIso());
        const dueGoals = state.savingsGoals.filter(
          (goal) =>
            goal.autoSaveEnabled &&
            goal.status === 'active' &&
            goal.autoSaveAmount > 0 &&
            goal.autoSaveNextDate !== null &&
            goal.autoSaveNextDate <= today
        );

        if (dueGoals.length === 0) return 0;

        const executionTime = nowIso();
        set((current) => {
          const goalMap = new Map(dueGoals.map((goal) => [goal.id, goal]));

          const nextGoals = current.savingsGoals.map((goal) => {
            const dueGoal = goalMap.get(goal.id);
            if (!dueGoal) return goal;
            const nextAmount = Math.min(goal.currentAmount + goal.autoSaveAmount, goal.targetAmount);
            const status: SavingsGoalStatus =
              nextAmount >= goal.targetAmount ? 'completed' : goal.status;
            return {
              ...goal,
              currentAmount: nextAmount,
              status,
              autoSaveNextDate: nextIntervalDate(today, goal.autoSaveInterval),
              updatedAt: executionTime,
            };
          });

          const autoSaveTransactions = dueGoals.map((goal) => ({
            id: createId('txn'),
            type: 'auto_save' as const,
            amount: goal.autoSaveAmount,
            description: `Auto-save deposit for ${goal.title}`,
            status: 'completed' as const,
            occurredAt: executionTime,
          }));

          const autoSaveNotifications = dueGoals.map((goal) => ({
            id: createId('notif'),
            type: 'savings_update' as const,
            title: 'Auto-Save Executed',
            message: `NLe ${goal.autoSaveAmount.toFixed(2)} auto-saved to ${goal.title}.`,
            createdAt: executionTime,
            read: false,
            actionPath: '/(main)/savings',
          }));

          return {
            savingsGoals: nextGoals,
            vaultTransactions: [...autoSaveTransactions, ...current.vaultTransactions],
            notifications: current.preferences.notificationsEnabled
              ? [...autoSaveNotifications, ...current.notifications]
              : current.notifications,
          };
        });

        return dueGoals.length;
      },

      createDispute: (payload) => {
        const createdAt = nowIso();
        const dispute: DisputeRecord = {
          id: createId('dispute'),
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

      linkPhoneNumber: (phone) => {
        const normalized = phone.trim();
        if (!normalized) return { ok: false, message: 'Phone number is required.' };

        const state = get();
        if (state.linkedPhoneNumbers.includes(normalized)) {
          return { ok: false, message: 'Phone number is already linked.' };
        }

        set((current) => ({
          linkedPhoneNumbers: [normalized, ...current.linkedPhoneNumbers],
        }));
        return { ok: true };
      },

      unlinkPhoneNumber: (phone) => {
        set((state) => ({
          linkedPhoneNumbers: state.linkedPhoneNumbers.filter((item) => item !== phone),
        }));
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
      name: 'megasafe-app-data-v1',
      storage: createJSONStorage(() => AsyncStorage),
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
        linkedBankAccounts: state.linkedBankAccounts,
      }),
    }
  )
);
