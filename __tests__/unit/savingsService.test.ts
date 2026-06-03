import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchSavingsGoals,
  getVaultBalance,
  createSavingsGoal,
  processSavingsDeposit,
  processSavingsWithdrawal,
  normalizeSavingsCategory,
  formatSavingsCategory,
} from '../../src/services/savingsService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── normalizeSavingsCategory / formatSavingsCategory ──────────────────────────

describe('normalizeSavingsCategory', () => {
  it('maps education → school_fees', () => {
    expect(normalizeSavingsCategory('education')).toBe('school_fees');
  });

  it('maps emergency → emergency', () => {
    expect(normalizeSavingsCategory('Emergency')).toBe('emergency');
  });

  it('falls back to other for unknown labels', () => {
    expect(normalizeSavingsCategory('wedding')).toBe('other');
  });
});

describe('formatSavingsCategory', () => {
  it('formats school_fees → Education', () => {
    expect(formatSavingsCategory('school_fees')).toBe('Education');
  });

  it('formats house → Family', () => {
    expect(formatSavingsCategory('house')).toBe('Family');
  });
});

// ── fetchSavingsGoals ─────────────────────────────────────────────────────────

describe('fetchSavingsGoals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps DB rows to SavingsGoal objects', async () => {
    const { __chainable } = getMocks();
    const fakeRows = [
      {
        id: 'goal-1', user_id: 'usr-1', title: 'My House', description: null,
        category: 'house', goal_emoji: '🏠', target_amount: 10000, current_amount: 2500,
        currency_code: 'NLe', target_date: '2025-12-31', status: 'active',
        auto_save_enabled: false, auto_save_amount: null, auto_save_frequency: null,
        auto_save_next_date: null, created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];
    __chainable.order.mockResolvedValueOnce({ data: fakeRows, error: null });

    const { goals, error } = await fetchSavingsGoals('usr-1');

    expect(error).toBeNull();
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toBe('My House');
    expect(goals[0].current_amount).toBe(2500);
    expect(goals[0].status).toBe('active');
  });

  it('returns empty array on DB error', async () => {
    const { __chainable } = getMocks();
    __chainable.order.mockResolvedValueOnce({
      data: null,
      error: { message: 'RLS denied' },
    });

    const { goals, error } = await fetchSavingsGoals('usr-1');

    expect(goals).toEqual([]);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/rls denied/i);
  });
});

// ── getVaultBalance ────────────────────────────────────────────────────────────

describe('getVaultBalance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps RPC result and computes savingsProgressPct correctly', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        total_balance:     '800',
        active_balance:    '600',
        completed_balance: '400',
        goals: [],
      },
      error: null,
    });

    const result = await getVaultBalance();

    expect(result.error).toBeNull();
    expect(result.totalBalance).toBe(800);
    expect(result.activeBalance).toBe(600);
    expect(result.completedBalance).toBe(400);
    // 800 / (600 + 400) * 100 = 80%
    expect(result.savingsProgressPct).toBe(80);
  });

  it('returns zero progress when no targets', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '0', active_balance: '0', completed_balance: '0', goals: [] },
      error: null,
    });

    const result = await getVaultBalance();
    expect(result.savingsProgressPct).toBe(0);
    expect(result.error).toBeNull();
  });

  it('caps progress at 100 when over-funded', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { total_balance: '1500', active_balance: '1000', completed_balance: '0', goals: [] },
      error: null,
    });

    const result = await getVaultBalance();
    expect(result.savingsProgressPct).toBe(100);
  });

  it('surfaces RPC error', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Permission denied' } });

    const result = await getVaultBalance();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.totalBalance).toBe(0);
  });
});

// ── createSavingsGoal ─────────────────────────────────────────────────────────

describe('createSavingsGoal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls create_savings_goal RPC (not direct INSERT) and returns goal', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        id: 'goal-new', user_id: 'usr-1', title: 'Emergency Fund',
        description: null, category: 'emergency', goal_emoji: '🆘',
        target_amount: 500, current_amount: 0, currency_code: 'NLe',
        target_date: null, status: 'active',
        auto_save_enabled: false, auto_save_amount: null, auto_save_frequency: null,
        auto_save_next_date: null, created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      error: null,
    });

    const { goal, error } = await createSavingsGoal({
      ownerId: 'usr-1',
      title: 'Emergency Fund',
      category: 'emergency',
      targetAmount: 500,
    });

    expect(error).toBeNull();
    expect(goal).not.toBeNull();
    expect(goal?.title).toBe('Emergency Fund');
    // current_amount must be 0 — only the RPC can set it, never the client
    expect(goal?.current_amount).toBe(0);

    // Verify the RPC was called (not a direct from().insert())
    expect(__mockRpc).toHaveBeenCalledWith('create_savings_goal', expect.objectContaining({
      p_owner_id:       'usr-1',
      p_title:          'Emergency Fund',
      p_category:       'emergency',
      p_target_amount:  500,
    }));
  });

  it('propagates RPC error', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Target amount must be positive.' },
    });

    const { goal, error } = await createSavingsGoal({
      ownerId: 'usr-1', title: 'Bad Goal', category: 'other', targetAmount: -1,
    });

    expect(goal).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

// ── processSavingsDeposit ─────────────────────────────────────────────────────

describe('processSavingsDeposit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls initiate_savings_deposit RPC with idempotency key', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, payment_id: 'pay-123' },
      error: null,
    });

    const { success, paymentId, error } = await processSavingsDeposit({
      goalId: 'goal-1',
      amount: 200,
      paymentMethod: 'orange_money',
      idempotencyKey: 'stable-key-abc',
    });

    expect(error).toBeNull();
    expect(success).toBe(true);
    expect(paymentId).toBe('pay-123');

    expect(__mockRpc).toHaveBeenCalledWith('initiate_savings_deposit', expect.objectContaining({
      p_goal_id:         'goal-1',
      p_amount:          200,
      p_method:          'orange_money',
      p_idempotency_key: 'stable-key-abc',
    }));
  });

  it('generates idempotency key when not provided', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

    await processSavingsDeposit({ goalId: 'g', amount: 50, paymentMethod: 'cash_collected' });

    const call = __mockRpc.mock.calls[0];
    expect(call[1].p_idempotency_key).toBeTruthy();
    expect(typeof call[1].p_idempotency_key).toBe('string');
  });
});

// ── processSavingsWithdrawal ──────────────────────────────────────────────────

describe('processSavingsWithdrawal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls record_savings_transaction RPC with type=withdrawal', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, current_amount: 300 },
      error: null,
    });

    const { success, newBalance, error } = await processSavingsWithdrawal({
      goalId: 'goal-1',
      amount: 100,
      note: 'Rent payment',
    });

    expect(error).toBeNull();
    expect(success).toBe(true);
    expect(newBalance).toBe(300);

    expect(__mockRpc).toHaveBeenCalledWith('record_savings_transaction', expect.objectContaining({
      p_savings_goal_id: 'goal-1',
      p_amount:          100,
      p_type:            'withdrawal',
      p_note:            'Rent payment',
    }));
  });

  it('surfaces RPC error for insufficient balance', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'Insufficient balance for withdrawal.' },
      error: null,
    });

    const { success, error } = await processSavingsWithdrawal({ goalId: 'g', amount: 9999 });

    expect(success).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/insufficient balance/i);
  });
});
