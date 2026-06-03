import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDispute,
  fetchUserDisputes,
  updateDisputeStatus,
} from '../../src/services/disputeService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── createDispute ─────────────────────────────────────────────────────────────

describe('createDispute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects title shorter than 5 chars without touching DB', async () => {
    const { __mockRpc } = getMocks();

    const result = await createDispute('Hi', 'A'.repeat(20), 'missing_payment');

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/at least 5/i);
    expect(__mockRpc).not.toHaveBeenCalled();
  });

  it('rejects description shorter than 20 chars without touching DB', async () => {
    const { __mockRpc } = getMocks();

    const result = await createDispute('Valid Title Here', 'Too short', 'missing_payment');

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/at least 20/i);
    expect(__mockRpc).not.toHaveBeenCalled();
  });

  it('rejects invalid category without touching DB', async () => {
    const { __mockRpc } = getMocks();

    const result = await createDispute(
      'Valid Title Here', 'A'.repeat(25), 'invalid_category'
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/invalid.*category/i);
    expect(__mockRpc).not.toHaveBeenCalled();
  });

  it('calls create_dispute RPC for valid inputs', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, dispute_id: 'dsp-abc' },
      error: null,
    });

    const result = await createDispute(
      'Missing contribution',
      'My contribution of 200 NLe was recorded twice but only one receipt was issued.',
      'missing_payment',
      'grp-1',
      'pay-1'
    );

    expect(result.success).toBe(true);
    expect(result.disputeId).toBe('dsp-abc');
    expect(result.error).toBeNull();

    expect(__mockRpc).toHaveBeenCalledWith('create_dispute', expect.objectContaining({
      p_title:    'Missing contribution',
      p_category: 'missing_payment',
      p_group_id: 'grp-1',
    }));
  });

  it('surfaces RPC error', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Dispute against self not allowed.' },
    });

    const result = await createDispute(
      'Dispute title valid',
      'Description long enough to pass validation checks here.',
      'other'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ── updateDisputeStatus ───────────────────────────────────────────────────────

describe('updateDisputeStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid status without hitting DB', async () => {
    const { __mockRpc } = getMocks();

    const result = await updateDisputeStatus('dsp-1', 'closed' as 'resolved');

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/invalid.*status/i);
    expect(__mockRpc).not.toHaveBeenCalled();
  });

  it('calls update_dispute_status RPC for valid status', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

    const result = await updateDisputeStatus('dsp-1', 'resolved', 'Refund issued.');

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();

    expect(__mockRpc).toHaveBeenCalledWith('update_dispute_status', {
      p_dispute_id:      'dsp-1',
      p_status:          'resolved',
      p_resolution_note: 'Refund issued.',
    });
  });
});

// ── fetchUserDisputes ─────────────────────────────────────────────────────────

describe('fetchUserDisputes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls get_my_disputes RPC and returns mapped array', async () => {
    const { __mockRpc } = getMocks();
    const fakeDisputes = [
      {
        id: 'dsp-1', complainant_id: 'usr-1', accused_user_id: null,
        group_id: 'grp-1', category: 'missing_payment', title: 'Missing pay',
        description: 'Full description here', status: 'open', priority: 'normal',
        resolution_note: null, created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z', resolved_at: null, payment_id: null,
      },
    ];
    __mockRpc.mockResolvedValueOnce({
      data: { disputes: fakeDisputes },
      error: null,
    });

    const { disputes, error } = await fetchUserDisputes();

    expect(error).toBeNull();
    expect(disputes).toHaveLength(1);
    expect(disputes[0].status).toBe('open');
    expect(disputes[0].title).toBe('Missing pay');

    expect(__mockRpc).toHaveBeenCalledWith('get_my_disputes', { p_status: null });
  });

  it('filters by status when provided', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: { disputes: [] }, error: null });

    await fetchUserDisputes('resolved');

    expect(__mockRpc).toHaveBeenCalledWith('get_my_disputes', { p_status: 'resolved' });
  });
});
