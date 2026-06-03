# Mi Osusu Super Admin Dashboard

This folder contains the Phase 9 Next.js 15 admin dashboard scaffold.

## Features included
- SSR auth checks via Supabase (`@supabase/ssr`) on admin pages.
- Middleware role gate for `super_admin`, verified from the `user_roles` table.
- IP allowlist; rate limiting scoped to privileged mutations (`/api/admin/action`).
- Admin pages:
  - `/admin`
  - `/admin/users`
  - `/admin/users/[id]`
  - `/admin/kyc`
  - `/admin/groups`
  - `/admin/collectors`
  - `/admin/reports`
  - `/admin/audit`
- Admin action API (`/api/admin/action`) with self-action prevention and audit logging.
- Report export API (`/api/admin/reports/export`) with CSV and basic PDF output.

## Setup
1. Copy `.env.example` to `.env.local`.
2. Set Supabase URL/anon key and optional `ADMIN_IP_ALLOWLIST`.
3. Install dependencies in `apps/admin`.
4. Run `npm run dev`.

## Authentication flow
The session is refreshed in exactly **one** place — `middleware.ts` — using
`supabase.auth.getUser()` (which revalidates the token with Supabase Auth and
rotates the single-use refresh token). The refreshed cookies are forwarded to
both the request and the response, so server components downstream never refresh
again. Server-side authorization (middleware, `requireSuperAdmin`, the action
route) always reads the role from the authoritative `user_roles` table — never
from `profiles.role`, JWT metadata, query params, or client state.
`requireSuperAdmin()` is wrapped in React `cache()`, so a page's layout and all
of its data functions share one verified result per render.

If a single-use refresh token is replayed (`refresh_token_already_used`),
middleware clears the stale Supabase auth cookies and redirects **once** to
`/login?reason=session_expired`.

## Verification
- `npm run verify:auth` — static checks that pin the auth invariants (no
  `getSession` for authz, no service-role key in `NEXT_PUBLIC_*`, role read from
  `user_roles`, stale-cookie clearing, matcher scope, etc.).
- Manual e2e checklist:
  1. Valid super admin signs in → lands on `/admin`; navigating between pages
     never bounces to `/login?reason=rate_limited`.
  2. Open `/login` while already signed in as a super admin → auto-redirects to
     `/admin`.
  3. Authenticated non-super-admin hits `/admin` → redirected to
     `/login?reason=insufficient_role`.
  4. Delete/corrupt the `sb-*-auth-token` cookie, then load `/admin` → one
     redirect to `/login?reason=session_expired`, cookies cleared, no loop.
  5. Open several admin tabs after the access token expires → at most one
     `session_expired` bounce; no repeating `refresh_token_already_used` errors.
