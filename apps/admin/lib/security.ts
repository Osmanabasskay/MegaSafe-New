import { createClient } from '@supabase/supabase-js';

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

// DB-backed rate limiter: survives server restarts, shared across all instances.
// Fails CLOSED on any DB error — an attacker triggering an RPC error must not
// bypass rate limiting. If the DB is genuinely down, admin actions are denied.
//
// action values (see supabase/prompt10_login_rate_limit.sql for limits):
//   'admin_action' (default) — 30 / 60s  — privileged mutations
//   'admin_login'            — 10 / 900s — login attempts
export const consumeAdminRateLimit = async (
  ip: string,
  action: 'admin_action' | 'admin_login' = 'admin_action'
): Promise<boolean> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[security] consume_admin_rate_limit: service-role key not configured — denying request');
    return false;
  }

  try {
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await client.rpc('consume_admin_rate_limit', {
      p_ip: ip,
      p_action: action,
    });
    if (error) {
      console.error('[security] consume_admin_rate_limit RPC error — denying request:', error.message);
      return false;
    }
    return Boolean(data);
  } catch (err) {
    console.error('[security] consume_admin_rate_limit exception — denying request:', err);
    return false;
  }
};

export const isSuperAdminRole = (role: unknown): boolean => role === 'super_admin';

export const assertNoSelfAction = (actorUserId: string, targetUserId: string): void => {
  if (actorUserId === targetUserId) {
    throw new Error('Self-action is blocked for admin safety.');
  }
};
