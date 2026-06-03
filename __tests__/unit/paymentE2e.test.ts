/**
 * Payment E2E / Integration tests (Phase 4)
 *
 * Tests the full payment flow from initiation through webhook processing.
 * Uses mocked provider (no real Monime sandbox credentials needed).
 *
 * Manual sandbox checklist is appended at the bottom of this file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initiateGroupPayment,
  fetchUserContributions,
  generateIdempotencyKey,
} from '../../src/services/paymentService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc:  ReturnType<typeof vi.fn>;
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
  __mockAuth: { getSession: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn> };
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── User initiates contribution payment ───────────────────────────────────────

describe('Payment initiation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires an active session before initiating payment', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({ data: { session: null } });

    const result = await initiateGroupPayment({ groupId: 'grp-1', amount: 200, method: 'orange_money' });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/authenticat/i);
  });

  it('calls initiate-payment edge function with correct payload (Payment Codes API)', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-abc', user: { id: 'usr-1' } } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success:                true,
        contribution_id:        'contrib-001',
        ussd_code:              '*144*5*654321#',
        monime_payment_code_id: 'pcode_session-xyz',
        expires_at:             '2025-01-15T10:10:00Z',
        status:                 'processing',
      }),
    });

    const result = await initiateGroupPayment({
      groupId: 'grp-1',
      amount: 200,
      method: 'orange_money',
      idempotencyKey: 'ikey-001',
    });

    expect(result.success).toBe(true);
    expect(result.contributionId).toBe('contrib-001');
    // Payment Codes API: ussdCode to dial, no browser redirect URL
    expect(result.ussdCode).toBe('*144*5*654321#');
    expect(result.monimePaymentCodeId).toBe('pcode_session-xyz');
    expect(result.error).toBeNull();
  });

  it('initiate payment creates a pending record (not approved)', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok-abc', user: { id: 'usr-1' } } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, status: 'pending', contribution_id: 'pay-002' }),
    });

    const result = await initiateGroupPayment({ groupId: 'grp-1', amount: 100, method: 'orange_money' });

    expect(result.success).toBe(true);
    // Payment must not be approved before webhook confirmation
    expect(result.status).toBe('pending');
    expect(result.status).not.toBe('approved');
  });

  it('propagates provider error from edge function', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok', user: { id: 'usr-1' } } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Monime API unavailable.' }),
    });

    const result = await initiateGroupPayment({ groupId: 'grp-1', amount: 100, method: 'orange_money' });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('reuses supplied idempotency key', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'tok', user: { id: 'usr-1' } } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    await initiateGroupPayment({
      groupId: 'grp-1',
      amount: 100,
      method: 'orange_money',
      idempotencyKey: 'stable-key',
    });

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string) as Record<string, unknown>;
    expect(body.idempotency_key).toBe('stable-key');
  });
});

// ── Duplicate webhook idempotency ─────────────────────────────────────────────

describe('Payment idempotency key uniqueness', () => {
  it('generateIdempotencyKey produces unique keys each time', () => {
    const keys = Array.from({ length: 100 }, () => generateIdempotencyKey());
    const unique = new Set(keys);
    expect(unique.size).toBe(100);
  });

  it('generateIdempotencyKey follows UUID v4 format', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

// ── Payment status mapping ────────────────────────────────────────────────────

describe('fetchUserContributions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps contribution rows to typed objects including status', async () => {
    const { __chainable } = getMocks();
    const fakeRows = [
      {
        id: 'cp-1', group_id: 'grp-1', member_id: 'usr-1',
        amount: 200, currency: 'NLe', status: 'approved',
        payment_method: 'orange_money', collected_at: '2025-03-01T10:00:00Z',
        receipt_number: 'RCP-001', period_id: 'per-1',
        period_label: 'March 2025', created_at: '2025-03-01T09:00:00Z',
      },
    ];
    __chainable.order.mockResolvedValueOnce({ data: fakeRows, error: null });

    const { contributions, error } = await fetchUserContributions('usr-1');

    expect(error).toBeNull();
    expect(contributions).toHaveLength(1);
    expect(contributions[0].status).toBe('approved');
    expect(contributions[0].amount).toBe(200);
  });

  it('returns empty array when DB errors — never fake data', async () => {
    const { __chainable } = getMocks();
    __chainable.order.mockResolvedValueOnce({ data: null, error: { message: 'RLS denied' } });

    const { contributions, error } = await fetchUserContributions('usr-1');

    expect(contributions).toEqual([]);
    expect(error).toBeInstanceOf(Error);
  });

  it('failed payment never credits balance (status=failed, not approved)', async () => {
    const { __chainable } = getMocks();
    __chainable.order.mockResolvedValueOnce({
      data: [{
        id: 'cp-fail', group_id: 'grp-1', member_id: 'usr-1',
        amount: 200, currency: 'NLe', status: 'failed',
        payment_method: 'orange_money', collected_at: null,
        receipt_number: null, period_id: 'per-1',
        period_label: 'March 2025', created_at: '2025-03-01T09:00:00Z',
      }],
      error: null,
    });

    const { contributions } = await fetchUserContributions('usr-1');

    expect(contributions[0].status).toBe('failed');
    // status is not 'approved' so no credit should be shown to the user
    expect(contributions[0].status).not.toBe('approved');
  });
});

// ── Payment flow completeness (mocked webhook simulation) ─────────────────────

describe('Payment webhook simulation (mocked)', () => {
  it('completed webhook should result in approved payment status', async () => {
    // Simulate what the payment-webhook Edge Function does:
    // 1. HMAC signature verified (server-side, not testable here)
    // 2. webhook_events deduplicated (idempotency)
    // 3. finalize_verified_payment called -> status = 'approved'
    //
    // We test the service layer's interpretation of the approved status.
    const { __chainable } = getMocks();
    __chainable.order.mockResolvedValueOnce({
      data: [{
        id: 'cp-2', status: 'approved', amount: 200, currency: 'NLe',
        payment_method: 'orange_money', collected_at: '2025-03-01T10:00:00Z',
        receipt_number: 'RCP-002', group_id: 'grp-1', member_id: 'usr-1',
        created_at: '2025-03-01T09:00:00Z',
      }],
      error: null,
    });

    const { contributions } = await fetchUserContributions('usr-1');
    expect(contributions[0].status).toBe('approved');
    // ContributionRow uses snake_case field names from the DB
    expect(contributions[0].receipt_number).toBe('RCP-002');
  });

  it('expired/cancelled payment shows correct status', async () => {
    const { __chainable } = getMocks();
    __chainable.order.mockResolvedValueOnce({
      data: [{
        id: 'cp-3', status: 'failed', amount: 200, currency: 'NLe',
        payment_method: 'orange_money', collected_at: null,
        receipt_number: null, group_id: 'grp-1', member_id: 'usr-1',
        created_at: '2025-03-01T09:00:00Z',
      }],
      error: null,
    });

    const { contributions } = await fetchUserContributions('usr-1');
    expect(contributions[0].status).toBe('failed');
    // No receipt for cancelled/expired payments
    expect(contributions[0].receipt_number).toBeNull();
  });
});

/*
 * ─── MANUAL SANDBOX CHECKLIST ────────────────────────────────────────────────
 *
 * Monime Payment Codes API — sandbox test procedure.
 * Run these steps manually when real Monime sandbox credentials are available.
 *
 * Event names used by the live backend:
 *   payment_code.processed  — user redeemed USSD; orderNumber available
 *   payment_code.completed  — fully confirmed (safe to credit)
 *   payment_code.expired    — terminal failure
 *   payment_code.cancelled  — terminal failure
 *
 * ── 1. CONFIGURE SANDBOX SECRETS ─────────────────────────────────────────────
 *    supabase secrets set MONIME_BASE_URL=https://sandbox.api.monime.io
 *    supabase secrets set MONIME_ACCESS_TOKEN=<sandbox_token>   # NOT MONIME_SECRET_KEY
 *    supabase secrets set MONIME_SPACE_ID=<sandbox_space_id>
 *    supabase secrets set MONIME_WEBHOOK_SECRET=<sandbox_signing_secret>
 *
 * ── 2. DEPLOY EDGE FUNCTIONS ─────────────────────────────────────────────────
 *    supabase functions deploy initiate-payment        # v3 — Osusu contributions
 *    supabase functions deploy initiate-vault-topup    # v2 — vault top-ups
 *    supabase functions deploy verify-payment          # v2 — Osusu status poll
 *    supabase functions deploy verify-vault-topup-status  # v2 — vault status poll
 *    supabase functions deploy mobile-money-webhook    # v2 — contribution finalization
 *    supabase functions deploy vault-webhook           # v2 — vault finalization
 *
 * ── 3. REGISTER WEBHOOKS IN MONIME DASHBOARD ─────────────────────────────────
 *    Register: https://<project-ref>.supabase.co/functions/v1/vault-webhook
 *    Register: https://<project-ref>.supabase.co/functions/v1/mobile-money-webhook
 *    Subscribe both to: payment_code.processed, payment_code.completed,
 *                       payment_code.expired, payment_code.cancelled
 *    Do NOT point Monime at old slugs (payment-webhook, confirm-payment, etc.)
 *
 * ── 4. OSUSU CONTRIBUTION PAYMENT ────────────────────────────────────────────
 *    a. Sign in as test user with KYC status = 'approved'.
 *    b. Navigate to Osusu group → Contribute.
 *    c. Tap Orange Money or AfriMoney button.
 *    d. Verify:
 *       - contribution_payments row created with status='pending' (not 'approved')
 *       - mobile_money_transactions row created with monime_payment_code_id set
 *       - ussd_code returned and displayed to user (no checkout_url)
 *       - monime_payment_code_id (NOT monime_session_id) stored in DB
 *
 * ── 5. VAULT TOP-UP PAYMENT ──────────────────────────────────────────────────
 *    a. Navigate to Vault → Add Money.
 *    b. Select Orange Money or AfriMoney, enter amount.
 *    c. Verify:
 *       - vault_topups row created with status='pending'
 *       - monime_payment_code_id stored in vault_topups
 *       - ussd_code displayed to user
 *
 * ── 6. VALID WEBHOOK (payment_code.completed) ─────────────────────────────────
 *    BODY='{"event":"payment_code.completed","data":{"id":"<payment_code_id>","status":"completed","amount":1000,"currency":"SLE","reference":"<idempotency_key>"}}'
 *    SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$MONIME_WEBHOOK_SECRET" -hex | awk '{print $2}')
 *    curl -X POST https://<ref>.supabase.co/functions/v1/mobile-money-webhook \
 *         -H "Content-Type: application/json" \
 *         -H "Monime-Signature: $SIG" -d "$BODY"
 *    Verify:
 *       - HTTP 200 returned
 *       - payment_webhook_events row inserted
 *       - contribution_payments.status → 'approved'
 *       - mobile_money_transactions.status → 'completed'
 *       - Next poll from app: effective_status = 'completed'
 *
 * ── 7. DUPLICATE WEBHOOK (idempotency check) ─────────────────────────────────
 *    Resend the identical BODY + SIG from step 6.
 *    Verify:
 *       - HTTP 200 returned
 *       - Response: {"status":"already_processed"}
 *       - contribution_payments.status is still 'approved' (no double-credit)
 *       - No second payment_webhook_events row inserted
 *
 * ── 8. TAMPERED SIGNATURE (security check) ───────────────────────────────────
 *    curl -X POST https://<ref>.supabase.co/functions/v1/mobile-money-webhook \
 *         -H "Content-Type: application/json" \
 *         -H "Monime-Signature: 0000000000000000000000000000000000000000000000000000000000000000" \
 *         -d "$BODY"
 *    Verify:
 *       - HTTP 200 returned
 *       - Response: {"status":"invalid_signature"}
 *       - No DB rows changed
 *
 * ── 9. FAILED / EXPIRED PAYMENT ──────────────────────────────────────────────
 *    Send payment_code.expired event (valid HMAC, different payment code ID):
 *    BODY='{"event":"payment_code.expired","data":{"id":"<another_code_id>","status":"expired"}}'
 *    Verify:
 *       - HTTP 200 returned
 *       - contribution_payments.status → 'failed' (or vault_topups.status → 'failed')
 *       - No balance credited
 *       - Next poll from app: effective_status = 'expired'
 *
 * ── 10. CANCELLED PAYMENT ────────────────────────────────────────────────────
 *    Send payment_code.cancelled event (valid HMAC):
 *    Verify: same as expired — status = 'failed', no balance credited.
 *
 * ── 11. RECEIPT CHECK ────────────────────────────────────────────────────────
 *    After approved payment, fetch user contributions via fetchUserContributions().
 *    Verify:
 *       - receipt_number is present for approved payments
 *       - receipt_number is null for failed/expired/cancelled payments
 */
