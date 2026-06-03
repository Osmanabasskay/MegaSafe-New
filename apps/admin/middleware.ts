import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getClientIp, isIpAllowed } from '@/lib/security';
import {
  buildRoleCacheCookie,
  ROLE_CACHE_COOKIE,
  ROLE_CACHE_TTL_SECONDS,
  verifyRoleCacheCookie,
} from '@/lib/role-cache';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Supabase SSR stores the session in cookies named `sb-<project-ref>-auth-token`
// (optionally chunked: `…-auth-token.0`, `…-auth-token.1`). We only ever touch
// the cookie NAMES — never the access/refresh token values — so nothing secret
// is read or logged here.
const isSupabaseAuthCookie = (name: string): boolean =>
  name.startsWith('sb-') && name.includes('-auth-token');

// Dev-only, secret-free diagnostics. Never logs tokens or the session object.
const debug = (event: string, fields: Record<string, unknown>): void => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[admin-mw]', event, fields);
  }
};

const wantsJson = (request: NextRequest): boolean =>
  request.nextUrl.pathname.startsWith('/api/admin');

const deny = (request: NextRequest, status: number, reason: string): NextResponse => {
  if (wantsJson(request)) return NextResponse.json({ error: reason }, { status });
  const url = new URL('/login', request.url);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
};

// Used when the stored session is corrupt or its single-use refresh token was
// already rotated by a parallel request. We clear the Supabase auth cookies so
// the dead refresh token can never be replayed, then bounce exactly once. This
// is what breaks the `refresh_token_already_used` → redirect-loop cycle.
const denyAndClearSession = (request: NextRequest, reason: string): NextResponse => {
  let res: NextResponse;
  if (wantsJson(request)) {
    res = NextResponse.json({ error: reason }, { status: 401 });
  } else {
    const url = new URL('/login', request.url);
    url.searchParams.set('reason', reason);
    res = NextResponse.redirect(url);
  }
  for (const cookie of request.cookies.getAll()) {
    if (isSupabaseAuthCookie(cookie.name) || cookie.name === ROLE_CACHE_COOKIE) {
      res.cookies.set(cookie.name, '', { maxAge: 0, path: '/' });
    }
  }
  return res;
};

export async function middleware(request: NextRequest) {
  const route = request.nextUrl.pathname;
  const ip = getClientIp(request.headers);
  if (!isIpAllowed(ip)) return deny(request, 403, 'ip_not_allowed');

  // ── The ONE place that refreshes the session ──────────────────────────────
  // Refreshed cookies are written to BOTH the forwarded request (so server
  // components / route handlers downstream see the rotated token and do NOT
  // refresh again) and the response (so the browser stores it). Keeping this as
  // the single refresh authority is what prevents duplicate, racing refreshes.
  //
  // NOTE: per-request rate limiting was deliberately REMOVED from here. It was
  // consuming the `admin_action` budget (30/60s/IP) on every page GET and every
  // Next.js link prefetch, which produced false `rate_limited` logouts during
  // normal navigation. Login attempts are rate-limited by Supabase Auth itself;
  // privileged mutations stay rate-limited inside /api/admin/action.
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as never)
        );
      },
    },
  });

  const hadAuthCookie = request.cookies
    .getAll()
    .some((cookie) => isSupabaseAuthCookie(cookie.name));

  // getUser() revalidates the access token against the Supabase Auth server (and
  // transparently refreshes it if expired). NEVER use getSession() here — it only
  // reads unverified local cookie state and must not be trusted for authorization.
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    userId = data.user?.id ?? null;
  } catch (err) {
    const code = (err as { code?: string; status?: number })?.code;
    // A parallel request already rotated the single-use refresh token, or the
    // session is otherwise corrupt. Clear cookies + bounce once.
    if (hadAuthCookie) {
      debug('session_refresh_failed', { route, code });
      return denyAndClearSession(request, 'session_expired');
    }
    debug('no_session', { route });
    return deny(request, 401, 'not_authenticated');
  }

  if (!userId) {
    // No verified user. If cookies were present the session is stale → clear it.
    if (hadAuthCookie) return denyAndClearSession(request, 'session_expired');
    return deny(request, 401, 'not_authenticated');
  }

  // ── Role cache (short-circuits the two DB queries on warm navigations) ───────
  // The cache cookie is HMAC-SHA-256 signed with ADMIN_ROLE_CACHE_SECRET and
  // expires in 30 s. If the signature is valid and the userId matches the one
  // Supabase Auth just verified, we skip the DB round trip. A revoked admin is
  // denied within at most one 30-second window.
  // If ADMIN_ROLE_CACHE_SECRET is not configured the cache is silently bypassed —
  // the DB queries below run as normal (fail-safe degradation, not fail-open).
  const cachedCookieValue = request.cookies.get(ROLE_CACHE_COOKIE)?.value ?? '';
  if (cachedCookieValue && await verifyRoleCacheCookie(cachedCookieValue, userId)) {
    debug('role_cache_hit', { route, userId });
    return response;
  }

  // ── Authoritative role check (server-side, from the DATABASE) ──────────────
  // user_roles is the single source of truth for privileged roles across the
  // whole backend (see supabase/prompt8/prompt9). We do NOT trust profiles.role,
  // JWT user_metadata/app_metadata, query params, or any client-supplied value.
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !svcKey) return deny(request, 500, 'server_misconfigured');
  const svc = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

  const [{ data: roleRow }, { data: profile }] = await Promise.all([
    svc
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle(),
    svc.from('profiles').select('status, is_active').eq('id', userId).maybeSingle(),
  ]);

  if (!roleRow) return deny(request, 403, 'insufficient_role');
  if (
    profile?.is_active === false ||
    profile?.status === 'suspended' ||
    profile?.status === 'banned'
  )
    return deny(request, 403, 'account_suspended');

  // Set the role cache cookie on the outgoing response.
  // httpOnly + secure + sameSite=strict prevents it being read or forged by JS.
  const newCacheValue = await buildRoleCacheCookie(userId);
  if (newCacheValue) {
    response.cookies.set(ROLE_CACHE_COOKIE, newCacheValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: ROLE_CACHE_TTL_SECONDS,
      path: '/',
    });
  }

  debug('authorized', { route, userId });
  return response;
}

// Runs ONLY on protected surfaces. Because the matcher is an explicit allow-list
// of `/admin/*` and `/api/admin/*`, static assets (`_next/static`, `_next/image`,
// `favicon.ico`), images, fonts, public files and the `/login` route are excluded
// by construction — no session refresh is ever triggered for them.
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
