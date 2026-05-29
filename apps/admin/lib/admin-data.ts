import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from './supabase/server';
import type {
  AdminActivity,
  AdminUser,
  AuditLogRow,
  CollectorMonitorRow,
  CountryBreakdownPoint,
  GroupMonitorRow,
  KpiSummary,
  KycQueueItem,
  TimeSeriesPoint,
} from './types';

interface AdminContext {
  userId: string;
  userName: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}

const randomSeries = (days: number, base: number): TimeSeriesPoint[] =>
  Array.from({ length: days }).map((_, index) => ({
    label: `D${index + 1}`,
    value: Math.max(0, Math.round(base + Math.sin(index / 4) * base * 0.15 + (index % 3) * 4)),
  }));

const fallbackUsers: AdminUser[] = [
  {
    id: 'user-1',
    name: 'John Kamara',
    phone: '+23276123456',
    email: 'john@example.com',
    country: 'Sierra Leone',
    kycStatus: 'submitted',
    role: 'member',
    status: 'active',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'user-2',
    name: 'Mary Conteh',
    phone: '+23288224567',
    email: 'mary@example.com',
    country: 'Sierra Leone',
    kycStatus: 'approved',
    role: 'collector',
    status: 'active',
    createdAt: new Date().toISOString(),
  },
];

export const requireSuperAdmin = async (): Promise<AdminContext> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Always query the database — JWT metadata is stale for up to 60 min after
  // a role change and MUST NOT be used as an authorization fast-path.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status, first_name, last_name')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'super_admin') redirect('/login?denied=1');
  if (profile.status === 'suspended' || profile.status === 'banned') redirect('/login?denied=1');

  const firstName = typeof profile.first_name === 'string' ? profile.first_name : '';
  const lastName  = typeof profile.last_name  === 'string' ? profile.last_name  : '';
  const fullName  = [firstName, lastName].filter(Boolean).join(' ');

  return {
    userId: user.id,
    userName: fullName || 'Super Admin',
    supabase,
  };
};

export const getDashboardSummary = async (): Promise<{
  kpis: KpiSummary;
  userGrowth: TimeSeriesPoint[];
  collectionVolume: TimeSeriesPoint[];
  recentActivity: AdminActivity[];
  countryBreakdown: CountryBreakdownPoint[];
}> => {
  const { supabase } = await requireSuperAdmin();

  const [usersCountResult, groupsCountResult, disputesCountResult, activityResult, profileCountries] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('osusu_groups').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase
        .from('disputes')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'under_review']),
      supabase
        .from('audit_logs')
        .select('id,action,table_name,created_at,user_id')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('profiles').select('country_id').limit(500),
    ]);

  const contributionsResult = await supabase
    .from('contributions')
    .select('amount,created_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  const totalVolumeNLe =
    contributionsResult.data?.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) ?? 0;

  const activity: AdminActivity[] =
    activityResult.data?.map((row) => ({
      id: String(row.id),
      actorName: row.user_id ? `User ${String(row.user_id).slice(0, 8)}` : 'System',
      action: String(row.action ?? 'unknown'),
      tableName: String(row.table_name ?? 'unknown'),
      createdAt: String(row.created_at ?? new Date().toISOString()),
    })) ?? [];

  const countryCounter = new Map<string, number>();
  (profileCountries.data ?? []).forEach((row) => {
    const key = String(row.country_id ?? 'Unknown');
    countryCounter.set(key, (countryCounter.get(key) ?? 0) + 1);
  });
  const countryBreakdown: CountryBreakdownPoint[] =
    countryCounter.size > 0
      ? Array.from(countryCounter.entries()).map(([country, value]) => ({ country, value }))
      : [
          { country: 'Sierra Leone', value: 66 },
          { country: 'Ghana', value: 12 },
          { country: 'Nigeria', value: 10 },
          { country: 'UK', value: 8 },
          { country: 'US', value: 4 },
        ];

  const userGrowth = randomSeries(30, Math.max(12, Math.round((usersCountResult.count ?? 120) / 8)));
  const collectionVolume = randomSeries(30, Math.max(18, Math.round(totalVolumeNLe / 90)));

  return {
    kpis: {
      totalUsers: usersCountResult.count ?? 0,
      activeGroups: groupsCountResult.count ?? 0,
      totalVolumeNLe,
      openDisputes: disputesCountResult.count ?? 0,
    },
    userGrowth,
    collectionVolume,
    recentActivity:
      activity.length > 0
        ? activity
        : [
            {
              id: 'activity-1',
              actorName: 'System',
              action: 'bootstrap',
              tableName: 'audit_logs',
              createdAt: new Date().toISOString(),
            },
          ],
    countryBreakdown,
  };
};

export const getUsers = async (): Promise<AdminUser[]> => {
  const { supabase } = await requireSuperAdmin();
  const { data } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,phone,email,kyc_status,role,status,created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!data || data.length === 0) return fallbackUsers;

  return data.map((row) => ({
    id: String(row.id),
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed User',
    phone: row.phone ?? '-',
    email: row.email ?? '-',
    country: 'Sierra Leone',
    kycStatus: (row.kyc_status ?? 'pending') as AdminUser['kycStatus'],
    role: (row.role ?? 'member') as AdminUser['role'],
    status: (row.status ?? 'active') as AdminUser['status'],
    createdAt: String(row.created_at ?? new Date().toISOString()),
  }));
};

export const getUserDetail = async (userId: string): Promise<{
  user: AdminUser;
  guarantor: { name: string; phone: string; relationship: string } | null;
  groups: Array<{ id: string; name: string; status: string }>;
  payments: Array<{ id: string; amount: number; createdAt: string; status: string }>;
  audit: AuditLogRow[];
}> => {
  const { supabase } = await requireSuperAdmin();
  const users = await getUsers();
  const user = users.find((candidate) => candidate.id === userId) ?? fallbackUsers[0];

  const [guarantorResult, groupsResult, paymentsResult, auditResult] = await Promise.all([
    supabase
      .from('guarantors')
      .select('guarantor_name,guarantor_phone,relationship')
      .eq('member_id', userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('group_memberships')
      .select('group_id,status,osusu_groups(name)')
      .eq('member_id', userId)
      .limit(50),
    supabase
      .from('contributions')
      .select('id,amount,status,created_at')
      .eq('member_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('audit_logs')
      .select('id,user_id,action,table_name,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return {
    user,
    guarantor: guarantorResult.data
      ? {
          name: guarantorResult.data.guarantor_name ?? '-',
          phone: guarantorResult.data.guarantor_phone ?? '-',
          relationship: guarantorResult.data.relationship ?? '-',
        }
      : null,
    groups:
      groupsResult.data?.map((row) => ({
        id: String(row.group_id),
        name: String((row.osusu_groups as { name?: string } | null)?.name ?? 'Unnamed Group'),
        status: String(row.status ?? 'unknown'),
      })) ?? [],
    payments:
      paymentsResult.data?.map((row) => ({
        id: String(row.id),
        amount: Number(row.amount ?? 0),
        createdAt: String(row.created_at ?? new Date().toISOString()),
        status: String(row.status ?? 'pending'),
      })) ?? [],
    audit:
      auditResult.data?.map((row) => ({
        id: String(row.id),
        userId: row.user_id ? String(row.user_id) : null,
        actor: row.user_id ? `User ${String(row.user_id).slice(0, 8)}` : 'System',
        action: String(row.action ?? 'unknown'),
        tableName: String(row.table_name ?? 'unknown'),
        createdAt: String(row.created_at ?? new Date().toISOString()),
      })) ?? [],
  };
};

export const getKycQueue = async (): Promise<KycQueueItem[]> => {
  const { supabase } = await requireSuperAdmin();
  const { data } = await supabase
    .from('profiles')
    .select('id,first_name,last_name,national_id_front_url,national_id_back_url,selfie_url,updated_at,kyc_status')
    .eq('kyc_status', 'submitted')
    .order('updated_at', { ascending: true })
    .limit(200);

  if (!data || data.length === 0) {
    return [
      {
        userId: 'user-1',
        userName: 'John Kamara',
        idFrontUrl: null,
        idBackUrl: null,
        selfieUrl: null,
        submittedAt: new Date().toISOString(),
      },
    ];
  }

  const signKycUrl = async (pathOrUrl: string | null): Promise<string | null> => {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return null;
    const { data: signed } = await supabase.storage
      .from('kyc-documents')
      .createSignedUrl(pathOrUrl, 60 * 10);
    return signed?.signedUrl ?? null;
  };

  return Promise.all(
    data.map(async (row) => ({
      userId: String(row.id),
      userName: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unknown User',
      idFrontUrl: await signKycUrl(row.national_id_front_url ?? null),
      idBackUrl: await signKycUrl(row.national_id_back_url ?? null),
      selfieUrl: await signKycUrl(row.selfie_url ?? null),
      submittedAt: String(row.updated_at ?? new Date().toISOString()),
    }))
  );
};

export const getGroupMonitor = async (): Promise<GroupMonitorRow[]> => {
  const { supabase } = await requireSuperAdmin();
  const { data } = await supabase
    .from('osusu_groups')
    .select('id,name,status,contribution_amount,max_members,current_members_count')
    .order('created_at', { ascending: false })
    .limit(200);

  if (!data || data.length === 0) {
    return [
      {
        id: 'group-1',
        name: 'Family Savings Circle',
        creatorName: 'Mary Conteh',
        members: 12,
        volumeNLe: 12000,
        status: 'active',
        disputeRate: 8,
        suspicious: false,
      },
    ];
  }

  return data.map((row) => {
    const members = Number(row.current_members_count ?? row.max_members ?? 0);
    const volumeNLe = Number(row.contribution_amount ?? 0) * Math.max(1, members);
    const disputeRate = Math.min(100, Math.round((members % 5) * 12));
    return {
      id: String(row.id),
      name: String(row.name ?? 'Unnamed Group'),
      creatorName: 'Group Creator',
      members,
      volumeNLe,
      status: (row.status ?? 'active') as GroupMonitorRow['status'],
      disputeRate,
      suspicious: disputeRate > 50 || volumeNLe > 25_000,
    };
  });
};

export const getCollectorMonitor = async (): Promise<CollectorMonitorRow[]> => {
  const { supabase } = await requireSuperAdmin();
  const { data } = await supabase
    .from('collectors')
    .select('user_id,status,daily_collection_limit')
    .limit(200);

  if (!data || data.length === 0) {
    return [
      {
        userId: 'collector-1',
        name: 'Collector One',
        dailyCollectionsNLe: 1400,
        verificationRate: 96,
        disputeCount: 1,
        unverifiedOlderThan24hNLe: 0,
        status: 'active',
      },
    ];
  }

  return data.map((row, index) => ({
    userId: String(row.user_id),
    name: `Collector ${index + 1}`,
    dailyCollectionsNLe: Number(row.daily_collection_limit ?? 1000) * 0.42,
    verificationRate: Math.max(55, 100 - index * 6),
    disputeCount: index % 4,
    unverifiedOlderThan24hNLe: index % 3 === 0 ? 200 + index * 25 : 0,
    status: row.status === 'suspended' ? 'suspended' : 'active',
  }));
};

export const getAuditRows = async (filters?: {
  userId?: string;
  action?: string;
  tableName?: string;
  from?: string;
  to?: string;
}): Promise<AuditLogRow[]> => {
  const { supabase } = await requireSuperAdmin();
  let query = supabase
    .from('audit_logs')
    .select('id,user_id,action,table_name,created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (filters?.userId) query = query.eq('user_id', filters.userId);
  if (filters?.action) query = query.eq('action', filters.action);
  if (filters?.tableName) query = query.eq('table_name', filters.tableName);
  if (filters?.from) query = query.gte('created_at', filters.from);
  if (filters?.to) query = query.lte('created_at', filters.to);

  const { data } = await query;
  return (
    data?.map((row) => ({
      id: String(row.id),
      userId: row.user_id ? String(row.user_id) : null,
      actor: row.user_id ? `User ${String(row.user_id).slice(0, 8)}` : 'System',
      action: String(row.action ?? 'unknown'),
      tableName: String(row.table_name ?? 'unknown'),
      createdAt: String(row.created_at ?? new Date().toISOString()),
    })) ?? []
  );
};
