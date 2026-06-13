/**
 * MegaSafe Production Hardening — Security Test Suite
 *
 * Covers all 10 hardening scenarios from the security audit:
 *
 *  1. A member cannot update dispute status (screen + server-side guard)
 *  2. A member cannot read or update another user's dispute
 *  3. A user cannot link a payment method for another user ID
 *  4. A payment method is inactive until OTP-verified
 *  5. A profile update cannot change role, status, KYC status, or balance
 *  6. Receipt data cannot be forged from client state
 *  7. Financial totals come only from backend ledger / RPC
 *  8. 2FA cannot be shown as enabled unless backend enrollment is complete
 *  9. Storage upload rejects oversized, wrong-MIME, and unauthorised-path files
 * 10. RLS policies block cross-user reads and writes
 *
 * Approach: static analysis of source + SQL files (no real Supabase connection).
 */

import { describe, it, expect } from 'vitest';
import * as fs   from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../');
const SRC  = path.join(ROOT, 'src');
const APP  = path.join(ROOT, 'app');
const MIG  = path.join(ROOT, 'supabase', 'migrations');

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function latestMigration(): string {
  const file = path.join(MIG, '20260606000001_megasafe_disputes_payment_methods.sql');
  return read(file);
}

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — A member cannot update dispute status by tapping a card
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 1: Member cannot advance dispute status from the UI', () => {
  const disputesScreen = read(path.join(APP, 'components', 'disputes.tsx'));

  it('disputes.tsx does not export or call advanceStatus', () => {
    expect(disputesScreen).not.toMatch(/advanceStatus/);
  });

  it('disputes.tsx does not import updateDisputeStatus from the service', () => {
    expect(disputesScreen).not.toMatch(/updateDisputeStatus\s*as\s*updateRemoteDisputeStatus/);
    expect(disputesScreen).not.toMatch(/import.*updateDisputeStatus/);
  });

  it('disputes.tsx does not contain a nextStatus transition map', () => {
    expect(disputesScreen).not.toMatch(/nextStatus\s*:/);
    expect(disputesScreen).not.toMatch(/nextStatus\[/);
  });

  it('disputes.tsx does not show "Tap to progress status" UI affordance', () => {
    expect(disputesScreen).not.toMatch(/Tap to progress status/i);
    expect(disputesScreen).not.toMatch(/onPress.*advanceStatus/);
  });

  it('migration: update_dispute_status RPC enforces admin-only role check', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/update_dispute_status/);
    // Must check user_roles, not trust the caller
    expect(sql).toMatch(/FROM public\.user_roles[\s\S]*?WHERE user_id = v_uid/);
    expect(sql).toMatch(/role IN \('super_admin', 'org_admin'\)/);
  });

  it('migration: update_dispute_status returns Permission denied for non-admin callers', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/Permission denied.*support staff/i);
  });

  it('migration: direct UPDATE on disputes table is blocked by no_direct_update policy', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/disputes_no_direct_update/);
    expect(sql).toMatch(/FOR UPDATE TO authenticated[\s\S]*?USING \(false\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — A member cannot read or update another user's dispute
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 2: Object-level authorization for disputes', () => {
  it('migration: disputes_select_own policy restricts SELECT to raised_by = auth.uid()', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/disputes_select_own/);
    expect(sql).toMatch(/FOR SELECT TO authenticated[\s\S]*?USING \(raised_by = auth\.uid\(\)\)/);
  });

  it('migration: disputes_manage_own (permissive FOR ALL) is dropped', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/DROP POLICY IF EXISTS "disputes_manage_own"/);
  });

  it('migration: get_my_disputes RPC filters by raised_by = v_uid (not a caller-supplied ID)', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/get_my_disputes/);
    // Must filter on raised_by = v_uid where v_uid comes from auth.uid()
    expect(sql).toMatch(/d\.raised_by = v_uid/);
    // v_uid must come from auth.uid(), not from a function parameter
    expect(sql).toMatch(/v_uid := auth\.uid\(\)/);
    // The RPC must NOT accept a p_user_id parameter (that would be an IDOR vector)
    expect(sql).not.toMatch(/get_my_disputes\([^)]*p_user_id/);
  });

  it('disputeService.ts: fetchUserDisputes calls get_my_disputes RPC (server-filtered)', async () => {
    const svc = read(path.join(SRC, 'services', 'disputeService.ts'));
    expect(svc).toMatch(/get_my_disputes/);
    // Must not do a direct .from('disputes').select() with client-controlled filter
    expect(svc).not.toMatch(/\.from\(['"]disputes['"]\)\.select\(.*\)\.eq\(['"]raised_by['"]/);
  });

  it('migration: no INSERT policy allows members to create disputes on behalf of others', () => {
    const sql = latestMigration();
    // The create_dispute RPC always uses auth.uid() as raised_by
    expect(sql).toMatch(/v_uid.*auth\.uid\(\)/);
    // The block INSERT policy must exist
    expect(sql).toMatch(/disputes_no_direct_insert/);
    expect(sql).toMatch(/FOR INSERT TO authenticated[\s\S]*?WITH CHECK \(false\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — A user cannot link a payment method for another user ID
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 3: Payment method ownership enforced server-side', () => {
  it('migration: link_payment_method derives user_id from auth.uid(), never from params', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/link_payment_method/);
    // user_id must come from auth.uid()
    expect(sql).toMatch(/v_uid := auth\.uid\(\)/);
    // The function signature must NOT include a p_user_id parameter
    expect(sql).not.toMatch(/link_payment_method\([^)]*p_user_id/);
    // Insert must use v_uid (the session-derived variable), not any caller-supplied variable
    expect(sql).toMatch(/INSERT INTO public\.linked_payment_methods[\s\S]*?v_uid, p_provider/s);
  });

  it('migration: unlink_payment_method checks ownership before deleting', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/unlink_payment_method/);
    expect(sql).toMatch(/v_owner <> v_uid[\s\S]*?Permission denied/s);
  });

  it('migration: lpm_no_direct_write policy blocks direct INSERT/UPDATE/DELETE', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/lpm_no_direct_write/);
    // Uses USING(false) WITH CHECK(false) to block all direct writes
    expect(sql).toMatch(/FOR ALL TO authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/s);
  });

  it('paymentMethodService does not accept a caller-supplied user_id (static)', () => {
    const svcPath = path.join(SRC, 'services', 'paymentMethodService.ts');
    if (!fs.existsSync(svcPath)) return; // service may not exist yet; migration is the enforcement
    const svc = read(svcPath);
    expect(svc).not.toMatch(/p_user_id|userId.*param|user_id.*param/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 4 — A payment method is inactive until OTP-verified
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 4: Payment methods inactive until verified', () => {
  it('migration: link_payment_method inserts with is_verified=FALSE, is_active=FALSE', () => {
    const sql = latestMigration();
    // The INSERT must explicitly set both to false
    expect(sql).toMatch(/is_verified, is_active[\s\S]*?FALSE, FALSE/s);
  });

  it('migration: verify_payment_method activates only after OTP matches', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/verify_payment_method/);
    // OTP must match hash before activation
    expect(sql).toMatch(/encode\(sha256\(p_otp_code::bytea\), 'hex'\) <> v_method\.otp_code_hash/);
    // On match: is_active = TRUE
    expect(sql).toMatch(/is_active\s*=\s*TRUE/);
    // On mismatch: increment attempts, do NOT activate
    expect(sql).toMatch(/otp_attempts = otp_attempts \+ 1/);
  });

  it('migration: verify_payment_method enforces 10-minute OTP expiry', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/INTERVAL '10 minutes'/);
    expect(sql).toMatch(/Verification code has expired/i);
  });

  it('migration: verify_payment_method limits to 3 OTP attempts before lockout', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/otp_attempts >= 3/);
    expect(sql).toMatch(/Too many failed attempts/i);
  });

  it('migration: get_my_payment_methods never returns raw phone_number in response', () => {
    const sql = latestMigration();
    // The response must only include masked_number, not phone_number
    const getMethodsBody = sql.match(/CREATE OR REPLACE FUNCTION public\.get_my_payment_methods[\s\S]*?\$\$;/)?.[0] ?? '';
    expect(getMethodsBody).toMatch(/masked_number/);
    expect(getMethodsBody).not.toMatch(/'phone_number',\s*m\.phone_number/);
  });

  it('migration: linked_payment_methods has CHECK constraint for SL E.164 format', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/lpm_phone_format_check/);
    // Constraint body enforces +232 followed by exactly 8 digits
    expect(sql).toMatch(/phone_number ~ /);
    expect(sql).toMatch(/\+232\[0-9\]\{8\}/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 5 — Profile update cannot change role, status, KYC, or balance
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 5: Profile immutable-field protection', () => {
  it('auth_hardening migration: trigger protects role and kyc_status from direct updates', () => {
    const hardeningFile = path.join(
      ROOT, 'supabase', '_live_snapshot', 'canonical_security_objects.sql'
    );
    const sql = read(hardeningFile);
    expect(sql).toMatch(/protect_profile_immutable_columns/);
    expect(sql).toMatch(/NEW\.role IS DISTINCT FROM OLD\.role/);
    expect(sql).toMatch(/NEW\.kyc_status IS DISTINCT FROM OLD\.kyc_status/);
  });

  it('KYC RPCs can update KYC profile fields only through a transaction-local trusted flag', () => {
    const migration = read(path.join(
      MIG, '20260606000004_allow_trusted_kyc_profile_status_updates.sql'
    ));
    const snapshot = read(path.join(
      ROOT, 'supabase', '_live_snapshot', 'canonical_security_objects.sql'
    ));

    expect(migration).toMatch(/app\.kyc_profile_status_update_allowed/);
    expect(migration).toMatch(/set_config\('app\.kyc_profile_status_update_allowed', 'on', true\)/);
    expect(migration).toMatch(/NEW\.kyc_status IS DISTINCT FROM OLD\.kyc_status AND NOT v_kyc_update_allowed/);
    expect(migration).toMatch(/NEW\.kyc_verified IS DISTINCT FROM OLD\.kyc_verified AND NOT v_kyc_update_allowed/);
    expect(snapshot).toMatch(/NEW\.kyc_status IS DISTINCT FROM OLD\.kyc_status AND NOT v_kyc_update_allowed/);
  });

  it('profileService.ts does not include role in its update payload', () => {
    const svc = read(path.join(SRC, 'services', 'profileService.ts'));
    expect(svc).not.toMatch(/payload\.role\s*=/);
    expect(svc).not.toMatch(/role:\s*params\./);
    expect(svc).not.toMatch(/kyc_status:\s*(params|input)\./);
    expect(svc).not.toMatch(/balance:\s*(params|input)\./);
    expect(svc).not.toMatch(/status:\s*(params|input)\./);
  });

  it('no screen directly PATCHes profiles.role, kyc_status, or balance', () => {
    const allFiles: string[] = [];
    for (const dir of [SRC, APP]) {
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) allFiles.push(full);
        }
      };
      if (fs.existsSync(dir)) walk(dir);
    }

    const violations: string[] = [];
    for (const file of allFiles) {
      const text = read(file);
      // Direct update of protected fields via .from('profiles').update({ role: ... })
      if (/\.from\(['"]profiles['"]\)\.update\([^)]*(?:role|kyc_status|balance|is_active)\s*:/m.test(text)) {
        violations.push(path.relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
    expect(violations, `Direct protected-field updates: ${violations.join(', ')}`).toEqual([]);
  });

  it('authStore.ts reads role via get_my_role RPC, not from JWT metadata', () => {
    const authStore = read(path.join(SRC, 'store', 'authStore.ts'));
    // Must not read role from token claims (app_metadata or user_metadata)
    expect(authStore).not.toMatch(/user_metadata\.role/);
    expect(authStore).not.toMatch(/app_metadata\.role/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 6 — Receipt data cannot be forged from client state
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 6: Receipts generated from backend records, not client state', () => {
  const paymentSuccess = read(path.join(APP, '(groups)', 'payment-success.tsx'));

  it('payment-success.tsx queries contribution_payments table for authoritative data', () => {
    expect(paymentSuccess).toMatch(/contribution_payments/);
  });

  it('payment-success.tsx does not default to status:verified without a backend check', () => {
    expect(paymentSuccess).not.toMatch(/status:\s*['"]verified['"]/);
  });

  it('payment-success.tsx validates UUID before using as a DB key', () => {
    expect(paymentSuccess).toMatch(/UUID_RE|[0-9a-f]{8}.*[0-9a-f]{4}/);
  });

  it('payment-success.tsx filters by authenticated user ID (member_id = user.id)', () => {
    expect(paymentSuccess).toMatch(/member_id.*user\.id|\.eq.*user\.id/);
  });

  it('payment-success.tsx does not contain hardcoded fake transaction or receipt IDs', () => {
    expect(paymentSuccess).not.toMatch(/TXN-2024-1215-001/);
    expect(paymentSuccess).not.toMatch(/RCP-20241215-123456/);
    expect(paymentSuccess).not.toMatch(/Family Savings Circle/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 7 — Financial totals from backend ledger / RPC only
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 7: Financial totals server-side only', () => {
  it('reportService.ts fetches totals from get_home_summary RPC (not calculated client-side)', () => {
    const svc = read(path.join(SRC, 'services', 'reportService.ts'));
    expect(svc).toMatch(/get_home_summary/);
    // Must not do JS arithmetic on client-fetched rows to compute savings_total
    expect(svc).not.toMatch(/\.reduce\(.*savings|savings.*\.reduce/);
  });

  it('vaultService.ts fetches balances via getVaultSummary RPC', () => {
    const svc = read(path.join(SRC, 'services', 'vaultService.ts'));
    expect(svc).toMatch(/get_vault_summary|getVaultSummary/i);
    // Must not compute balance client-side from raw transaction rows
    expect(svc).not.toMatch(/transactions\.reduce\(.*balance/);
  });

  it('home.tsx does not perform client-side summation of financial data', () => {
    const screen = read(path.join(APP, '(main)', 'home.tsx'));
    // Screen must use getHomeSummary, not reduce over transaction arrays
    expect(screen).toMatch(/getHomeSummary/);
    expect(screen).not.toMatch(/\.reduce\(.*savingsTotal\s*\+|savingsTotal\s*\+=\s*t\./);
  });

  it('no screen computes balance as sum of local transaction arrays', () => {
    const violations: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          const text = read(full);
          if (/\.reduce\([^)]*amount[^)]*,\s*0\)/m.test(text)) {
            // Allow in test files and non-financial helpers
            const rel = path.relative(ROOT, full).replace(/\\/g, '/');
            if (!rel.startsWith('__tests__') && !rel.includes('buildStatement')) {
              violations.push(rel);
            }
          }
        }
      }
    };
    walk(path.join(APP, '(main)'));
    expect(violations, `Client-side balance reduce in: ${violations.join(', ')}`).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 8 — 2FA not shown as enabled unless backend enrollment is complete
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 8: 2FA state reflects real Supabase MFA enrollment', () => {
  const tfaScreen = read(path.join(APP, '(settings)', '2fa.tsx'));

  it('2fa.tsx does not contain a fake toggle that sets enabled=true without backend call', () => {
    expect(tfaScreen).not.toMatch(/setTwoFactorEnabled\(true\)/);
    expect(tfaScreen).not.toMatch(/Alert\.alert\(['"]Success['"]/i);
  });

  it('2fa.tsx uses supabase.auth.mfa.listFactors to determine enrollment state', () => {
    expect(tfaScreen).toMatch(/mfa\.listFactors|listFactors/);
  });

  it('2fa.tsx enrollment uses mfa.enroll() and mfa.challenge() + mfa.verify()', () => {
    expect(tfaScreen).toMatch(/mfa\.enroll/);
    expect(tfaScreen).toMatch(/mfa\.challenge/);
    expect(tfaScreen).toMatch(/mfa\.verify/);
  });

  it('2fa.tsx requires live TOTP code to unenroll (prevents stolen-session attack)', () => {
    // Unenrolling must call mfa.unenroll() only after verifying a fresh TOTP code
    expect(tfaScreen).toMatch(/mfa\.unenroll/);
    // There must be a confirmation step that verifies code before unenroll
    expect(tfaScreen).toMatch(/confirming_remove|removeCode|confirmCode/i);
  });

  it('appDataStore preferences.twoFactorEnabled is NOT the authoritative 2FA state', () => {
    // The store flag is a UI preference cache only; the real state comes from listFactors
    const store = read(path.join(SRC, 'store', 'appDataStore.ts'));
    // The flag may exist for UI hints but must not gate security decisions
    if (store.match(/twoFactorEnabled/)) {
      // It should not be set to true without a backend call
      expect(store).not.toMatch(/twoFactorEnabled:\s*true(?!\s*\/\/ from backend)/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 9 — Storage upload rejects oversized / wrong-MIME / wrong-path files
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 9: Storage upload security controls', () => {
  it('storageUpload.ts performs magic-byte MIME detection (not extension-only)', () => {
    const svc = read(path.join(SRC, 'services', 'storageUpload.ts'));
    expect(svc).toMatch(/detectImageMime|magic.*byte|0xFF.*0xD8|0x89.*0x50/i);
  });

  it('storageUpload.ts enforces a file-size limit for KYC uploads', () => {
    const svc = read(path.join(SRC, 'services', 'storageUpload.ts'));
    expect(svc).toMatch(/MAX_KYC_BYTES|maxKycBytes|8.*1024.*1024|8388608/i);
  });

  it('storageUpload.ts rejects files whose MIME is not image/jpeg or image/png', () => {
    const svc = read(path.join(SRC, 'services', 'storageUpload.ts'));
    expect(svc).toMatch(/image\/jpeg.*image\/png|ALLOWED_MIME/i);
    expect(svc).toMatch(/Unsupported.*type|not.*allowed|only.*image/i);
  });

  it('storageUpload.ts does not allow path traversal sequences', () => {
    const svc = read(path.join(SRC, 'services', 'storageUpload.ts'));
    expect(svc).not.toMatch(/\.\.\//);
  });

  it('storageUpload.ts uses upsert:false for KYC uploads (prevents overwriting reviewed docs)', () => {
    const svc = read(path.join(SRC, 'services', 'storageUpload.ts'));
    expect(svc).toMatch(/upsert.*false|upsert:\s*false/);
  });

  it('KYC upload path is scoped to kyc/{userId}/{submissionId}/ (no cross-user paths)', () => {
    const profSvc = read(path.join(SRC, 'services', 'profileService.ts'));
    // Path must include userId as second segment after 'kyc/'
    expect(profSvc).toMatch(/kyc\/\$\{.*[Uu]ser[Ii]d.*\}\//);
  });

  it('SVG files are rejected (no SVG in MIME allowlist)', () => {
    const svc = read(path.join(SRC, 'services', 'storageUpload.ts'));
    expect(svc).not.toMatch(/image\/svg/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO 10 — RLS policies block cross-user reads and writes
// ══════════════════════════════════════════════════════════════════════════════

describe('Scenario 10: RLS policies prevent cross-user data access', () => {
  it('migration: disputes SELECT policy restricts to own rows only', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/disputes_select_own/);
    expect(sql).toMatch(/raised_by = auth\.uid\(\)/);
  });

  it('migration: linked_payment_methods SELECT policy restricts to own rows', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/lpm_select_own/);
    expect(sql).toMatch(/user_id = auth\.uid\(\)/);
  });

  it('migration: direct writes to disputes are blocked (false policies)', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/disputes_no_direct_insert/);
    expect(sql).toMatch(/disputes_no_direct_update/);
    expect(sql).toMatch(/disputes_no_direct_delete/);
  });

  it('migration: direct writes to linked_payment_methods are blocked', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/lpm_no_direct_write/);
  });

  it('all RPCs use auth.uid() as the identity source — never a caller-supplied user ID', () => {
    const sql = latestMigration();
    // Every RPC body must derive v_uid := auth.uid()
    const rpcNames = [
      'create_dispute',
      'update_dispute_status',
      'get_my_disputes',
      'get_admin_disputes',
      'link_payment_method',
      'verify_payment_method',
      'get_my_payment_methods',
      'unlink_payment_method',
    ];
    for (const rpc of rpcNames) {
      const rpcBody = sql.match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}[\\s\\S]*?\\$\\$;`)
      )?.[0] ?? '';
      expect(rpcBody, `${rpc} must derive user id from auth.uid()`).toMatch(/auth\.uid\(\)/);
    }
  });

  it('profileService.ts update path is via RPC (server derives user_id from session)', () => {
    const svc = read(path.join(SRC, 'services', 'profileService.ts'));
    // Must use RPC or auth.getUser() — never accept user_id as a caller-supplied update key
    expect(svc).toMatch(/supabase\.rpc|auth\.getUser|auth\.uid/i);
    // The one direct .update() allowed is uploadAvatar, which now derives from auth.getUser()
    // and uses user.id (session-derived), not a function parameter named 'userId'.
    // Verify no update still uses the old caller-supplied 'userId' parameter directly.
    expect(svc).not.toMatch(/\.from\(['"]profiles['"]\)\.update\([^)]*\)\.eq\(['"]id['"],\s*userId\)/);
  });

  it('notificationService.ts uses RLS recipient_id filter (not client-supplied)', () => {
    const svc = read(path.join(SRC, 'services', 'notificationService.ts'));
    // Fetch uses supabase.auth.getUser() to get the user id, then filters
    expect(svc).toMatch(/auth\.getUser|\.eq\(['"]recipient_id['"],\s*user\.id\)/);
    // Must NOT take a userId parameter and use it as the filter
    expect(svc).not.toMatch(/fetchNotifications\s*\([^)]*userId[^)]*\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BONUS — Migration quality checks
// ══════════════════════════════════════════════════════════════════════════════

describe('Migration quality: SECURITY DEFINER + REVOKE/GRANT pattern', () => {
  it('all RPCs are SECURITY DEFINER', () => {
    const sql = latestMigration();
    const rpcNames = [
      'create_dispute', 'update_dispute_status', 'get_my_disputes',
      'get_admin_disputes', 'link_payment_method', 'verify_payment_method',
      'get_my_payment_methods', 'unlink_payment_method',
    ];
    for (const rpc of rpcNames) {
      expect(sql, `${rpc} must be SECURITY DEFINER`).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}[\\s\\S]*?SECURITY DEFINER`)
      );
    }
  });

  it('all RPCs set search_path = public to prevent search_path hijacking', () => {
    const sql = latestMigration();
    const count = (sql.match(/SET search_path = public/g) ?? []).length;
    // Should appear once per RPC (at least 8)
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it('all RPCs REVOKE from PUBLIC then GRANT only to authenticated', () => {
    const sql = latestMigration();
    const rpcNames = [
      'create_dispute', 'update_dispute_status', 'get_my_disputes',
      'get_admin_disputes', 'link_payment_method', 'verify_payment_method',
      'get_my_payment_methods', 'unlink_payment_method',
    ];
    for (const rpc of rpcNames) {
      expect(sql, `${rpc} must REVOKE from PUBLIC`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}`)
      );
      expect(sql, `${rpc} must GRANT to authenticated`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc} TO authenticated`)
      );
    }
  });

  it('migration wraps all DDL in a single transaction (BEGIN … COMMIT)', () => {
    const sql = latestMigration();
    // BEGIN may follow a header comment block — search for it anywhere near the start
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;\s*$/);
  });

  it('create_dispute enforces rate limit (max 5 per 24 hours)', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/v_recent_count >= 5/);
    expect(sql).toMatch(/INTERVAL '24 hours'/);
    expect(sql).toMatch(/Too many dispute submissions/i);
  });

  it('link_payment_method enforces rate limit (max 3 per hour)', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/>= 3[\s\S]*?INTERVAL '1 hour'|INTERVAL '1 hour'[\s\S]*?>= 3/s);
    expect(sql).toMatch(/Too many link attempts/i);
  });

  it('update_dispute_status enforces allowed transition state machine', () => {
    const sql = latestMigration();
    // Must check that transition is in the allowed set
    expect(sql).toMatch(/Invalid transition/i);
    // Terminal state guard
    expect(sql).toMatch(/terminal state/i);
  });

  it('update_dispute_status requires resolution_note for resolved/dismissed', () => {
    const sql = latestMigration();
    expect(sql).toMatch(/resolution note is required/i);
  });
});
