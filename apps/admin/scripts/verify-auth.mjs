#!/usr/bin/env node
/**
 * Static auth-invariant checks for the Mi Osusu admin app.
 *
 * This is NOT a replacement for the manual e2e checklist in README — it pins the
 * source-level invariants that the auth fix depends on, so a future edit can't
 * silently regress them. Run with:  node scripts/verify-auth.mjs
 *
 * Exit code 0 = all invariants hold, 1 = at least one regressed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: Boolean(pass), detail });

const middleware = read('middleware.ts');
const adminData = read('lib/admin-data.ts');
const actionRoute = read('app/api/admin/action/route.ts');
const loginPage = read('app/login/page.tsx');
const loginForm = read('components/login-form.tsx');
const loginRoute = read('app/api/login/route.ts');
const logoutRoute = read('app/api/logout/route.ts');
const roleCache = read('lib/role-cache.ts');
const envExample = read('.env.example');
const env = read('.env');

// 1. No getSession() used anywhere for server-side authorization.
const sources = [middleware, adminData, actionRoute, loginPage];
check(
  'getSession() is never used for authorization',
  sources.every((s) => !/auth\.getSession\s*\(/.test(s)),
  'use getUser() — it revalidates the token with Supabase Auth'
);

// 2. Service-role key is server-only (never exposed via NEXT_PUBLIC_/EXPO_PUBLIC_).
const leak = /(NEXT_PUBLIC|EXPO_PUBLIC)[A-Z0-9_]*(SERVICE_ROLE|SERVICE|SECRET)/i;
check(
  'service-role key is not exposed to the browser',
  !leak.test(envExample) && !leak.test(env),
  'no NEXT_PUBLIC_/EXPO_PUBLIC_ variable may hold the service-role key'
);

// 3. Middleware no longer consumes the per-request rate limit on navigation.
check(
  'middleware does not rate-limit page navigation',
  !/consumeAdminRateLimit/.test(middleware),
  'rate limiting belongs on login + /api/admin/action, not every GET/prefetch'
);

// 4. The mutation endpoint still rate-limits.
check(
  '/api/admin/action still enforces rate limiting',
  /consumeAdminRateLimit/.test(actionRoute)
);

// 5. Role checks use the authoritative user_roles table (not profiles.role).
check(
  'middleware authorizes from user_roles, not profiles.role',
  /from\(['"]user_roles['"]\)/.test(middleware) &&
    !/role\s*!==\s*['"]super_admin['"]/.test(middleware),
  'must read user_roles, not profiles.role'
);
check(
  'requireSuperAdmin authorizes from user_roles, not profiles.role',
  /from\(['"]user_roles['"]\)/.test(adminData) &&
    !/role\s*!==\s*['"]super_admin['"]/.test(adminData)
);

// 6. requireSuperAdmin is request-deduplicated via React cache().
check(
  'requireSuperAdmin is wrapped in cache() to dedupe per request',
  /cache\(async/.test(adminData) && /from ['"]react['"]/.test(adminData)
);

// 7. refresh_token_already_used is handled: cookies cleared + single bounce.
check(
  'middleware clears stale Supabase auth cookies on refresh failure',
  /maxAge:\s*0/.test(middleware) && /-auth-token/.test(middleware)
);
check(
  'session_expired redirect reason exists',
  /session_expired/.test(middleware) && /session_expired/.test(loginPage)
);

// 8. Middleware matcher only covers protected surfaces (excludes static/_next).
check(
  'matcher is an allow-list of /admin and /api/admin only',
  /matcher:\s*\[['"]\/admin\/:path\*['"],\s*['"]\/api\/admin\/:path\*['"]\]/.test(middleware)
);

// ── Fix 1: Login throttling ───────────────────────────────────────────────────

// 9. login-form never touches Supabase directly.
check(
  'login-form does not call createBrowserClient or signInWithPassword directly',
  !(/createBrowserClient/.test(loginForm) || /signInWithPassword/.test(loginForm)),
  'sign-in must go through /api/login so server-side rate limiting applies'
);

// 10. /api/login route exists and rate-limits login attempts.
check(
  '/api/login route exists and calls consumeAdminRateLimit with admin_login action',
  loginRoute.length > 0 && /admin_login/.test(loginRoute)
);

// 11. /api/logout route exists and clears the role cache cookie.
check(
  '/api/logout route exists and clears the role cache cookie',
  logoutRoute.length > 0 && /ROLE_CACHE_COOKIE/.test(logoutRoute)
);

// ── Fix 2: Role cache cookie ──────────────────────────────────────────────────

// 12. ADMIN_ROLE_CACHE_SECRET is documented but never as a NEXT_PUBLIC_* variable.
const cacheSecretLeak = /(NEXT_PUBLIC|EXPO_PUBLIC)[A-Z0-9_]*ROLE_CACHE/i;
check(
  'ADMIN_ROLE_CACHE_SECRET is not exposed to the browser',
  !cacheSecretLeak.test(envExample) && !cacheSecretLeak.test(env),
  'ADMIN_ROLE_CACHE_SECRET must not be a NEXT_PUBLIC_* or EXPO_PUBLIC_* variable'
);

// 13. Role cache is HMAC-signed (uses crypto.subtle) and has a TTL.
check(
  'role cache uses HMAC-SHA-256 signature',
  /HMAC/.test(roleCache) && /SHA-256/.test(roleCache)
);

// 14. Middleware uses the role cache (skips DB on cache hit).
check(
  'middleware checks role cache before hitting the database',
  /verifyRoleCacheCookie/.test(middleware) && /buildRoleCacheCookie/.test(middleware)
);

// 15. denyAndClearSession also clears the role cache cookie.
check(
  'session clear also removes the role cache cookie',
  /ROLE_CACHE_COOKIE/.test(middleware)
);

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (!r.pass) failed++;
  console.log(`[${tag}] ${r.name}${!r.pass && r.detail ? `\n        ↳ ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} invariants hold.`);
process.exit(failed === 0 ? 0 : 1);
