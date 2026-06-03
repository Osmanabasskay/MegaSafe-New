import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateInviteCode,
  parseGroupConfiguration,
  fetchActivePeriodForGroup,
} from '../../src/services/groupService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
  __mockAuth: { getSession: ReturnType<typeof vi.fn> };
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── generateInviteCode ────────────────────────────────────────────────────────

describe('generateInviteCode', () => {
  it('follows MSF-XXXXXX format', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^MSF-[A-Z2-9]{6}$/);
  });

  it('produces unique codes across 50 calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()));
    expect(codes.size).toBe(50);
  });

  it('does not use ambiguous characters I, O, 1', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateInviteCode().slice(4);
      expect(code).not.toMatch(/[IO1]/);
    }
  });
});

// ── parseGroupConfiguration ────────────────────────────────────────────────────

describe('parseGroupConfiguration', () => {
  it('returns empty object for null input', () => {
    expect(parseGroupConfiguration(null)).toEqual({});
  });

  it('parses adminCollectionPhone from JSON custom_rules', () => {
    const config = parseGroupConfiguration(
      JSON.stringify({ adminCollectionPhone: '+232 76 555 000', invites: [] })
    );
    expect(config.adminCollectionPhone).toBe('+232 76 555 000');
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseGroupConfiguration('not-json')).toEqual({});
  });
});

// ── fetchActivePeriodForGroup ─────────────────────────────────────────────────

describe('fetchActivePeriodForGroup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns earliest open period id and label', async () => {
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: {
        id: 'period-uuid-open',
        period_label: 'February 2025',
        period_start: '2025-02-01',
        period_end: '2025-02-28',
        status: 'open',
      },
      error: null,
    });

    const { periodId, periodLabel, error } = await fetchActivePeriodForGroup('grp-1');

    expect(error).toBeNull();
    expect(periodId).toBe('period-uuid-open');
    expect(periodLabel).toBe('February 2025');
  });

  it('returns null periodId when no open period exists', async () => {
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const { periodId, periodLabel, error } = await fetchActivePeriodForGroup('grp-empty');

    expect(error).toBeNull();
    expect(periodId).toBeNull();
    expect(periodLabel).toBeNull();
  });

  it('surfaces DB error', async () => {
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation "payment_periods" does not exist' },
    });

    const { periodId, error } = await fetchActivePeriodForGroup('grp-1');

    expect(periodId).toBeNull();
    expect(error).toBeInstanceOf(Error);
    // toBackendError intercepts "does not exist" and returns the schema bootstrap message
    expect(error?.message).toMatch(/supabase schema|failed because/i);
  });

  it('queries status=open specifically', async () => {
    const { __mockFrom, __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await fetchActivePeriodForGroup('grp-1');

    // from() called on the right table
    expect(__mockFrom).toHaveBeenCalledWith('payment_periods');
    // eq called with status='open'
    const eqCalls = __chainable.eq.mock.calls as unknown as Array<[string, string]>;
    const statusCall = eqCalls.find(([field]) => field === 'status');
    expect(statusCall).toBeDefined();
    expect(statusCall?.[1]).toBe('open');
  });
});
