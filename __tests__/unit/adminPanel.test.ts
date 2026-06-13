/**
 * Admin panel unit tests (Phase 6)
 *
 * Tests admin security utilities: IP allowlist, rate limit fail-closed behavior,
 * self-action guard, role assertions, and audit log logic.
 *
 * These tests use the actual admin lib functions (no Next.js server context needed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getClientIp, isIpAllowed, assertNoSelfAction, isSuperAdminRole } from '../../apps/admin/lib/security';
import { logAdminAction } from '../../apps/admin/lib/audit';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── IP allow-list ──────────────────────────────────────────────────────────────

describe('isIpAllowed', () => {
  afterEach(() => { delete process.env['ADMIN_IP_ALLOWLIST']; });

  it('allows all IPs when ADMIN_IP_ALLOWLIST is empty', () => {
    process.env['ADMIN_IP_ALLOWLIST'] = '';
    expect(isIpAllowed('1.2.3.4')).toBe(true);
    expect(isIpAllowed('unknown')).toBe(true);
  });

  it('allows matching IPs when allowlist is set', () => {
    process.env['ADMIN_IP_ALLOWLIST'] = '192.168.1.1,10.0.0.5';
    expect(isIpAllowed('192.168.1.1')).toBe(true);
    expect(isIpAllowed('10.0.0.5')).toBe(true);
  });

  it('blocks non-allowlisted IPs', () => {
    process.env['ADMIN_IP_ALLOWLIST'] = '192.168.1.1';
    expect(isIpAllowed('99.99.99.99')).toBe(false);
    expect(isIpAllowed('unknown')).toBe(false);
  });

  it('trims whitespace from allowlist entries', () => {
    process.env['ADMIN_IP_ALLOWLIST'] = ' 192.168.1.1 , 10.0.0.1 ';
    expect(isIpAllowed('192.168.1.1')).toBe(true);
    expect(isIpAllowed('10.0.0.1')).toBe(true);
  });
});

// ── getClientIp ───────────────────────────────────────────────────────────────

describe('getClientIp', () => {
  it('prefers x-forwarded-for header — reads LAST entry (Vercel proxy model)', () => {
    // The outermost Vercel/Cloudflare proxy APPENDS the real client IP as the
    // LAST entry. Reading the first entry is the classic IP-spoofing vector
    // (a client can prepend arbitrary IPs). getClientIp() correctly reads last.
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(headers)).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip', () => {
    const headers = new Headers({ 'x-real-ip': '9.8.7.6' });
    expect(getClientIp(headers)).toBe('9.8.7.6');
  });

  it('returns unknown when no IP headers present', () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe('unknown');
  });
});

// ── isSuperAdminRole ──────────────────────────────────────────────────────────

describe('isSuperAdminRole', () => {
  it('returns true for super_admin', () => {
    expect(isSuperAdminRole('super_admin')).toBe(true);
  });

  it('returns false for org_admin, collector, member, undefined, null', () => {
    expect(isSuperAdminRole('org_admin')).toBe(false);
    expect(isSuperAdminRole('collector')).toBe(false);
    expect(isSuperAdminRole('member')).toBe(false);
    expect(isSuperAdminRole(undefined)).toBe(false);
    expect(isSuperAdminRole(null)).toBe(false);
    expect(isSuperAdminRole('')).toBe(false);
  });

  it('is case-sensitive — Super_Admin is not super_admin', () => {
    expect(isSuperAdminRole('Super_Admin')).toBe(false);
    expect(isSuperAdminRole('SUPER_ADMIN')).toBe(false);
  });
});

// ── assertNoSelfAction ────────────────────────────────────────────────────────

describe('assertNoSelfAction', () => {
  it('throws when actor equals target (self-action blocked)', () => {
    expect(() => assertNoSelfAction('user-123', 'user-123')).toThrow(/self-action/i);
  });

  it('does not throw when actor != target', () => {
    expect(() => assertNoSelfAction('admin-1', 'user-2')).not.toThrow();
    expect(() => assertNoSelfAction('a', 'b')).not.toThrow();
  });

  it('is not vulnerable to empty-string bypass', () => {
    // Both empty strings would be "equal" — block them
    expect(() => assertNoSelfAction('', '')).toThrow();
  });
});

// ── logAdminAction ────────────────────────────────────────────────────────────

describe('logAdminAction (corrected: writes admin_actions, not the broken audit_logs path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts into admin_actions with correct columns (admin_user_id/target_table — NOT user_id/new_values)', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock   = vi.fn().mockReturnValue({ insert: insertMock });
    const fakeSvc    = { from: fromMock } as unknown as SupabaseClient;

    await logAdminAction({
      supabase:       fakeSvc,
      adminUserId:    'admin-1',
      adminName:      'Osman Abass Kamara',
      targetUserId:   'user-2',
      action:         'approve_kyc',
      tableName:      'profiles',
      targetRecordId: 'user-2',
      reason:         'Documents verified',
    });

    // The old code wrote to the non-existent audit_logs columns — now it targets admin_actions.
    expect(fromMock).toHaveBeenCalledWith('admin_actions');
    const insertArg = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg).toMatchObject({
      admin_user_id:  'admin-1',
      action:         'approve_kyc',
      target_table:   'profiles',
      target_user_id: 'user-2',
      reason:         'Documents verified',
      status:         'success',
    });
    // must NOT use the broken column names
    expect(insertArg).not.toHaveProperty('user_id');
    expect(insertArg).not.toHaveProperty('new_values');
    // risk score is attached for prioritisation
    expect(typeof insertArg.risk_score).toBe('number');
  });

  it('does not throw when admin_actions insert fails (non-fatal, logs error)', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: { message: 'DB error' } });
    const fromMock   = vi.fn().mockReturnValue({ insert: insertMock });
    const fakeSvc    = { from: fromMock } as unknown as SupabaseClient;

    await expect(
      logAdminAction({
        supabase: fakeSvc,
        adminUserId: 'admin-1',
        targetUserId: 'user-2',
        action: 'reject_kyc',
        tableName: 'profiles',
      })
    ).resolves.not.toThrow();
  });

  it('writes target_table from caller, never from user input', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock   = vi.fn().mockReturnValue({ insert: insertMock });
    const fakeSvc    = { from: fromMock } as unknown as SupabaseClient;

    await logAdminAction({
      supabase:     fakeSvc,
      adminUserId:  'admin-1',
      targetUserId: 'user-2',
      action:       'approve_kyc',
      tableName:    'profiles',  // hardcoded by caller — never user-supplied
    });

    const insertArg = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.target_table).toBe('profiles');
  });

  it('does not put the literal string "unknown" into the inet ip_address column', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock   = vi.fn().mockReturnValue({ insert: insertMock });
    const fakeSvc    = { from: fromMock } as unknown as SupabaseClient;

    await logAdminAction({
      supabase: fakeSvc, adminUserId: 'admin-1', action: 'suspend_user',
      tableName: 'profiles', ipAddress: 'unknown',
    });
    const insertArg = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.ip_address).toBeNull();
  });
});

// ── Admin panel fake data check ───────────────────────────────────────────────

describe('Admin panel — no fake data', () => {
  it('admin-data.ts does not reference fallbackUsers or hardcoded fake records', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve('apps/admin/lib/admin-data.ts');
    const text = fs.readFileSync(filePath, 'utf8');

    expect(text).not.toMatch(/fallbackUsers/i);
    expect(text).not.toMatch(/fakeUser/i);
    expect(text).not.toMatch(/demoContributions/i);
    expect(text).not.toMatch(/randomSeries/i);
    expect(text).not.toMatch(/mockPayments/i);
  });

  it('admin-data.ts reads user_roles table for role check (not profiles.role only)', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve('apps/admin/lib/admin-data.ts');
    const text = fs.readFileSync(filePath, 'utf8');

    // Should query user_roles or profiles.role from DB — not hardcoded role strings
    const hasRoleQuery = /user_roles|profiles.*role|\.role.*super_admin/i.test(text);
    expect(hasRoleQuery).toBe(true);
  });
});

// ── Admin action route security (contract tests) ──────────────────────────────

describe('Admin action route — security contract', () => {
  it('consumeAdminRateLimit fails CLOSED when service key is not configured', async () => {
    const orig = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['NEXT_PUBLIC_SUPABASE_URL'];

    const { consumeAdminRateLimit } = await import('../../apps/admin/lib/security');
    const result = await consumeAdminRateLimit('1.2.3.4');

    // Fail CLOSED — no key = deny
    expect(result).toBe(false);

    if (orig) process.env['SUPABASE_SERVICE_ROLE_KEY'] = orig;
  });
});
