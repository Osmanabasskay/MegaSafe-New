/**
 * Super Admin Risk Dashboard tests (Phase 17).
 *
 * These are runnable without a live DB or Next.js server context:
 *  - pure risk-scoring helpers
 *  - source-contract assertions over the dashboard code (sidebar sections,
 *    new admin actions, audit logging, export logging, fixed bugs, new pages)
 *
 * Backend/DB behaviour (RPC role-gating, risk_events inserts, detection views,
 * duplicate constraints) is verified by the SQL test suite in
 * supabase/tests/risk_dashboard_tests.sql (executed against the database).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { riskScoreForAction } from '../../apps/admin/lib/audit';

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

// ── Risk scoring (Phase 3) ─────────────────────────────────────────────────────

describe('riskScoreForAction', () => {
  it('scores high-impact financial/account actions higher than low-impact ones', () => {
    expect(riskScoreForAction('approve_withdrawal')).toBeGreaterThan(riskScoreForAction('add_admin_note'));
    expect(riskScoreForAction('ban_user')).toBeGreaterThan(riskScoreForAction('unsuspend_user'));
    expect(riskScoreForAction('freeze_payout')).toBeGreaterThanOrEqual(50);
  });

  it('returns a sane default for unknown actions', () => {
    expect(riskScoreForAction('totally_unknown_action')).toBe(15);
  });

  it('keeps every score within 0..100', () => {
    for (const a of ['suspend_user', 'ban_user', 'approve_withdrawal', 'freeze_payout', 'export_generated', 'add_admin_note']) {
      const s = riskScoreForAction(a);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

// ── Severity banding (Phase 3 / Phase 15) ──────────────────────────────────────

describe('severity banding', () => {
  // mirror of severityForScore in components/risk-badge.tsx and severity_for_score() in DB
  const band = (s: number) => (s <= 20 ? 'low' : s <= 40 ? 'medium' : s <= 60 ? 'high' : s <= 80 ? 'critical' : 'extreme');

  it('maps the documented ranges', () => {
    expect(band(10)).toBe('low');
    expect(band(30)).toBe('medium');
    expect(band(55)).toBe('high');
    expect(band(75)).toBe('critical');
    expect(band(95)).toBe('extreme');
  });

  it('risk-badge.tsx uses the same thresholds (20/40/60/80)', () => {
    const src = read('apps/admin/components/risk-badge.tsx');
    expect(src).toMatch(/<= 20/);
    expect(src).toMatch(/<= 40/);
    expect(src).toMatch(/<= 60/);
    expect(src).toMatch(/<= 80/);
    expect(src).toMatch(/extreme/);
  });
});

// ── Sidebar: all 22 sections (Phase 2) ─────────────────────────────────────────

describe('sidebar sections (Phase 2)', () => {
  const shell = read('apps/admin/components/admin-shell.tsx');
  const required = [
    '/admin', '/admin/risk', '/admin/users', '/admin/kyc', '/admin/devices', '/admin/logins',
    '/admin/vault', '/admin/savings', '/admin/transactions', '/admin/payments', '/admin/payouts',
    '/admin/groups', '/admin/osusu', '/admin/collectors', '/admin/disputes', '/admin/fraud',
    '/admin/audit', '/admin/security', '/admin/rate-limits', '/admin/admin-activity',
    '/admin/reports', '/admin/health',
  ];
  it.each(required)('includes nav route %s', (route) => {
    expect(shell).toContain(`'${route}'`);
  });
});

// ── New pages exist (Phase 5/6/10/11/14) ───────────────────────────────────────

describe('new dashboard pages exist', () => {
  const pages = [
    'apps/admin/app/admin/risk/page.tsx',
    'apps/admin/app/admin/fraud/page.tsx',
    'apps/admin/app/admin/devices/page.tsx',
    'apps/admin/app/admin/logins/page.tsx',
    'apps/admin/app/admin/rate-limits/page.tsx',
    'apps/admin/app/admin/admin-activity/page.tsx',
    'apps/admin/app/admin/health/page.tsx',
  ];
  it.each(pages)('%s exists', (p) => {
    expect(fs.existsSync(path.resolve(p))).toBe(true);
  });
});

// ── Action route: new controls + bug fixes (Phase 6/8/10) ──────────────────────

describe('admin action route', () => {
  const route = read('apps/admin/app/api/admin/action/route.ts');

  it('supports the new admin controls', () => {
    for (const a of ['lock_account', 'unlock_account', 'force_logout', 'mark_kyc_verified', 'escalate_kyc',
      'freeze_payout', 'unfreeze_payout', 'freeze_transaction', 'mark_risk_reviewed', 'update_risk_status',
      'create_fraud_case', 'update_fraud_case', 'add_admin_note']) {
      expect(route).toContain(`'${a}'`);
    }
  });

  it('FIX: collector actions key on user_id, not the non-existent profile_id', () => {
    expect(route).not.toMatch(/collectors'\)\.update\([^)]*\)\.eq\('profile_id'/);
    expect(route).toMatch(/from\('collectors'\)\.update\(\{ is_active: false \}\)\.eq\('user_id'/);
  });

  it('FIX: force_disband uses the valid group_status "archived" (not "disbanded")', () => {
    expect(route).toMatch(/status: 'archived'/);
  });

  it('raises a risk_event for high-severity actions (record_risk_event)', () => {
    expect(route).toContain('record_risk_event');
  });

  it('logs every action to the admin_actions ledger', () => {
    expect(route).toContain('logAdminAction');
  });
});

// ── Audit logging fix (Phase 11/12) ────────────────────────────────────────────

describe('audit logging', () => {
  const audit = read('apps/admin/lib/audit.ts');
  it('writes to admin_actions, not the broken audit_logs columns', () => {
    expect(audit).toContain("from('admin_actions')");
    expect(audit).toContain('admin_user_id');
    expect(audit).not.toContain("from('audit_logs')");
    // the broken columns must not be USED as insert keys (mentions in comments are fine)
    expect(audit).not.toMatch(/new_values\s*:/);
    expect(audit).not.toMatch(/\n\s*user_id\s*:/);
  });
  it('never writes secret-bearing fields (no password/otp/token columns)', () => {
    // ensure no `password:` / `otp:` / `refresh_token:` / `jwt:` field assignments
    expect(audit).not.toMatch(/\b(password|otp|secret|refresh_token|jwt)\s*:/i);
  });
});

// ── Export audit logging + metadata (Phase 13) ─────────────────────────────────

describe('reports export route', () => {
  const exp = read('apps/admin/app/api/admin/reports/export/route.ts');
  it('audit-logs every export as export_generated', () => {
    expect(exp).toContain("action: 'export_generated'");
  });
  it('stamps generated_by and generated_at on CSV exports', () => {
    expect(exp).toContain('generated_by');
    expect(exp).toContain('generated_at');
  });
  it('supports the new export types', () => {
    for (const t of ['risk_events', 'security_events', 'admin_activity', 'audit_log', 'kyc', 'collectors', 'groups', 'contributions', 'payments', 'payouts']) {
      expect(exp).toContain(`'${t}'`);
    }
  });
  it('gates on requireSuperAdmin', () => {
    expect(exp).toContain('requireSuperAdmin');
  });
});

// ── Data layer uses secure RPCs (Phase 16) ─────────────────────────────────────

describe('admin-data RPC wiring', () => {
  const data = read('apps/admin/lib/admin-data.ts');
  it.each([
    'get_super_admin_overview_metrics',
    'get_live_risk_events',
    'get_user_risk_profile',
    'get_admin_activity',
    'get_system_health_summary',
  ])('calls RPC %s', (rpc) => {
    expect(data).toContain(rpc);
  });
});
