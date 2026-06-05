/**
 * collectorService — THIN FRONTEND CLIENT
 *
 * All collector business logic lives in the backend:
 *   - record_physical_collection RPC (atomic, rate-limited, fraud-logged)
 *   - assign_collector_validated RPC (KYC-gated, atomic notifications)
 *   - deactivate_collector_atomic RPC (atomic deactivation + member alerts)
 *
 * This file only calls those RPCs and maps results to UI types.
 */

import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';
import { generateIdempotencyKey } from './paymentService';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RecordCollectionInput {
  groupId: string;
  memberId: string;
  amount: number;
  /** UUID from payment_periods — required by the live RPC */
  periodId: string;
  paymentMethod: 'cash' | 'orange_money' | 'afrimoney' | 'qmoney' | 'bank_transfer';
  notes?: string;
  idempotencyKey?: string;
}

export interface RecordCollectionResult {
  success: boolean;
  receiptNumber: string | null;
  contributionId: string | null;
  amount: number | null;
  collectedAt: string | null;
  idempotent: boolean;
  error: Error | null;
}

export interface AssignCollectorInput {
  groupId: string;
  userId: string;
  displayName?: string;
  photoUrl?: string;
  passcode?: string;   // omit to auto-generate server-side
}

export interface AssignCollectorResult {
  success: boolean;
  collectorId: string | null;
  memberSecretCode: string | null;
  collectorPasscode: string | null;
  error: Error | null;
}

export interface ActiveCollectorInfo {
  id: string;
  profileId: string;
  displayName: string;
  photoUrl: string | null;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// Record physical collection
// Secret code and passcode validated server-side only.
// ─────────────────────────────────────────────────────────────

export async function recordPhysicalCollection(
  input: RecordCollectionInput
): Promise<RecordCollectionResult> {
  if (!supabaseConfigured) {
    return {
      success: true,
      receiptNumber: `RCP-LOCAL-${Date.now()}`,
      contributionId: null, amount: input.amount,
      collectedAt: new Date().toISOString(),
      idempotent: false, error: null,
    };
  }

  try {
    const iKey = input.idempotencyKey ?? generateIdempotencyKey();

    const { data, error } = await supabase.rpc('record_physical_collection', {
      p_group_id:        input.groupId,
      p_member_id:       input.memberId,
      p_period_id:       input.periodId,
      p_amount:          input.amount,
      p_payment_method:  input.paymentMethod,
      p_notes:           input.notes ?? null,
      p_idempotency_key: iKey,
    });

    if (error) throw error;

    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      success:        Boolean(result.success),
      receiptNumber:  result.receipt_number as string ?? null,
      contributionId: result.contribution_id as string ?? null,
      amount:         result.amount ? Number(result.amount) : null,
      collectedAt:    result.collected_at as string ?? null,
      idempotent:     Boolean(result.idempotent),
      error:          null,
    };
  } catch (err) {
    return {
      success: false, receiptNumber: null, contributionId: null,
      amount: null, collectedAt: null, idempotent: false,
      error: toBackendError(err, 'Record physical collection'),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Assign collector (server validates caller is group creator)
// ─────────────────────────────────────────────────────────────

export async function assignCollector(
  input: AssignCollectorInput
): Promise<AssignCollectorResult> {
  if (!supabaseConfigured) {
    return { success: true, collectorId: null, memberSecretCode: '000000', collectorPasscode: '000000', error: null };
  }

  try {
    const { data, error } = await supabase.rpc('assign_collector_validated', {
      p_group_id:     input.groupId,
      p_user_id:      input.userId,
      p_display_name: input.displayName ?? null,
      p_photo_url:    input.photoUrl ?? null,
      p_passcode:     input.passcode ?? null,   // null → server auto-generates
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      success:          Boolean(result.success),
      collectorId:      result.collector_id as string ?? null,
      memberSecretCode: result.member_secret_code as string ?? null,
      collectorPasscode: result.collector_passcode as string ?? null,
      error:            null,
    };
  } catch (err) {
    return {
      success: false, collectorId: null, memberSecretCode: null, collectorPasscode: null,
      error: toBackendError(err, 'Assign collector'),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Deactivate collector (atomic: deactivates + alerts all members)
// ─────────────────────────────────────────────────────────────

export async function deactivateCollector(params: {
  groupId: string;
  collectorProfileId: string;
}): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured) return { success: true, error: null };

  try {
    const { data, error } = await supabase.rpc('deactivate_collector_atomic', {
      p_group_id:              params.groupId,
      p_collector_profile_id:  params.collectorProfileId,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { success: Boolean(result.success), error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Deactivate collector') };
  }
}

// ─────────────────────────────────────────────────────────────
// Read: fetch active collectors for a group (display only)
// ─────────────────────────────────────────────────────────────

export async function fetchActiveCollectorsForGroup(
  groupId: string
): Promise<{ collectors: ActiveCollectorInfo[]; error: Error | null }> {
  if (!supabaseConfigured) return { collectors: [], error: null };

  try {
    const { data, error } = await supabase
      .from('collectors')
      .select('id,profile_id,collector_display_name,collector_photo_url,is_active,created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return {
      collectors: ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id:          row.id as string,
        profileId:   row.profile_id as string,
        displayName: typeof row.collector_display_name === 'string' && row.collector_display_name
          ? row.collector_display_name
          : 'Collector',
        photoUrl:    typeof row.collector_photo_url === 'string' ? row.collector_photo_url : null,
        isActive:    row.is_active === true,
      })),
      error: null,
    };
  } catch (err) {
    return { collectors: [], error: toBackendError(err, 'Fetch collectors') };
  }
}

// ─────────────────────────────────────────────────────────────
// Read: collector performance report (server-aggregated)
// ─────────────────────────────────────────────────────────────

export async function getCollectorReport(
  collectorId?: string | null
): Promise<{ report: Record<string, unknown> | null; error: Error | null }> {
  if (!supabaseConfigured) return { report: null, error: null };

  try {
    const { data, error } = await supabase.rpc('calculate_collector_summary', {
      p_collector_id: collectorId ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { report: result, error: null };
  } catch (err) {
    return { report: null, error: toBackendError(err, 'Get collector report') };
  }
}
