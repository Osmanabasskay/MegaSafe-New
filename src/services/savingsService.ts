/**
 * savingsService — THIN FRONTEND CLIENT
 *
 * Display and read operations only.
 * All balance updates use the record_savings_transaction RPC (SECURITY DEFINER).
 * Payment initiation uses the initiate_savings_deposit RPC.
 * current_amount is never written directly by the client.
 */

import { supabase, supabaseConfigured } from './supabase';
import { toBackendError, logDbError } from './backendErrors';
import type { SupportedPaymentMethod } from './paymentService';
import { generateIdempotencyKey } from './paymentService';

// Maps any UI label (capitalized or lowercase) to the DB enum value.
// The live savings_goals.auto_save_frequency column type is contribution_frequency.
// Valid DB enum values: daily | weekly | biweekly | monthly
export const AUTO_SAVE_FREQ_TO_DB: Readonly<Record<string, 'daily' | 'weekly' | 'biweekly' | 'monthly'>> = {
  daily:    'daily',
  Daily:    'daily',
  DAILY:    'daily',
  weekly:   'weekly',
  Weekly:   'weekly',
  WEEKLY:   'weekly',
  biweekly: 'biweekly',
  Biweekly: 'biweekly',
  BIWEEKLY: 'biweekly',
  monthly:  'monthly',
  Monthly:  'monthly',
  MONTHLY:  'monthly',
};

export type SavingsGoalStatus = 'active' | 'completed' | 'withdrawn' | 'cancelled';
export type SavingsGoalCategory =
  | 'car'
  | 'house'
  | 'rent'
  | 'school_fees'
  | 'business'
  | 'travel'
  | 'emergency'
  | 'other';

export interface SavingsGoal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: SavingsGoalCategory;
  goal_emoji: string | null;
  target_amount: number;
  current_amount: number;
  currency_code: string;
  target_date: string | null;
  status: SavingsGoalStatus;
  auto_save_enabled: boolean;
  auto_save_amount: number | null;
  auto_save_frequency: 'daily' | 'weekly' | 'monthly' | null;
  auto_save_next_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSavingsGoalInput {
  ownerId: string;
  title: string;
  description?: string | null;
  category: SavingsGoalCategory;
  targetAmount: number;
  targetDate?: string | null;
  autoSaveEnabled?: boolean;
  autoSaveAmount?: number | null;
  autoSaveFrequency?: 'daily' | 'weekly' | 'monthly' | null;
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

function normalizeSavingsGoal(row: unknown): SavingsGoal | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  return {
    id:                  typeof r.id === 'string' ? r.id : createLocalId('goal'),
    user_id:             typeof r.user_id === 'string' ? r.user_id : (typeof r.owner_id === 'string' ? r.owner_id : ''),
    title:               typeof r.title === 'string' ? r.title : 'Untitled Goal',
    description:         typeof r.description === 'string' ? r.description : null,
    category:            typeof r.category === 'string' ? (r.category as SavingsGoalCategory) : 'other',
    goal_emoji:          typeof r.goal_emoji === 'string' ? r.goal_emoji : null,
    target_amount:       typeof r.target_amount === 'number' ? r.target_amount : Number(r.target_amount ?? 0),
    current_amount:      typeof r.current_amount === 'number' ? r.current_amount : Number(r.current_amount ?? 0),
    currency_code:       typeof r.currency_code === 'string' ? r.currency_code : 'NLe',
    target_date:         typeof r.target_date === 'string' ? r.target_date : null,
    status:              typeof r.status === 'string' ? (r.status as SavingsGoalStatus) : 'active',
    auto_save_enabled:   Boolean(r.auto_save_enabled),
    auto_save_amount:    typeof r.auto_save_amount === 'number' ? r.auto_save_amount : null,
    auto_save_frequency: typeof r.auto_save_frequency === 'string'
                           ? (r.auto_save_frequency as 'daily' | 'weekly' | 'monthly') : null,
    auto_save_next_date: typeof r.auto_save_next_date === 'string' ? r.auto_save_next_date : null,
    created_at:          typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    updated_at:          typeof r.updated_at === 'string' ? r.updated_at : new Date().toISOString(),
  };
}

export function normalizeSavingsCategory(categoryLabel: string): SavingsGoalCategory {
  const n = categoryLabel.trim().toLowerCase();
  if (n === 'emergency')  return 'emergency';
  if (n === 'education')  return 'school_fees';
  if (n === 'business')   return 'business';
  if (n === 'travel')     return 'travel';
  if (n === 'family')     return 'house';
  return 'other';
}

export function formatSavingsCategory(category: SavingsGoalCategory): string {
  if (category === 'school_fees') return 'Education';
  if (category === 'house')       return 'Family';
  if (category === 'emergency')   return 'Emergency';
  if (category === 'business')    return 'Business';
  if (category === 'travel')      return 'Travel';
  if (category === 'car')         return 'Car';
  if (category === 'rent')        return 'Rent';
  return 'Personal';
}

// ─────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────

export async function fetchSavingsGoals(
  ownerId: string
): Promise<{ goals: SavingsGoal[]; error: Error | null }> {
  if (!supabaseConfigured) return { goals: [], error: null };

  try {
    const { data, error } = await supabase
      .from('savings_goals')
      .select('*')
      .eq('user_id', ownerId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return {
      goals: (data ?? []).map(normalizeSavingsGoal).filter((g): g is SavingsGoal => g != null),
      error: null,
    };
  } catch (err) {
    return { goals: [], error: toBackendError(err, 'Load savings goals') };
  }
}

/** Get vault balance summary — server-calculated. */
export async function getVaultBalance(): Promise<{
  totalBalance: number;
  activeBalance: number;
  completedBalance: number;
  /** Progress percentage (0–100) computed here in the service layer.
   *  Screens must read this field directly — never recompute it in the UI. */
  savingsProgressPct: number;
  goals: SavingsGoal[];
  error: Error | null;
}> {
  if (!supabaseConfigured) {
    return { totalBalance: 0, activeBalance: 0, completedBalance: 0, savingsProgressPct: 0, goals: [], error: null };
  }

  try {
    const { data, error } = await supabase.rpc('get_vault_balance');
    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    const totalBalance     = Number(result.total_balance ?? 0);
    const activeBalance    = Number(result.active_balance ?? 0);
    const completedBalance = Number(result.completed_balance ?? 0);
    const totalTarget      = activeBalance + completedBalance;
    // Compute progress at the service layer so no screen does this arithmetic.
    const savingsProgressPct = totalTarget > 0
      ? Math.min(100, Math.round((totalBalance / totalTarget) * 100 * 100) / 100)
      : 0;

    const rawGoals = (result.goals as unknown[]) ?? [];
    return {
      totalBalance,
      activeBalance,
      completedBalance,
      savingsProgressPct,
      goals: rawGoals.map(normalizeSavingsGoal).filter((g): g is SavingsGoal => g != null),
      error: null,
    };
  } catch (err) {
    return { totalBalance: 0, activeBalance: 0, completedBalance: 0, savingsProgressPct: 0, goals: [], error: toBackendError(err, 'Get vault balance') };
  }
}

// ─────────────────────────────────────────────────────────────
// Create savings goal
// ─────────────────────────────────────────────────────────────

export async function createSavingsGoal(
  input: CreateSavingsGoalInput
): Promise<{ goal: SavingsGoal | null; error: Error | null }> {
  if (!supabaseConfigured) {
    return {
      goal: {
        id: createLocalId('goal'), user_id: input.ownerId, title: input.title,
        description: input.description ?? null, category: input.category, goal_emoji: '🎯',
        target_amount: input.targetAmount, current_amount: 0, currency_code: 'NLe',
        target_date: input.targetDate ?? null, status: 'active',
        auto_save_enabled: input.autoSaveEnabled ?? false,
        auto_save_amount: input.autoSaveAmount ?? null,
        auto_save_frequency: input.autoSaveFrequency ?? null,
        auto_save_next_date: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      error: null,
    };
  }

  // Map UI label → DB enum value defensively before sending to Supabase.
  // savings_goals.auto_save_frequency is type contribution_frequency (enum).
  const rawFreq = input.autoSaveEnabled ? (input.autoSaveFrequency ?? null) : null;
  const mappedFreq = rawFreq != null ? (AUTO_SAVE_FREQ_TO_DB[rawFreq] ?? rawFreq) : null;

  const rpcPayload = {
    p_owner_id:            input.ownerId,
    p_title:               input.title.trim(),
    p_description:         input.description?.trim() || null,
    p_category:            input.category,
    p_target_amount:       input.targetAmount,
    p_target_date:         input.targetDate ?? null,
    p_auto_save_enabled:   input.autoSaveEnabled ?? false,
    p_auto_save_amount:    input.autoSaveEnabled ? input.autoSaveAmount ?? null : null,
    p_auto_save_frequency: mappedFreq,
  };

  try {
    // Use SECURITY DEFINER RPC — enforces auth.uid() = owner_id server-side,
    // sets current_amount = 0, and creates an audit log atomically.
    // Direct INSERT is no longer permitted here.
    const { data, error } = await supabase.rpc('create_savings_goal', rpcPayload);

    if (error) {
      logDbError('create_savings_goal RPC', 'savings_goals', rpcPayload as Record<string, unknown>, error);
      throw new Error(error.message);
    }
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return { goal: normalizeSavingsGoal(result), error: null };
  } catch (err) {
    return { goal: null, error: toBackendError(err, 'Create savings goal') };
  }
}

// ─────────────────────────────────────────────────────────────
// Delete savings goal
// ─────────────────────────────────────────────────────────────

export async function deleteSavingsGoal(params: {
  goalId: string;
  ownerId: string;
}): Promise<{ success: boolean; error: Error | null }> {
  if (!supabaseConfigured || params.goalId.startsWith('local-')) {
    return { success: true, error: null };
  }

  try {
    const { data, error } = await supabase
      .from('savings_goals')
      .delete()
      .eq('id', params.goalId)
      .eq('user_id', params.ownerId)
      .select('id');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new Error('Only the savings goal owner can delete this goal.');
    }
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Delete savings goal') };
  }
}

// ─────────────────────────────────────────────────────────────
// Initiate savings deposit — server validates and creates payment
// ─────────────────────────────────────────────────────────────

export async function processSavingsDeposit(params: {
  goalId: string;
  amount: number;
  paymentMethod: SupportedPaymentMethod;
  idempotencyKey?: string;
}): Promise<{ success: boolean; paymentId?: string; error: Error | null }> {
  if (!supabaseConfigured) {
    return { success: true, paymentId: createLocalId('payment'), error: null };
  }

  try {
    const iKey = params.idempotencyKey ?? generateIdempotencyKey();

    const { data, error } = await supabase.rpc('initiate_savings_deposit', {
      p_goal_id:         params.goalId,
      p_amount:          params.amount,
      p_method:          params.paymentMethod,
      p_idempotency_key: iKey,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      success:   Boolean(result.success),
      paymentId: result.payment_id as string,
      error:     null,
    };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Process savings deposit') };
  }
}

// ─────────────────────────────────────────────────────────────
// Record savings withdrawal — server validates balance
// ─────────────────────────────────────────────────────────────

export async function processSavingsWithdrawal(params: {
  goalId: string;
  amount: number;
  note?: string;
}): Promise<{ success: boolean; newBalance?: number; error: Error | null }> {
  if (!supabaseConfigured) return { success: true, error: null };

  try {
    const { data, error } = await supabase.rpc('record_savings_transaction', {
      p_savings_goal_id: params.goalId,
      p_amount:          params.amount,
      p_type:            'withdrawal',
      p_note:            params.note ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      success:    true,
      newBalance: Number(result.current_amount ?? 0),
      error:      null,
    };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Process savings withdrawal') };
  }
}
