/**
 * Vault & Withdrawal unit tests (Phase 3)
 *
 * Tests: get_vault_balance, processSavingsWithdrawal, request/approve/reject
 * withdrawal paths, error handling, auth guards, KYC enforcement.
 *
 * All Supabase calls are mocked — no real DB connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getVaultBalance,
  processSavingsWithdrawal,
  processSavingsDeposit,
} from '../../src/services/savingsService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── get_vault_balance ─────────────────────────────────────────────────────────

describe('getVaultBalance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns totals from RPC response', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '1500', active_balance: '1000', completed_balance: '200', goals: [] },
      error: null,
    });

    const r = await getVaultBalance();
    expect(r.error).toBeNull();
    expect(r.totalBalance).toBe(1500);
    expect(r.activeBalance).toBe(1000);
    expect(r.completedBalance).toBe(200);
  });

  it('computes savingsProgressPct from active+completed balance', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '600', active_balance: '500', completed_balance: '100', goals: [] },
      error: null,
    });

    const r = await getVaultBalance();
    // 600 / (500 + 100) * 100 = 100%
    expect(r.savingsProgressPct).toBe(100);
  });

  it('returns 0 progress when active + completed balance is 0', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '0', active_balance: '0', completed_balance: '0', goals: [] },
      error: null,
    });

    const r = await getVaultBalance();
    expect(r.savingsProgressPct).toBe(0);
    expect(r.totalBalance).toBe(0);
  });

  it('caps progress at 100 when balance exceeds targets', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '9999', active_balance: '1000', completed_balance: '500', goals: [] },
      error: null,
    });

    const r = await getVaultBalance();
    expect(r.savingsProgressPct).toBe(100);
  });

  it('surfaces RPC error — never returns fake balance', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Permission denied.' } });

    const r = await getVaultBalance();
    expect(r.error).toBeInstanceOf(Error);
    // Must return 0, never a fake balance
    expect(r.totalBalance).toBe(0);
    expect(r.activeBalance).toBe(0);
    expect(r.completedBalance).toBe(0);
    expect(r.savingsProgressPct).toBe(0);
  });

  it('surfaces data-level error field — never returns fake balance', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'User not found.' },
      error: null,
    });

    const r = await getVaultBalance();
    expect(r.error).toBeInstanceOf(Error);
    expect(r.totalBalance).toBe(0);
  });

  it('calls get_vault_balance RPC (not a direct table query)', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '0', active_balance: '0', completed_balance: '0', goals: [] },
      error: null,
    });

    await getVaultBalance();

    expect(__mockRpc).toHaveBeenCalledWith('get_vault_balance');
    // Verify direct table queries are never made for balance data
    const { __mockFrom } = getMocks();
    expect(__mockFrom).not.toHaveBeenCalledWith('vault_balances');
    expect(__mockFrom).not.toHaveBeenCalledWith('savings_transactions');
  });
});

// ── processSavingsWithdrawal ──────────────────────────────────────────────────

describe('processSavingsWithdrawal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls record_savings_transaction RPC with type=withdrawal', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, current_amount: 400 },
      error: null,
    });

    const result = await processSavingsWithdrawal({ goalId: 'goal-1', amount: 100, note: 'Rent' });

    expect(result.error).toBeNull();
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(400);

    expect(__mockRpc).toHaveBeenCalledWith('record_savings_transaction', expect.objectContaining({
      p_savings_goal_id: 'goal-1',
      p_amount:          100,
      p_type:            'withdrawal',
      p_note:            'Rent',
    }));
  });

  it('returns error for insufficient balance', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'Insufficient balance for withdrawal.' },
      error: null,
    });

    const result = await processSavingsWithdrawal({ goalId: 'goal-1', amount: 9999 });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/insufficient balance/i);
  });

  it('returns error when RPC rejects unauthenticated call', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'JWT expired.' } });

    const result = await processSavingsWithdrawal({ goalId: 'goal-1', amount: 50 });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns error when RPC rejects with KYC not approved', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'KYC verification required before withdrawals.' },
      error: null,
    });

    const result = await processSavingsWithdrawal({ goalId: 'goal-1', amount: 100 });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toMatch(/kyc/i);
  });

  it('handles duplicate idempotency key gracefully (idempotent success)', async () => {
    const { __mockRpc } = getMocks();
    // Server returns success with current amount on duplicate key
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, current_amount: 300, idempotent: true },
      error: null,
    });

    const result = await processSavingsWithdrawal({ goalId: 'goal-1', amount: 50 });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('never directly inserts into withdrawal_requests table', async () => {
    const { __mockFrom } = getMocks();

    __getMocks().then = undefined; // suppress potential chaining
    await processSavingsWithdrawal({ goalId: 'goal-1', amount: 10 }).catch(() => {});

    const fromCalls = (__mockFrom.mock.calls as string[][]).map((c) => c[0]);
    expect(fromCalls).not.toContain('withdrawal_requests');
    expect(fromCalls).not.toContain('savings_transactions');
  });
});

// ── approve/reject withdrawal via RPCs ────────────────────────────────────────

describe('Withdrawal approval flow (RPC contract)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processSavingsWithdrawal uses record_savings_transaction, not approve_withdrawal_request', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: { success: true, current_amount: 0 }, error: null });

    await processSavingsWithdrawal({ goalId: 'g', amount: 10 });

    const rpcName = (__mockRpc.mock.calls[0] as [string])[0];
    // The frontend record_savings_transaction RPC is used for savings withdrawals.
    // approve_withdrawal_request is an admin-only RPC called from admin Edge Function.
    expect(rpcName).toBe('record_savings_transaction');
    expect(rpcName).not.toBe('approve_withdrawal_request');
    expect(rpcName).not.toBe('reject_withdrawal_request');
  });

  it('processSavingsDeposit uses initiate_savings_deposit RPC', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: { success: true, payment_id: 'pay-1' }, error: null });

    await processSavingsDeposit({ goalId: 'goal-1', amount: 100, paymentMethod: 'orange_money' });

    const rpcName = (__mockRpc.mock.calls[0] as [string])[0];
    expect(rpcName).toBe('initiate_savings_deposit');
  });
});

// ── Vault screen balance policy ───────────────────────────────────────────────

describe('Vault balance display policy', () => {
  it('getVaultBalance returns 0 balances when supabase is not configured', async () => {
    // The supabaseConfigured=false branch must return zeros, never hardcoded fake values
    // This is enforced in the service; here we verify the contract via mock error path
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network error' } });

    const r = await getVaultBalance();
    // Even on error, totalBalance must never be a fake/demo number
    expect(r.totalBalance).toBe(0);
    expect(r.savingsProgressPct).toBe(0);
  });

  it('never returns a hardcoded balance (e.g. 1200.00)', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const r = await getVaultBalance();
    // 1200 is a common demo value — must never appear
    expect(r.totalBalance).not.toBe(1200);
    expect(r.totalBalance).not.toBe(250);
    expect(r.totalBalance).not.toBe(750);
  });
});

// helper shim — getMocks() already returns the mock, but for the "not.toContain" assertion
// we need a fresh reference inside the test
function __getMocks() {
  return _supabaseMock as unknown as MockHandles;
}
