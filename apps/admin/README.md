# MegaSafe Super Admin Dashboard

This folder contains the Phase 9 Next.js 15 admin dashboard scaffold.

## Features included
- SSR auth checks via Supabase on admin pages.
- Middleware role gate for `super_admin`.
- IP allowlist and API rate limiting (500 requests/min per IP).
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
