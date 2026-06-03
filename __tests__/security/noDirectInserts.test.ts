/**
 * Security static analysis tests.
 *
 * Scans the frontend source tree for patterns that are forbidden in a
 * production-grade financial app. Tests fail on UNSAFE findings;
 * acceptable patterns are explicitly allow-listed with a rationale.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../');
const SRC  = path.join(ROOT, 'src');
const APP  = path.join(ROOT, 'app');

/** Recursively collect .ts / .tsx files under a directory. */
function tsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) result.push(full);
  }
  return result;
}

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function rel(p: string): string {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

// ── Financial table names the frontend must never INSERT/UPDATE into ──────────

const FINANCIAL_TABLES = [
  'contribution_payments',
  'mobile_money_transactions',
  'vault_balances',
  'savings_transactions',
  'withdrawal_requests',
  'audit_logs',
];

// ── Allowed patterns (exceptions with documented rationale) ──────────────────

// supabase.ts uses setTimeout only for network request abort — not business logic
const ALLOWED_SETTIMEOUT_FILES = new Set(['src/services/supabase.ts']);

// PLACEHOLDER_KEY in supabase.ts is a structural JWT shape placeholder, not real creds
const ALLOWED_HARDCODED_JWT_FILES = new Set(['src/services/supabase.ts']);

// notifications table INSERT in notificationService.ts — flagged as UNSAFE below
// but we allow-list the specific file so other files can still be checked
const ALLOWED_NOTIFICATION_INSERT_FILES = new Set(['src/services/notificationService.ts']);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Security: no direct financial table inserts from frontend', () => {
  const sourceFiles = [...tsFiles(SRC), ...tsFiles(APP)];

  it('does not INSERT into contribution_payments from frontend', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      // Pattern: .from('contribution_payments').insert(  or  .insert into contribution_payments
      if (/\.from\(['"](contribution_payments)['"]\)\.(insert|update|delete)/m.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Direct writes to contribution_payments found in: ${violations.join(', ')}`).toEqual([]);
  });

  it('does not INSERT into mobile_money_transactions from frontend', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/\.from\(['"](mobile_money_transactions)['"]\)\.(insert|update|delete)/m.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Direct writes to mobile_money_transactions found in: ${violations.join(', ')}`).toEqual([]);
  });

  it('does not INSERT into vault_balances from frontend', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/\.from\(['"](vault_balances|savings_transactions)['"]\)\.(insert|update|delete)/m.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Direct writes to vault_balances/savings_transactions: ${violations.join(', ')}`).toEqual([]);
  });

  it('does not INSERT into withdrawal_requests from frontend', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/\.from\(['"](withdrawal_requests)['"]\)\.(insert|update|delete)/m.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Direct writes to withdrawal_requests: ${violations.join(', ')}`).toEqual([]);
  });

  it('does not INSERT into audit_logs from frontend', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/\.from\(['"](audit_logs)['"]\)\.(insert|update|delete)/m.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Direct writes to audit_logs: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: no service_role key in frontend code', () => {
  const sourceFiles = [...tsFiles(SRC), ...tsFiles(APP)];

  it('does not reference service_role key or SUPABASE_SERVICE_ROLE_KEY', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/SUPABASE_SERVICE_ROLE_KEY|service_role_key|createClient.*service_role/im.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `service_role key referenced in: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: no hardcoded JWT or API secrets (except structural placeholder)', () => {
  const serviceFiles = tsFiles(SRC);

  it('does not contain hardcoded JWTs outside the known placeholder in supabase.ts', () => {
    // A JWT has 3 base64url segments separated by dots — detect long multi-segment tokens
    const jwtPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
    const violations: string[] = [];
    for (const file of serviceFiles) {
      const fileRel = rel(file);
      if (ALLOWED_HARDCODED_JWT_FILES.has(fileRel)) continue;
      const text = readFile(file);
      if (jwtPattern.test(text)) violations.push(fileRel);
    }
    expect(violations, `Hardcoded JWTs in: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: no setTimeout in service-layer business logic', () => {
  const serviceFiles = tsFiles(SRC);

  it('services do not use setTimeout for business logic (only supabase.ts network timeout is allowed)', () => {
    const violations: string[] = [];
    for (const file of serviceFiles) {
      const fileRel = rel(file);
      if (ALLOWED_SETTIMEOUT_FILES.has(fileRel)) continue;
      const text = readFile(file);
      if (/\bsetTimeout\b/.test(text)) violations.push(fileRel);
    }
    expect(violations, `setTimeout in service files: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: no old table names (group_memberships / contributions)', () => {
  const sourceFiles = [...tsFiles(SRC), ...tsFiles(APP)];

  it('does not reference deprecated group_memberships table', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/\.from\(['"](group_memberships)['"]\)/m.test(text)) violations.push(rel(file));
    }
    expect(violations, `Old table group_memberships in: ${violations.join(', ')}`).toEqual([]);
  });

  it('does not reference deprecated contributions table (must be contribution_payments)', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      // Exact table name match — "contributions" as standalone table, not as a substring
      if (/\.from\(['"]contributions['"]\)/m.test(text)) violations.push(rel(file));
    }
    expect(violations, `Old table contributions in: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: no fake/mock financial data in production paths', () => {
  const sourceFiles = [...tsFiles(SRC), ...tsFiles(APP)];

  it('does not hardcode fallback financial arrays with fake users', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      // Pattern: array of objects that look like fake member/user data
      if (/fallbackUsers|randomSeries|fakeMembers|demoContributions|mockPayments/i.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Fake financial data in: ${violations.join(', ')}`).toEqual([]);
  });

  it('supabaseConfigured=false paths return empty arrays or null (no fake financial rows)', () => {
    // Scan for patterns where supabaseConfigured guard returns constructed financial objects
    const violations: string[] = [];
    const financialReturnPattern = /if\s*\(!\s*supabaseConfigured\)[^}]*\{[^}]*(amount|balance|contribution|receipt)/ms;

    for (const file of [...tsFiles(SRC)]) {
      const text = readFile(file);
      if (financialReturnPattern.test(text)) {
        // Allow-list: paymentService returns local-contrib ID (not a real amount)
        // Allow-list: savingsService returns a goal skeleton (creates goal shell when offline)
        // Allow-list: groupService returns a local group when offline
        const fileRel = rel(file);
        const allowedOfflineFiles = new Set([
          'src/services/paymentService.ts',
          'src/services/savingsService.ts',
          'src/services/groupService.ts',
          'src/services/collectorService.ts',
        ]);
        if (!allowedOfflineFiles.has(fileRel)) {
          violations.push(fileRel);
        }
      }
    }
    expect(violations, `Unexpected fake financial returns in: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: notifications table INSERT removed from frontend (FIXED)', () => {
  it('notificationService.ts no longer contains direct INSERT into notifications', () => {
    const notifFile = path.join(SRC, 'services', 'notificationService.ts');
    const text = readFile(notifFile);
    // sendContributionAlert and sendAssignmentNotification were removed.
    // Notification dispatch now happens server-side only.
    const hasDirectInsert = /\.from\(['"]notifications['"]\)\.insert\(/.test(text);
    expect(hasDirectInsert).toBe(false);
  });
});

describe('Security: 2FA screen is honest placeholder (FIXED)', () => {
  it('2fa.tsx no longer contains a fake toggle or success alert', () => {
    const tfaFile = path.join(APP, '(settings)', '2fa.tsx');
    const text = readFile(tfaFile);

    // Fake toggle removed
    const hasFakeToggle = /setTwoFactorEnabled\(true\)/.test(text);
    // Fake success alert removed
    const hasFakeSuccessAlert = /Alert\.alert\(['"]Success['"]/i.test(text);

    expect(hasFakeToggle).toBe(false);
    expect(hasFakeSuccessAlert).toBe(false);
  });
});
