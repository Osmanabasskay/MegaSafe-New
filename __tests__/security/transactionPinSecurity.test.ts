import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260608000002_transaction_pin_system.sql'),
  'utf8',
);
const pinCreateFixMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260608000003_fix_transaction_pin_create.sql'),
  'utf8',
);

describe('Transaction PIN security migration', () => {
  it('stores only a hash and keeps transaction_pins backend-only', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.transaction_pins/);
    expect(migration).toMatch(/pin_hash text NOT NULL/);
    expect(migration).toMatch(/crypt\(p_pin, gen_salt\('bf', 12\)\)/);
    expect(migration).toMatch(/SET search_path = public, extensions/);
    expect(pinCreateFixMigration).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/);
    expect(pinCreateFixMigration).toMatch(/SET search_path = public, extensions/);
    expect(migration).toMatch(/ALTER TABLE public\.transaction_pins ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE ALL ON public\.transaction_pins FROM authenticated/);
    expect(migration).toMatch(/USING \(false\)/);
  });

  it('locks repeated failed attempts and audits PIN events', () => {
    expect(migration).toMatch(/\^\\d\{4\}\$/);
    expect(migration).toMatch(/v_failed >= 5 THEN now\(\) \+ interval '15 minutes'/);
    expect(migration).toMatch(/TRANSACTION_PIN_VERIFY_FAILED/);
    expect(migration).toMatch(/TRANSACTION_PIN_LOCKED/);
    expect(migration).toMatch(/MONEY_ACTION_BLOCKED_PIN_REQUIRED/);
    expect(migration).toMatch(/MONEY_ACTION_BLOCKED_PIN_INVALID/);
  });

  it('revokes legacy direct money RPC signatures and adds PIN-gated overloads', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.process_withdrawal_request\(uuid, numeric, text, text, text, text\)/);
    expect(migration).toMatch(/p_transaction_pin\s+text DEFAULT NULL/);
    expect(migration).toMatch(/verify_transaction_pin\(p_transaction_pin, 'process_withdrawal_request'/);
    expect(migration).toMatch(/verify_transaction_pin\(p_transaction_pin, 'initiate_group_payment'/);
    expect(migration).toMatch(/verify_transaction_pin\(p_transaction_pin, 'initiate_vault_topup'/);
    expect(migration).toMatch(/verify_transaction_pin\(p_transaction_pin, 'link_payment_method'/);
  });
});
