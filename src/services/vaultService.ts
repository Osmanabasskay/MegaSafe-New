/**
 * vaultService — THIN FRONTEND CLIENT
 *
 * All financial operations proxy through backend RPCs or Edge Functions.
 * The frontend NEVER calculates balances, fees, or payment outcomes.
 * All amounts shown are server-authoritative.
 */

import { supabase, supabaseConfigured } from './supabase';
import { toBackendError }               from './backendErrors';
import { generateIdempotencyKey }       from './paymentService';

// ── Types ────────────────────────────────────────────────────────

export interface VaultSummary {
  postedBalance:     number;
  reservedBalance:   number;
  availableBalance:  number;
  pendingTopupCount: number;
  pendingTopupAmount: number;
  currency:          string;
}

export type VaultTopupMethod = 'orange_money' | 'afrimoney';
// qmoney is intentionally excluded — not supported via Monime

export interface VaultTopupResult {
  success:               boolean;
  topupId:               string | null;
  monimePaymentCodeId:   string | null;
  ussdCode:              string | null;   // USSD dial string for the user e.g. "*144*5*123456#"
  expiresAt:             string | null;   // ISO timestamp when the payment code expires
  amount:                number | null;
  status:                string | null;
  idempotent:            boolean;
  error:                 Error | null;
}

export type VaultTopupEffectiveStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface VaultTopupStatusResult {
  topupId:               string | null;
  dbStatus:              string | null;
  monimeStatus:          string | null;
  effectiveStatus:       VaultTopupEffectiveStatus;
  amount:                number | null;
  currency:              string | null;
  ussdCode:              string | null;
  monimePaymentCodeId:   string | null;
  completedAt:           string | null;
  error:                 Error | null;
}

export interface PayOsusuResult {
  success:        boolean;
  contributionId: string | null;
  reservationId:  string | null;
  amount:         number | null;
  fee:            number | null;
  idempotent:     boolean;
  error:          Error | null;
}

export interface DepositSavingsResult {
  success:         boolean;
  transactionId:   string | null;
  newGoalBalance:  number | null;
  amountDeposited: number | null;
  idempotent:      boolean;
  error:           Error | null;
}

// ── Helpers ──────────────────────────────────────────────────────

function getEdgeUrl(path: string): string {
  const url =
    (supabase as unknown as { supabaseUrl: string }).supabaseUrl ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    '';
  return `${url}/functions/v1/${path}`;
}

async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// ── Get Vault Summary ────────────────────────────────────────────

export async function getVaultSummary(): Promise<{
  summary: VaultSummary | null;
  error: Error | null;
}> {
  if (!supabaseConfigured) {
    return {
      summary: {
        postedBalance: 0, reservedBalance: 0, availableBalance: 0,
        pendingTopupCount: 0, pendingTopupAmount: 0, currency: 'NLe',
      },
      error: null,
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_vault_summary');
    if (error) throw error;
    const r = data as Record<string, unknown>;
    if (r?.error) throw new Error(r.error as string);

    return {
      summary: {
        postedBalance:      Number(r.posted_balance      ?? 0),
        reservedBalance:    Number(r.reserved_balance    ?? 0),
        availableBalance:   Number(r.available_balance   ?? 0),
        pendingTopupCount:  Number(r.pending_topup_count ?? 0),
        pendingTopupAmount: Number(r.pending_topup_amount ?? 0),
        currency:           String(r.currency ?? 'NLe'),
      },
      error: null,
    };
  } catch (err) {
    return { summary: null, error: toBackendError(err, 'Get vault summary') };
  }
}

// ── Initiate Vault Top-Up ────────────────────────────────────────

export async function initiateVaultTopup(params: {
  amount:          number;
  method:          VaultTopupMethod;
  idempotencyKey?: string;
  description?:    string;
}): Promise<VaultTopupResult> {
  const blank: VaultTopupResult = {
    success: false, topupId: null, monimePaymentCodeId: null,
    ussdCode: null, expiresAt: null, amount: null, status: null, idempotent: false, error: null,
  };
  if (!supabaseConfigured) return { ...blank, success: true, status: 'demo' };

  try {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated.');

    const iKey = params.idempotencyKey ?? generateIdempotencyKey();
    const resp = await fetch(getEdgeUrl('initiate-vault-topup'), {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:          params.amount,
        method:          params.method,
        idempotency_key: iKey,
        description:     params.description ?? null,
      }),
    });

    const json = await resp.json() as Record<string, unknown>;
    if (!resp.ok || json.error) {
      throw new Error((json.error as string) ?? `Top-up initiation failed (${resp.status})`);
    }

    return {
      success:             Boolean(json.success),
      topupId:             (json.topup_id              as string | null) ?? null,
      monimePaymentCodeId: (json.monime_payment_code_id as string | null) ?? null,
      ussdCode:            (json.ussd_code              as string | null) ?? null,
      expiresAt:           (json.expires_at             as string | null) ?? null,
      amount:              json.amount != null ? Number(json.amount) : null,
      status:              (json.status                 as string | null) ?? null,
      idempotent:          Boolean(json.idempotent),
      error:               null,
    };
  } catch (err) {
    return { ...blank, error: toBackendError(err, 'Initiate vault top-up') };
  }
}

// ── Verify Vault Top-Up Status ───────────────────────────────────

export async function verifyVaultTopupStatus(params: {
  topupId?:             string;
  monimePaymentCodeId?: string;
  monimeSessionId?:     string;  // backward compat for older records
}): Promise<VaultTopupStatusResult> {
  const blank: VaultTopupStatusResult = {
    topupId: null, dbStatus: null, monimeStatus: null,
    effectiveStatus: 'pending', amount: null, currency: null,
    ussdCode: null, monimePaymentCodeId: null, completedAt: null, error: null,
  };
  if (!supabaseConfigured) return blank;

  try {
    const token = await getAuthToken();
    if (!token) throw new Error('Not authenticated.');

    const resp = await fetch(getEdgeUrl('verify-vault-topup-status'), {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topup_id:               params.topupId              ?? null,
        monime_payment_code_id: params.monimePaymentCodeId  ?? null,
        monime_session_id:      params.monimeSessionId       ?? null,
      }),
    });

    const json = await resp.json() as Record<string, unknown>;
    if (!resp.ok || json.error) {
      throw new Error((json.error as string) ?? `Status check failed (${resp.status})`);
    }

    return {
      topupId:             (json.topup_id              as string | null) ?? null,
      dbStatus:            (json.db_status             as string | null) ?? null,
      monimeStatus:        (json.monime_status         as string | null) ?? null,
      effectiveStatus:     (json.effective_status as VaultTopupEffectiveStatus) ?? 'pending',
      amount:              json.amount != null ? Number(json.amount) : null,
      currency:            (json.currency              as string | null) ?? null,
      ussdCode:            (json.ussd_code             as string | null) ?? null,
      monimePaymentCodeId: (json.monime_payment_code_id as string | null) ?? null,
      completedAt:         (json.completed_at          as string | null) ?? null,
      error:               null,
    };
  } catch (err) {
    return { ...blank, error: toBackendError(err, 'Verify vault top-up status') };
  }
}

// ── Pay Osusu From Vault ─────────────────────────────────────────

export async function payOsusuFromVault(params: {
  groupId:          string;
  periodId?:        string | null;
  idempotencyKey?:  string;
  notes?:           string;
}): Promise<PayOsusuResult> {
  const blank: PayOsusuResult = {
    success: false, contributionId: null, reservationId: null,
    amount: null, fee: null, idempotent: false, error: null,
  };
  if (!supabaseConfigured) return { ...blank, success: true };

  try {
    const iKey = params.idempotencyKey ?? generateIdempotencyKey();

    const { data, error } = await supabase.rpc('pay_osusu_from_vault', {
      p_group_id:        params.groupId,
      p_period_id:       params.periodId ?? null,
      p_idempotency_key: iKey,
      p_notes:           params.notes ?? null,
    });

    if (error) throw error;
    const r = data as Record<string, unknown>;
    if (r?.error) throw new Error(r.error as string);

    return {
      success:        Boolean(r.success),
      contributionId: (r.contribution_id as string | null) ?? null,
      reservationId:  (r.reservation_id  as string | null) ?? null,
      amount:         r.amount != null ? Number(r.amount) : null,
      fee:            r.fee    != null ? Number(r.fee)    : null,
      idempotent:     Boolean(r.idempotent),
      error:          null,
    };
  } catch (err) {
    return { ...blank, error: toBackendError(err, 'Pay Osusu from vault') };
  }
}

// ── Deposit Savings From Vault ───────────────────────────────────

export async function depositSavingsFromVault(params: {
  goalId:          string;
  amount:          number;
  idempotencyKey?: string;
}): Promise<DepositSavingsResult> {
  const blank: DepositSavingsResult = {
    success: false, transactionId: null, newGoalBalance: null,
    amountDeposited: null, idempotent: false, error: null,
  };
  if (!supabaseConfigured) return { ...blank, success: true };

  try {
    const iKey = params.idempotencyKey ?? generateIdempotencyKey();

    const { data, error } = await supabase.rpc('deposit_savings_from_vault', {
      p_goal_id:         params.goalId,
      p_amount:          params.amount,
      p_idempotency_key: iKey,
    });

    if (error) throw error;
    const r = data as Record<string, unknown>;
    if (r?.error) throw new Error(r.error as string);

    return {
      success:         Boolean(r.success),
      transactionId:   (r.transaction_id  as string | null) ?? null,
      newGoalBalance:  r.new_goal_balance  != null ? Number(r.new_goal_balance)  : null,
      amountDeposited: r.amount_deposited  != null ? Number(r.amount_deposited)  : null,
      idempotent:      Boolean(r.idempotent),
      error:           null,
    };
  } catch (err) {
    return { ...blank, error: toBackendError(err, 'Deposit savings from vault') };
  }
}
