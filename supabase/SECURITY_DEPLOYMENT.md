# Mi Osusu Security Hardening — Deployment Checklist

## Step 1 — Rotate Supabase credentials (IMMEDIATE)

The anon key was previously committed to git.

1. Go to **Supabase Dashboard → Settings → API**
2. Click **"Regenerate anon key"**
3. Update `.env` with the new key
4. Restart the dev server: `npx expo start -c`

## Step 2 — Apply the SQL migration

Paste the contents of `supabase/security_hardening.sql` into the **Supabase SQL Editor** and run it.

This migration:
- Adds positive-amount CHECK constraints (contributions, payments, savings)
- Replaces the broken `group_memberships` INSERT policy (prevents self-approved joins)
- Prevents direct client writes to `savings_goals.current_amount`
- Removes the fabricable `audit_logs` INSERT policy
- Replaces `random()` with `gen_random_bytes()` for member secret codes
- Adds `record_savings_transaction()` RPC for atomic balance updates
- Adds `insert_audit_log()` RPC for tamper-proof audit entries
- Adds `resolve_invite_code()` RPC for safe invite code lookups
- Adds `idempotency_key` column to payments

## Step 3 — Verify RLS is ON for all tables

Run this in SQL Editor to confirm:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All rows should show `rowsecurity = true`.

## Step 4 — Enable Auth Rate Limiting

In **Supabase Dashboard → Authentication → Rate Limits**:
- OTP send: max 5 per hour per email/phone
- Sign-in: max 10 per hour per IP

## Step 5 — Remove .env from git history (optional but recommended)

```bash
git filter-repo --path .env --invert-paths
git push --force-with-lease origin mi-osusu2.1
```

> **Warning:** This rewrites git history. Coordinate with all team members first.
