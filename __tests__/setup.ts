import { vi } from 'vitest';

// Suppress __DEV__ reference from supabase.ts
(global as Record<string, unknown>).__DEV__ = false;

// Mock the supabase module globally so services don't connect to a real DB
vi.mock('../src/services/supabase', () => {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const mockAuth = {
    getSession: vi.fn(),
    getUser: vi.fn(),
    signOut: vi.fn(),
  };

  const chainable = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: undefined,
  };

  mockFrom.mockReturnValue(chainable);

  return {
    supabase: { rpc: mockRpc, from: mockFrom, auth: mockAuth },
    supabaseConfigured: true,
    __mockRpc: mockRpc,
    __mockFrom: mockFrom,
    __mockAuth: mockAuth,
    __chainable: chainable,
  };
});
