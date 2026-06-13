/**
 * Vault → Osusu contribution tests
 *
 *   1. payOsusuFromVault calls the secure SECURITY DEFINER RPC with the
 *      transaction PIN — no frontend balance math, no frontend amount.
 *   2. Insufficient vault balance blocks payment with the clear message.
 *   3. Successful vault contribution returns server-confirmed records.
 *   4. Duplicate contributions are blocked server-side (idempotent replay).
 *   5. The contribute screen exposes BOTH options: Pay from Vault and
 *      Pay with Mobile Money (static check on the production screen source).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { payOsusuFromVault } from '../../src/services/vaultService';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockRpc: ReturnType<typeof vi.fn>;
};
const getMocks = () => _supabaseMock as unknown as MockHandles;

const GROUP_ID = '99999999-9999-4999-8999-999999999999';

describe('payOsusuFromVault (secure backend path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the pay_osusu_from_vault RPC with PIN and idempotency key', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { success: true, contribution_id: 'contrib-1', amount: 100, fee: 0, status: 'approved' },
      error: null,
    });

    await payOsusuFromVault({ groupId: GROUP_ID, transactionPin: '1234' });

    expect(__mockRpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = __mockRpc.mock.calls[0];
    expect(rpcName).toBe('pay_osusu_from_vault');
    expect(args.p_group_id).toBe(GROUP_ID);
    expect(args.p_transaction_pin).toBe('1234');
    expect(typeof args.p_idempotency_key).toBe('string');
    // No amount parameter exists — the server derives it from the group.
    expect(args).not.toHaveProperty('p_amount');
  });

  it('always sends the PIN key (null when absent) to avoid RPC overload ambiguity', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

    await payOsusuFromVault({ groupId: GROUP_ID });

    const [, args] = getMocks().__mockRpc.mock.calls[0];
    expect(args).toHaveProperty('p_transaction_pin', null);
  });

  it('insufficient vault balance blocks the payment with a clear message', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        error: 'Insufficient vault balance. Add money to your vault or pay with mobile money.',
        required: 120,
        action: 'topup_required',
      },
      error: null,
    });

    const { success, error } = await payOsusuFromVault({ groupId: GROUP_ID, transactionPin: '1234' });
    expect(success).toBe(false);
    expect(error?.message).toMatch(/Insufficient vault balance/);
  });

  it('successful vault contribution returns server-side records', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: {
        success: true,
        contribution_id: 'contrib-7',
        receipt_number: 'RCP-20260611-AB12CD34',
        amount: 100,
        fee: 2,
        total_debit: 102,
        status: 'approved',
      },
      error: null,
    });

    const result = await payOsusuFromVault({ groupId: GROUP_ID, transactionPin: '1234' });
    expect(result.success).toBe(true);
    expect(result.contributionId).toBe('contrib-7');
    expect(result.amount).toBe(100);
    expect(result.fee).toBe(2);
  });

  it('duplicate contribution is blocked server-side', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { error: 'You have already paid for this period.', contribution_id: 'contrib-1' },
      error: null,
    });

    const { success, error } = await payOsusuFromVault({ groupId: GROUP_ID, transactionPin: '1234' });
    expect(success).toBe(false);
    expect(error?.message).toMatch(/already paid for this period/);
  });

  it('idempotent replay returns the original contribution without a second debit', async () => {
    const { __mockRpc } = getMocks();
    __mockRpc.mockResolvedValueOnce({
      data: { contribution_id: 'contrib-1', status: 'approved', idempotent: true },
      error: null,
    });

    const result = await payOsusuFromVault({
      groupId: GROUP_ID,
      idempotencyKey: 'fixed-key-123',
      transactionPin: '1234',
    });
    expect(result.idempotent).toBe(true);
    expect(result.contributionId).toBe('contrib-1');
  });
});

describe('contribute screen payment options (static)', () => {
  const source = readFileSync(
    resolve(__dirname, '../../app/(groups)/contribute.tsx'),
    'utf8',
  );

  it('shows the Pay from Vault option', () => {
    expect(source).toMatch(/from Vault/);
    expect(source).toMatch(/payOsusuFromVault/);
  });

  it('shows both mobile money providers (Orange Money + AfriMoney)', () => {
    expect(source).toMatch(/Orange Money/);
    expect(source).toMatch(/AfriMoney/);
    // QMoney must never be offered as a selectable provider.
    expect(source).not.toMatch(/method:\s*['"]qmoney['"]/i);
    expect(source).not.toMatch(/label:\s*['"]QMoney['"]/i);
  });

  it('disables Pay from Vault when the balance is insufficient', () => {
    expect(source).toMatch(/disabled=\{!hasEnoughBalance/);
  });

  it('shows the required insufficient-balance message', () => {
    expect(source).toMatch(/Insufficient vault balance\. Add money to your vault or pay with\s+mobile money\./);
  });

  it('never deducts the vault balance on the frontend', () => {
    // The screen reads balances for display only; all debits happen in the
    // pay_osusu_from_vault SECURITY DEFINER RPC.
    expect(source).not.toMatch(/availableBalance\s*-=/);
    expect(source).not.toMatch(/setVault\(\s*\{[^}]*availableBalance:\s*[^}]*-\s*/);
  });
});
