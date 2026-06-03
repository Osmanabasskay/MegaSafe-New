/**
 * reportService — THIN FRONTEND CLIENT
 *
 * All report data is server-calculated via RPCs.
 * No totals, balances, or aggregations are computed client-side.
 */

import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';

// ─────────────────────────────────────────────────────────────
// Group admin report (creator / super_admin only)
// ─────────────────────────────────────────────────────────────

export async function getGroupAdminReport(
  groupId: string
): Promise<{ report: Record<string, unknown> | null; error: Error | null }> {
  if (!supabaseConfigured) return { report: null, error: null };

  try {
    const { data, error } = await supabase.rpc('get_group_admin_report', {
      p_group_id: groupId,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { report: result, error: null };
  } catch (err) {
    return { report: null, error: toBackendError(err, 'Get admin report') };
  }
}

// ─────────────────────────────────────────────────────────────
// Outstanding balances report (creator / collector / super_admin)
// ─────────────────────────────────────────────────────────────

export async function getOutstandingBalances(
  groupId: string
): Promise<{ report: Record<string, unknown> | null; error: Error | null }> {
  if (!supabaseConfigured) return { report: null, error: null };

  try {
    const { data, error } = await supabase.rpc('get_outstanding_balances', {
      p_group_id: groupId,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { report: result, error: null };
  } catch (err) {
    return { report: null, error: toBackendError(err, 'Get outstanding balances') };
  }
}

// ─────────────────────────────────────────────────────────────
// Home summary (server-aggregated, replaces client-side calcs)
// ─────────────────────────────────────────────────────────────

export interface HomeSummary {
  savingsTotal: number;
  unreadNotifications: number;
  groups: Array<{
    groupId: string;
    name: string;
    status: string;
    contributionAmount: number;
    frequency: string;
    role: 'creator' | 'member';
    totalCollected: number;
    memberCount: number;
  }>;
}

export async function getHomeSummary(): Promise<{ summary: HomeSummary | null; error: Error | null }> {
  if (!supabaseConfigured) {
    return {
      summary: { savingsTotal: 0, unreadNotifications: 0, groups: [] },
      error: null,
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_home_summary');
    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    const rawGroups = (result.groups as unknown[]) ?? [];
    return {
      summary: {
        savingsTotal:        Number(result.savings_total ?? 0),
        unreadNotifications: Number(result.unread_notifications ?? 0),
        groups: rawGroups.map((g) => {
          const grp = g as Record<string, unknown>;
          return {
            groupId:            grp.group_id as string,
            name:               grp.name as string,
            status:             grp.status as string,
            contributionAmount: Number(grp.contribution_amount ?? 0),
            frequency:          grp.frequency as string,
            role:               grp.role as 'creator' | 'member',
            totalCollected:     Number(grp.total_collected ?? 0),
            memberCount:        Number(grp.member_count ?? 0),
          };
        }),
      },
      error: null,
    };
  } catch (err) {
    return { summary: null, error: toBackendError(err, 'Get home summary') };
  }
}

// ─────────────────────────────────────────────────────────────
// Group summary (server-aggregated)
// ─────────────────────────────────────────────────────────────

export async function getGroupSummary(
  groupId: string
): Promise<{ summary: Record<string, unknown> | null; error: Error | null }> {
  if (!supabaseConfigured) return { summary: null, error: null };

  try {
    const { data, error } = await supabase.rpc('get_group_summary', {
      p_group_id: groupId,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { summary: result, error: null };
  } catch (err) {
    return { summary: null, error: toBackendError(err, 'Get group summary') };
  }
}

// ─────────────────────────────────────────────────────────────
// My role (always reads from DB, never trusts local state)
// ─────────────────────────────────────────────────────────────

export interface MyRole {
  role: string;
  kycStatus: string;
  status: string;
}

export async function getMyRole(): Promise<{ role: MyRole | null; error: Error | null }> {
  if (!supabaseConfigured) return { role: null, error: null };

  try {
    const { data, error } = await supabase.rpc('get_my_role');
    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      role: {
        role:      result.role as string,
        kycStatus: result.kyc_status as string,
        status:    result.status as string,
      },
      error: null,
    };
  } catch (err) {
    return { role: null, error: toBackendError(err, 'Get my role') };
  }
}
