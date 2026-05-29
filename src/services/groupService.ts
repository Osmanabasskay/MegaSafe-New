import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseConfigured } from './supabase';
import { uploadFromUri } from './storageUpload';
import { toBackendError } from './backendErrors';
import type {
  ContributorAssignment,
  Frequency,
  GroupConfiguration,
  GroupInviteContact,
  GroupStatus,
  OsusuGroup,
  PayoutOrder,
} from '../types/group';

const LOCAL_GROUPS_KEY = 'megasafe:groups:v1';

export interface CreateGroupInput {
  userId: string;
  name: string;
  description: string | null;
  logoUri?: string | null;
  adminCollectionPhone?: string | null;
  contributionAmount: number;
  frequency: Frequency;
  maxMembers: number;
  cycleStartDate: string;
  totalCycles: number;
  payoutOrder: PayoutOrder;
  isPublic: boolean;
  joinRequiresApproval: boolean;
  customRules: string | null;
  inviteCode?: string;
  contributionNumber?: string;
}

export interface GroupListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  createdBy: string;
  customRules: string | null;
  members: number;
  contributionAmount: number;
  frequency: Frequency;
  role: 'creator' | 'admin' | 'member';
  unreadCount?: number;
  totalCollected: number;
  nextPayout: string;
  lastActivity: string;
  status: GroupStatus;
  adminCollectionPhone: string | null;
  contributionNumber: string | null;
}

export type DeleteGroupOutcome = 'deleted' | 'pending_super_admin';

export interface GroupAdminContact {
  id: string;
  label: string;
  phone: string;
  role: 'creator' | 'admin';
}

export interface GroupMemberSummary {
  id: string;
  userId: string;
  displayName: string;
  phone: string | null;
  payoutPosition: number | null;
  joinedAt: string;
}

export interface GroupContributionSummary {
  id: string;
  memberId: string;
  amount: number;
  contributionPeriod: string;
  collectionMethod: string;
  status: 'pending' | 'collected' | 'verified' | 'disputed' | 'refunded';
  createdAt: string;
  receiptNumber: string | null;
}

export interface MemberContributionCoverage {
  lastContributionPeriod: string | null;
  lastPaidToDate: string | null;
  nextUnpaidDate: string | null;
}

interface ProfileSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

function isFrequency(value: unknown): value is Frequency {
  return value === 'daily' || value === 'weekly' || value === 'biweekly' || value === 'monthly';
}

function isPayoutOrder(value: unknown): value is PayoutOrder {
  return value === 'sequential' || value === 'random' || value === 'custom';
}

function isGroupStatus(value: unknown): value is GroupStatus {
  return (
    value === 'active' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'disbanded' ||
    value === 'pending'
  );
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  return fallback;
}

function createLocalId(prefix: string): string {
  const rand = new Uint16Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    rand[0] = Math.floor(Math.random() * 65536);
  }
  return `local-${prefix}-${Date.now()}-${rand[0]}`;
}

function normalizeGroupRow(row: unknown): OsusuGroup | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;

  const frequencyRaw = record.frequency;
  const payoutRaw = record.payout_order;
  const statusRaw = record.status;

  const frequency = isFrequency(frequencyRaw) ? frequencyRaw : 'weekly';
  const payoutOrder = isPayoutOrder(payoutRaw) ? payoutRaw : 'sequential';
  const status = isGroupStatus(statusRaw) ? statusRaw : 'active';

  return {
    id: asText(record.id, createLocalId('group')),
    created_at: asText(record.created_at, new Date().toISOString()),
    name: asText(record.name, 'Untitled Group'),
    description: typeof record.description === 'string' ? record.description : null,
    avatar_url: typeof record.avatar_url === 'string' ? record.avatar_url : null,
    contribution_amount: asNumber(record.contribution_amount, 0),
    frequency,
    max_members: asNumber(record.max_members, 5),
    cycle_start_date: asText(record.cycle_start_date, new Date().toISOString().slice(0, 10)),
    total_cycles: asNumber(record.total_cycles, asNumber(record.max_members, 5)),
    payout_order: payoutOrder,
    is_public: Boolean(record.is_public),
    join_requires_approval: Boolean(record.join_requires_approval),
    custom_rules: typeof record.custom_rules === 'string' ? record.custom_rules : null,
    status,
    created_by: asText(record.created_by, 'local-user'),
    invite_code: asText(record.invite_code, generateInviteCode()),
    contribution_number: typeof record.contribution_number === 'string' ? record.contribution_number : null,
  };
}

async function loadLocalGroups(): Promise<OsusuGroup[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_GROUPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => normalizeGroupRow(row))
      .filter((row): row is OsusuGroup => row != null);
  } catch {
    return [];
  }
}

async function saveLocalGroups(groups: OsusuGroup[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(groups));
}

async function upsertLocalGroup(group: OsusuGroup): Promise<void> {
  const current = await loadLocalGroups();
  const remaining = current.filter((item) => item.id !== group.id);
  await saveLocalGroups([group, ...remaining]);
}

async function deleteLocalGroup(groupId: string): Promise<void> {
  const current = await loadLocalGroups();
  await saveLocalGroups(current.filter((item) => item.id !== groupId));
}

function addDays(dateString: string, days: number): string {
  const base = new Date(dateString);
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function nextPayoutFromFrequency(cycleStartDate: string, frequency: Frequency): string {
  if (frequency === 'daily') return addDays(cycleStartDate, 1);
  if (frequency === 'weekly') return addDays(cycleStartDate, 7);
  if (frequency === 'biweekly') return addDays(cycleStartDate, 14);
  return addDays(cycleStartDate, 30);
}

function mergeInvites(invites: GroupInviteContact[] | undefined): GroupInviteContact[] {
  if (!Array.isArray(invites)) return [];
  return invites.map((invite) => ({
    name: invite.name ?? '',
    email: invite.email ?? '',
    phone: invite.phone ?? '',
  }));
}

export function parseGroupConfiguration(customRules: string | null): GroupConfiguration {
  if (!customRules) return {};

  try {
    const parsed = JSON.parse(customRules) as Record<string, unknown>;
    return {
      adminCollectionPhone:
        typeof parsed.adminCollectionPhone === 'string' ? parsed.adminCollectionPhone : null,
      invites: mergeInvites(parsed.invites as GroupInviteContact[] | undefined),
      rules:
        parsed.rules && typeof parsed.rules === 'object'
          ? (parsed.rules as Record<string, unknown>)
          : undefined,
      deletionRequest:
        parsed.deletionRequest && typeof parsed.deletionRequest === 'object'
          ? (parsed.deletionRequest as GroupConfiguration['deletionRequest'])
          : undefined,
    };
  } catch {
    return {};
  }
}

export function buildGroupConfiguration(config: GroupConfiguration): string {
  return JSON.stringify({
    adminCollectionPhone: config.adminCollectionPhone ?? null,
    invites: mergeInvites(config.invites),
    rules: config.rules ?? {},
    deletionRequest: config.deletionRequest,
  });
}

function toListItem(group: OsusuGroup): GroupListItem {
  const config = parseGroupConfiguration(group.custom_rules);
  return {
    id: group.id,
    name: group.name,
    avatarUrl: group.avatar_url,
    createdBy: group.created_by,
    customRules: group.custom_rules,
    members: group.max_members,
    contributionAmount: group.contribution_amount,
    frequency: group.frequency,
    role: 'creator',
    totalCollected: 0,
    nextPayout: nextPayoutFromFrequency(group.cycle_start_date, group.frequency),
    lastActivity: new Date(group.created_at).toLocaleDateString(),
    status: group.status,
    adminCollectionPhone: config.adminCollectionPhone ?? null,
    contributionNumber: group.contribution_number,
  };
}

function toListItemWithMemberCount(group: OsusuGroup, memberCount: number | undefined): GroupListItem {
  return {
    ...toListItem(group),
    members: memberCount ?? (group.created_by ? 1 : 0),
  };
}

async function uploadGroupLogo(params: {
  userId: string;
  groupId: string;
  uri: string;
}): Promise<{ publicUrl: string | null; error: Error | null }> {
  const path = `${params.userId}/group-logos/${params.groupId}.jpg`;
  const { error } = await uploadFromUri('avatars', path, params.uri);
  if (error) return { publicUrl: null, error: toBackendError(error, 'Upload group logo') };

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = data.publicUrl;

  // Use RPC to update logo — avoids a direct frontend write path on osusu_groups.
  // The RPC enforces created_by = auth.uid() server-side.
  const { data: rpcData, error: rpcError } = await supabase.rpc('update_group_logo', {
    p_group_id:   params.groupId,
    p_avatar_url: publicUrl,
  });

  if (rpcError) {
    return { publicUrl: null, error: toBackendError(new Error(rpcError.message), 'Save group logo') };
  }

  const rpcResult = rpcData as Record<string, unknown> | null;
  if (rpcResult?.error) {
    return { publicUrl: null, error: toBackendError(new Error(rpcResult.error as string), 'Save group logo') };
  }

  return { publicUrl, error: null };
}

async function fetchProfilesByIds(userIds: string[]): Promise<Map<string, ProfileSummary>> {
  const cleaned = [...new Set(userIds.filter(Boolean))];
  if (cleaned.length === 0 || !supabaseConfigured) return new Map();

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,first_name,last_name,phone,email')
      .in('id', cleaned);

    if (error) throw new Error(error.message);

    return new Map(
      ((data ?? []) as ProfileSummary[]).map((profile) => [profile.id, profile])
    );
  } catch {
    return new Map();
  }
}

async function fetchApprovedMemberCounts(groupIds: string[]): Promise<Map<string, number>> {
  const cleaned = [...new Set(groupIds.filter(Boolean))];
  const counts = new Map<string, number>();
  if (cleaned.length === 0 || !supabaseConfigured) return counts;

  try {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('group_id')
      .in('group_id', cleaned)
      .eq('status', 'approved');

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as Array<{ group_id: string | null }>) {
      if (!row.group_id) continue;
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }
  } catch {
    return counts;
  }

  return counts;
}

export async function listCachedGroupsForUser(userId: string): Promise<GroupListItem[]> {
  const fromLocal = await loadLocalGroups();
  return fromLocal
    .filter((group) => group.created_by === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((group) => ({ ...toListItemWithMemberCount(group, 1), role: 'creator' as const }));
}

function formatProfileName(profile: ProfileSummary | undefined, fallback: string): string {
  if (!profile) return fallback;
  const parts = [profile.first_name, profile.last_name].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0
  );
  if (parts.length > 0) return parts.join(' ');
  if (profile.email) return profile.email;
  if (profile.phone) return profile.phone;
  return fallback;
}

export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Use crypto.getRandomValues for cryptographically secure randomness.
  // Available in React Native (Hermes), Node, and browsers.
  const randomBytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for environments without crypto (should not occur in production)
    for (let i = 0; i < 6; i++) randomBytes[i] = Math.floor(Math.random() * 256);
  }
  let token = '';
  for (let i = 0; i < 6; i += 1) {
    token += alphabet[randomBytes[i]! % alphabet.length];
  }
  return `MSF-${token}`;
}

async function ensureProfileExists(userId: string): Promise<true | Error> {
  if (!supabaseConfigured) return true;

  try {
    const { data: existing, error: selectErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (selectErr) throw new Error(selectErr.message);
    if (existing) return true;

    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData?.session?.user;
    const email = sessionUser?.email ?? null;
    const firstName = (sessionUser?.user_metadata as Record<string, unknown> | undefined)?.first_name;
    const lastName = (sessionUser?.user_metadata as Record<string, unknown> | undefined)?.last_name;

    const { error: insertErr } = await supabase.from('profiles').upsert(
      {
        id: userId,
        email,
        first_name: typeof firstName === 'string' ? firstName : null,
        last_name: typeof lastName === 'string' ? lastName : null,
      },
      { onConflict: 'id' }
    );

    if (insertErr) {
      return toBackendError(
        new Error(insertErr.message),
        'Set up your profile'
      );
    }

    return true;
  } catch (err) {
    return toBackendError(err, 'Verify your profile');
  }
}

// ─── Group CRUD ─────────────────────────────────────────────────────────────

export async function createGroup(input: CreateGroupInput): Promise<{
  group: OsusuGroup | null;
  error: Error | null;
}> {
  const payload = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    contribution_amount: input.contributionAmount,
    frequency: input.frequency,
    max_members: input.maxMembers,
    cycle_start_date: input.cycleStartDate,
    total_cycles: input.totalCycles,
    payout_order: input.payoutOrder,
    is_public: input.isPublic,
    join_requires_approval: input.joinRequiresApproval,
    custom_rules: input.customRules,
    status: 'active' as GroupStatus,
    created_by: input.userId,
    invite_code: input.inviteCode ?? generateInviteCode(),
    contribution_number: input.contributionNumber ?? null,
    avatar_url: null,
  };

  if (!supabaseConfigured) {
    const localGroup: OsusuGroup = {
      id: createLocalId('group'),
      created_at: new Date().toISOString(),
      name: payload.name,
      description: payload.description,
      avatar_url: null,
      contribution_amount: payload.contribution_amount,
      frequency: payload.frequency,
      max_members: payload.max_members,
      cycle_start_date: payload.cycle_start_date,
      total_cycles: payload.total_cycles,
      payout_order: payload.payout_order,
      is_public: payload.is_public,
      join_requires_approval: payload.join_requires_approval,
      custom_rules: payload.custom_rules,
      status: payload.status,
      created_by: payload.created_by,
      invite_code: payload.invite_code,
      contribution_number: payload.contribution_number,
    };

    await upsertLocalGroup(localGroup);
    return { group: localGroup, error: null };
  }

  const profileResult = await ensureProfileExists(input.userId);
  if (profileResult !== true) {
    return { group: null, error: profileResult };
  }

  try {
    // Use SECURITY DEFINER RPC — validates input, creates creator membership,
    // generates server-side invite code, and audits atomically.
    // Direct INSERT is no longer permitted here to prevent bypassing validations.
    const { data: rpcData, error: rpcError } = await supabase.rpc('create_osusu_group', {
      p_name:                   payload.name,
      p_description:            payload.description,
      p_contribution_amount:    payload.contribution_amount,
      p_frequency:              payload.frequency,
      p_max_members:            payload.max_members,
      p_cycle_start_date:       payload.cycle_start_date ?? null,
      p_total_cycles:           payload.total_cycles ?? null,
      p_invite_code:            payload.invite_code ?? null,
      p_join_requires_approval: payload.join_requires_approval ?? false,
    });

    if (rpcError) throw new Error(rpcError.message);

    const result = rpcData as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    const groupId = result.group_id as string;

    // Fetch the full group row for local cache
    const { data: groupRow, error: fetchError } = await supabase
      .from('osusu_groups')
      .select('*')
      .eq('id', groupId)
      .single();

    if (fetchError) throw new Error(fetchError.message);

    let normalized = normalizeGroupRow(groupRow);
    if (!normalized) throw new Error('Group was created but could not be loaded back.');

    if (input.logoUri) {
      const { publicUrl } = await uploadGroupLogo({
        userId: input.userId,
        groupId: normalized.id,
        uri:     input.logoUri,
      });
      if (publicUrl) normalized = { ...normalized, avatar_url: publicUrl };
    }

    await upsertLocalGroup(normalized);
    return { group: normalized, error: null };
  } catch (error) {
    return { group: null, error: toBackendError(error, 'Create group') };
  }
}

export async function listGroupsForUser(userId: string): Promise<{
  groups: GroupListItem[];
  error: Error | null;
}> {
  const merged = new Map<string, OsusuGroup>();
  let remoteError: Error | null = null;

  const fromLocal = await loadLocalGroups();
  for (const group of fromLocal) {
    if (group.created_by === userId) merged.set(group.id, group);
  }

  if (supabaseConfigured) {
    try {
      const [createdResponse, membershipResponse] = await Promise.all([
        supabase
          .from('osusu_groups')
          .select('*')
          .eq('created_by', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('group_memberships')
          .select('group_id')
          .eq('member_id', userId)
          .eq('status', 'approved'),
      ]);

      if (createdResponse.error) throw new Error(createdResponse.error.message);
      if (membershipResponse.error) throw new Error(membershipResponse.error.message);

      for (const row of createdResponse.data ?? []) {
        const normalized = normalizeGroupRow(row);
        if (normalized) merged.set(normalized.id, normalized);
      }

      const membershipIds = [...new Set((membershipResponse.data ?? []).map((item) => item.group_id).filter(Boolean))];
      if (membershipIds.length > 0) {
        const { data: memberGroups, error: memberGroupsError } = await supabase
          .from('osusu_groups')
          .select('*')
          .in('id', membershipIds);

        if (memberGroupsError) throw new Error(memberGroupsError.message);

        for (const row of memberGroups ?? []) {
          const normalized = normalizeGroupRow(row);
          if (normalized) merged.set(normalized.id, normalized);
        }
      }

      await Promise.all([...merged.values()].map((group) => upsertLocalGroup(group)));
    } catch (error) {
      remoteError = toBackendError(error, 'Load groups');
    }
  }

  const sortedGroups = [...merged.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const memberCounts = await fetchApprovedMemberCounts(sortedGroups.map((group) => group.id));
  const groups = sortedGroups.map((group) => ({
    ...toListItemWithMemberCount(group, memberCounts.get(group.id)),
    role: group.created_by === userId ? 'creator' as const : 'member' as const,
  }));

  return { groups, error: remoteError };
}

export async function getGroupById(groupId: string): Promise<{
  group: OsusuGroup | null;
  error: Error | null;
}> {
  const fromLocal = (await loadLocalGroups()).find((group) => group.id === groupId) ?? null;

  if (!supabaseConfigured) {
    return { group: fromLocal, error: null };
  }

  try {
    const { data, error } = await supabase.from('osusu_groups').select('*').eq('id', groupId).maybeSingle();
    if (error) throw new Error(error.message);

    const normalized = normalizeGroupRow(data);
    if (!normalized) return { group: fromLocal, error: null };

    await upsertLocalGroup(normalized);
    return { group: normalized, error: null };
  } catch (error) {
    return { group: fromLocal, error: toBackendError(error, 'Load group') };
  }
}

export async function deleteGroup(params: {
  groupId: string;
  userId: string;
}): Promise<{ success: boolean; outcome: DeleteGroupOutcome | null; error: Error | null }> {
  if (!supabaseConfigured || params.groupId.startsWith('local-')) {
    await deleteLocalGroup(params.groupId);
    return { success: true, outcome: 'deleted', error: null };
  }

  // Delegated to request_group_deletion RPC (SECURITY DEFINER).
  // Member-count check and deletion/pending logic are atomic server-side.
  try {
    const { data, error } = await supabase.rpc('request_group_deletion', {
      p_group_id: params.groupId,
      p_reason:   null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    const outcome = result.outcome as string;
    if (outcome === 'deleted') {
      await deleteLocalGroup(params.groupId);
      return { success: true, outcome: 'deleted', error: null };
    }
    return { success: true, outcome: 'pending_super_admin', error: null };
  } catch (error) {
    return { success: false, outcome: null, error: toBackendError(error, 'Delete group') };
  }
}

export async function fetchGroupAdminContacts(group: OsusuGroup): Promise<{
  contacts: GroupAdminContact[];
  error: Error | null;
}> {
  const config = parseGroupConfiguration(group.custom_rules);
  const contacts = new Map<string, GroupAdminContact>();

  if (config.adminCollectionPhone) {
    contacts.set(config.adminCollectionPhone, {
      id: `custom-${group.id}`,
      label: 'Group Admin',
      phone: config.adminCollectionPhone,
      role: 'admin',
    });
  }

  if (!supabaseConfigured) {
    return { contacts: [...contacts.values()], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,first_name,last_name,phone,email')
      .eq('id', group.created_by)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const profile = data as ProfileSummary | null;
    if (profile?.phone) {
      const label = formatProfileName(profile, 'Group Creator');
      contacts.set(profile.phone, {
        id: profile.id,
        label,
        phone: profile.phone,
        role: 'creator',
      });
    }

    return { contacts: [...contacts.values()], error: null };
  } catch (error) {
    return {
      contacts: [...contacts.values()],
      error: toBackendError(error, 'Load admin contacts'),
    };
  }
}

export async function fetchGroupMembers(groupId: string): Promise<{
  members: GroupMemberSummary[];
  error: Error | null;
}> {
  if (!supabaseConfigured) return { members: [], error: null };

  try {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('id,member_id,payout_position,joined_at,created_at')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });

    if (error) throw new Error(error.message);

    const memberships = (data ?? []) as Array<{
      id: string;
      member_id: string;
      payout_position: number | null;
      joined_at: string | null;
      created_at: string;
    }>;

    const profiles = await fetchProfilesByIds(memberships.map((member) => member.member_id));

    return {
      members: memberships.map((member, index) => ({
        id: member.id,
        userId: member.member_id,
        displayName: formatProfileName(profiles.get(member.member_id), `Member ${index + 1}`),
        phone: profiles.get(member.member_id)?.phone ?? null,
        payoutPosition: member.payout_position,
        joinedAt: member.joined_at ?? member.created_at,
      })),
      error: null,
    };
  } catch (error) {
    return { members: [], error: toBackendError(error, 'Load group members') };
  }
}

export async function fetchGroupContributions(groupId: string): Promise<{
  contributions: GroupContributionSummary[];
  error: Error | null;
}> {
  if (!supabaseConfigured) return { contributions: [], error: null };

  try {
    const { data, error } = await supabase
      .from('contributions')
      .select('id,member_id,amount,contribution_period,collection_method,status,created_at,receipt_number')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return {
      contributions: ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
        id: asText(item.id, createLocalId('contribution')),
        memberId: asText(item.member_id),
        amount: asNumber(item.amount, 0),
        contributionPeriod: asText(item.contribution_period, 'Current cycle'),
        collectionMethod: asText(item.collection_method, 'unknown'),
        status: (asText(item.status, 'pending') as GroupContributionSummary['status']),
        createdAt: asText(item.created_at, new Date().toISOString()),
        receiptNumber: typeof item.receipt_number === 'string' ? item.receipt_number : null,
      })),
      error: null,
    };
  } catch (error) {
    return { contributions: [], error: toBackendError(error, 'Load group contributions') };
  }
}

function parseContributionPeriodEnd(period: string): string | null {
  const matches = period.match(/\d{4}-\d{2}-\d{2}/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

function parseContributionPeriodStart(period: string): string | null {
  const matches = period.match(/\d{4}-\d{2}-\d{2}/g);
  if (!matches || matches.length === 0) return null;
  return matches[0] ?? null;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = new Date(`${startA}T00:00:00`).getTime();
  const aEnd = new Date(`${endA}T00:00:00`).getTime();
  const bStart = new Date(`${startB}T00:00:00`).getTime();
  const bEnd = new Date(`${endB}T00:00:00`).getTime();
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function nextDateAfter(dateString: string): string | null {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function fetchMemberContributionCoverage(params: {
  groupId: string;
  memberId: string;
}): Promise<{ coverage: MemberContributionCoverage; error: Error | null }> {
  const empty: MemberContributionCoverage = {
    lastContributionPeriod: null,
    lastPaidToDate: null,
    nextUnpaidDate: null,
  };
  if (!supabaseConfigured) return { coverage: empty, error: null };

  try {
    const { data, error } = await supabase
      .from('contributions')
      .select('contribution_period,created_at')
      .eq('group_id', params.groupId)
      .eq('member_id', params.memberId)
      .in('status', ['pending', 'collected', 'verified'])
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    let latest: { period: string; endDate: string; time: number } | null = null;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const period = asText(row.contribution_period);
      const endDate = parseContributionPeriodEnd(period);
      if (!endDate) continue;
      const time = new Date(`${endDate}T00:00:00`).getTime();
      if (!Number.isFinite(time)) continue;
      if (!latest || time > latest.time) latest = { period, endDate, time };
    }

    if (!latest) return { coverage: empty, error: null };
    return {
      coverage: {
        lastContributionPeriod: latest.period,
        lastPaidToDate: latest.endDate,
        nextUnpaidDate: nextDateAfter(latest.endDate),
      },
      error: null,
    };
  } catch (error) {
    return { coverage: empty, error: toBackendError(error, 'Load member contribution coverage') };
  }
}

// ─── Contributor Assignment (Admin) ─────────────────────────────────────────

/**
 * Searches registered profiles by name, phone, or email for contributor assignment.
 */
export async function searchProfiles(query: string): Promise<{
  profiles: ProfileSummary[];
  error: Error | null;
}> {
  if (!supabaseConfigured || !query.trim()) return { profiles: [], error: null };

  try {
    const like = `%${query.trim()}%`;
    const { data, error } = await supabase
      .from('profiles')
      .select('id,first_name,last_name,phone,email')
      .or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .limit(20);

    if (error) throw new Error(error.message);
    return { profiles: (data ?? []) as ProfileSummary[], error: null };
  } catch (error) {
    return { profiles: [], error: toBackendError(error, 'Search profiles') };
  }
}

/**
 * Assigns a user as an Osusu Contributor to a group.
 * Creates a membership (if not existing) and a collector record.
 * Stores collector display name, photo, and passcode.
 * Notifies ALL group members about the new collector identity.
 */
export async function assignContributor(params: {
  groupId: string;
  userId: string;
  addedBy: string;
  payoutPosition?: number;
  collectorDisplayName?: string;
  collectorPhotoUrl?: string;
  collectorPasscode?: string;
}): Promise<{ success: boolean; secretCode: string | null; collectorPasscode: string | null; error: Error | null }> {
  if (!supabaseConfigured) {
    return { success: true, secretCode: '000000', collectorPasscode: '000000', error: null };
  }

  // Delegated to assign_collector_validated RPC (SECURITY DEFINER).
  // Membership upsert, passcode generation, and member notifications
  // are now atomic server-side operations.
  try {
    const { data, error } = await supabase.rpc('assign_collector_validated', {
      p_group_id:     params.groupId,
      p_user_id:      params.userId,
      p_display_name: params.collectorDisplayName ?? null,
      p_photo_url:    params.collectorPhotoUrl ?? null,
      p_passcode:     params.collectorPasscode ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      success:          Boolean(result.success),
      secretCode:       result.member_secret_code as string ?? null,
      collectorPasscode: result.collector_passcode as string ?? null,
      error:            null,
    };
  } catch (error) {
    return { success: false, secretCode: null, collectorPasscode: null, error: toBackendError(error, 'Assign contributor') };
  }
}

/**
 * Fetches all approved contributors for a group (used by collector dropdown).
 */
export async function fetchGroupContributors(groupId: string): Promise<{
  contributors: ContributorAssignment[];
  error: Error | null;
}> {
  if (!supabaseConfigured) return { contributors: [], error: null };

  try {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('id,member_id,payout_position')
      .eq('group_id', groupId)
      .in('status', ['approved', 'pending'])
      .order('payout_position', { ascending: true, nullsFirst: false });

    if (error) throw new Error(error.message);

    const memberships = (data ?? []) as Array<{
      id: string;
      member_id: string;
      payout_position: number | null;
    }>;

    const profiles = await fetchProfilesByIds(memberships.map((m) => m.member_id));

    return {
      contributors: memberships.map((m, index) => ({
        membershipId: m.id,
        userId: m.member_id,
        displayName: formatProfileName(profiles.get(m.member_id), `Contributor ${index + 1}`),
        phone: profiles.get(m.member_id)?.phone ?? null,
        payoutPosition: m.payout_position,
      })),
      error: null,
    };
  } catch (error) {
    return { contributors: [], error: toBackendError(error, 'Load group contributors') };
  }
}

// ─── Collector Contribution Recording ───────────────────────────────────────
//
// MIGRATION NOTE: recordCollectorContribution() has been replaced by
// recordPhysicalCollection() in collectorService.ts which calls the
// record_physical_collection SECURITY DEFINER RPC.  All validation,
// secret-code checking, overlap detection, receipt generation, fraud
// logging, and audit logging now happen atomically on the server.
//
// Import { recordPhysicalCollection } from './collectorService' instead.

export interface RecordCollectorContributionInput {
  groupId: string;
  memberId: string;
  collectorUserId: string;
  amount: number;
  contributionPeriod: string;
  collectionMethod: 'cash_collected' | 'orange_money' | 'afrimoney' | 'qmoney';
  notes?: string;
  memberSecretCode: string;
  collectorSecretCode?: string;
  paymentDate?: string;
  fromDate?: string;
  toDate?: string;
  durationCount?: number;
  durationUnit?: 'day' | 'week' | 'month';
}

/**
 * Records a contribution by the collector.
 * Validates the member secret code, prevents duplicate entries,
 * creates an audit log, sends a notification, and generates a receipt number.
 */
export async function recordCollectorContribution(input: RecordCollectorContributionInput): Promise<{
  receiptNumber: string | null;
  contributionId: string | null;
  error: Error | null;
}> {
  // All logic delegated to record_physical_collection RPC (SECURITY DEFINER).
  // Secret code validation, overlap checks, receipt generation, fraud logging,
  // and audit logging are now atomic server-side operations.
  // Use recordPhysicalCollection() from collectorService.ts instead.
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { receiptNumber: null, contributionId: null, error: new Error('Amount must be greater than zero.') };
  }

  if (!supabaseConfigured) {
    return { receiptNumber: `RCP-LOCAL-${Date.now()}`, contributionId: null, error: null };
  }

  try {
    const { data, error } = await supabase.rpc('record_physical_collection', {
      p_group_id:           input.groupId,
      p_member_id:          input.memberId,
      p_amount:             input.amount,
      p_period:             input.contributionPeriod,
      p_from_date:          input.fromDate ?? null,
      p_to_date:            input.toDate ?? null,
      p_method:             input.collectionMethod,
      p_member_secret_code: input.memberSecretCode,
      p_collector_passcode: input.collectorSecretCode ?? null,
      // Generate a real idempotency key so duplicate submissions on network
      // retry don't create double financial records. Previously null, which
      // defeated the RPC's duplicate-detection entirely (null != null in SQL).
      p_idempotency_key:    crypto.randomUUID(),
      p_notes:              input.notes ?? null,
      p_cycle_number:       1,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      receiptNumber:  result.receipt_number as string ?? null,
      contributionId: result.contribution_id as string ?? null,
      error:          null,
    };
  } catch (error) {
    return { receiptNumber: null, contributionId: null, error: toBackendError(error, 'Record collector contribution') };
  }
}

// ─── Collector Identity Management ──────────────────────────────────────────

export interface ActiveCollectorInfo {
  id: string;
  profileId: string;
  displayName: string;
  photoUrl: string | null;
  isActive: boolean;
}

export async function fetchActiveCollectorsForGroup(groupId: string): Promise<{
  collectors: ActiveCollectorInfo[];
  error: Error | null;
}> {
  if (!supabaseConfigured) return { collectors: [], error: null };

  try {
    const { data, error } = await supabase
      .from('collectors')
      .select('id,profile_id,collector_display_name,collector_photo_url,is_active,created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const profiles = await fetchProfilesByIds(rows.map((row) => row.profile_id as string).filter(Boolean));

    return {
      collectors: rows.map((row) => {
        const profileId = row.profile_id as string;
        const displayName =
          typeof row.collector_display_name === 'string' && row.collector_display_name.trim()
            ? row.collector_display_name.trim()
            : formatProfileName(profiles.get(profileId), 'Collector');

        return {
          id: row.id as string,
          profileId,
          displayName,
          photoUrl: typeof row.collector_photo_url === 'string' ? row.collector_photo_url : null,
          isActive: row.is_active === true,
        };
      }),
      error: null,
    };
  } catch (error) {
    return { collectors: [], error: toBackendError(error, 'Fetch active collectors') };
  }
}

/**
 * Fetches the active collector for a group so members can verify the collector's identity.
 */
export async function fetchActiveCollectorForGroup(groupId: string): Promise<{
  collector: ActiveCollectorInfo | null;
  error: Error | null;
}> {
  if (!supabaseConfigured) return { collector: null, error: null };

  try {
    const { data, error } = await supabase
      .from('collectors')
      .select('id,profile_id,collector_display_name,collector_photo_url,is_active')
      .eq('group_id', groupId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { collector: null, error: null };

    const row = data as Record<string, unknown>;
    const profileId = row.profile_id as string;

    // If no display name set, fall back to the profile name
    let displayName = typeof row.collector_display_name === 'string' && row.collector_display_name
      ? row.collector_display_name
      : '';

    if (!displayName) {
      const profiles = await fetchProfilesByIds([profileId]);
      displayName = formatProfileName(profiles.get(profileId), 'Collector');
    }

    return {
      collector: {
        id: row.id as string,
        profileId,
        displayName,
        photoUrl: typeof row.collector_photo_url === 'string' ? row.collector_photo_url : null,
        isActive: row.is_active === true,
      },
      error: null,
    };
  } catch (error) {
    return { collector: null, error: toBackendError(error, 'Fetch active collector') };
  }
}

/**
 * Deactivates a collector and notifies all group members instantly.
 * This is critical for fraud prevention — removed collectors must not collect money.
 */
export async function deactivateCollector(params: {
  groupId: string;
  collectorProfileId: string;
  deactivatedBy: string;
}): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured) return { success: true, error: null };

  // Delegated to deactivate_collector_atomic RPC (SECURITY DEFINER).
  // Deactivation and member alerts happen atomically on the server.
  try {
    const { data, error } = await supabase.rpc('deactivate_collector_atomic', {
      p_group_id:               params.groupId,
      p_collector_profile_id:   params.collectorProfileId,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { success: Boolean(result.success), error: null };
  } catch (error) {
    return { success: false, error: toBackendError(error, 'Deactivate collector') };
  }
}
