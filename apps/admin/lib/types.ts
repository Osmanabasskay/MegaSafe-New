export interface KpiSummary {
  totalUsers: number;
  activeGroups: number;
  totalVolumeNLe: number;
  openDisputes: number;
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

export interface AdminUser {
  id: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  kycStatus: 'submitted' | 'approved' | 'rejected' | 'pending';
  role: 'super_admin' | 'group_creator' | 'collector' | 'member';
  status: 'active' | 'suspended' | 'banned';
  createdAt: string;
}

export interface KycQueueItem {
  userId: string;
  userName: string;
  idFrontUrl: string | null;
  idBackUrl: string | null;
  selfieUrl: string | null;
  submittedAt: string;
}

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

export interface CollectorMonitorRow {
  userId: string;
  name: string;
  dailyCollectionsNLe: number;
  verificationRate: number;
  disputeCount: number;
  unverifiedOlderThan24hNLe: number;
  status: 'active' | 'suspended';
}

export interface AuditLogRow {
  id: string;
  userId: string | null;
  actor: string;
  action: string;
  tableName: string;
  createdAt: string;
}
