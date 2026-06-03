import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';

export type RemoteDisputeStatus = 'open' | 'under_review' | 'resolved' | 'escalated' | 'dismissed';

export type DisputeCategory =
  | 'missing_payment'
  | 'collector_misconduct'
  | 'incorrect_amount'
  | 'unauthorized_transaction'
  | 'other';

export type DisputePriority = 'low' | 'normal' | 'high' | 'critical';

function createLocalId(prefix: string): string {
  const rand = new Uint16Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rand);
  } else {
    rand[0] = Math.floor(Math.random() * 65536);
  }
  return `local-${prefix}-${Date.now()}-${rand[0]}`;
}

const VALID_CATEGORIES: DisputeCategory[] = [
  'missing_payment',
  'collector_misconduct',
  'incorrect_amount',
  'unauthorized_transaction',
  'other',
];

export async function createDispute(
  title: string,
  description: string,
  category: string,
  groupId?: string,
  paymentId?: string,
  accusedUserId?: string,
  priority: DisputePriority = 'normal',
  evidenceUrl?: string
): Promise<{ success: boolean; error: Error | null; disputeId?: string }> {
  if (!title.trim() || title.trim().length < 5) {
    return { success: false, error: new Error('Dispute title must be at least 5 characters.') };
  }
  if (!description.trim() || description.trim().length < 20) {
    return { success: false, error: new Error('Dispute description must be at least 20 characters.') };
  }
  if (!VALID_CATEGORIES.includes(category as DisputeCategory)) {
    return { success: false, error: new Error('Invalid dispute category.') };
  }

  if (!supabaseConfigured) {
    return { success: true, error: null, disputeId: createLocalId('dispute') };
  }

  try {
    const { data, error } = await supabase.rpc('create_dispute', {
      p_title:        title.trim(),
      p_description:  description.trim(),
      p_category:     category,
      p_group_id:     groupId ?? null,
      p_payment_id:   paymentId ?? null,
      p_accused_id:   accusedUserId ?? null,
      p_priority:     priority,
      p_evidence_url: evidenceUrl ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { success: true, error: null, disputeId: result.dispute_id as string };
  } catch (error) {
    return { success: false, error: toBackendError(error, 'Create dispute') };
  }
}

export interface DisputeRow {
  id: string;
  complainant_id: string;
  accused_user_id: string | null;
  group_id: string | null;
  group_name?: string | null;
  payment_id: string | null;
  category: DisputeCategory;
  title: string;
  description: string;
  status: RemoteDisputeStatus;
  priority: DisputePriority;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export async function fetchUserDisputes(
  status?: RemoteDisputeStatus
): Promise<{ disputes: DisputeRow[]; error: Error | null }> {
  if (!supabaseConfigured) {
    return { disputes: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc('get_my_disputes', {
      p_status: status ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { disputes: (result.disputes as DisputeRow[]) ?? [], error: null };
  } catch (error) {
    return { disputes: [], error: toBackendError(error, 'Load disputes') };
  }
}

export async function updateDisputeStatus(
  disputeId: string,
  status: RemoteDisputeStatus,
  resolutionNote?: string
): Promise<{ success: boolean; error: Error | null }> {
  const VALID_STATUSES: RemoteDisputeStatus[] = ['open', 'under_review', 'resolved', 'escalated', 'dismissed'];
  if (!VALID_STATUSES.includes(status)) {
    return { success: false, error: new Error('Invalid dispute status.') };
  }

  if (!supabaseConfigured) {
    return { success: true, error: null };
  }

  try {
    const { data, error } = await supabase.rpc('update_dispute_status', {
      p_dispute_id:      disputeId,
      p_status:          status,
      p_resolution_note: resolutionNote?.trim() ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: toBackendError(error, 'Update dispute') };
  }
}

export async function fetchAdminDisputes(params?: {
  status?: RemoteDisputeStatus;
  category?: DisputeCategory;
  limit?: number;
  offset?: number;
}): Promise<{ disputes: DisputeRow[]; total: number; error: Error | null }> {
  if (!supabaseConfigured) {
    return { disputes: [], total: 0, error: null };
  }

  try {
    const { data, error } = await supabase.rpc('get_admin_disputes', {
      p_status:   params?.status ?? null,
      p_category: params?.category ?? null,
      p_limit:    params?.limit ?? 50,
      p_offset:   params?.offset ?? 0,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      disputes: (result.disputes as DisputeRow[]) ?? [],
      total: Number(result.total ?? 0),
      error: null,
    };
  } catch (error) {
    return { disputes: [], total: 0, error: toBackendError(error, 'Load admin disputes') };
  }
}
