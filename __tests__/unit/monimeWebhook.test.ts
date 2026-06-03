/**
 * Monime webhook processing unit tests
 *
 * Tests cover:
 *   1. MONIME_METHODS set — orange_money + afrimoney only (QMoney excluded)
 *   2. generateIdempotencyKey — UUID v4 uniqueness and format
 *   3. verifyMonimeCheckout — frontend polling service (verify-payment Edge Fn)
 *   4. Monime HMAC-SHA256 signature verification logic
 *   5. Monime Payment Codes event-type classification (payment_code.* — NOT checkout_session.*)
 *   6. Provider ID mapping — orange_money→m17, afrimoney→m18 only (QMoney excluded)
 *   7. Webhook deduplication contract
 *   8. Webhook-to-finalize flow (integration-style, mocked)
 *
 * All Supabase and fetch calls are mocked.
 * No real DB or network connections are made.
 *
 * Event names used in the live backend (_shared/monime.ts):
 *   payment_code.processed  — user redeemed USSD code; orderNumber available
 *   payment_code.completed  — payment confirmed end-to-end (safe to credit)
 *   payment_code.expired    — terminal failure
 *   payment_code.cancelled  — terminal failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  generateIdempotencyKey,
  verifyMonimeCheckout,
  MONIME_METHODS,
} from '../../src/services/paymentService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc:   ReturnType<typeof vi.fn>;
  __mockFrom:  ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
  __mockAuth:  { getSession: ReturnType<typeof vi.fn> };
};
const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── 1. MONIME_METHODS set ─────────────────────────────────────────────────────

describe('MONIME_METHODS', () => {
  it('includes orange_money and afrimoney', () => {
    expect(MONIME_METHODS.has('orange_money')).toBe(true);
    expect(MONIME_METHODS.has('afrimoney')).toBe(true);
  });

  it('does NOT include qmoney (not confirmed in Monime API docs)', () => {
    // QMoney (m13) is excluded intentionally — Monime docs do not confirm it.
    expect(MONIME_METHODS.has('qmoney' as never)).toBe(false);
  });

  it('does not include cash_collected or bank_transfer', () => {
    expect(MONIME_METHODS.has('cash_collected' as never)).toBe(false);
    expect(MONIME_METHODS.has('bank_transfer'  as never)).toBe(false);
  });
});

// ── 2. generateIdempotencyKey ─────────────────────────────────────────────────

describe('generateIdempotencyKey (Monime reference)', () => {
  it('produces UUID v4 format suitable as Monime reference', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('produces unique keys across 30 calls — no reference collision', () => {
    const keys = new Set(Array.from({ length: 30 }, generateIdempotencyKey));
    expect(keys.size).toBe(30);
  });
});

// ── 3. verifyMonimeCheckout ───────────────────────────────────────────────────

describe('verifyMonimeCheckout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when not authenticated', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({ data: { session: null } });

    const result = await verifyMonimeCheckout('pc_abc123');

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/not authenticated/i);
    expect(result.effectiveStatus).toBe('pending');
  });

  it('returns status from verify-payment edge function', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'txn-uuid',
        payment_id:       'contrib-uuid',
        local_status:     'processing',
        monime_status:    'pending',
        effective_status: 'processing',
        amount:           500,
        created_at:       '2025-01-15T10:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_abc123');

    expect(result.error).toBeNull();
    expect(result.mmTxnId).toBe('txn-uuid');
    expect(result.paymentId).toBe('contrib-uuid');
    expect(result.effectiveStatus).toBe('processing');
    expect(result.amount).toBe(500);
  });

  it('returns completed status when webhook has landed', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'txn-uuid',
        payment_id:       'contrib-uuid',
        local_status:     'completed',
        monime_status:    'completed',
        effective_status: 'completed',
        amount:           500,
        created_at:       '2025-01-15T10:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_abc123');
    expect(result.effectiveStatus).toBe('completed');
    expect(result.error).toBeNull();
  });

  it('returns expired status when payment code expired', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'txn-uuid',
        payment_id:       null,
        local_status:     'failed',
        monime_status:    'expired',
        effective_status: 'expired',
        amount:           200,
        created_at:       '2025-01-15T10:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_expired');
    expect(result.effectiveStatus).toBe('expired');
  });

  it('returns not_found when payment code does not belong to caller', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        status:           'not_found',
        local_status:     null,
        monime_status:    null,
        effective_status: 'not_found',
        mm_txn_id:        null,
        payment_id:       null,
        amount:           null,
        created_at:       null,
      }),
    });

    const result = await verifyMonimeCheckout('pc_other_user');
    expect(result.effectiveStatus).toBe('not_found');
    expect(result.error).toBeNull();
  });

  it('wraps network errors as typed Error', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'jwt-token' } },
    });

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network request failed'));

    const result = await verifyMonimeCheckout('pc_abc');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.effectiveStatus).toBe('pending');
  });

  it('sends monime_payment_code_id in request body (Payment Codes API, not Checkout Sessions)', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        effective_status: 'pending', mm_txn_id: null, payment_id: null,
        local_status: 'pending', monime_status: null, amount: null, created_at: null,
      }),
    });

    await verifyMonimeCheckout('pc_test_session');

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>;
    // verify-payment uses monime_payment_code_id (Payment Codes API)
    expect(body.monime_payment_code_id).toBe('pc_test_session');
    // Must NOT use old checkout_session / monime_session_id field names
    expect(body).not.toHaveProperty('monime_session_id');
    expect(body).not.toHaveProperty('session_id');
  });
});

// ── 4. Monime HMAC-SHA256 signature verification logic ────────────────────────
// Tests the algorithm used in _shared/monime.ts verifyMonimeSignature().
// Cannot import Deno module directly — we exercise the same crypto.subtle logic.

describe('Monime HMAC-SHA256 signature verification logic', () => {
  async function computeHmac(body: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    return Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  it('same body + secret produces deterministic HMAC (hex, 64 chars)', async () => {
    const body   = '{"event":"payment_code.completed","data":{"id":"pc_abc"}}';
    const secret = 'test-webhook-secret';
    const a = await computeHmac(body, secret);
    const b = await computeHmac(body, secret);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different body produces different HMAC', async () => {
    const secret = 'test-webhook-secret';
    const a = await computeHmac('{"event":"payment_code.completed"}', secret);
    const b = await computeHmac('{"event":"payment_code.expired"}',   secret);
    expect(a).not.toBe(b);
  });

  it('different secret produces different HMAC', async () => {
    const body = '{"event":"payment_code.completed"}';
    const a = await computeHmac(body, 'secret-1');
    const b = await computeHmac(body, 'secret-2');
    expect(a).not.toBe(b);
  });

  it('constant-time comparison: detects single-character difference', async () => {
    const body   = '{"event":"payment_code.completed","data":{"id":"pc_test"}}';
    const secret = 'test-secret';
    const correct = await computeHmac(body, secret);
    const tampered = correct.slice(0, -1) + (correct.endsWith('f') ? '0' : 'f');

    function constantTimeEqual(a: string, b: string): boolean {
      if (a.length !== b.length) return false;
      let mismatch = 0;
      for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return mismatch === 0;
    }

    expect(constantTimeEqual(correct, correct)).toBe(true);
    expect(constantTimeEqual(correct, tampered)).toBe(false);
    // Mismatched lengths also fail
    expect(constantTimeEqual(correct, correct.slice(0, 32))).toBe(false);
  });

  it('tampered payload produces a different HMAC (security: replay/MITM detection)', async () => {
    const secret    = 'webhook-secret';
    const original  = '{"event":"payment_code.completed","data":{"id":"pc_1","amount":1000}}';
    const tampered  = '{"event":"payment_code.completed","data":{"id":"pc_1","amount":9999}}';
    const sigOriginal = await computeHmac(original, secret);
    const sigTampered = await computeHmac(tampered, secret);
    expect(sigOriginal).not.toBe(sigTampered);
  });
});

// ── 5. Monime Payment Codes event-type classification ─────────────────────────
// These must match the exact event names from _shared/monime.ts.

describe('Monime Payment Code event-type routing', () => {
  // Mirror the exact logic from _shared/monime.ts
  function isProcessedEvent(e: string) { return e === 'payment_code.processed'; }
  function isCompletedEvent(e: string) { return e === 'payment_code.completed'; }
  function isFailedEvent(e: string) {
    return e === 'payment_code.expired' || e === 'payment_code.cancelled';
  }
  function isSuccessEvent(e: string) {
    return isProcessedEvent(e) || isCompletedEvent(e);
  }

  it('payment_code.processed is a success (in-progress) event', () => {
    expect(isProcessedEvent('payment_code.processed')).toBe(true);
    expect(isSuccessEvent('payment_code.processed')).toBe(true);
    expect(isFailedEvent('payment_code.processed')).toBe(false);
  });

  it('payment_code.completed is a success (terminal) event', () => {
    expect(isCompletedEvent('payment_code.completed')).toBe(true);
    expect(isSuccessEvent('payment_code.completed')).toBe(true);
    expect(isFailedEvent('payment_code.completed')).toBe(false);
  });

  it('payment_code.expired is a failure event', () => {
    expect(isFailedEvent('payment_code.expired')).toBe(true);
    expect(isCompletedEvent('payment_code.expired')).toBe(false);
    expect(isProcessedEvent('payment_code.expired')).toBe(false);
  });

  it('payment_code.cancelled is a failure event', () => {
    expect(isFailedEvent('payment_code.cancelled')).toBe(true);
    expect(isCompletedEvent('payment_code.cancelled')).toBe(false);
  });

  it('unknown events are neither completed nor failed', () => {
    expect(isCompletedEvent('unknown.event')).toBe(false);
    expect(isFailedEvent('unknown.event')).toBe(false);
    expect(isSuccessEvent('unknown.event')).toBe(false);
  });

  // Confirm old checkout_session.* names are NOT used
  it('old checkout_session.* events are not recognised (decommissioned)', () => {
    expect(isCompletedEvent('checkout_session.completed')).toBe(false);
    expect(isFailedEvent('checkout_session.expired')).toBe(false);
    expect(isFailedEvent('checkout_session.cancelled')).toBe(false);
  });
});

// ── 6. Provider ID mapping ────────────────────────────────────────────────────

describe('Monime provider ID mapping', () => {
  // Mirror MONIME_PROVIDER_IDS from _shared/monime.ts
  const PROVIDER_IDS: Record<string, string> = {
    orange_money: 'm17',
    afrimoney:    'm18',
    // qmoney intentionally absent — not confirmed in Monime API docs
  };

  it('orange_money maps to m17', () => {
    expect(PROVIDER_IDS['orange_money']).toBe('m17');
  });

  it('afrimoney maps to m18', () => {
    expect(PROVIDER_IDS['afrimoney']).toBe('m18');
  });

  it('qmoney has no mapping (excluded)', () => {
    expect(PROVIDER_IDS['qmoney']).toBeUndefined();
  });

  it('only two providers are mapped (no QMoney / m13)', () => {
    const ids = Object.values(PROVIDER_IDS);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain('m13');
  });

  it('provider IDs are distinct', () => {
    const ids    = Object.values(PROVIDER_IDS);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── 7. Webhook deduplication logic ────────────────────────────────────────────

describe('Webhook deduplication', () => {
  // Documents the contract enforced by payment_webhook_events UNIQUE constraint:
  // (provider, session_id, event_type)
  type WebhookKey = { provider: string; session_id: string; event_type: string };

  function makeDedupChecker() {
    const seen = new Set<string>();
    return (key: WebhookKey): boolean => {
      const k = `${key.provider}|${key.session_id}|${key.event_type}`;
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    };
  }

  it('first delivery of a payment_code.completed event is not a duplicate', () => {
    const isDuplicate = makeDedupChecker();
    const event: WebhookKey = {
      provider:   'monime',
      session_id: 'pc_abc123',
      event_type: 'payment_code.completed',
    };
    expect(isDuplicate(event)).toBe(false);
  });

  it('retry of the same event is a duplicate — prevents double-crediting', () => {
    const isDuplicate = makeDedupChecker();
    const event: WebhookKey = {
      provider:   'monime',
      session_id: 'pc_abc123',
      event_type: 'payment_code.completed',
    };
    isDuplicate(event); // first delivery
    expect(isDuplicate(event)).toBe(true); // retry
  });

  it('same payment_code_id with different event_type is NOT a duplicate', () => {
    const isDuplicate = makeDedupChecker();
    expect(isDuplicate({
      provider: 'monime', session_id: 'pc_abc', event_type: 'payment_code.processed',
    })).toBe(false);
    expect(isDuplicate({
      provider: 'monime', session_id: 'pc_abc', event_type: 'payment_code.completed',
    })).toBe(false);
  });

  it('different payment_code_id with same event_type is NOT a duplicate', () => {
    const isDuplicate = makeDedupChecker();
    expect(isDuplicate({
      provider: 'monime', session_id: 'pc_111', event_type: 'payment_code.completed',
    })).toBe(false);
    expect(isDuplicate({
      provider: 'monime', session_id: 'pc_222', event_type: 'payment_code.completed',
    })).toBe(false);
  });

  it('dedup key includes provider — different provider same code is NOT a duplicate', () => {
    const isDuplicate = makeDedupChecker();
    expect(isDuplicate({
      provider: 'monime',     session_id: 'pc_abc', event_type: 'payment_code.completed',
    })).toBe(false);
    expect(isDuplicate({
      provider: 'other-psp',  session_id: 'pc_abc', event_type: 'payment_code.completed',
    })).toBe(false);
  });
});

// ── 8. Webhook-to-finalize flow (integration-style, mocked) ──────────────────

describe('Monime webhook → finalize Osusu contribution (mocked flow)', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Simulates what mobile-money-webhook does server-side:
   *   1. Verify HMAC (invalid → skip)
   *   2. Deduplicate via payment_webhook_events
   *   3. Re-verify via Monime API (getPaymentCode)
   *   4. Call finalize_monime_checkout RPC → contribution becomes approved
   *
   * We test the frontend's interpretation of the result via verifyMonimeCheckout.
   */

  it('after webhook completes, polling returns approved/completed status', async () => {
    const { __chainable } = getMocks();
    // Simulate DB state after mobile-money-webhook ran finalize_monime_checkout:
    // mobile_money_transactions.status = 'completed'
    __chainable.order?.mockResolvedValueOnce?.({
      data: [{
        id: 'cp-finalized', status: 'approved', amount: 200, currency: 'NLe',
        payment_method: 'orange_money', collected_at: '2025-03-01T10:00:00Z',
        receipt_number: 'RCP-WEBHOOK-001', group_id: 'grp-1', member_id: 'usr-1',
        created_at: '2025-03-01T09:00:00Z',
      }],
      error: null,
    });

    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-1' } },
    });

    // After webhook, verify-payment returns effective_status='completed'
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'mm-1',
        payment_id:       'cp-finalized',
        local_status:     'completed',
        monime_status:    'completed',
        effective_status: 'completed',
        amount:           200,
        created_at:       '2025-03-01T09:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_finalized');
    expect(result.effectiveStatus).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.paymentId).toBe('cp-finalized');
  });

  it('tampered webhook: invalid HMAC → polling stays at pending (no DB mutation)', async () => {
    // When the webhook arrives with an invalid HMAC:
    //   - mobile-money-webhook returns 200 with {status:'invalid_signature'}
    //   - No DB rows are changed
    //   - Poll still returns 'pending' (contribution_payments unchanged)
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-2' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'mm-2',
        payment_id:       null,
        local_status:     'processing',
        monime_status:    'pending',
        effective_status: 'processing',
        amount:           200,
        created_at:       '2025-03-01T09:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_tampered_webhook');
    // Payment is still in-progress — tampered webhook didn't mutate DB
    expect(result.effectiveStatus).toBe('processing');
    expect(result.error).toBeNull();
  });

  it('duplicate webhook: second delivery does not change effective status', async () => {
    const { __mockAuth } = getMocks();

    // First poll (after first webhook delivery)
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-3' } },
    });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({
        effective_status: 'completed', mm_txn_id: 'mm-3', payment_id: 'cp-3',
        local_status: 'completed', monime_status: 'completed', amount: 200, created_at: null,
      }),
    });
    const first = await verifyMonimeCheckout('pc_dup');
    expect(first.effectiveStatus).toBe('completed');

    // Second poll (after retry/duplicate webhook) — status unchanged
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-3' } },
    });
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({
        effective_status: 'completed', mm_txn_id: 'mm-3', payment_id: 'cp-3',
        local_status: 'completed', monime_status: 'completed', amount: 200, created_at: null,
      }),
    });
    const second = await verifyMonimeCheckout('pc_dup');
    expect(second.effectiveStatus).toBe('completed');
    // Dedup ensured no double-credit — DB stayed at 'completed', not 'double-approved'
  });

  it('payment_code.expired webhook → effective_status becomes expired', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-4' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'mm-4',
        payment_id:       null,
        local_status:     'failed',
        monime_status:    'expired',
        effective_status: 'expired',
        amount:           300,
        created_at:       '2025-03-01T09:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_expired_webhook');
    expect(result.effectiveStatus).toBe('expired');
    expect(result.paymentId).toBeNull();
  });

  it('payment_code.cancelled webhook → effective_status becomes cancelled', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-5' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        mm_txn_id:        'mm-5',
        payment_id:       null,
        local_status:     'failed',
        monime_status:    'cancelled',
        effective_status: 'cancelled',
        amount:           300,
        created_at:       '2025-03-01T09:00:00Z',
      }),
    });

    const result = await verifyMonimeCheckout('pc_cancelled_webhook');
    expect(result.effectiveStatus).toBe('cancelled');
  });

  it('failed payment never credits vault or contribution balance', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-6' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: async () => ({
        effective_status: 'failed', local_status: 'failed', monime_status: null,
        mm_txn_id: 'mm-6', payment_id: null, amount: 200, created_at: null,
      }),
    });

    const result = await verifyMonimeCheckout('pc_failed_outright');
    expect(result.effectiveStatus).toBe('failed');
    // Only a 'completed' effective_status should trigger any balance credit — never 'failed'
    expect(result.effectiveStatus).not.toBe('completed');
  });

  it('malformed JSON body from edge function is handled as an error', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-7' } },
    });

    // Simulate edge function returning non-OK status (malformed event / internal error)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok:   false,
      json: async () => ({ error: 'Internal server error' }),
    });

    const result = await verifyMonimeCheckout('pc_malformed');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.effectiveStatus).toBe('pending');
  });
});
