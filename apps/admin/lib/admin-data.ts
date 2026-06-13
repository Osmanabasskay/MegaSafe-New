import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServiceClient } from './supabase/service';
import type {
  AdminActivity,
  AdminUser,
  AuditLogRow,
  CollectorMonitorRow,
  CommissionRow,
  CountryBreakdownPoint,
  DashboardKpis,
  DisputeRow,
  GroupMonitorRow,
  KycApplicationRow,
  KycQueueItem,
  MobileMoneyTxRow,
  OsusuContributionRow,
  RateLimitEventRow,
  SavingsGoalRow,
  SavingsTransactionRow,
  SecuritySummary,
  SendPaymentIntentRow,
  SendPaymentMonitorSummary,
  SendPaymentRiskEventRow,
  TimeSeriesPoint,
  VaultAccountRow,
  VaultSummary,
  VaultTopupRow,
  VaultTransactionRow,
  WebhookEventRow,
  WithdrawalRow,
} from './types';
import { createSupabaseServerClient } from './supabase/server';

// ─── Auth context ──────────────────────────────────────────────────────────────

interface AdminCtx {
  userId: string;
  userName: string;
  svc: ReturnType<typeof createServiceClient>;
}

/**
 * Verify super admin from the DATABASE on every request.
 *
 * - Role source is `user_roles` (the authoritative table used across the whole
 *   backend — see supabase/prompt8/prompt9), NOT `profiles.role` and NOT any JWT
 *   metadata, which can be stale for up to 60 min after a role change.
 * - Wrapped in React `cache()` so that the layout AND every server data function
 *   that calls it during a single render share ONE getUser() + ONE role lookup.
 *   This removes the duplicated auth checks that previously fired getUser() once
 *   per nested data function on a single page load.
 *
 * Session refresh is handled exclusively by middleware; here getUser() simply
 * revalidates the already-fresh token. We never call getSession()/refreshSession().
 */
export const requireSuperAdmin = cache(async (): Promise<AdminCtx> => {
  const anonClient = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await anonClient.auth.getUser();

  // A corrupt/used refresh token surfaces here only if middleware was bypassed;
  // middleware normally clears the cookies and redirects first.
  if (error || !user) redirect('/login?reason=session_expired');

  const svc = createServiceClient();
  const [{ data: roleRow }, { data: profile }] = await Promise.all([
    svc
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'super_admin')
      .maybeSingle(),
    svc
      .from('profiles')
      .select('status, is_active, full_name, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle(),
  ]);

  if (!roleRow) redirect('/login?reason=insufficient_role');
  if (
    profile?.is_active === false ||
    profile?.status === 'suspended' ||
    profile?.status === 'banned'
  )
    redirect('/login?reason=account_suspended');

  const userName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    String(profile?.full_name ?? '') ||
    'Super Admin';

  return { userId: user.id, userName, svc };
});

// ─── Date helpers ──────────────────────────────────────────────────────────────

const groupByDay = (
  rows: Array<Record<string, unknown>>,
  getValue?: (row: Record<string, unknown>) => number
): TimeSeriesPoint[] => {
  const acc: Record<string, number> = {};
  for (const row of rows) {
    const ts = String(row.created_at ?? row.requested_at ?? '');
    if (!ts) continue;
    const day = ts.slice(0, 10);
    acc[day] = (acc[day] ?? 0) + (getValue ? getValue(row) : 1);
  }
  return Object.entries(acc)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

// ─── Dashboard ─────────────────────────────────────────────────────────────────

export const getDashboardKpis = async (): Promise<{
  kpis: DashboardKpis;
  userGrowth: TimeSeriesPoint[];
  topupVolume: TimeSeriesPoint[];
  contributionVolume: TimeSeriesPoint[];
  countryBreakdown: CountryBreakdownPoint[];
  recentActivity: AdminActivity[];
}> => {
  const { svc } = await requireSuperAdmin();
  const ago30 = daysAgo(30);
  const ago1 = hoursAgo(24);

  const [
    totalUsersRes,
    newTodayRes,
    pendingKycRes,
    activeGroupsRes,
    totalGroupsRes,
    openDisputesRes,
    underReviewDisputesRes,
    pendingWithdrawalsRes,
    paidCommissionsRes,
    savingsBalanceRes,
    failedTopupsRes,
    failedPaymentsRes,
    rateLimitRes,
    topupsLast30Res,
    profilesLast30Res,
    contributionsLast30Res,
    activityRes,
    countriesRes,
  ] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', daysAgo(0)),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'submitted'),
    svc.from('osusu_groups').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    svc.from('osusu_groups').select('id', { count: 'exact', head: true }),
    svc.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'under_review'),
    svc.from('withdrawal_requests').select('id,amount').eq('status', 'pending'),
    svc.from('commissions').select('commission_amount').eq('status', 'paid'),
    svc.from('savings_goals').select('current_amount').eq('is_active', true),
    svc.from('vault_topups').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', ago1),
    svc.from('mobile_money_transactions').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', ago1),
    svc.from('rate_limit_log').select('id', { count: 'exact', head: true }).gte('created_at', ago1),
    svc.from('vault_topups').select('amount,created_at').eq('status', 'completed').gte('created_at', ago30).order('created_at'),
    svc.from('profiles').select('created_at').gte('created_at', ago30).order('created_at'),
    svc.from('contribution_payments').select('amount,created_at').eq('status', 'approved').gte('created_at', ago30).order('created_at'),
    svc.from('audit_logs').select('id,action,table_name,created_at,actor_id').order('created_at', { ascending: false }).limit(20),
    svc.from('profiles').select('country_id').not('country_id', 'is', null).limit(500),
  ]);

  const pendingWithdrawalsAmount = (pendingWithdrawalsRes.data ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0
  );
  const totalCommissionsNLe = (paidCommissionsRes.data ?? []).reduce(
    (s, r) => s + Number(r.commission_amount ?? 0),
    0
  );
  const totalSavingsNLe = (savingsBalanceRes.data ?? []).reduce(
    (s, r) => s + Number(r.current_amount ?? 0),
    0
  );
  const topupsLast30NLe = (topupsLast30Res.data ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0
  );

  const countryAcc = new Map<string, number>();
  for (const row of countriesRes.data ?? []) {
    const k = String(row.country_id ?? 'Unknown');
    countryAcc.set(k, (countryAcc.get(k) ?? 0) + 1);
  }

  return {
    kpis: {
      users: {
        total: totalUsersRes.count ?? 0,
        newToday: newTodayRes.count ?? 0,
        pendingKyc: pendingKycRes.count ?? 0,
      },
      groups: { active: activeGroupsRes.count ?? 0, total: totalGroupsRes.count ?? 0 },
      disputes: {
        open: openDisputesRes.count ?? 0,
        underReview: underReviewDisputesRes.count ?? 0,
      },
      withdrawals: {
        pendingCount: pendingWithdrawalsRes.data?.length ?? 0,
        pendingAmountNLe: pendingWithdrawalsAmount,
      },
      revenue: { totalCommissionsNLe },
      savings: { totalBalanceNLe: totalSavingsNLe },
      vault: { topups30DaysNLe: topupsLast30NLe },
      risk: {
        failedTopups24h: failedTopupsRes.count ?? 0,
        rateLimitEvents24h: rateLimitRes.count ?? 0,
        failedPayments24h: failedPaymentsRes.count ?? 0,
      },
    },
    userGrowth: groupByDay(
      (profilesLast30Res.data ?? []) as Array<Record<string, unknown>>
    ),
    topupVolume: groupByDay(
      (topupsLast30Res.data ?? []) as Array<Record<string, unknown>>,
      (r) => Number(r.amount ?? 0)
    ),
    contributionVolume: groupByDay(
      (contributionsLast30Res.data ?? []) as Array<Record<string, unknown>>,
      (r) => Number(r.amount ?? 0)
    ),
    countryBreakdown: Array.from(countryAcc.entries()).map(([country, value]) => ({
      country,
      value,
    })),
    recentActivity: (activityRes.data ?? []).map((r) => ({
      id: String(r.id),
      actorName: r.actor_id ? `User ${String(r.actor_id).slice(0, 8)}` : 'System',
      action: String(r.action ?? ''),
      tableName: String(r.table_name ?? ''),
      createdAt: String(r.created_at ?? ''),
    })),
  };
};

// kept for backward compatibility with older pages
export const getDashboardSummary = getDashboardKpis;

// ─── Users ─────────────────────────────────────────────────────────────────────

export const getUsers = async (filters?: {
  search?: string;
  kycStatus?: string;
  role?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ users: AdminUser[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = filters?.pageSize ?? 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('profiles')
    .select('id,first_name,last_name,phone,email,kyc_status,role,status,is_active,created_at,country_id', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.kycStatus) query = query.eq('kyc_status', filters.kycStatus);
  if (filters?.role) query = query.eq('role', filters.role);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.search) {
    query = query.or(
      `full_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    );
  }

  const { data, count } = await query;

  return {
    users: (data ?? []).map((r) => ({
      id: String(r.id),
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed User',
      phone: r.phone ?? '-',
      email: r.email ?? '-',
      country: String(r.country_id ?? 'Sierra Leone'),
      kycStatus: (r.kyc_status ?? 'pending') as AdminUser['kycStatus'],
      role: (r.role ?? 'member') as AdminUser['role'],
      status: (r.status ?? 'active') as AdminUser['status'],
      isActive: r.is_active !== false,
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
  };
};

export const getUserDetail = async (
  userId: string
): Promise<{
  user: AdminUser;
  guarantor: { name: string; phone: string; relationship: string } | null;
  groups: Array<{ id: string; name: string; status: string }>;
  payments: Array<{ id: string; amount: number; createdAt: string; status: string }>;
  vaultTopups: Array<{ id: string; amount: number; status: string; provider: string; createdAt: string }>;
  savingsGoals: Array<{ id: string; title: string; currentAmount: number; targetAmount: number; status: string }>;
  audit: AuditLogRow[];
}> => {
  const { svc } = await requireSuperAdmin();

  const [
    profileRes,
    guarantorRes,
    groupsRes,
    paymentsRes,
    vaultTopupsRes,
    savingsRes,
    auditRes,
  ] = await Promise.all([
    svc.from('profiles').select('id,first_name,last_name,phone,email,kyc_status,role,status,is_active,created_at,country_id').eq('id', userId).maybeSingle(),
    svc.from('guarantors').select('name,phone,relationship').eq('member_id', userId).limit(1).maybeSingle(),
    svc.from('osusu_group_members').select('group_id,is_active,osusu_groups(name,status)').eq('user_id', userId).limit(50),
    svc.from('contribution_payments').select('id,amount,status,created_at').eq('member_id', userId).order('created_at', { ascending: false }).limit(20),
    svc.from('vault_topups').select('id,amount,status,provider,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    svc.from('savings_goals').select('id,title,current_amount,target_amount,status').eq('user_id', userId).limit(10),
    svc.from('audit_logs').select('id,actor_id,action,table_name,record_id,ip_address,created_at').eq('actor_id', userId).order('created_at', { ascending: false }).limit(20),
  ]);

  const p = profileRes.data;
  const user: AdminUser = p
    ? {
        id: String(p.id),
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown User',
        phone: p.phone ?? '-',
        email: p.email ?? '-',
        country: String(p.country_id ?? 'Sierra Leone'),
        kycStatus: (p.kyc_status ?? 'pending') as AdminUser['kycStatus'],
        role: (p.role ?? 'member') as AdminUser['role'],
        status: (p.status ?? 'active') as AdminUser['status'],
        isActive: p.is_active !== false,
        createdAt: String(p.created_at ?? ''),
      }
    : {
        id: userId,
        name: 'Unknown User',
        phone: '-',
        email: '-',
        country: 'Sierra Leone',
        kycStatus: 'pending',
        role: 'member',
        status: 'active',
        isActive: true,
        createdAt: new Date().toISOString(),
      };

  return {
    user,
    guarantor: guarantorRes.data
      ? {
          name: String(guarantorRes.data.name ?? '-'),
          phone: String(guarantorRes.data.phone ?? '-'),
          relationship: String(guarantorRes.data.relationship ?? '-'),
        }
      : null,
    groups: (groupsRes.data ?? []).map((r) => ({
      id: String(r.group_id),
      name: String((r.osusu_groups as { name?: string } | null)?.name ?? 'Unnamed Group'),
      status: r.is_active ? 'active' : 'removed',
    })),
    payments: (paymentsRes.data ?? []).map((r) => ({
      id: String(r.id),
      amount: Number(r.amount ?? 0),
      createdAt: String(r.created_at ?? ''),
      status: String(r.status ?? ''),
    })),
    vaultTopups: (vaultTopupsRes.data ?? []).map((r) => ({
      id: String(r.id),
      amount: Number(r.amount ?? 0),
      status: String(r.status ?? ''),
      provider: String(r.provider ?? ''),
      createdAt: String(r.created_at ?? ''),
    })),
    savingsGoals: (savingsRes.data ?? []).map((r) => ({
      id: String(r.id),
      title: String(r.title ?? 'Untitled'),
      currentAmount: Number(r.current_amount ?? 0),
      targetAmount: Number(r.target_amount ?? 0),
      status: String(r.status ?? 'active'),
    })),
    audit: (auditRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: r.actor_id ? String(r.actor_id) : null,
      actor: r.actor_id ? `User ${String(r.actor_id).slice(0, 8)}` : 'System',
      action: String(r.action ?? ''),
      tableName: String(r.table_name ?? ''),
      recordId: r.record_id ? String(r.record_id) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      createdAt: String(r.created_at ?? ''),
    })),
  };
};

// ─── KYC ─────────────────────────────────────────────────────────────────────

export const getKycQueue = async (): Promise<KycQueueItem[]> => {
  const { svc } = await requireSuperAdmin();

  const { data } = await svc
    .from('kyc_applications')
    .select(
      'id,user_id,full_name,first_name,last_name,status,submitted_at,ai_verification_status,ai_verification_reason_code,suspicious_flags,manual_review_reason,kyc_documents(document_kind,storage_path)'
    )
    .in('status', ['pending', 'verification_processing', 'under_review', 'manual_review'])
    .order('submitted_at', { ascending: true })
    .limit(200);

  if (!data || data.length === 0) return [];

  const signUrl = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const { data: signed } = await svc.storage
      .from('kyc-documents')
      .createSignedUrl(path, 60 * 10);
    return signed?.signedUrl ?? null;
  };

  return Promise.all(
    data.map(async (r) => {
      const docs = Array.isArray(r.kyc_documents)
        ? (r.kyc_documents as Array<{ document_kind?: string; storage_path?: string }>)
        : [];
      const docPath = (kind: string) =>
        docs.find((d) => d.document_kind === kind)?.storage_path ?? null;
      return {
        applicationId: String(r.id),
        userId: String(r.user_id),
        userName:
          [r.first_name, r.last_name].filter(Boolean).join(' ') ||
          String(r.full_name ?? 'Unknown User'),
        idFrontUrl: await signUrl(docPath('id_front')),
        idBackUrl: await signUrl(docPath('id_back')),
        selfieUrl: await signUrl(docPath('selfie')),
        submittedAt: String(r.submitted_at ?? ''),
        kycStatus: String(r.status ?? 'pending'),
        aiStatus: String(r.ai_verification_status ?? 'not_started'),
        reasonCode: r.ai_verification_reason_code ? String(r.ai_verification_reason_code) : null,
        suspiciousFlags: Array.isArray(r.suspicious_flags) ? r.suspicious_flags.map(String) : [],
        manualReviewReason: r.manual_review_reason ? String(r.manual_review_reason) : null,
      };
    })
  );
};

export const getKycApplications = async (filters?: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ applications: KycApplicationRow[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = filters?.pageSize ?? 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('kyc_applications')
    .select(
      'id,user_id,full_name,first_name,last_name,phone_number,status,ai_verification_status,ai_verification_reason_code,suspicious_flags,document_type,national_id_number,submitted_at,reviewed_at,rejection_reason',
      { count: 'exact' }
    )
    .order('submitted_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.status) query = query.eq('status', filters.status);

  const { data, count } = await query;

  return {
    applications: (data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      fullName:
        [r.first_name, r.last_name].filter(Boolean).join(' ') ||
        String(r.full_name ?? 'Unknown'),
      phone: String(r.phone_number ?? '-'),
      status: String(r.status ?? ''),
      aiStatus: String(r.ai_verification_status ?? 'not_started'),
      reasonCode: r.ai_verification_reason_code ? String(r.ai_verification_reason_code) : null,
      suspiciousFlags: Array.isArray(r.suspicious_flags) ? r.suspicious_flags.map(String) : [],
      documentType: String(r.document_type ?? '-'),
      nationalIdNumber: String(r.national_id_number ?? '-'),
      submittedAt: String(r.submitted_at ?? ''),
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
    })),
    total: count ?? 0,
  };
};

export interface KycSignals {
  counts: { pending: number; submitted: number; approved: number; rejected: number; manualReview: number; retakeRequired: number };
  duplicatePhones: Array<{ phone: string; count: number }>;
  duplicateDocuments: Array<{ checksum: string; count: number; distinctUsers: number }>;
  underageCount: number;
  missingDataCount: number;
}

/** KYC fraud signals (Phase 7) — derived from live data + detection views. */
export const getKycSignals = async (): Promise<KycSignals> => {
  const { svc } = await requireSuperAdmin();
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

  const [pendingRes, submittedRes, approvedRes, rejectedRes, manualReviewRes, retakeRes, phonesRes, docsRes, underageRes, missingRes] =
    await Promise.all([
      svc.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
      svc.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'submitted'),
      svc.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'approved'),
      svc.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'rejected'),
      svc.from('kyc_applications').select('id', { count: 'exact', head: true }).eq('status', 'manual_review'),
      svc.from('kyc_applications').select('id', { count: 'exact', head: true }).eq('status', 'retake_required'),
      svc.from('v_same_phone_accounts').select('phone,account_count').limit(50),
      svc.from('v_duplicate_kyc_documents').select('checksum,doc_count,distinct_users').limit(50),
      svc.from('profiles').select('id', { count: 'exact', head: true }).gt('date_of_birth', eighteenYearsAgo.toISOString().slice(0, 10)).in('kyc_status', ['submitted', 'pending']),
      svc.from('kyc_applications').select('id', { count: 'exact', head: true }).is('national_id_number', null),
    ]);

  return {
    counts: {
      pending: pendingRes.count ?? 0,
      submitted: submittedRes.count ?? 0,
      approved: approvedRes.count ?? 0,
      rejected: rejectedRes.count ?? 0,
      manualReview: manualReviewRes.count ?? 0,
      retakeRequired: retakeRes.count ?? 0,
    },
    duplicatePhones: (phonesRes.data ?? []).map((r) => ({ phone: String(r.phone), count: Number(r.account_count ?? 0) })),
    duplicateDocuments: (docsRes.data ?? []).map((r) => ({ checksum: String(r.checksum).slice(0, 16), count: Number(r.doc_count ?? 0), distinctUsers: Number(r.distinct_users ?? 0) })),
    underageCount: underageRes.count ?? 0,
    missingDataCount: missingRes.count ?? 0,
  };
};

// ─── Vault ─────────────────────────────────────────────────────────────────────

export const getVaultSummary = async (): Promise<{
  summary: VaultSummary;
  topups: VaultTopupRow[];
  transactions: VaultTransactionRow[];
  accounts: VaultAccountRow[];
}> => {
  const { svc } = await requireSuperAdmin();

  const [accountsRes, topupsRes, txRes] = await Promise.all([
    svc.from('vault_accounts').select('id,user_id,currency,status,created_at').order('created_at', { ascending: false }).limit(200),
    svc.from('vault_topups').select('id,user_id,amount,fee_amount,currency,status,provider,provider_method,phone_number,created_at,completed_at').order('created_at', { ascending: false }).limit(300),
    svc.from('vault_transactions').select('id,vault_id,user_id,type,amount,currency,reference,description,created_at').order('created_at', { ascending: false }).limit(300),
  ]);

  const topupData = topupsRes.data ?? [];
  const completedTopups = topupData.filter((t) => t.status === 'completed');
  const totalTopupsNLe = completedTopups.reduce((s, t) => s + Number(t.amount ?? 0), 0);
  const pendingTopups = topupData.filter((t) => t.status === 'pending').length;
  const failedTopups = topupData.filter((t) => t.status === 'failed').length;

  return {
    summary: {
      totalTopupsNLe,
      totalWithdrawalsNLe: 0,
      netBalanceNLe: totalTopupsNLe,
      pendingTopups,
      failedTopups,
      totalAccounts: accountsRes.data?.length ?? 0,
    },
    topups: topupData.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      amount: Number(r.amount ?? 0),
      feeAmount: Number(r.fee_amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? ''),
      provider: String(r.provider ?? ''),
      providerMethod: r.provider_method ? String(r.provider_method) : null,
      phoneNumber: r.phone_number ? String(r.phone_number) : null,
      createdAt: String(r.created_at ?? ''),
      completedAt: r.completed_at ? String(r.completed_at) : null,
    })),
    transactions: (txRes.data ?? []).map((r) => ({
      id: String(r.id),
      vaultId: String(r.vault_id),
      userId: String(r.user_id),
      type: String(r.type ?? ''),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      reference: r.reference ? String(r.reference) : null,
      description: r.description ? String(r.description) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    accounts: (accountsRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? ''),
      createdAt: String(r.created_at ?? ''),
    })),
  };
};

// ─── Savings ──────────────────────────────────────────────────────────────────

export const getSavingsSummary = async (): Promise<{
  goals: SavingsGoalRow[];
  transactions: SavingsTransactionRow[];
  totalBalanceNLe: number;
  activeGoalsCount: number;
  completedGoalsCount: number;
}> => {
  const { svc } = await requireSuperAdmin();

  const [goalsRes, txRes] = await Promise.all([
    svc.from('savings_goals').select('id,user_id,title,target_amount,current_amount,currency,status,is_active,completed_at,created_at,category').order('created_at', { ascending: false }).limit(300),
    svc.from('savings_transactions').select('id,goal_id,user_id,type,amount,currency,reference,note,created_at').order('created_at', { ascending: false }).limit(300),
  ]);

  const goalsData = goalsRes.data ?? [];
  const totalBalance = goalsData.filter((g) => g.is_active).reduce((s, g) => s + Number(g.current_amount ?? 0), 0);
  const activeCount = goalsData.filter((g) => g.is_active).length;
  const completedCount = goalsData.filter((g) => !g.is_active && g.completed_at).length;

  return {
    goals: goalsData.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      title: String(r.title ?? 'Untitled'),
      targetAmount: Number(r.target_amount ?? 0),
      currentAmount: Number(r.current_amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? 'active'),
      isActive: r.is_active !== false,
      completedAt: r.completed_at ? String(r.completed_at) : null,
      createdAt: String(r.created_at ?? ''),
      category: r.category ? String(r.category) : null,
    })),
    transactions: (txRes.data ?? []).map((r) => ({
      id: String(r.id),
      goalId: String(r.goal_id),
      userId: String(r.user_id),
      type: String(r.type ?? ''),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      reference: r.reference ? String(r.reference) : null,
      note: r.note ? String(r.note) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    totalBalanceNLe: totalBalance,
    activeGoalsCount: activeCount,
    completedGoalsCount: completedCount,
  };
};

// ─── Payments ─────────────────────────────────────────────────────────────────

export const getPaymentsSummary = async (filters?: {
  provider?: string;
  status?: string;
  page?: number;
}): Promise<{
  mobileMoneyTxs: MobileMoneyTxRow[];
  webhookEvents: WebhookEventRow[];
  sendMonitor: SendPaymentMonitorSummary;
  sendIntents: SendPaymentIntentRow[];
  sendRiskEvents: SendPaymentRiskEventRow[];
  total: number;
}> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const ago24 = hoursAgo(24);

  let mmQuery = svc
    .from('mobile_money_transactions')
    .select('id,user_id,provider,provider_reference,direction,amount,currency,status,phone_number,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.provider) mmQuery = mmQuery.eq('provider', filters.provider);
  if (filters?.status) mmQuery = mmQuery.eq('status', filters.status);

  const [
    mmRes,
    webhookRes,
    pendingIntentsRes,
    failedConfirmationsRes,
    duplicateAttemptsRes,
    unauthorizedAttemptsRes,
    webhookFailuresRes,
    suspiciousActivityRes,
    sendIntentRes,
    sendRiskRes,
  ] = await Promise.all([
    mmQuery,
    svc.from('payment_webhook_events').select('id,provider,event_type,session_id,reference,signature_valid,created_at').order('created_at', { ascending: false }).limit(50),
    svc.from('payment_intents').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    svc.from('payment_intents').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('failed_at', ago24),
    svc.from('rate_limit_log').select('id', { count: 'exact', head: true }).in('action', ['create_send_payment_intent', 'confirm_send_payment']).gte('created_at', ago24),
    svc.from('audit_logs').select('id', { count: 'exact', head: true }).in('action', ['payment_intent_unauthorized_target', 'payment_intent_create_rejected']).gte('created_at', ago24),
    svc.from('payment_webhook_events').select('id', { count: 'exact', head: true }).or('signature_valid.eq.false,event_type.ilike.%fail%').gte('created_at', ago24),
    svc.from('audit_logs').select('id', { count: 'exact', head: true }).in('action', ['payment_intent_unauthorized_target', 'payment_intent_create_rejected', 'payment_failed', 'payment_confirmation_unlinked_method', 'payment_intent_unlinked_method', 'payment_intent_expired', 'payment_intent_rate_limited']).gte('created_at', ago24),
    svc
      .from('payment_intents')
      .select('id,user_id,target_type,target_name,amount,currency,method,status,reference,provider_reference,created_at,expires_at')
      .order('created_at', { ascending: false })
      .limit(50),
    svc
      .from('audit_logs')
      .select('id,actor_id,action,table_name,record_id,created_at')
      .in('action', ['payment_intent_created', 'payment_intent_create_rejected', 'payment_intent_unauthorized_target', 'payment_intent_unlinked_method', 'payment_intent_rate_limited', 'payment_provider_confirmation_started', 'payment_succeeded', 'payment_failed', 'payment_confirmation_unlinked_method', 'payment_intent_expired'])
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return {
    mobileMoneyTxs: (mmRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      provider: String(r.provider ?? ''),
      providerReference: r.provider_reference ? String(r.provider_reference) : null,
      direction: String(r.direction ?? ''),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? ''),
      phoneNumber: r.phone_number ? String(r.phone_number) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    webhookEvents: (webhookRes.data ?? []).map((r) => ({
      id: String(r.id),
      provider: String(r.provider ?? ''),
      eventType: String(r.event_type ?? ''),
      sessionId: r.session_id ? String(r.session_id) : null,
      reference: r.reference ? String(r.reference) : null,
      signatureValid: Boolean(r.signature_valid),
      createdAt: String(r.created_at ?? ''),
    })),
    sendMonitor: {
      pendingIntents: pendingIntentsRes.count ?? 0,
      failedConfirmations: failedConfirmationsRes.count ?? 0,
      duplicateIdempotencyAttempts: duplicateAttemptsRes.count ?? 0,
      unauthorizedTargetAttempts: unauthorizedAttemptsRes.count ?? 0,
      providerWebhookFailures: webhookFailuresRes.count ?? 0,
      suspiciousActivity: suspiciousActivityRes.count ?? 0,
    },
    sendIntents: (sendIntentRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      targetType: String(r.target_type ?? ''),
      targetName: String(r.target_name ?? ''),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      method: String(r.method ?? ''),
      status: String(r.status ?? ''),
      reference: r.reference ? String(r.reference) : null,
      providerReference: r.provider_reference ? String(r.provider_reference) : null,
      createdAt: String(r.created_at ?? ''),
      expiresAt: String(r.expires_at ?? ''),
    })),
    sendRiskEvents: (sendRiskRes.data ?? []).map((r) => ({
      id: String(r.id),
      actorId: r.actor_id ? String(r.actor_id) : null,
      action: String(r.action ?? ''),
      tableName: String(r.table_name ?? ''),
      recordId: r.record_id ? String(r.record_id) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    total: mmRes.count ?? 0,
  };
};

// ─── Withdrawals / Payouts ────────────────────────────────────────────────────

export const getWithdrawals = async (filters?: {
  status?: string;
  page?: number;
}): Promise<{ withdrawals: WithdrawalRow[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('withdrawal_requests')
    .select(
      'id,user_id,amount,currency,destination_provider,destination_number,status,requested_at,review_note,reviewed_at,completed_at',
      { count: 'exact' }
    )
    .order('requested_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.status) query = query.eq('status', filters.status);

  const { data, count } = await query;

  return {
    withdrawals: (data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      destinationProvider: String(r.destination_provider ?? ''),
      destinationNumber: maskNumber(String(r.destination_number ?? '')),
      status: String(r.status ?? ''),
      requestedAt: String(r.requested_at ?? ''),
      reviewNote: r.review_note ? String(r.review_note) : null,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
    })),
    total: count ?? 0,
  };
};

const maskNumber = (n: string): string => {
  if (n.length <= 4) return '****';
  return n.slice(0, 3) + '****' + n.slice(-2);
};

// ─── Osusu ─────────────────────────────────────────────────────────────────────

export const getGroupMonitor = async (): Promise<GroupMonitorRow[]> => {
  const { svc } = await requireSuperAdmin();
  const { data } = await svc
    .from('osusu_groups')
    .select('id,name,status,contribution_amount,max_members,created_by')
    .order('created_at', { ascending: false })
    .limit(200);

  if (!data || data.length === 0) return [];

  const groupIds = data.map((r) => String(r.id));
  const { data: memberData } = await svc
    .from('osusu_group_members')
    .select('group_id')
    .in('group_id', groupIds)
    .eq('is_active', true);

  const memberCounts = new Map<string, number>();
  for (const m of memberData ?? []) {
    const k = String(m.group_id);
    memberCounts.set(k, (memberCounts.get(k) ?? 0) + 1);
  }

  return data.map((r) => {
    const members = memberCounts.get(String(r.id)) ?? 0;
    const volumeNLe = Number(r.contribution_amount ?? 0) * Math.max(1, members);
    return {
      id: String(r.id),
      name: String(r.name ?? 'Unnamed Group'),
      creatorName: r.created_by ? `User ${String(r.created_by).slice(0, 8)}` : 'Unknown',
      members,
      volumeNLe,
      status: (r.status ?? 'active') as GroupMonitorRow['status'],
      disputeRate: 0,
      suspicious: volumeNLe > 25_000,
    };
  });
};

export const getOsusuContributions = async (filters?: {
  groupId?: string;
  status?: string;
  page?: number;
}): Promise<{ contributions: OsusuContributionRow[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('contribution_payments')
    .select('id,group_id,member_id,amount,currency,status,payment_method,collected_at,created_at,osusu_groups(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.groupId) query = query.eq('group_id', filters.groupId);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, count } = await query;

  return {
    contributions: (data ?? []).map((r) => ({
      id: String(r.id),
      groupId: String(r.group_id),
      groupName: String((r.osusu_groups as { name?: string } | null)?.name ?? '-'),
      memberId: String(r.member_id),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? ''),
      paymentMethod: r.payment_method ? String(r.payment_method) : null,
      collectedAt: r.collected_at ? String(r.collected_at) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
  };
};

export const getCommissions = async (filters?: {
  status?: string;
  page?: number;
}): Promise<{ commissions: CommissionRow[]; total: number; totalPaidNLe: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('commissions')
    .select('id,collector_id,payment_id,group_id,rate,base_amount,commission_amount,currency,status,paid_at,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.status) query = query.eq('status', filters.status);

  const { data, count } = await query;

  const totalPaidNLe =
    (data ?? []).filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);

  return {
    commissions: (data ?? []).map((r) => ({
      id: String(r.id),
      collectorId: String(r.collector_id),
      paymentId: String(r.payment_id),
      groupId: String(r.group_id),
      rate: Number(r.rate ?? 0),
      baseAmount: Number(r.base_amount ?? 0),
      commissionAmount: Number(r.commission_amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? ''),
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
    totalPaidNLe,
  };
};

// ─── Collectors ───────────────────────────────────────────────────────────────

export const getCollectorMonitor = async (): Promise<CollectorMonitorRow[]> => {
  const { svc } = await requireSuperAdmin();
  const { data } = await svc
    .from('collectors')
    .select('user_id,is_active,display_name,commission_rate')
    .limit(200);

  if (!data || data.length === 0) return [];

  return data.map((r) => ({
    userId: String(r.user_id),
    name: typeof r.display_name === 'string' && r.display_name ? r.display_name : 'Collector',
    dailyCollectionsNLe: 0,
    verificationRate: 0,
    disputeCount: 0,
    unverifiedOlderThan24hNLe: 0,
    status: r.is_active ? 'active' : 'suspended',
    commissionRate: Number(r.commission_rate ?? 0),
  }));
};

// ─── Disputes ─────────────────────────────────────────────────────────────────

export const getDisputes = async (filters?: {
  status?: string;
  category?: string;
  page?: number;
}): Promise<{ disputes: DisputeRow[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('disputes')
    .select('id,group_id,payment_id,complainant_id,accused_user_id,category,title,description,status,priority,resolution_note,created_at,updated_at,resolved_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.category) query = query.eq('category', filters.category);

  const { data, count } = await query;

  return {
    disputes: (data ?? []).map((r) => ({
      id: String(r.id),
      groupId: r.group_id ? String(r.group_id) : null,
      paymentId: r.payment_id ? String(r.payment_id) : null,
      complainantId: String(r.complainant_id ?? ''),
      accusedUserId: r.accused_user_id ? String(r.accused_user_id) : null,
      category: String(r.category ?? ''),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      status: String(r.status ?? ''),
      priority: String(r.priority ?? 'medium'),
      resolutionNote: r.resolution_note ? String(r.resolution_note) : null,
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
      resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    })),
    total: count ?? 0,
  };
};

// ─── Audit Logs ────────────────────────────────────────────────────────────────

export const getAuditRows = async (filters?: {
  userId?: string;
  action?: string;
  tableName?: string;
  from?: string;
  to?: string;
  page?: number;
}): Promise<{ rows: AuditLogRow[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;

  let query = svc
    .from('audit_logs')
    .select('id,actor_id,action,table_name,record_id,ip_address,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters?.userId) query = query.eq('actor_id', filters.userId);
  if (filters?.action) query = query.ilike('action', `%${filters.action}%`);
  if (filters?.tableName) query = query.eq('table_name', filters.tableName);
  if (filters?.from) query = query.gte('created_at', filters.from);
  if (filters?.to) query = query.lte('created_at', filters.to);

  const { data, count } = await query;

  return {
    rows: (data ?? []).map((r) => ({
      id: String(r.id),
      userId: r.actor_id ? String(r.actor_id) : null,
      actor: r.actor_id ? `User ${String(r.actor_id).slice(0, 8)}` : 'System',
      action: String(r.action ?? ''),
      tableName: String(r.table_name ?? ''),
      recordId: r.record_id ? String(r.record_id) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
  };
};

// ─── Security ──────────────────────────────────────────────────────────────────

// ─── Risk intelligence (new RPC-backed) ─────────────────────────────────────

type Json = Record<string, unknown>;

/** Overview intelligence cards (Phase 4) via secure RPC. */
export const getOverviewMetrics = async (): Promise<Json> => {
  const { svc } = await requireSuperAdmin();
  const { data, error } = await svc.rpc('get_super_admin_overview_metrics');
  if (error) {
    console.error('[admin-data] get_super_admin_overview_metrics:', error.message);
    return {};
  }
  return (data ?? {}) as Json;
};

export interface RiskEventRow {
  id: string;
  eventType: string;
  riskScore: number;
  severity: string;
  status: string;
  reason: string | null;
  relatedTable: string | null;
  relatedRecordId: string | null;
  targetUserId: string | null;
  targetName: string | null;
  actorName: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export const getLiveRiskEvents = async (filters?: {
  severity?: string;
  status?: string;
  eventType?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<RiskEventRow[]> => {
  const { svc } = await requireSuperAdmin();
  const { data, error } = await svc.rpc('get_live_risk_events', {
    p_severity: filters?.severity || null,
    p_status: filters?.status || null,
    p_event_type: filters?.eventType || null,
    p_search: filters?.search || null,
    p_from: filters?.from || null,
    p_to: filters?.to || null,
    p_limit: filters?.limit ?? 150,
    p_offset: filters?.offset ?? 0,
  });
  if (error) {
    console.error('[admin-data] get_live_risk_events:', error.message);
    return [];
  }
  return ((data ?? []) as Json[]).map((r) => ({
    id: String(r.id),
    eventType: String(r.event_type ?? ''),
    riskScore: Number(r.risk_score ?? 0),
    severity: String(r.severity ?? 'low'),
    status: String(r.status ?? 'open'),
    reason: r.reason ? String(r.reason) : null,
    relatedTable: r.related_table ? String(r.related_table) : null,
    relatedRecordId: r.related_record_id ? String(r.related_record_id) : null,
    targetUserId: r.target_user_id ? String(r.target_user_id) : null,
    targetName: r.target_name ? String(r.target_name) : null,
    actorName: r.actor_name ? String(r.actor_name) : null,
    createdAt: String(r.created_at ?? ''),
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
  }));
};

export const getUserRiskProfile = async (userId: string): Promise<Json> => {
  const { svc } = await requireSuperAdmin();
  const { data, error } = await svc.rpc('get_user_risk_profile', { p_user_id: userId });
  if (error) {
    console.error('[admin-data] get_user_risk_profile:', error.message);
    return {};
  }
  return (data ?? {}) as Json;
};

export interface FraudCaseRow {
  id: string;
  caseNumber: string;
  title: string;
  severity: string;
  status: string;
  subjectUserId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const getFraudCases = async (filters?: { status?: string; severity?: string }): Promise<{
  cases: FraudCaseRow[];
  counts: Record<string, number>;
}> => {
  const { svc } = await requireSuperAdmin();
  let q = svc
    .from('fraud_cases')
    .select('id,case_number,title,severity,status,subject_user_id,resolution_note,created_at,resolved_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.severity) q = q.eq('severity', filters.severity);
  const { data } = await q;
  const rows = (data ?? []).map((r) => ({
    id: String(r.id),
    caseNumber: String(r.case_number ?? ''),
    title: String(r.title ?? ''),
    severity: String(r.severity ?? 'medium'),
    status: String(r.status ?? 'open'),
    subjectUserId: r.subject_user_id ? String(r.subject_user_id) : null,
    resolutionNote: r.resolution_note ? String(r.resolution_note) : null,
    createdAt: String(r.created_at ?? ''),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
  }));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { cases: rows, counts };
};

export interface SecurityEventRow {
  id: string;
  userId: string | null;
  eventType: string;
  severity: string;
  ipAddress: string | null;
  reason: string | null;
  status: string;
  createdAt: string;
}

export const getSecurityEvents = async (filters?: {
  severity?: string;
  eventType?: string;
  status?: string;
  page?: number;
}): Promise<{ events: SecurityEventRow[]; total: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  let q = svc
    .from('security_events')
    .select('id,user_id,event_type,severity,ip_address,reason,status,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (filters?.severity) q = q.eq('severity', filters.severity);
  if (filters?.eventType) q = q.eq('event_type', filters.eventType);
  if (filters?.status) q = q.eq('status', filters.status);
  const { data, count } = await q;
  return {
    events: (data ?? []).map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      eventType: String(r.event_type ?? ''),
      severity: String(r.severity ?? 'low'),
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      reason: r.reason ? String(r.reason) : null,
      status: String(r.status ?? 'open'),
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
  };
};

export interface LoginAttemptRow {
  id: string;
  userId: string | null;
  email: string | null;
  ipAddress: string | null;
  outcome: string;
  reason: string | null;
  createdAt: string;
}

export const getLoginAttempts = async (filters?: {
  outcome?: string;
  page?: number;
}): Promise<{ attempts: LoginAttemptRow[]; total: number; failed24h: number }> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  let q = svc
    .from('login_attempts')
    .select('id,user_id,email,ip_address,outcome,reason,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);
  if (filters?.outcome) q = q.eq('outcome', filters.outcome);
  const [{ data, count }, failedRes] = await Promise.all([
    q,
    svc.from('login_attempts').select('id', { count: 'exact', head: true }).eq('outcome', 'failed').gte('created_at', hoursAgo(24)),
  ]);
  return {
    attempts: (data ?? []).map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      email: r.email ? String(r.email) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      outcome: String(r.outcome ?? ''),
      reason: r.reason ? String(r.reason) : null,
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
    failed24h: failedRes.count ?? 0,
  };
};

export interface DeviceSessionRow {
  id: string;
  userId: string;
  userName: string;
  deviceName: string | null;
  ipAddress: string | null;
  isTrusted: boolean;
  lastSeenAt: string;
  revokedAt: string | null;
}

export const getDeviceSessions = async (filters?: { page?: number }): Promise<{
  sessions: DeviceSessionRow[];
  total: number;
}> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const { data, count } = await svc
    .from('device_sessions')
    .select('id,user_id,device_name,ip_address,is_trusted,last_seen_at,revoked_at,profiles(first_name,last_name,full_name)', { count: 'exact' })
    .order('last_seen_at', { ascending: false })
    .range(from, from + pageSize - 1);
  return {
    sessions: (data ?? []).map((r) => {
      const p = r.profiles as { first_name?: string; last_name?: string; full_name?: string } | null;
      const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.full_name || 'Unknown User';
      return {
        id: String(r.id),
        userId: String(r.user_id),
        userName: name,
        deviceName: r.device_name ? String(r.device_name) : null,
        ipAddress: r.ip_address ? String(r.ip_address) : null,
        isTrusted: Boolean(r.is_trusted),
        lastSeenAt: String(r.last_seen_at ?? ''),
        revokedAt: r.revoked_at ? String(r.revoked_at) : null,
      };
    }),
    total: count ?? 0,
  };
};

export interface AdminActionRow {
  id: string;
  adminName: string | null;
  action: string;
  targetTable: string | null;
  targetUserId: string | null;
  targetName: string | null;
  reason: string | null;
  status: string;
  riskScore: number;
  ipAddress: string | null;
  createdAt: string;
}

export const getAdminActivity = async (filters?: {
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminActionRow[]> => {
  const { svc } = await requireSuperAdmin();
  const { data, error } = await svc.rpc('get_admin_activity', {
    p_admin_user_id: null,
    p_action: filters?.action || null,
    p_limit: filters?.limit ?? 150,
    p_offset: filters?.offset ?? 0,
  });
  if (error) {
    console.error('[admin-data] get_admin_activity:', error.message);
    return [];
  }
  return ((data ?? []) as Json[]).map((r) => ({
    id: String(r.id),
    adminName: r.admin_name ? String(r.admin_name) : null,
    action: String(r.action ?? ''),
    targetTable: r.target_table ? String(r.target_table) : null,
    targetUserId: r.target_user_id ? String(r.target_user_id) : null,
    targetName: r.target_name ? String(r.target_name) : null,
    reason: r.reason ? String(r.reason) : null,
    status: String(r.status ?? 'success'),
    riskScore: Number(r.risk_score ?? 0),
    ipAddress: r.ip_address ? String(r.ip_address) : null,
    createdAt: String(r.created_at ?? ''),
  }));
};

export const getSystemHealth = async (): Promise<Json> => {
  const { svc } = await requireSuperAdmin();
  const { data, error } = await svc.rpc('get_system_health_summary');
  if (error) {
    console.error('[admin-data] get_system_health_summary:', error.message);
    return { db_connection: 'error', error: error.message };
  }
  return (data ?? {}) as Json;
};

export const getRateLimitEvents = async (filters?: { page?: number }): Promise<{
  events: RateLimitEventRow[];
  total: number;
  last24h: number;
}> => {
  const { svc } = await requireSuperAdmin();
  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const [{ data, count }, last24Res] = await Promise.all([
    svc.from('rate_limit_log').select('id,user_id,ip_address,action,created_at', { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + pageSize - 1),
    svc.from('rate_limit_log').select('id', { count: 'exact', head: true }).gte('created_at', hoursAgo(24)),
  ]);
  return {
    events: (data ?? []).map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      action: String(r.action ?? ''),
      createdAt: String(r.created_at ?? ''),
    })),
    total: count ?? 0,
    last24h: last24Res.count ?? 0,
  };
};

export const getSecuritySummary = async (): Promise<{
  summary: SecuritySummary;
  rateLimitEvents: RateLimitEventRow[];
  recentFailedPayments: VaultTopupRow[];
  highValueWithdrawals: WithdrawalRow[];
}> => {
  const { svc } = await requireSuperAdmin();
  const ago24 = hoursAgo(24);

  const [
    rateLimitCountRes,
    failedKycRes,
    highWithdrawalRes,
    suspendedUsersRes,
    bannedUsersRes,
    rateLimitRowsRes,
    failedTopupsRes,
    highValueWdRes,
  ] = await Promise.all([
    svc.from('rate_limit_log').select('id', { count: 'exact', head: true }).gte('created_at', ago24),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('kyc_status', 'rejected'),
    svc.from('withdrawal_requests').select('id', { count: 'exact', head: true }).gte('amount', 1000),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'banned'),
    svc.from('rate_limit_log').select('id,user_id,ip_address,action,created_at').order('created_at', { ascending: false }).limit(50),
    svc.from('vault_topups').select('id,user_id,amount,fee_amount,currency,status,provider,provider_method,phone_number,created_at,completed_at').eq('status', 'failed').order('created_at', { ascending: false }).limit(20),
    svc.from('withdrawal_requests').select('id,user_id,amount,currency,destination_provider,destination_number,status,requested_at,review_note,reviewed_at,completed_at').gte('amount', 1000).order('requested_at', { ascending: false }).limit(20),
  ]);

  return {
    summary: {
      rateLimitEvents24h: rateLimitCountRes.count ?? 0,
      failedKycAttempts: failedKycRes.count ?? 0,
      highValueWithdrawals: highWithdrawalRes.count ?? 0,
      duplicateWebhooks: 0,
      suspendedUsers: suspendedUsersRes.count ?? 0,
      bannedUsers: bannedUsersRes.count ?? 0,
    },
    rateLimitEvents: (rateLimitRowsRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null,
      action: String(r.action ?? ''),
      createdAt: String(r.created_at ?? ''),
    })),
    recentFailedPayments: (failedTopupsRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      amount: Number(r.amount ?? 0),
      feeAmount: Number(r.fee_amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      status: String(r.status ?? ''),
      provider: String(r.provider ?? ''),
      providerMethod: r.provider_method ? String(r.provider_method) : null,
      phoneNumber: r.phone_number ? String(r.phone_number) : null,
      createdAt: String(r.created_at ?? ''),
      completedAt: r.completed_at ? String(r.completed_at) : null,
    })),
    highValueWithdrawals: (highValueWdRes.data ?? []).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      amount: Number(r.amount ?? 0),
      currency: String(r.currency ?? 'NLe'),
      destinationProvider: String(r.destination_provider ?? ''),
      destinationNumber: maskNumber(String(r.destination_number ?? '')),
      status: String(r.status ?? ''),
      requestedAt: String(r.requested_at ?? ''),
      reviewNote: r.review_note ? String(r.review_note) : null,
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
      completedAt: r.completed_at ? String(r.completed_at) : null,
    })),
  };
};

export const getTransactionVerificationSetting = async (): Promise<{
  required: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}> => {
  const { svc } = await requireSuperAdmin();
  const { data, error } = await svc
    .from('platform_settings')
    .select('value,updated_at,updated_by')
    .eq('key', 'verification_required_for_transactions')
    .maybeSingle();

  if (error) {
    console.error('[admin-data] transaction verification setting:', error.message);
  }

  const rawValue = data?.value as boolean | { enabled?: boolean } | null | undefined;
  const required = typeof rawValue === 'boolean'
    ? rawValue
    : rawValue && typeof rawValue === 'object'
      ? rawValue.enabled !== false
      : true;

  return {
    required,
    updatedAt: data?.updated_at ? String(data.updated_at) : null,
    updatedBy: data?.updated_by ? String(data.updated_by) : null,
  };
};
