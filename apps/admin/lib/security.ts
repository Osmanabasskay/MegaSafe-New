import { createClient } from '@supabase/supabase-js';

export const getClientIp = (headers: Headers): string => {
  // Cloudflare sets CF-Connecting-IP to the real client IP — it cannot be
  // spoofed by the client because Cloudflare strips client-supplied CF-* headers.
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // Vercel / trusted reverse proxy: read the LAST value from X-Forwarded-For.
  // The last entry is appended by the outermost proxy and cannot be forged by
  // the client. Reading the first value is the classic IP-spoofing vector.
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[parts.length - 1]?.trim() || 'unknown';
  }

  return headers.get('x-real-ip') || 'unknown';
};

export const isIpAllowed = (ip: string): boolean => {
  const allowlistRaw = process.env.ADMIN_IP_ALLOWLIST?.trim() || '';
  if (!allowlistRaw) {
    if (process.env.NODE_ENV === 'production') {
      // Fail CLOSED in production: an unconfigured allowlist is a misconfiguration.
      // Do NOT fall through to true — that would allow any IP to reach admin endpoints.
      console.error('[security] ADMIN_IP_ALLOWLIST is not set in production — denying all requests. Configure this env var immediately.');
      return false;
    }
    // Development: allow all (warn so it's visible in dev logs)
    console.warn('[security] ADMIN_IP_ALLOWLIST is not set — all IPs are allowed. Set this before deploying to production.');
    return true;
  }
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
