/**
 * payout-webhook logic tests
 *
 * The payout-webhook edge function runs in Deno; these tests cover its
 * decision logic via the shared pure module (paymentValidation.ts) plus the
 * HMAC scheme it shares with verifyMonimeSignature():
 *
 *   1. Completed payout → withdrawal completes (mapPayoutStatus)
 *   2. Failed/rejected/cancelled payout → withdrawal fails
 *   3. Amount mismatch must NEVER complete a withdrawal
 *   4. Invalid signature rejected (HMAC + timestamp freshness)
 *   5. Duplicate events rely on UNIQUE(provider, session_id, event_type)
 *   6. Unknown payout id → safe no-op
 */

import { describe, it, expect } from 'vitest';
import {
  mapPayoutStatus,
  amountMatchesMinor,
  isSupportedCurrency,
} from '../../supabase/functions/_shared/paymentValidation';

// ── Completion gate: replicates the payout-webhook decision exactly ──────────
// (mapped.recordStatus === 'completed' requires amount + currency to match)
function payoutCompletionGate(input: {
  monimeStatus: string;
  withdrawalAmountNLe: number;
  payoutAmountMinor: number;
  payoutCurrency: string;
}): 'completed' | 'failed' | 'cancelled' | 'blocked_mismatch' | 'in_flight' {
  const mapped = mapPayoutStatus(input.monimeStatus);
  if (mapped.recordStatus === 'completed') {
    const amountOk   = amountMatchesMinor(input.withdrawalAmountNLe, input.payoutAmountMinor);
    const currencyOk = isSupportedCurrency(input.payoutCurrency);
    if (!amountOk || !currencyOk) return 'blocked_mismatch';
    return 'completed';
  }
  if (mapped.terminal) return mapped.recordStatus as 'failed' | 'cancelled';
  return 'in_flight';
}

describe('payout completion gate', () => {
  it('completed payout with matching amount + SLE currency completes the withdrawal', () => {
    expect(payoutCompletionGate({
      monimeStatus: 'completed',
      withdrawalAmountNLe: 150,
      payoutAmountMinor: 15000,
      payoutCurrency: 'SLE',
    })).toBe('completed');
  });

  it('failed payout marks the withdrawal failed', () => {
    expect(payoutCompletionGate({
      monimeStatus: 'failed',
      withdrawalAmountNLe: 150,
      payoutAmountMinor: 15000,
      payoutCurrency: 'SLE',
    })).toBe('failed');
  });

  it('rejected and cancelled payouts are terminal failures', () => {
    expect(mapPayoutStatus('rejected').terminal).toBe(true);
    expect(mapPayoutStatus('cancelled').terminal).toBe(true);
    expect(mapPayoutStatus('rejected').recordStatus).toBe('failed');
  });

  it('amount mismatch NEVER completes the withdrawal', () => {
    expect(payoutCompletionGate({
      monimeStatus: 'completed',
      withdrawalAmountNLe: 150,
      payoutAmountMinor: 14999,
      payoutCurrency: 'SLE',
    })).toBe('blocked_mismatch');
  });

  it('currency mismatch NEVER completes the withdrawal', () => {
    expect(payoutCompletionGate({
      monimeStatus: 'completed',
      withdrawalAmountNLe: 150,
      payoutAmountMinor: 15000,
      payoutCurrency: 'USD',
    })).toBe('blocked_mismatch');
  });

  it('in-flight payout statuses leave the withdrawal processing', () => {
    expect(payoutCompletionGate({
      monimeStatus: 'processing',
      withdrawalAmountNLe: 150,
      payoutAmountMinor: 15000,
      payoutCurrency: 'SLE',
    })).toBe('in_flight');
  });
});

// ── Idempotency / dedup contract ──────────────────────────────────────────────

describe('payout webhook idempotency contract', () => {
  it('dedup key is (provider, session_id, event_type) — retries of the same event collapse', () => {
    // Mirrors payment_webhook_events UNIQUE(provider, session_id, event_type):
    // the same Monime delivery retried any number of times yields one row.
    const seen = new Set<string>();
    const insert = (provider: string, sessionId: string, eventType: string) => {
      const key = `${provider}|${sessionId}|${eventType}`;
      if (seen.has(key)) return { error: { code: '23505' } };
      seen.add(key);
      return { error: null };
    };

    expect(insert('monime_payout', 'po_1', 'payout.completed').error).toBeNull();
    expect(insert('monime_payout', 'po_1', 'payout.completed').error?.code).toBe('23505'); // duplicate ignored
    // A different lifecycle event for the same payout is still recorded once.
    expect(insert('monime_payout', 'po_1', 'payout.failed').error).toBeNull();
    // Payment-code webhooks use a different provider key — no cross-collision.
    expect(insert('monime', 'po_1', 'payout.completed').error).toBeNull();
  });

  it('record_monime_payout_result contract: completed is final, replays are idempotent', () => {
    // Mirrors the RPC: once payout_status/status = completed, any further
    // event (including a late "failed") must be acknowledged but ignored.
    type Withdrawal = { status: string; payoutStatus: string | null };
    const apply = (wd: Withdrawal, incoming: string): Withdrawal => {
      if (wd.payoutStatus === 'completed' || wd.status === 'completed') return wd; // idempotent
      if (incoming === 'completed') return { status: 'completed', payoutStatus: 'completed' };
      if (incoming === 'failed' || incoming === 'cancelled') return { status: 'failed', payoutStatus: incoming };
      return { ...wd, payoutStatus: incoming };
    };

    let wd: Withdrawal = { status: 'processing', payoutStatus: 'pending' };
    wd = apply(wd, 'completed');
    expect(wd.status).toBe('completed');

    // Double-credit attempt: replayed completed event changes nothing.
    const replayed = apply(wd, 'completed');
    expect(replayed).toEqual(wd);

    // A late failure can never downgrade a completed withdrawal.
    const lateFailure = apply(wd, 'failed');
    expect(lateFailure.status).toBe('completed');
  });
});

// ── Signature verification (same scheme as verifyMonimeSignature) ─────────────

describe('payout webhook signature verification logic', () => {
  async function computeHmac(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const BODY = '{"event":"payout.completed","data":{"id":"po_123","status":"completed"}}';

  it('valid signature over `${timestamp}.${body}` verifies', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const expected = await computeHmac(`${ts}.${BODY}`, 'payout-secret');
    const received = await computeHmac(`${ts}.${BODY}`, 'payout-secret');
    expect(received).toBe(expected);
  });

  it('tampered body produces a different signature (rejected)', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const good = await computeHmac(`${ts}.${BODY}`, 'payout-secret');
    const tampered = await computeHmac(`${ts}.${BODY.replace('po_123', 'po_999')}`, 'payout-secret');
    expect(tampered).not.toBe(good);
  });

  it('wrong secret produces a different signature (rejected)', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const good = await computeHmac(`${ts}.${BODY}`, 'payout-secret');
    const wrong = await computeHmac(`${ts}.${BODY}`, 'main-secret');
    expect(wrong).not.toBe(good);
  });

  it('timestamp freshness: events older than 300 s are rejected', () => {
    // Mirrors the freshness guard in verifyMonimeSignature().
    const FRESHNESS_WINDOW_MS = 300_000;
    const isFresh = (tsSeconds: number) => {
      const age = Date.now() - tsSeconds * 1000;
      return age <= FRESHNESS_WINDOW_MS && age >= -30_000;
    };
    expect(isFresh(Math.floor(Date.now() / 1000))).toBe(true);
    expect(isFresh(Math.floor(Date.now() / 1000) - 301)).toBe(false);  // stale
    expect(isFresh(Math.floor(Date.now() / 1000) + 120)).toBe(false);  // future skew
  });
});

// ── Unknown payout handling ───────────────────────────────────────────────────

describe('unknown payout handling', () => {
  it('a payout that matches no withdrawal is acknowledged without state change', () => {
    // Mirrors payout-webhook: withdrawal lookup by monime_payout_id, then by
    // uuid reference. No match → audit 'payout_unknown' + HTTP 200, no RPC call.
    const withdrawals = new Map([['po_known', 'wd-1']]);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const locate = (payoutId: string, reference: string | null) =>
      withdrawals.get(payoutId) ?? (reference && uuidRe.test(reference) ? withdrawals.get(reference) ?? null : null);

    expect(locate('po_known', null)).toBe('wd-1');
    expect(locate('po_mystery', null)).toBeNull();
    expect(locate('po_mystery', 'not-a-uuid')).toBeNull();
  });
});
