/**
 * paymentValidation.ts — pure payment validation + webhook routing logic.
 *
 * IMPORTANT: This module must stay dependency-free and Deno-free (no Deno.*,
 * no imports). It is shared between the Supabase Edge Functions and the
 * vitest suite (__tests__), which imports it directly to test the exact
 * production routing/validation rules.
 */

// ── Supported providers ────────────────────────────────────────────────────────

/** Monime provider IDs confirmed in the Monime docs. QMoney (m13) is NOT confirmed. */
export const SUPPORTED_MONIME_PROVIDERS: Record<string, string> = {
  orange_money: 'm17',
  afrimoney:    'm18',
};

export const QMONEY_UNSUPPORTED_MESSAGE =
  'QMoney is not currently supported. Please use Orange Money or AfriMoney.';

export const UNREGISTERED_NUMBER_MESSAGE =
  'This number is not registered with Orange Money or AfriMoney. Please use a valid mobile money number.';

export const PROVIDER_KYC_UNAVAILABLE_MESSAGE =
  'We could not verify your mobile money number right now. Please try again in a few minutes.';

export type ProviderValidation =
  | { ok: true; providerId: string; method: 'orange_money' | 'afrimoney' }
  | { ok: false; code: 'qmoney_unsupported' | 'unsupported_provider'; message: string };

/**
 * Validates a payment method/provider before any Monime call.
 * QMoney and unknown providers never reach payment-code creation.
 */
export function validateMonimeMethod(method: string | null | undefined): ProviderValidation {
  const normalized = String(method ?? '').trim().toLowerCase();
  if (normalized === 'orange_money' || normalized === 'afrimoney') {
    return { ok: true, providerId: SUPPORTED_MONIME_PROVIDERS[normalized], method: normalized };
  }
  if (normalized === 'qmoney' || normalized === 'm13') {
    return { ok: false, code: 'qmoney_unsupported', message: QMONEY_UNSUPPORTED_MESSAGE };
  }
  return { ok: false, code: 'unsupported_provider', message: QMONEY_UNSUPPORTED_MESSAGE };
}

// ── Amount / currency validation ───────────────────────────────────────────────

/**
 * Compares a display amount (NLe) against Monime's verified minor units (SLE).
 * 1 NLe = 100 minor units. Exact integer match required — no tolerance.
 */
export function amountMatchesMinor(displayAmount: number, verifiedMinor: number): boolean {
  if (!Number.isFinite(displayAmount) || !Number.isFinite(verifiedMinor)) return false;
  return Math.round(displayAmount * 100) === Math.round(verifiedMinor);
}

/** Monime collections/payouts must be SLE. */
export function isSupportedCurrency(currency: string | null | undefined): boolean {
  return currency === 'SLE';
}

// ── Webhook routing ────────────────────────────────────────────────────────────

export type WebhookRoute =
  | { route: 'osusu_contribution' }
  | { route: 'send_payment_group' }
  | { route: 'send_payment_savings' }
  | { route: 'vault_topup_misrouted' }
  | { route: 'unknown' };

export interface WebhookRouteMeta {
  payment_type?: string | null;
  target_type?: string | null;
}

export interface WebhookRouteFallback {
  /** A payment_intents row exists with provider_reference = payment code id. */
  intentTargetType?: 'group' | 'savings' | null;
  /** A mobile_money_transactions row exists with payment_id → contribution_payments. */
  hasContribution?: boolean;
}

/**
 * Explicit webhook routing for mobile-money-webhook.
 *
 * Priority:
 *   1. Trusted stored metadata (set server-side at payment-code creation and
 *      echoed back by the Monime API on re-verification — never client input).
 *   2. DB fallback for legacy codes created before metadata was attached.
 *
 * Unknown payment types are never finalized.
 */
export function resolveWebhookRoute(
  meta: WebhookRouteMeta | null | undefined,
  fallback?: WebhookRouteFallback,
): WebhookRoute {
  const paymentType = String(meta?.payment_type ?? '').trim().toLowerCase();
  const targetType  = String(meta?.target_type ?? '').trim().toLowerCase();

  if (paymentType === 'osusu_contribution') return { route: 'osusu_contribution' };
  if (paymentType === 'vault_topup')        return { route: 'vault_topup_misrouted' };
  if (paymentType === 'send_payment') {
    if (targetType === 'group')   return { route: 'send_payment_group' };
    if (targetType === 'savings') return { route: 'send_payment_savings' };
    // send_payment without target_type: fall back to the stored intent.
    if (fallback?.intentTargetType === 'group')   return { route: 'send_payment_group' };
    if (fallback?.intentTargetType === 'savings') return { route: 'send_payment_savings' };
    return { route: 'unknown' };
  }
  if (paymentType !== '') return { route: 'unknown' };

  // No metadata at all (legacy payment codes): derive from server-side records.
  if (fallback?.intentTargetType === 'group')   return { route: 'send_payment_group' };
  if (fallback?.intentTargetType === 'savings') return { route: 'send_payment_savings' };
  if (fallback?.hasContribution)                return { route: 'osusu_contribution' };
  return { route: 'unknown' };
}

// ── Status mapping ─────────────────────────────────────────────────────────────

/** Maps a Monime payment_code failure event/reason to the canonical status. */
export function mapFailureStatus(reason: string | null | undefined): 'expired' | 'cancelled' | 'failed' {
  const normalized = String(reason ?? '').trim().toLowerCase();
  if (normalized === 'expired') return 'expired';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'failed';
}

/**
 * Maps a Monime payout status (re-verified via API) to the withdrawal lifecycle.
 * Only 'completed' may complete a withdrawal; failed/cancelled/rejected fail it;
 * anything in flight stays 'processing'.
 */
export function mapPayoutStatus(monimeStatus: string | null | undefined): {
  recordStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  terminal: boolean;
} {
  const normalized = String(monimeStatus ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'completed':                  return { recordStatus: 'completed', terminal: true };
    case 'failed':
    case 'rejected':                   return { recordStatus: 'failed',    terminal: true };
    case 'cancelled':
    case 'canceled':                   return { recordStatus: 'cancelled', terminal: true };
    case 'processing':                 return { recordStatus: 'processing', terminal: false };
    default:                           return { recordStatus: 'pending',    terminal: false };
  }
}
