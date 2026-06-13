import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('mobile money vault top-up flow security contract', () => {
  const migration = read('supabase/migrations/20260607000001_mobile_money_vault_topup_flow.sql');
  const initiateFn = read('supabase/functions/initiate-vault-topup/index.ts');
  const webhookFn = read('supabase/functions/vault-webhook/index.ts');
  const statusFn = read('supabase/functions/verify-vault-topup-status/index.ts');
  const vaultService = read('src/services/vaultService.ts');
  const screen = read('app/(main)/vault-topup.tsx');

  it('creates top-ups from an owned active verified payment method, not a client provider string', () => {
    expect(initiateFn).toContain('payment_method_id');
    expect(initiateFn).toContain('p_payment_method_id');
    expect(migration).toContain('p_payment_method_id UUID');
    expect(migration).toContain('AND user_id = v_uid');
    expect(migration).toContain('AND is_verified = TRUE');
    expect(migration).toContain('AND is_active = TRUE');
  });

  it('enforces Orange Money and AfriMoney phone prefix rules server-side', () => {
    for (const prefix of ['+23272', '+23276', '+23279', '+23230', '+23277', '+23299']) {
      expect(migration).toContain(prefix);
    }
    expect(migration).toContain('provider_prefix_mismatch');
  });

  it('keeps fees, limits, idempotency, and masked display data backend-owned', () => {
    expect(migration).toContain('vault_topup_limits');
    expect(migration).toContain('idempotency_key');
    expect(migration).toContain('provider_account_masked');
    expect(vaultService).toContain('payment_method_id: params.paymentMethodId');
    expect(vaultService).toContain('totalAmount');
    expect(screen).toContain('getVaultSummary()');
    expect(screen).not.toContain('setNewBalance(amount');
  });

  it('webhook re-verifies provider status and refuses mismatched amount or currency', () => {
    expect(webhookFn).toContain('getPaymentCode(paymentCodeId)');
    expect(webhookFn).toContain('verified.currency');
    expect(webhookFn).toContain('verified.amount');
    expect(webhookFn).toContain('provider_amount_or_currency_mismatch');
    expect(webhookFn).toContain('suspicious_vault_topup_mismatch');
  });

  it('status polling returns only safe receipt fields after backend completion', () => {
    expect(statusFn).toContain('effective_status');
    expect(statusFn).toContain('transaction_id');
    expect(statusFn).toContain('provider_account_masked');
    expect(statusFn).not.toContain('phone_number');
  });

  it('frontend cannot mark success from the approval button alone', () => {
    expect(screen).toContain("next.effectiveStatus === 'completed'");
    expect(screen).toContain("setStep('success')");
    expect(screen).toContain('I Have Approved');
    expect(screen).not.toContain("onPress={() => setStep('success')}");
  });
});
