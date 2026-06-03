/**
 * paymentService — THIN FRONTEND CLIENT
 *
 * This file only:
 *   1. Sends requests to backend RPCs / Edge Functions.
 *   2. Returns typed results to the UI.
 *
 * All business logic, validation, calculations, duplicate checks,
 * receipt generation, and payment decisions happen in the backend.
 * Never add logic here that the server should own.
 *
 * Monime integration notes (Payment Codes API):
 *   - initiateGroupPayment returns ussd_code (USSD dial string) for mobile money.
 *   - User dials the code on their phone — no browser redirect needed.
 *   - After dialing, poll verifyMonimeCheckout for status updates.
 *   - NEVER use the poll response to consider a payment complete.
 *   - Authoritative completion arrives via mobile-money-webhook (server → DB).
 */

import { supabase, supabaseConfigured } from './supabase';
import { toBackendError } from './backendErrors';

export type SupportedPaymentMethod =
  | 'orange_money'
  | 'afrimoney'
  | 'bank_transfer'
  | 'card'
  | 'cash_collected';
// qmoney removed — not confirmed in Monime API docs

/** Methods routed through Monime Payment Codes API */
export const MONIME_METHODS: ReadonlySet<SupportedPaymentMethod> = new Set([
  'orange_money',
  'afrimoney',
]);

export type PaymentProvider =
  | 'monime'
  | 'flutterwave'
  | 'stripe'
  | 'cash_collector'
  | 'manual'
  | 'pending_gateway';

export type ContributionRow = {
  id: string;
  group_id: string;
  member_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string;
  receipt_number?: string;
  collected_at?: string | null;
  created_at: string;
};

/** Generate a cryptographically secure idempotency key (UUID v4 format). */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes]
    .map((b, i) => ([6, 8, 10, 12].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────
// Initiate Group Payment
// All validation and duplicate checks happen server-side.
// ─────────────────────────────────────────────────────────────

export interface InitiateGroupPaymentInput {
  groupId: string;
  amount: number;
  method: SupportedPaymentMethod;
  /** UUID from payment_periods — edge function resolves it if omitted. */
  periodId?: string | null;
  idempotencyKey?: string;
  notes?: string;
  // Deprecated: kept for call-site compatibility, ignored by edge function
  provider?: PaymentProvider;
  cycleNumber?: number;
  contributionPeriod?: string;
  fromDate?: string | null;
  toDate?: string | null;
  dueDate?: string | null;
}

export interface InitiateGroupPaymentResult {
  success: boolean;
  mmTxnId?: string;
  contributionId?: string;
  receiptNumber?: string;
  status?: string;
  providerRef?: string;
  /** USSD dial string — user dials this on their phone to authorise payment. */
  ussdCode?: string;
  /** Expires at ISO timestamp for the payment code. */
  expiresAt?: string;
  /** Monime payment code ID. Poll with verifyMonimeCheckout. */
  monimePaymentCodeId?: string;
  error: Error | null;
}

/**
 * Initiates a group contribution payment via the initiate-payment Edge Function.
 * All methods (mobile money, cash, card) route through the edge function so
 * provider secrets never leave the server and period resolution is server-side.
 */
export async function initiateGroupPayment(
  input: InitiateGroupPaymentInput
): Promise<InitiateGroupPaymentResult> {
  if (!supabaseConfigured) {
    return {
      success:        true,
      contributionId: `local-contrib-${Date.now()}`,
      status:         'pending',
      error:          null,
    };
  }

  try {
    const iKey = input.idempotencyKey ?? generateIdempotencyKey();

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Not authenticated.');

    const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl ??
                        process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
    const edgeUrl = `${supabaseUrl}/functions/v1/initiate-payment`;

    const resp = await fetch(edgeUrl, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id:        input.groupId,
        amount:          input.amount,
        method:          input.method,
        period_id:       input.periodId ?? null,
        idempotency_key: iKey,
        notes:           input.notes ?? null,
      }),
    });

    const json = await resp.json() as Record<string, unknown>;
    if (!resp.ok || json.error) {
      throw new Error((json.error as string) ?? `Payment initiation failed (${resp.status})`);
    }

    return {
      success:             json.success as boolean,
      mmTxnId:             json.mm_txn_id             as string | undefined,
      contributionId:      json.contribution_id        as string | undefined,
      receiptNumber:       json.receipt_number         as string | undefined,
      status:              json.status                 as string | undefined,
      ussdCode:            json.ussd_code              as string | undefined,
      expiresAt:           json.expires_at             as string | undefined,
      monimePaymentCodeId: json.monime_payment_code_id as string | undefined,
      error:               null,
    };
  } catch (err) {
    return { success: false, error: toBackendError(err, 'Initiate payment') };
  }
}

// ─────────────────────────────────────────────────────────────
// Verify Monime Payment Code Status (read-only poll)
//
// Call this after the user dials the USSD code on their phone
// to show them live progress. NEVER use this response to consider
// a payment complete — only display progress. The authoritative
// completion signal is mobile-money-webhook updating the DB.
// ─────────────────────────────────────────────────────────────

export type MonimeEffectiveStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'not_found';

export interface VerifyMonimeCheckoutResult {
  mmTxnId:         string | null;
  paymentId:       string | null;
  localStatus:     string | null;
  monimeStatus:    string | null;
  effectiveStatus: MonimeEffectiveStatus;
  amount:          number | null;
  createdAt:       string | null;
  error:           Error | null;
}

/**
 * Polls verify-payment for current status of a Monime payment code.
 * Display only — never use to consider a payment complete.
 */
export async function verifyMonimeCheckout(
  monimePaymentCodeId: string,
): Promise<VerifyMonimeCheckoutResult> {
  if (!supabaseConfigured) {
    return {
      mmTxnId: null, paymentId: null, localStatus: 'pending',
      monimeStatus: null, effectiveStatus: 'pending', amount: null,
      createdAt: null, error: null,
    };
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Not authenticated.');

    const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl ??
                        process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
    const edgeUrl = `${supabaseUrl}/functions/v1/verify-payment`;

    const resp = await fetch(edgeUrl, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ monime_payment_code_id: monimePaymentCodeId }),
    });

    const json = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error((json.error as string) ?? `Verify failed (${resp.status})`);
    }

    return {
      mmTxnId:         (json.mm_txn_id as string | null) ?? null,
      paymentId:       (json.payment_id as string | null) ?? null,
      localStatus:     (json.local_status as string | null) ?? null,
      monimeStatus:    (json.monime_status as string | null) ?? null,
      effectiveStatus: (json.effective_status as MonimeEffectiveStatus) ?? 'pending',
      amount:          json.amount != null ? Number(json.amount) : null,
      createdAt:       (json.created_at as string | null) ?? null,
      error:           null,
    };
  } catch (err) {
    return {
      mmTxnId: null, paymentId: null, localStatus: null,
      monimeStatus: null, effectiveStatus: 'pending', amount: null,
      createdAt: null, error: toBackendError(err, 'Verify payment status'),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Fetch contributions (read-only, display only)
// ─────────────────────────────────────────────────────────────

export async function fetchUserContributions(
  userId: string
): Promise<{ contributions: ContributionRow[]; error: Error | null }> {
  if (!supabaseConfigured) return { contributions: [], error: null };

  try {
    const { data, error } = await supabase
      .from('contribution_payments')
      .select('id,group_id,member_id,amount,currency,status,payment_method,receipt_number,collected_at,created_at')
      .eq('member_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { contributions: (data ?? []) as ContributionRow[], error: null };
  } catch (err) {
    return { contributions: [], error: toBackendError(err, 'Load contributions') };
  }
}

// ─────────────────────────────────────────────────────────────
// Get member contribution status (server-calculated)
// ─────────────────────────────────────────────────────────────

export interface MemberContributionStatus {
  groupId: string;
  memberId: string;
  totalPaid: number;
  outstandingBalance: number;
  paidCycles: number;
  totalCycles: number;
  lastContributionPeriod: string | null;
  lastPaidToDate: string | null;
  nextDueDate: string | null;
  expectedAmount: number;
  isFullyPaid: boolean;
}

export async function getMemberContributionStatus(
  groupId: string,
  memberId?: string
): Promise<{ status: MemberContributionStatus | null; error: Error | null }> {
  if (!supabaseConfigured) return { status: null, error: null };

  try {
    const { data, error } = await supabase.rpc('get_member_contribution_status', {
      p_group_id:  groupId,
      p_member_id: memberId ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    return {
      status: {
        groupId:                 result.group_id as string,
        memberId:                result.member_id as string,
        totalPaid:               Number(result.total_paid ?? 0),
        outstandingBalance:      Number(result.outstanding_balance ?? 0),
        paidCycles:              Number(result.paid_cycles ?? 0),
        totalCycles:             Number(result.total_cycles ?? 0),
        lastContributionPeriod:  result.last_contribution_period as string | null,
        lastPaidToDate:          result.last_paid_to_date as string | null,
        nextDueDate:             result.next_due_date as string | null,
        expectedAmount:          Number(result.expected_amount ?? 0),
        isFullyPaid:             Boolean(result.is_fully_paid),
      },
      error: null,
    };
  } catch (err) {
    return { status: null, error: toBackendError(err, 'Get contribution status') };
  }
}

// ─────────────────────────────────────────────────────────────
// Validate member eligibility (server-side)
// ─────────────────────────────────────────────────────────────

export async function validateMemberEligibility(
  groupId: string,
  memberId?: string
): Promise<{
  eligible: boolean;
  reason?: string;
  expectedAmount?: number;
  outstandingAmount?: number;
  error: Error | null;
}> {
  if (!supabaseConfigured) return { eligible: true, error: null };

  try {
    const { data, error } = await supabase.rpc('validate_member_eligibility', {
      p_group_id:  groupId,
      p_member_id: memberId ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;

    return {
      eligible:         Boolean(result.eligible),
      reason:           result.reason as string | undefined,
      expectedAmount:   result.expected_amount ? Number(result.expected_amount) : undefined,
      outstandingAmount: result.outstanding_amount ? Number(result.outstanding_amount) : undefined,
      error:            null,
    };
  } catch (err) {
    return { eligible: false, error: toBackendError(err, 'Validate eligibility') };
  }
}

// ─────────────────────────────────────────────────────────────
// Get contribution schedule (server-generated)
// ─────────────────────────────────────────────────────────────

export interface ScheduleEntry {
  cycleNumber: number;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  expectedAmount: number;
  isPaid: boolean;
  isOverdue: boolean;
}

export async function getContributionSchedule(
  groupId: string,
  memberId?: string
): Promise<{ schedule: ScheduleEntry[]; frequency: string; error: Error | null }> {
  if (!supabaseConfigured) return { schedule: [], frequency: 'monthly', error: null };

  try {
    const { data, error } = await supabase.rpc('generate_contribution_schedule', {
      p_group_id:  groupId,
      p_member_id: memberId ?? null,
    });

    if (error) throw error;
    const result = data as Record<string, unknown>;
    if (result?.error) throw new Error(result.error as string);

    const entries = ((result.schedule as unknown[]) ?? []).map((e) => {
      const entry = e as Record<string, unknown>;
      return {
        cycleNumber:    Number(entry.cycle_number),
        periodLabel:    entry.period_label as string,
        fromDate:       entry.from_date as string,
        toDate:         entry.to_date as string,
        expectedAmount: Number(entry.expected_amount),
        isPaid:         Boolean(entry.is_paid),
        isOverdue:      Boolean(entry.is_overdue),
      };
    });

    return { schedule: entries, frequency: result.frequency as string, error: null };
  } catch (err) {
    return { schedule: [], frequency: 'monthly', error: toBackendError(err, 'Get schedule') };
  }
}

// ─────────────────────────────────────────────────────────────
// Fetch payment by ID (read-only display)
// ─────────────────────────────────────────────────────────────

export async function fetchPaymentById(
  paymentId: string
): Promise<{ payment: Record<string, unknown> | null; error: Error | null }> {
  if (!supabaseConfigured) return { payment: null, error: null };

  try {
    const { data, error } = await supabase
      .from('contribution_payments')
      .select('id,group_id,member_id,amount,currency,status,payment_method,receipt_number,collected_at,created_at')
      .eq('id', paymentId)
      .single();

    if (error) throw error;
    return { payment: data as Record<string, unknown>, error: null };
  } catch (err) {
    return { payment: null, error: toBackendError(err, 'Fetch payment') };
  }
}
