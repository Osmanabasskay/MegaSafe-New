/**
 * paymentService unit tests
 *
 * Validates: idempotency key generation, payment initiation routing,
 * contribution fetch, member status mapping.
 *
 * All Supabase calls are mocked (see __tests__/setup.ts).
 * No real DB connection is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateIdempotencyKey,
  initiateGroupPayment,
  fetchUserContributions,
  getMemberContributionStatus,
  validateMemberEligibility,
} from '../../src/services/paymentService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
  __mockAuth: { getSession: ReturnType<typeof vi.fn> };
};

// vi.mock() is registered globally in setup.ts; importing the module returns the mocked version.
const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── generateIdempotencyKey ─────────────────────────────────────────────────

describe('generateIdempotencyKey', () => {
  it('returns a UUID-shaped string', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns a valid UUID from the React Native fallback path', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          for (let index = 0; index < bytes.length; index += 1) {
            bytes[index] = index;
          }
          return bytes;
        },
      },
    });

    try {
      const key = generateIdempotencyKey();
      expect(key).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
      expect(key.split('-').map((part) => part.length)).toEqual([8, 4, 4, 4, 12]);
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it('each call returns a unique key', () => {
    const keys = Array.from({ length: 20 }, () => generateIdempotencyKey());
    const unique = new Set(keys);
    expect(unique.size).toBe(20);
  });
});

// ── initiateGroupPayment ───────────────────────────────────────────────────

describe('initiateGroupPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication — returns error when no session', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({ data: { session: null } });

    const result = await initiateGroupPayment({
      groupId: 'grp-1',
      amount: 100,
      method: 'orange_money',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/not authenticated/i);
  });

  it('sends correct payload to edge function when authenticated', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'test-jwt-token' } },
    });

    // Mock global fetch to simulate edge function response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        contribution_id: 'contrib-abc',
        mm_txn_id: 'mm-xyz',
        receipt_number: 'RCP-001',
        status: 'pending',
      }),
    });

    const result = await initiateGroupPayment({
      groupId: 'grp-1',
      amount: 500,
      method: 'orange_money',
      periodId: 'period-uuid',
    });

    expect(result.success).toBe(true);
    expect(result.contributionId).toBe('contrib-abc');
    expect(result.mmTxnId).toBe('mm-xyz');
    expect(result.error).toBeNull();

    // Verify correct payload structure
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.group_id).toBe('grp-1');
    expect(body.amount).toBe(500);
    expect(body.method).toBe('orange_money');
    expect(body.period_id).toBe('period-uuid');
    expect(body.idempotency_key).toBeTruthy();
  });

  it('returns ussdCode and monimePaymentCodeId for Monime mobile money methods (Payment Codes API)', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'test-jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success:                true,
        contribution_id:        'contrib-abc',
        mm_txn_id:              'mm-xyz',
        monime_payment_code_id: 'pcode_Bx9HpQ5bkZtV2A3d',
        ussd_code:              '*144*5*123456#',
        expires_at:             '2025-01-15T10:10:00Z',
        status:                 'processing',
      }),
    });

    const result = await initiateGroupPayment({
      groupId: 'grp-1',
      amount:  200,
      method:  'afrimoney',
    });

    expect(result.success).toBe(true);
    // Payment Codes API: user dials ussdCode on their phone — no browser redirect
    expect(result.monimePaymentCodeId).toBe('pcode_Bx9HpQ5bkZtV2A3d');
    expect(result.ussdCode).toBe('*144*5*123456#');
    expect(result.expiresAt).toBe('2025-01-15T10:10:00Z');
    expect(result.error).toBeNull();
  });

  it('propagates error from edge function response', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'test-jwt-token' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Member has outstanding balance.' }),
    });

    const result = await initiateGroupPayment({
      groupId: 'grp-1',
      amount: 500,
      method: 'cash_collected',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/outstanding balance/i);
  });

  it('reuses idempotency key when provided', async () => {
    const { __mockAuth } = getMocks();
    __mockAuth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'test-jwt' } },
    });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const iKey = 'my-stable-key-123';
    await initiateGroupPayment({
      groupId: 'grp-1',
      amount: 100,
      method: 'cash_collected',
      idempotencyKey: iKey,
    });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.idempotency_key).toBe(iKey);
  });
});

// ── fetchUserContributions ─────────────────────────────────────────────────

describe('fetchUserContributions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns contributions mapped from DB rows', async () => {
    const { __chainable } = getMocks();
    const fakeRows = [
      {
        id: 'cp-1',
        group_id: 'grp-1',
        member_id: 'usr-1',
        amount: 200,
        currency: 'NLe',
        status: 'approved',
        payment_method: 'cash',
        receipt_number: 'RCP-001',
        collected_at: '2025-01-15',
        created_at: '2025-01-15T10:00:00Z',
      },
    ];
    __chainable.order.mockResolvedValueOnce({ data: fakeRows, error: null });

    const { contributions, error } = await fetchUserContributions('usr-1');

    expect(error).toBeNull();
    expect(contributions).toHaveLength(1);
    expect(contributions[0].status).toBe('approved');
    expect(contributions[0].payment_method).toBe('cash');
  });

  it('returns empty array on DB error, not fake data', async () => {
    const { __chainable } = getMocks();
    __chainable.order.mockResolvedValueOnce({
      data: null,
      error: { message: 'Permission denied' },
    });

    const { contributions, error } = await fetchUserContributions('usr-1');

    // toBackendError wraps Supabase error objects (not Error instances) with
    // a generic "Unable to <action>." message — the important thing is that
    // an error is returned and contributions are empty (no fake data).
    expect(contributions).toEqual([]);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/load contributions/i);
  });
});

// ── getMemberContributionStatus ────────────────────────────────────────────

describe('getMemberContributionStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps RPC result to typed status object', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        group_id: 'grp-1',
        member_id: 'usr-1',
        total_paid: '600',
        outstanding_balance: '200',
        paid_cycles: '3',
        total_cycles: '4',
        last_contribution_period: '2025-01',
        last_paid_to_date: '2025-01-31',
        next_due_date: '2025-02-28',
        expected_amount: '200',
        is_fully_paid: false,
      },
      error: null,
    });

    const { status, error } = await getMemberContributionStatus('grp-1', 'usr-1');

    expect(error).toBeNull();
    expect(status?.totalPaid).toBe(600);
    expect(status?.outstandingBalance).toBe(200);
    expect(status?.paidCycles).toBe(3);
    expect(status?.isFullyPaid).toBe(false);
  });

  it('surfaces RPC error as typed Error', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Group not found' },
    });

    const { status, error } = await getMemberContributionStatus('bad-grp', 'usr-1');
    expect(status).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

// ── validateMemberEligibility ──────────────────────────────────────────────

describe('validateMemberEligibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns eligible=true when RPC says so', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { eligible: true, expected_amount: 200, outstanding_amount: 0 },
      error: null,
    });

    const result = await validateMemberEligibility('grp-1', 'usr-1');
    expect(result.eligible).toBe(true);
    expect(result.error).toBeNull();
  });

  it('returns eligible=false with reason when member has outstanding balance', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        eligible: false,
        reason: 'Member has outstanding balance of 200 NLe',
        outstanding_amount: 200,
      },
      error: null,
    });

    const result = await validateMemberEligibility('grp-1', 'usr-1');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/outstanding balance/i);
  });
});
