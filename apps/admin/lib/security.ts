const ADMIN_RATE_WINDOW_MS = 60_000;
const ADMIN_RATE_LIMIT = 500;
const rateWindow = new Map<string, { count: number; windowStartMs: number }>();

export const getClientIp = (headers: Headers): string => {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return headers.get('x-real-ip') || 'unknown';
};

export const isIpAllowed = (ip: string): boolean => {
  const allowlistRaw = process.env.ADMIN_IP_ALLOWLIST?.trim() || '';
  if (!allowlistRaw) return true;
  const allowlist = allowlistRaw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist.includes(ip);
};

export const consumeAdminRateLimit = (ip: string): boolean => {
  const now = Date.now();
  const existing = rateWindow.get(ip);
  if (!existing || now - existing.windowStartMs >= ADMIN_RATE_WINDOW_MS) {
    rateWindow.set(ip, { count: 1, windowStartMs: now });
    return true;
  }
  if (existing.count >= ADMIN_RATE_LIMIT) return false;
  existing.count += 1;
  return true;
};

export const isSuperAdminRole = (role: unknown): boolean => role === 'super_admin';

export const assertNoSelfAction = (actorUserId: string, targetUserId: string): void => {
  if (actorUserId === targetUserId) {
    throw new Error('Self-action is blocked for admin safety.');
  }
};
