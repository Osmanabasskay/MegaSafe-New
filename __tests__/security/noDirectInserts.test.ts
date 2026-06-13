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

// supabase.ts and hibp.ts use setTimeout exclusively for network-request abort — not business logic
const ALLOWED_SETTIMEOUT_FILES = new Set([
  'src/services/supabase.ts',
  'src/utils/auth/hibp.ts',
]);

// supabase.ts was refactored from a JWT-shaped PLACEHOLDER_KEY to an
// sb_publishable_placeholder_ string, which doesn't match the eyJ... JWT regex.
// The allow-list entry is kept defensively in case the pattern ever reverts.
const ALLOWED_HARDCODED_JWT_FILES = new Set(['src/services/supabase.ts']);

// supabase.ts references 'service_role' strings as DETECTION / REJECTION guards
// (it throws an error when it detects a service_role key — defensive code, not a leak).
// The comment block at the bottom also documents what keys must NOT be used.
const ALLOWED_SERVICE_ROLE_REF_FILES = new Set(['src/services/supabase.ts']);

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
      const fileRel = rel(file);
      // supabase.ts contains 'service_role' as a DETECTION guard that throws an
      // error if such a key is accidentally used — not a real exposure.
      if (ALLOWED_SERVICE_ROLE_REF_FILES.has(fileRel)) continue;
      const text = readFile(file);
      if (/SUPABASE_SERVICE_ROLE_KEY|service_role_key|createClient.*service_role/im.test(text)) {
        violations.push(fileRel);
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

// ── MegaSafe 2.1 hardening tests ─────────────────────────────────────────────

describe('Security: no hardcoded demo transaction/receipt IDs in production code', () => {
  const sourceFiles = [...tsFiles(SRC), ...tsFiles(APP)];

  it('payment-success screen does not contain hardcoded fake transaction IDs', () => {
    const psFile = path.join(APP, '(groups)', 'payment-success.tsx');
    const text = readFile(psFile);
    // These exact demo strings must never appear in the source after MegaSafe 2.1
    expect(text, 'Fake TXN ID found in payment-success').not.toMatch(/TXN-2024-1215-001/);
    expect(text, 'Fake RCP number found in payment-success').not.toMatch(/RCP-20241215-123456/);
    expect(text, 'Fake group name found in payment-success').not.toMatch(/Family Savings Circle/);
    expect(text, 'Fake phone found in payment-success').not.toMatch(/\+232 76 123 456/);
    expect(text, 'Hardcoded groupId fallback found').not.toMatch(/groupId\s*[=:]\s*['"]1['"]/);
  });

  it('payment-success initial state does not hardcode status=verified', () => {
    const psFile = path.join(APP, '(groups)', 'payment-success.tsx');
    const text = readFile(psFile);
    // Ensure the screen does NOT default to "verified" without a backend check
    expect(text, 'payment-success should not default to status:verified').not.toMatch(
      /status:\s*['"]verified['"]/
    );
  });

  it('no file contains hardcoded family-fund or similar demo group names', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFile(file);
      if (/Family\s+Savings\s+Circle|Family\s+Fund/i.test(text)) {
        violations.push(rel(file));
      }
    }
    expect(violations, `Demo group names found in: ${violations.join(', ')}`).toEqual([]);
  });
});

describe('Security: Math.random must not appear in security-critical code', () => {
  it('groupService.ts generateInviteCode does not call Math.random()', () => {
    const file = path.join(SRC, 'services', 'groupService.ts');
    const text = readFile(file);
    // Match actual invocations (with parentheses), not comments that mention the function name.
    // A comment "Math.random is not acceptable" should not trigger this.
    const hasInsecureCall = /generateInviteCode[\s\S]*?Math\.random\s*\(/s.test(text);
    expect(hasInsecureCall, 'Math.random() call in generateInviteCode').toBe(false);
  });

  it('groupService.ts createLocalId does not call Math.random()', () => {
    const file = path.join(SRC, 'services', 'groupService.ts');
    const text = readFile(file);
    const hasInsecureCall = /createLocalId[\s\S]*?Math\.random\s*\(/s.test(text);
    expect(hasInsecureCall, 'Math.random() call in createLocalId').toBe(false);
  });

  it('assign-contributors screen generateRandomPasscode does not call Math.random()', () => {
    const file = path.join(APP, '(groups)', 'assign-contributors.tsx');
    const text = readFile(file);
    const hasInsecureCall = /generateRandomPasscode[\s\S]*?Math\.random\s*\(/s.test(text);
    expect(hasInsecureCall, 'Math.random() call in generateRandomPasscode').toBe(false);
  });
});

describe('Security: passcode must never be shown in Alert.alert', () => {
  it('assign-contributors does not show collector passcode in Alert.alert', () => {
    const file = path.join(APP, '(groups)', 'assign-contributors.tsx');
    const text = readFile(file);
    // The Alert.alert must not contain the passcode variable — only the reveal modal should
    const alertBlocks = text.match(/Alert\.alert\([^;]+;/gs) ?? [];
    const violatingAlert = alertBlocks.find((block) =>
      /collectorPasscode|finalPasscode|secretCode|Passcode:|Secret Code:/i.test(block)
    );
    expect(violatingAlert, 'Passcode exposed in Alert.alert').toBeUndefined();
  });

  it('assign-contributors has a secure reveal modal (not just an Alert) for passcode', () => {
    const file = path.join(APP, '(groups)', 'assign-contributors.tsx');
    const text = readFile(file);
    // The secure reveal modal state variables must be present
    expect(text, 'Missing showRevealModal state').toMatch(/showRevealModal/);
    expect(text, 'Missing revealPasscode state').toMatch(/revealPasscode/);
  });
});

describe('Security: QMoney must not appear in Monime digital payment flows', () => {
  it('monime-payment screen does not offer QMoney as a provider', () => {
    const file = path.join(APP, '(groups)', 'monime-payment.tsx');
    const text = readFile(file);
    // QMoney should never be a Monime digital payment provider option
    expect(text, 'QMoney found in Monime digital payment screen').not.toMatch(/qmoney|q_money|QMoney/i);
  });

  it('collector screen labels QMoney as manual collection only', () => {
    const file = path.join(APP, '(groups)', 'collector.tsx');
    const text = readFile(file);
    // QMoney must be labeled to indicate it is manual-only, not a Monime digital method
    expect(text, 'QMoney not labeled as manual-only in collector screen').toMatch(/QMoney.*Manual|Manual.*QMoney/i);
  });
});

describe('Security: Sierra Leone phone validation enforced in group creation', () => {
  it('create.tsx imports and uses Sierra Leone phone validator', () => {
    const file = path.join(APP, '(groups)', 'create.tsx');
    const text = readFile(file);
    expect(text, 'Missing isValidSierraLeonePhone import').toMatch(/isValidSierraLeonePhone/);
    expect(text, 'Missing normalizeToSierraLeone import').toMatch(/normalizeToSierraLeone/);
    // The validation must be called in handleCreate
    expect(text, 'Phone validation not called in handleCreate').toMatch(/isValidSierraLeonePhone\(normalizedPhone\)/);
  });

  it('create.tsx enforces minimum contribution amount', () => {
    const file = path.join(APP, '(groups)', 'create.tsx');
    const text = readFile(file);
    expect(text, 'Missing MIN_CONTRIBUTION_AMOUNT').toMatch(/MIN_CONTRIBUTION_AMOUNT/);
    expect(text, 'Missing MAX_CONTRIBUTION_AMOUNT').toMatch(/MAX_CONTRIBUTION_AMOUNT/);
  });
});

describe('Security: physical collection image validation', () => {
  it('assign-contributors validates MIME type and file size before photo upload', () => {
    const file = path.join(APP, '(groups)', 'assign-contributors.tsx');
    const text = readFile(file);
    expect(text, 'Missing image MIME type validation').toMatch(/ALLOWED_IMAGE_TYPES|mimeType/);
    expect(text, 'Missing file size validation').toMatch(/MAX_PHOTO_BYTES|fileSize/);
    expect(text, 'Missing validateAndSetPhoto function').toMatch(/validateAndSetPhoto/);
  });

  it('create.tsx validates image MIME type before logo upload', () => {
    const file = path.join(APP, '(groups)', 'create.tsx');
    const text = readFile(file);
    expect(text, 'Missing MIME type check in create.tsx').toMatch(/ALLOWED_LOGO_TYPES|mimeType/);
  });
});

describe('Security: contact access requires prior explanation', () => {
  it('invite.tsx explains contact permission purpose before requesting', () => {
    const file = path.join(APP, '(groups)', 'invite.tsx');
    const text = readFile(file);
    // An Alert.alert explaining the permission must appear before requestPermissionsAsync
    const permExplanationIndex = text.indexOf('Access Your Contacts');
    const permRequestIndex = text.indexOf('requestPermissionsAsync');
    expect(permExplanationIndex, 'Missing contact permission explanation').toBeGreaterThan(-1);
    expect(permRequestIndex, 'Missing requestPermissionsAsync call').toBeGreaterThan(-1);
    expect(
      permExplanationIndex < permRequestIndex,
      'Permission explanation must come before the permission request'
    ).toBe(true);
  });
});

describe('Security: payment-success fetches backend receipt (not params)', () => {
  it('payment-success.tsx queries contribution_payments for authoritative data', () => {
    const file = path.join(APP, '(groups)', 'payment-success.tsx');
    const text = readFile(file);
    // Must query the DB, not trust route params for receipt data
    expect(text, 'Must query contribution_payments').toMatch(/contribution_payments/);
    expect(text, 'Must validate UUID before use').toMatch(/UUID_RE|[0-9a-f]{8}.*[0-9a-f]{4}/);
    // Must not display verified without a DB check
    expect(text, 'Must use member_id RLS filter').toMatch(/member_id.*user\.id|eq.*user\.id/);
  });
});
