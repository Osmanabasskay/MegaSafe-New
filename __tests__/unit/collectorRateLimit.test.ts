/**
 * Collector rate limit tests (Phase 5)
 *
 * Tests that record_physical_collection enforces rate limits and
 * blocks invalid, duplicate, unassigned, and inactive collectors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordPhysicalCollection } from '../../src/services/collectorService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

const validInput = {
  groupId: 'grp-1',
  memberId: 'usr-2',
  amount: 200,
  periodId: 'period-uuid-1',
  paymentMethod: 'cash' as const,
  idempotencyKey: 'ikey-unique',
};

// ── Valid collector ─────────────────────────────────────────────────────────

describe('record_physical_collection — valid collector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('valid collector can record a collection successfully', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        receipt_number: 'RCP-100',
        contribution_id: 'cp-100',
        amount: 200,
        collected_at: '2025-03-01T09:00:00Z',
        idempotent: false,
      },
      error: null,
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.receiptNumber).toBe('RCP-100');
  });
});

// ── Rate limiting ───────────────────────────────────────────────────────────

describe('record_physical_collection — rate limiting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('repeated rapid calls are blocked by rate limit (RPC returns error)', async () => {
    const { __mockRpc } = getMocks();
    // First call succeeds
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, receipt_number: 'RCP-A', contribution_id: 'cp-A', amount: 200, collected_at: '', idempotent: false },
      error: null,
    });
    // Second rapid call hits rate limit
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'Rate limit exceeded. Please wait before recording another collection.' },
      error: null,
    });

    // First call
    const r1 = await recordPhysicalCollection({ ...validInput, idempotencyKey: 'k1' });
    expect(r1.success).toBe(true);

    // Second rapid call
    const r2 = await recordPhysicalCollection({ ...validInput, idempotencyKey: 'k2' });
    expect(r2.success).toBe(false);
    expect(r2.error).toBeInstanceOf(Error);
    expect(r2.error?.message).toMatch(/rate limit/i);
  });

  it('duplicate payment period (same group+member+period) is blocked', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'A payment for this member already exists for this period.' },
      error: null,
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/already exists|duplicate/i);
  });

  it('same idempotency key returns idempotent=true (no duplicate)', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        receipt_number: 'RCP-DUP',
        contribution_id: 'cp-DUP',
        amount: 200,
        collected_at: '2025-03-01T09:00:00Z',
        idempotent: true,
      },
      error: null,
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(result.error).toBeNull();
  });
});

// ── Invalid / unauthorized collectors ─────────────────────────────────────

describe('record_physical_collection — blocked callers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalid collector (no record) is blocked by RPC', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Collector record not found.' },
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('unassigned collector is blocked', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'Collector is not assigned to this group.' },
      error: null,
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/not assigned/i);
  });

  it('inactive collector is blocked', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'Collector account is inactive.' },
      error: null,
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/inactive/i);
  });

  it('returns error for missing open period', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'No open period found for group.' },
      error: null,
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/no open period/i);
  });

  it('unauthenticated call (JWT error) is rejected', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'JWT expired or invalid.' },
    });

    const result = await recordPhysicalCollection(validInput);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ── Idempotency key generation ─────────────────────────────────────────────

describe('record_physical_collection — idempotency key', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-generates a UUID idempotency key when not supplied', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, receipt_number: 'RCP-AUTO', contribution_id: 'cp-a', amount: 200, collected_at: '', idempotent: false },
      error: null,
    });

    await recordPhysicalCollection({
      groupId: 'g', memberId: 'm', amount: 200,
      periodId: 'p', paymentMethod: 'cash',
    });

    const call = __mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    const key = call[1].p_idempotency_key;
    expect(key).toBeTruthy();
    expect(typeof key).toBe('string');
    expect((key as string).length).toBeGreaterThan(10);
  });
});
