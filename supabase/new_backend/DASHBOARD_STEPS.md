# Manual Supabase Dashboard Steps
# Project: upuhjekwmtjnjksqikdu

Complete these steps in the Supabase Dashboard after migrations are applied.

---

## 1. Get Your API Keys (Required first)

1. Go to: https://supabase.com/dashboard/project/upuhjekwmtjnjksqikdu/settings/api
2. Copy **Project URL** → use as `EXPO_PUBLIC_SUPABASE_URL`
3. Copy **anon / public key** → use as `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. Copy **service_role / secret key** → use as `SUPABASE_SECRET_KEY` (server-side only, NEVER in frontend)

---

## 2. Create Your First Super Admin User

1. Go to: Dashboard > Authentication > Users > Add User
2. Create the user with email + password
3. Note the user UUID from the list
4. In SQL Editor, run:
```sql
-- Replace <uuid> with the actual user UUID from step 2
UPDATE public.user_roles SET role = 'super_admin' WHERE user_id = '<uuid>';

-- Verify
SELECT role FROM public.user_roles WHERE user_id = '<uuid>';
```

---

## 3. Enable Required Extensions

Go to: Dashboard > Database > Extensions

Enable:
- [x] **pgcrypto** (for `gen_random_bytes` — should be on by default)
- [ ] **pg_cron** (for auto-save scheduled jobs)
- [ ] **pg_net** (for outgoing HTTP calls from Edge Functions if needed)
- [ ] **unaccent** (optional — for search/name normalization)

```sql
-- Verify pgcrypto is working:
SELECT encode(gen_random_bytes(4), 'hex');
-- Should return 8-character hex string
```

---

## 4. Set Edge Function Secrets

Go to: Dashboard > Edge Functions > Secrets (or Settings > Secrets)

Add these secrets (do NOT put them in `.env`):
```
SUPABASE_SERVICE_ROLE_KEY   = <service_role key from step 1>
ORANGE_MONEY_API_KEY        = <from Orange Money developer portal>
ORANGE_MONEY_MERCHANT_KEY   = <from Orange Money>
ORANGE_MONEY_WEBHOOK_SECRET = <generate with: openssl rand -hex 32>
AFRIMONEY_API_KEY            = <from Afrimoney>
AFRIMONEY_WEBHOOK_SECRET     = <generate with: openssl rand -hex 32>
QMONEY_API_KEY               = <from QMoney>
QMONEY_WEBHOOK_SECRET        = <generate with: openssl rand -hex 32>
WEBHOOK_BASE_URL             = https://upuhjekwmtjnjksqikdu.supabase.co/functions/v1
```

---

## 5. Configure Storage for Payment Proofs

Go to: Dashboard > Storage > New Bucket

1. Create bucket: `payment-proofs`
2. Set to **private** (not public)
3. Add storage policies:

```sql
-- Allow authenticated users to upload their own proofs
CREATE POLICY "upload own proofs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);

-- Allow uploaders and group managers to read proofs
CREATE POLICY "read own proofs"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
```

---

## 6. Configure Authentication

Go to: Dashboard > Authentication > Providers

Enable:
- [x] **Email** — enable "Confirm email" for production
- [ ] **Phone** (SMS) — configure with Twilio for Sierra Leone (+232) numbers

Go to: Dashboard > Authentication > URL Configuration
- Set **Site URL** to your app's URL
- Add redirect URLs for Expo deep links: `exp://`, `miosusu://`

Go to: Dashboard > Authentication > Email Templates
- Customize confirmation and password reset emails with Mi Osusu branding

---

## 7. Set Up pg_cron Auto-Save Job

After enabling pg_cron extension:

```sql
-- Verify pg_cron is available
SELECT cron.version();

-- Schedule auto-save sweep daily at 02:00 UTC
SELECT cron.schedule(
  'miosusu_auto_save_daily',
  '0 2 * * *',
  $$SELECT public.run_auto_save_sweep();$$
);

-- List scheduled jobs
SELECT * FROM cron.job;
```

Note: `run_auto_save_sweep()` function is in the existing Mi Osusu project migrations.
Create a similar function for this new project as needed.

---

## 8. Set JWT Expiry (Security Hardening)

Go to: Dashboard > Authentication > Settings > JWT Settings

- Set **JWT expiry** to `3600` (1 hour) for production
- Enable **Refresh token rotation**
- Set **Refresh token reuse interval** to `10` seconds

---

## 9. Configure IP Allowlist (Admin Panel)

In your admin panel `.env` (server-side only):
```env
ADMIN_IP_ALLOWLIST=<your-office-ip>,<your-vpn-ip>
```

Leave blank during development. Lock down before production launch.

---

## 10. Enable Realtime (Optional — Notifications)

Go to: Dashboard > Database > Replication

Enable replication for:
- `notifications` table — so the app receives real-time notification badges

In your app:
```typescript
const channel = supabase
  .channel('notifications')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'notifications',
    filter: `user_id=eq.${user.id}`,
  }, (payload) => {
    // Show in-app notification
  })
  .subscribe();
```

---

## 11. Advisors — Run Security Check

In SQL Editor:
```sql
-- Check for security advisories
SELECT * FROM public.get_advisors();
```
Or use: Dashboard > Database > Advisors

Fix any HIGH severity items before going to production.
