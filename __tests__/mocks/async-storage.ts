import { vi } from 'vitest';

const store: Record<string, string> = {};
export default {
  getItem: vi.fn(async (key: string) => store[key] ?? null),
  setItem: vi.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn(async (key: string) => { delete store[key]; }),
};
