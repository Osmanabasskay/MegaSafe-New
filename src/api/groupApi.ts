/**
 * groupApi — thin wrappers for group-related backend operations.
 * All membership, schedule, and stat aggregations are server-calculated.
 */

import { getGroupSummary, getGroupAdminReport, getOutstandingBalances } from '../services/reportService';
import {
  listGroupsForUser,
  getGroupById,
  createGroup,
  type GroupListItem,
} from '../services/groupService';
import type { OsusuGroup } from '../types/group';
import { getContributionSchedule, getMemberContributionStatus } from '../services/paymentService';
import { toBackendError } from '../services/backendErrors';

export type { OsusuGroup, GroupListItem };

export async function fetchUserGroups(
  userId: string
): Promise<{ groups: GroupListItem[]; error: Error | null }> {
  return listGroupsForUser(userId);
}

export async function fetchGroupById(
  groupId: string
): Promise<{ group: OsusuGroup | null; error: Error | null }> {
  return getGroupById(groupId);
}

export async function fetchGroupSummary(
  groupId: string
): Promise<{ summary: Record<string, unknown> | null; error: Error | null }> {
  return getGroupSummary(groupId);
}

export async function fetchGroupAdminReport(
  groupId: string
): Promise<{ report: Record<string, unknown> | null; error: Error | null }> {
  return getGroupAdminReport(groupId);
}

export async function fetchOutstandingBalances(
  groupId: string
): Promise<{ report: Record<string, unknown> | null; error: Error | null }> {
  return getOutstandingBalances(groupId);
}

export async function fetchMemberContributionStatus(
  groupId: string,
  memberId?: string
) {
  return getMemberContributionStatus(groupId, memberId);
}

export async function fetchContributionSchedule(
  groupId: string,
  memberId?: string
) {
  return getContributionSchedule(groupId, memberId);
}

export async function createNewGroup(
  params: Parameters<typeof createGroup>[0]
): Promise<{ group: OsusuGroup | null; error: Error | null }> {
  return createGroup(params);
}

export async function joinGroupByCode(
  inviteCode: string,
  _userId: string
): Promise<{ error: Error | null }> {
  try {
    const { supabase } = await import('../services/supabase');
    const { data, error } = await supabase.rpc('resolve_invite_code', { p_invite_code: inviteCode });
    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);
    return { error: null };
  } catch (err) {
    return { error: toBackendError(err, 'Join group') };
  }
}
