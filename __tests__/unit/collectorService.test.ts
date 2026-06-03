import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordPhysicalCollection,
  assignCollector,
  getCollectorReport,
} from '../../src/services/collectorService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── recordPhysicalCollection ──────────────────────────────────────────────────

describe('recordPhysicalCollection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls record_physical_collection RPC with correct params (periodId, not period)', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        receipt_number: 'RCP-001',
        contribution_id: 'cp-abc',
        amount: 200,
        collected_at: '2025-02-01T09:00:00Z',
        idempotent: false,
      },
      error: null,
    });

    const result = await recordPhysicalCollection({
      groupId:       'grp-1',
      memberId:      'usr-2',
      amount:        200,
      periodId:      'period-uuid-1',
      paymentMethod: 'cash',
      notes:         'Collected at market',
      idempotencyKey: 'ikey-abc',
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.receiptNumber).toBe('RCP-001');
    expect(result.contributionId).toBe('cp-abc');
    expect(result.idempotent).toBe(false);

    expect(__mockRpc).toHaveBeenCalledWith('record_physical_collection', {
      p_group_id:        'grp-1',
      p_member_id:       'usr-2',
      p_period_id:       'period-uuid-1',
      p_amount:          200,
      p_payment_method:  'cash',
      p_notes:           'Collected at market',
      p_idempotency_key: 'ikey-abc',
    });
  });

  it('generates idempotency key when not supplied', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, receipt_number: 'RCP-002', contribution_id: 'cp-xyz',
              amount: 100, collected_at: '2025-02-01T10:00:00Z', idempotent: false },
      error: null,
    });

    await recordPhysicalCollection({
      groupId: 'grp-1', memberId: 'usr-3', amount: 100,
      periodId: 'p-uuid', paymentMethod: 'orange_money',
    });

    const call = __mockRpc.mock.calls[0];
    expect(call[1].p_idempotency_key).toBeTruthy();
    expect(call[1].p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('marks idempotent=true when RPC reports duplicate', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        receipt_number: 'RCP-001',
        contribution_id: 'cp-abc',
        amount: 200,
        collected_at: '2025-02-01T09:00:00Z',
        idempotent: true,
      },
      error: null,
    });

    const result = await recordPhysicalCollection({
      groupId: 'g', memberId: 'm', amount: 200,
      periodId: 'p', paymentMethod: 'cash', idempotencyKey: 'dup-key',
    });

    expect(result.idempotent).toBe(true);
    expect(result.success).toBe(true);
  });

  it('surfaces RPC error as typed Error', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Member is not active in this group.' },
    });

    const result = await recordPhysicalCollection({
      groupId: 'g', memberId: 'm', amount: 100,
      periodId: 'p', paymentMethod: 'cash',
    });

    expect(result.success).toBe(false);
    expect(result.receiptNumber).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    // toBackendError wraps plain Supabase error objects with "Unable to <action>."
    expect(result.error?.message).toMatch(/record physical collection/i);
  });

  it('rejects when RPC returns error field in data', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'No open period found for group.' },
      error: null,
    });

    const result = await recordPhysicalCollection({
      groupId: 'g', memberId: 'm', amount: 100,
      periodId: 'p', paymentMethod: 'cash',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/no open period/i);
  });
});

// ── assignCollector ────────────────────────────────────────────────────────────

describe('assignCollector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls assign_collector_validated RPC and returns codes', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        collector_id: 'col-1',
        member_secret_code: 'SEC-123',
        collector_passcode: 'PAS-456',
      },
      error: null,
    });

    const result = await assignCollector({
      groupId: 'grp-1',
      userId: 'usr-5',
      displayName: 'Fatou Koroma',
    });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.collectorId).toBe('col-1');
    expect(result.memberSecretCode).toBe('SEC-123');
    expect(result.collectorPasscode).toBe('PAS-456');

    expect(__mockRpc).toHaveBeenCalledWith('assign_collector_validated', expect.objectContaining({
      p_group_id:     'grp-1',
      p_user_id:      'usr-5',
      p_display_name: 'Fatou Koroma',
    }));
  });

  it('surfaces RPC error when caller is not group creator', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'Only the group creator may assign a collector.' },
      error: null,
    });

    const result = await assignCollector({ groupId: 'g', userId: 'not-creator' });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/group creator/i);
  });
});

// ── getCollectorReport ─────────────────────────────────────────────────────────

describe('getCollectorReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls calculate_collector_summary (not get_collector_report)', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        total_collected: '2400',
        total_contributions: '12',
        groups_covered: '3',
      },
      error: null,
    });

    const { report, error } = await getCollectorReport('col-1');

    expect(error).toBeNull();
    expect(report?.total_collected).toBe('2400');

    expect(__mockRpc).toHaveBeenCalledWith('calculate_collector_summary', {
      p_collector_id: 'col-1',
    });
    // Verify the old broken name is NOT used
    const rpcName = __mockRpc.mock.calls[0][0] as string;
    expect(rpcName).not.toBe('get_collector_report');
  });

  it('passes null when no collectorId provided', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: {}, error: null });

    await getCollectorReport();

    expect(__mockRpc).toHaveBeenCalledWith('calculate_collector_summary', {
      p_collector_id: null,
    });
  });
});
