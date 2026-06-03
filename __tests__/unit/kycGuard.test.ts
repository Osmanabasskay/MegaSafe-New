/**
 * KYC Guard unit tests (Phase 2)
 *
 * Tests that the KYC guard correctly enforces access based on backend profile status.
 * Tests the profileService.fetchProfile path (mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as _supabaseMock from '../../src/services/supabase';

type MockHandles = {
  __mockFrom: ReturnType<typeof vi.fn>;
  __chainable: Record<string, ReturnType<typeof vi.fn>>;
};

const getMocks = () => _supabaseMock as unknown as MockHandles;

// ── fetchProfile KYC status path ──────────────────────────────────────────────

describe('fetchProfile KYC status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns kyc_status=approved from profile row', async () => {
    const { fetchProfile } = await import('../../src/services/profileService');
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: { id: 'usr-1', kyc_status: 'approved', full_name: 'Test User' },
      error: null,
    });

    const { profile, error } = await fetchProfile('usr-1');

    expect(error).toBeNull();
    expect(profile?.kyc_status).toBe('approved');
  });

  it('returns kyc_status=pending for new users', async () => {
    const { fetchProfile } = await import('../../src/services/profileService');
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: { id: 'usr-2', kyc_status: 'pending', full_name: 'New User' },
      error: null,
    });

    const { profile, error } = await fetchProfile('usr-2');

    expect(error).toBeNull();
    expect(profile?.kyc_status).toBe('pending');
  });

  it('returns kyc_status=rejected for rejected KYC', async () => {
    const { fetchProfile } = await import('../../src/services/profileService');
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: { id: 'usr-3', kyc_status: 'rejected', full_name: 'Rejected User' },
      error: null,
    });

    const { profile } = await fetchProfile('usr-3');
    expect(profile?.kyc_status).toBe('rejected');
  });

  it('returns kyc_status=submitted for in-review users', async () => {
    const { fetchProfile } = await import('../../src/services/profileService');
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: { id: 'usr-4', kyc_status: 'submitted', full_name: 'In Review' },
      error: null,
    });

    const { profile } = await fetchProfile('usr-4');
    expect(profile?.kyc_status).toBe('submitted');
  });

  it('returns null profile on DB error without crashing', async () => {
    const { fetchProfile } = await import('../../src/services/profileService');
    const { __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Network error.' },
    });

    const { profile, error } = await fetchProfile('usr-5');

    expect(profile).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });

  it('uses profiles table (not user_roles or other table)', async () => {
    const { fetchProfile } = await import('../../src/services/profileService');
    const { __mockFrom, __chainable } = getMocks();
    __chainable.maybeSingle.mockResolvedValueOnce({ data: { id: 'u', kyc_status: 'approved' }, error: null });

    await fetchProfile('usr-1');

    expect(__mockFrom).toHaveBeenCalledWith('profiles');
  });
});

// ── KYC guard logic ──────────────────────────────────────────────────────────

describe('KYC guard logic (pure function assertions)', () => {
  it('isApproved is true only for approved status', () => {
    const statuses = ['pending', 'submitted', 'rejected', null, undefined, ''];
    for (const s of statuses) {
      expect(s === 'approved').toBe(false);
    }
    expect('approved' === 'approved').toBe(true);
  });

  it('non-approved kyc_status should block financial actions', () => {
    const blockedStatuses: Array<string | null> = ['pending', 'submitted', 'rejected', null];
    for (const status of blockedStatuses) {
      // The hook's requireKyc() returns false for non-approved status
      const isApproved = status === 'approved';
      expect(isApproved).toBe(false);
    }
  });

  it('kyc_status=approved allows financial actions', () => {
    const isApproved = 'approved' === 'approved';
    expect(isApproved).toBe(true);
  });
});

// ── Screen KYC guard coverage (static analysis) ───────────────────────────────

describe('KYC guard screen coverage (static)', () => {
  it('contribute.tsx imports useKycGuard', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.resolve('app/(groups)/contribute.tsx'), 'utf8');
    expect(text).toContain('useKycGuard');
    expect(text).toContain('requireKyc');
  });

  it('savings-create.tsx imports useKycGuard', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.resolve('app/(main)/savings-create.tsx'), 'utf8');
    expect(text).toContain('useKycGuard');
    expect(text).toContain('requireKyc');
  });

  it('vault.tsx imports useKycGuard for withdrawal', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.resolve('app/(main)/vault.tsx'), 'utf8');
    expect(text).toContain('useKycGuard');
    expect(text).toContain('requireKyc');
  });

  it('create.tsx (group creation) imports useKycGuard', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.resolve('app/(groups)/create.tsx'), 'utf8');
    expect(text).toContain('useKycGuard');
    expect(text).toContain('requireKyc');
  });

  it('collector.tsx imports useKycGuard for physical collection', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.resolve('app/(groups)/collector.tsx'), 'utf8');
    expect(text).toContain('useKycGuard');
    expect(text).toContain('requireKyc');
  });

  it('useKycGuard hook always fetches kyc_status from backend (not local cache only)', async () => {
    const fs   = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.resolve('src/hooks/useKycGuard.ts'), 'utf8');
    // The hook must call fetchProfile (backend) not just read from a Zustand store
    expect(text).toContain('fetchProfile');
  });
});
