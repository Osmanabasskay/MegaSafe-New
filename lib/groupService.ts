import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseConfigured } from './supabase';
import type { Frequency, GroupStatus, OsusuGroup, PayoutOrder } from '../types/group';

const LOCAL_GROUPS_KEY = 'megasafe:groups:v1';

export interface CreateGroupInput {
  userId: string;
  name: string;
  description: string | null;
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
}

export interface GroupListItem {
  id: string;
  name: string;
  members: number;
  contributionAmount: number;
  frequency: Frequency;
  role: 'creator' | 'admin' | 'member';
  unreadCount?: number;
  totalCollected: number;
  nextPayout: string;
  lastActivity: string;
  status: GroupStatus;
}

function isFrequency(value: unknown): value is Frequency {
  return value === 'daily' || value === 'weekly' || value === 'biweekly' || value === 'monthly';
}

function isPayoutOrder(value: unknown): value is PayoutOrder {
  return value === 'sequential' || value === 'random';
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
    id: asText(record.id, `local-${Date.now()}`),
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

function toListItem(group: OsusuGroup): GroupListItem {
  return {
    id: group.id,
    name: group.name,
    members: group.max_members,
    contributionAmount: group.contribution_amount,
    frequency: group.frequency,
    role: 'creator',
    totalCollected: 0,
    nextPayout: nextPayoutFromFrequency(group.cycle_start_date, group.frequency),
    lastActivity: 'Just created',
    status: group.status,
  };
}

export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < 6; i += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `MSF-${token}`;
}

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
  };

  if (supabaseConfigured) {
    try {
      const { data, error } = await supabase.from('osusu_groups').insert(payload).select('*').single();
      if (!error) {
        const normalized = normalizeGroupRow(data);
        if (normalized) {
          await upsertLocalGroup(normalized);
          return { group: normalized, error: null };
        }
      }
    } catch {
      // Fall back to local cache when remote insert is unavailable.
    }
  }

  const localGroup: OsusuGroup = {
    id: `local-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
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
  };

  await upsertLocalGroup(localGroup);
  return { group: localGroup, error: null };
}

export async function listGroupsForUser(userId: string): Promise<{
  groups: GroupListItem[];
  error: Error | null;
}> {
  const fromLocal = (await loadLocalGroups()).filter((group) => group.created_by === userId);
  const merged = new Map<string, OsusuGroup>();

  for (const group of fromLocal) {
    merged.set(group.id, group);
  }

  if (supabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('osusu_groups')
        .select('*')
        .eq('created_by', userId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);

      for (const row of data ?? []) {
        const normalized = normalizeGroupRow(row);
        if (!normalized) continue;
        merged.set(normalized.id, normalized);
        await upsertLocalGroup(normalized);
      }
    } catch {
      // Local cache already available.
    }
  }

  const groups = [...merged.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map(toListItem);

  return { groups, error: null };
}

export async function getGroupById(groupId: string): Promise<{
  group: OsusuGroup | null;
  error: Error | null;
}> {
  const fromLocal = (await loadLocalGroups()).find((group) => group.id === groupId) ?? null;
  if (fromLocal) return { group: fromLocal, error: null };

  if (!supabaseConfigured) return { group: null, error: null };

  try {
    const { data, error } = await supabase.from('osusu_groups').select('*').eq('id', groupId).maybeSingle();
    if (error) return { group: null, error: new Error(error.message) };
    const normalized = normalizeGroupRow(data);
    if (!normalized) return { group: null, error: null };
    await upsertLocalGroup(normalized);
    return { group: normalized, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load group';
    return { group: null, error: new Error(message) };
  }
}
