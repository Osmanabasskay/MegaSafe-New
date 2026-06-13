// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface KpiSummary {
  totalUsers: number;
  activeGroups: number;
  totalVolumeNLe: number;
  openDisputes: number;
}

export interface DashboardKpis {
  users: { total: number; newToday: number; pendingKyc: number };
  groups: { active: number; total: number };
  disputes: { open: number; underReview: number };
  withdrawals: { pendingCount: number; pendingAmountNLe: number };
  revenue: { totalCommissionsNLe: number };
  savings: { totalBalanceNLe: number };
  vault: { topups30DaysNLe: number };
  risk: { failedTopups24h: number; rateLimitEvents24h: number; failedPayments24h: number };
}

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface CountryBreakdownPoint {
  country: string;
  value: number;
}

export interface AdminActivity {
  id: string;
  actorName: string;
  action: string;
  tableName: string;
  createdAt: string;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  kycStatus: 'submitted' | 'approved' | 'rejected' | 'pending';
  role: 'super_admin' | 'group_creator' | 'collector' | 'member';
  status: 'active' | 'suspended' | 'banned';
  isActive: boolean;
  createdAt: string;
}

// ─── KYC ─────────────────────────────────────────────────────────────────────

export interface KycQueueItem {
  applicationId: string;
  userId: string;
  userName: string;
  idFrontUrl: string | null;
  idBackUrl: string | null;
  selfieUrl: string | null;
  submittedAt: string;
  kycStatus: string;
  aiStatus: string;
  reasonCode: string | null;
  suspiciousFlags: string[];
  manualReviewReason: string | null;
}

export interface KycApplicationRow {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  status: string;
  aiStatus: string;
  reasonCode: string | null;
  suspiciousFlags: string[];
  documentType: string;
  nationalIdNumber: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

// ─── Vault ────────────────────────────────────────────────────────────────────

export interface VaultTopupRow {
  id: string;
  userId: string;
  amount: number;
  feeAmount: number;
  currency: string;
  status: string;
  provider: string;
  providerMethod: string | null;
  phoneNumber: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface VaultTransactionRow {
  id: string;
  vaultId: string;
  userId: string;
  type: string;
  amount: number;
  currency: string;
  reference: string | null;
  description: string | null;
  createdAt: string;
}

export interface VaultAccountRow {
  id: string;
  userId: string;
  currency: string;
  status: string;
  createdAt: string;
}

export interface VaultSummary {
  totalTopupsNLe: number;
  totalWithdrawalsNLe: number;
  netBalanceNLe: number;
  pendingTopups: number;
  failedTopups: number;
  totalAccounts: number;
}

// ─── Savings ──────────────────────────────────────────────────────────────────

export interface SavingsGoalRow {
  id: string;
  userId: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  status: string;
  isActive: boolean;
  completedAt: string | null;
  createdAt: string;
  category: string | null;
}

export interface SavingsTransactionRow {
  id: string;
  goalId: string;
  userId: string;
  type: string;
  amount: number;
  currency: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface MobileMoneyTxRow {
  id: string;
  userId: string;
  provider: string;
  providerReference: string | null;
  direction: string;
  amount: number;
  currency: string;
  status: string;
  phoneNumber: string | null;
  createdAt: string;
}

export interface WebhookEventRow {
  id: string;
  provider: string;
  eventType: string;
  sessionId: string | null;
  reference: string | null;
  signatureValid: boolean;
  createdAt: string;
}

export interface SendPaymentIntentRow {
  id: string;
  userId: string;
  targetType: string;
  targetName: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reference: string | null;
  providerReference: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface SendPaymentRiskEventRow {
  id: string;
  actorId: string | null;
  action: string;
  tableName: string;
  recordId: string | null;
  createdAt: string;
}

export interface SendPaymentMonitorSummary {
  pendingIntents: number;
  failedConfirmations: number;
  duplicateIdempotencyAttempts: number;
  unauthorizedTargetAttempts: number;
  providerWebhookFailures: number;
  suspiciousActivity: number;
}

// ─── Withdrawals / Payouts ────────────────────────────────────────────────────

export interface WithdrawalRow {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  destinationProvider: string;
  destinationNumber: string;
  status: string;
  requestedAt: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
}

// ─── Osusu ────────────────────────────────────────────────────────────────────

export interface GroupMonitorRow {
  id: string;
  name: string;
  creatorName: string;
  members: number;
  volumeNLe: number;
  status: 'active' | 'paused' | 'disbanded';
  disputeRate: number;
  suspicious: boolean;
}

export interface OsusuContributionRow {
  id: string;
  groupId: string;
  groupName: string;
  memberId: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string | null;
  collectedAt: string | null;
  createdAt: string;
}

export interface CommissionRow {
  id: string;
  collectorId: string;
  paymentId: string;
  groupId: string;
  rate: number;
  baseAmount: number;
  commissionAmount: number;
  currency: string;
  status: string;
  createdAt: string;
}

// ─── Collectors ───────────────────────────────────────────────────────────────

export interface CollectorMonitorRow {
  userId: string;
  name: string;
  dailyCollectionsNLe: number;
  verificationRate: number;
  disputeCount: number;
  unverifiedOlderThan24hNLe: number;
  status: 'active' | 'suspended';
  commissionRate: number;
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

export interface DisputeRow {
  id: string;
  groupId: string | null;
  paymentId: string | null;
  complainantId: string;
  accusedUserId: string | null;
  category: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  userId: string | null;
  actor: string;
  action: string;
  tableName: string;
  recordId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

// ─── Security ─────────────────────────────────────────────────────────────────

export interface RateLimitEventRow {
  id: string;
  userId: string | null;
  ipAddress: string | null;
  action: string;
  createdAt: string;
}

export interface SecuritySummary {
  rateLimitEvents24h: number;
  failedKycAttempts: number;
  highValueWithdrawals: number;
  duplicateWebhooks: number;
  suspendedUsers: number;
  bannedUsers: number;
}
