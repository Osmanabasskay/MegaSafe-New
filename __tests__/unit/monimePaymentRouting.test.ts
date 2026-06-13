/**
 * Monime payment validation + webhook routing tests
 *
 * Imports the EXACT production module used by the edge functions
 * (supabase/functions/_shared/paymentValidation.ts — pure, Deno-free)
 * so these tests exercise the real routing/validation rules:
 *
 *   1. Provider validation — m17/m18 only, QMoney rejected with exact copy
 *   2. Amount/currency validation — NLe display vs SLE minor units
 *   3. Webhook routing — explicit per payment_type/target_type + DB fallback
 *   4. Failure status mapping — expired/cancelled/failed
 *   5. Payout status mapping — only 'completed' completes a withdrawal
 */

import { describe, it, expect } from 'vitest';
import {
  validateMonimeMethod,
  amountMatchesMinor,
  isSupportedCurrency,
  resolveWebhookRoute,
  mapFailureStatus,
  mapPayoutStatus,
  SUPPORTED_MONIME_PROVIDERS,
  QMONEY_UNSUPPORTED_MESSAGE,
  UNREGISTERED_NUMBER_MESSAGE,
} from '../../supabase/functions/_shared/paymentValidation';

// ── 1. Provider validation ────────────────────────────────────────────────────

describe('validateMonimeMethod', () => {
  it('accepts orange_money → m17', () => {
    const result = validateMonimeMethod('orange_money');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.providerId).toBe('m17');
  });

  it('accepts afrimoney → m18', () => {
    const result = validateMonimeMethod('afrimoney');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.providerId).toBe('m18');
  });

  it('rejects QMoney with the exact user-facing message', () => {
    const result = validateMonimeMethod('qmoney');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('qmoney_unsupported');
      expect(result.message).toBe('QMoney is not currently supported. Please use Orange Money or AfriMoney.');
    }
  });

  it('rejects the raw m13 provider id like QMoney', () => {
    const result = validateMonimeMethod('m13');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('qmoney_unsupported');
  });

  it('rejects unknown providers with the same clear message', () => {
    for (const method of ['bank_transfer', 'card', 'mpesa', '', null, undefined]) {
      const result = validateMonimeMethod(method as string);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toBe(QMONEY_UNSUPPORTED_MESSAGE);
    }
  });

  it('normalizes case and whitespace', () => {
    expect(validateMonimeMethod('  Orange_Money ').ok).toBe(true);
    expect(validateMonimeMethod('QMONEY').ok).toBe(false);
  });

  it('exposes exactly two supported providers (m17, m18)', () => {
    expect(Object.values(SUPPORTED_MONIME_PROVIDERS).sort()).toEqual(['m17', 'm18']);
  });

  it('unregistered-number message matches the audit requirement', () => {
    expect(UNREGISTERED_NUMBER_MESSAGE).toBe(
      'This number is not registered with Orange Money or AfriMoney. Please use a valid mobile money number.',
    );
  });
});

// ── 2. Amount / currency validation ───────────────────────────────────────────

describe('amountMatchesMinor', () => {
  it('matches NLe display amount against SLE minor units (1 NLe = 100)', () => {
    expect(amountMatchesMinor(50, 5000)).toBe(true);
    expect(amountMatchesMinor(10.5, 1050)).toBe(true);
    expect(amountMatchesMinor(0.01, 1)).toBe(true);
  });

  it('rejects any mismatch — no tolerance for real money', () => {
    expect(amountMatchesMinor(50, 5001)).toBe(false);
    expect(amountMatchesMinor(50, 4999)).toBe(false);
    expect(amountMatchesMinor(50, 500)).toBe(false);   // off by 10×
    expect(amountMatchesMinor(50, 500000)).toBe(false); // off by 100×
  });

  it('rejects non-finite inputs', () => {
    expect(amountMatchesMinor(NaN, 5000)).toBe(false);
    expect(amountMatchesMinor(50, NaN)).toBe(false);
    expect(amountMatchesMinor(Infinity, Infinity)).toBe(false);
  });
});

describe('isSupportedCurrency', () => {
  it('accepts only SLE', () => {
    expect(isSupportedCurrency('SLE')).toBe(true);
    expect(isSupportedCurrency('SLL')).toBe(false);
    expect(isSupportedCurrency('NLe')).toBe(false);
    expect(isSupportedCurrency('USD')).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
  });
});

// ── 3. Webhook routing ────────────────────────────────────────────────────────

describe('resolveWebhookRoute', () => {
  it('routes osusu_contribution to the contribution finalizer', () => {
    expect(resolveWebhookRoute({ payment_type: 'osusu_contribution' }))
      .toEqual({ route: 'osusu_contribution' });
  });

  it('routes send_payment + group to the send-payment finalizer', () => {
    expect(resolveWebhookRoute({ payment_type: 'send_payment', target_type: 'group' }))
      .toEqual({ route: 'send_payment_group' });
  });

  it('routes send_payment + savings to the savings finalizer', () => {
    expect(resolveWebhookRoute({ payment_type: 'send_payment', target_type: 'savings' }))
      .toEqual({ route: 'send_payment_savings' });
  });

  it('flags vault_topup as misrouted (belongs to vault-webhook)', () => {
    expect(resolveWebhookRoute({ payment_type: 'vault_topup' }))
      .toEqual({ route: 'vault_topup_misrouted' });
  });

  it('unknown payment_type never finalizes', () => {
    expect(resolveWebhookRoute({ payment_type: 'gift_card' })).toEqual({ route: 'unknown' });
    expect(resolveWebhookRoute({ payment_type: 'send_payment', target_type: 'crypto' }))
      .toEqual({ route: 'unknown' });
  });

  it('send_payment without target_type falls back to the stored intent', () => {
    expect(resolveWebhookRoute({ payment_type: 'send_payment' }, { intentTargetType: 'savings' }))
      .toEqual({ route: 'send_payment_savings' });
    expect(resolveWebhookRoute({ payment_type: 'send_payment' }, { intentTargetType: 'group' }))
      .toEqual({ route: 'send_payment_group' });
    expect(resolveWebhookRoute({ payment_type: 'send_payment' }, {}))
      .toEqual({ route: 'unknown' });
  });

  it('no metadata at all: derives the route from server-side records', () => {
    expect(resolveWebhookRoute(null, { intentTargetType: 'group' }))
      .toEqual({ route: 'send_payment_group' });
    expect(resolveWebhookRoute(null, { intentTargetType: 'savings' }))
      .toEqual({ route: 'send_payment_savings' });
    expect(resolveWebhookRoute(null, { hasContribution: true }))
      .toEqual({ route: 'osusu_contribution' });
    expect(resolveWebhookRoute(null, {})).toEqual({ route: 'unknown' });
    expect(resolveWebhookRoute(undefined)).toEqual({ route: 'unknown' });
  });

  it('metadata wins over DB fallback (intent fallback never overrides explicit type)', () => {
    expect(resolveWebhookRoute(
      { payment_type: 'osusu_contribution' },
      { intentTargetType: 'savings', hasContribution: true },
    )).toEqual({ route: 'osusu_contribution' });
  });
});

// ── 4. Failure status mapping ─────────────────────────────────────────────────

describe('mapFailureStatus', () => {
  it('maps Monime terminal reasons to the canonical status model', () => {
    expect(mapFailureStatus('expired')).toBe('expired');
    expect(mapFailureStatus('cancelled')).toBe('cancelled');
    expect(mapFailureStatus('canceled')).toBe('cancelled');
    expect(mapFailureStatus('declined')).toBe('failed');
    expect(mapFailureStatus(null)).toBe('failed');
  });
});

// ── 5. Payout status mapping ──────────────────────────────────────────────────

describe('mapPayoutStatus', () => {
  it('only completed payouts complete a withdrawal', () => {
    expect(mapPayoutStatus('completed')).toEqual({ recordStatus: 'completed', terminal: true });
  });

  it('failed / rejected / cancelled are terminal failures', () => {
    expect(mapPayoutStatus('failed')).toEqual({ recordStatus: 'failed', terminal: true });
    expect(mapPayoutStatus('rejected')).toEqual({ recordStatus: 'failed', terminal: true });
    expect(mapPayoutStatus('cancelled')).toEqual({ recordStatus: 'cancelled', terminal: true });
  });

  it('in-flight payouts stay non-terminal (withdrawal remains processing)', () => {
    expect(mapPayoutStatus('processing')).toEqual({ recordStatus: 'processing', terminal: false });
    expect(mapPayoutStatus('pending')).toEqual({ recordStatus: 'pending', terminal: false });
    expect(mapPayoutStatus('something_new')).toEqual({ recordStatus: 'pending', terminal: false });
    expect(mapPayoutStatus(null)).toEqual({ recordStatus: 'pending', terminal: false });
  });
});
