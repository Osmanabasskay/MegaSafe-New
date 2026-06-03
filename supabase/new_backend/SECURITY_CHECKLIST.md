# Mi Osusu Osusu — Security Checklist
# Project: upuhjekwmtjnjksqikdu

## ✅ Database Layer

- [x] RLS enabled on all 24 tables
- [x] No table has a permissive "allow all" policy
- [x] `user_roles` — only `super_admin` can write; no user can change their own role
- [x] `audit_logs` — no INSERT/UPDATE/DELETE policy for any authenticated user; only `create_audit_log()` SECURITY DEFINER function writes here
- [x] `vault_transactions` — no frontend INSERT policy; only `_credit_vault()` backend function writes
- [x] `savings_transactions` — no frontend INSERT policy; only backend functions write
- [x] `escrow_transactions` — no INSERT policy; only service-role / SECURITY DEFINER writes
- [x] `commissions` — no INSERT policy; only `_record_commission()` writes
- [x] `mobile_money_transactions` — no INSERT policy; only Edge Functions write
- [x] `contribution_payments` — members can INSERT with status='pending' only; UPDATE blocked for all frontend users
- [x] `payment_periods` — only group managers can create; frontend cannot lock periods
- [x] Balances are NEVER stored — always computed server-side from transaction ledger
- [x] Receipt numbers generated server-side with `gen_random_bytes()` — not from device
- [x] Duplicate payment per period blocked by UNIQUE (group_id, period_id, member_id) constraint
- [x] Duplicate receipt numbers blocked by UNIQUE constraint
- [x] Duplicate mobile money provider references blocked by UNIQUE constraint
- [x] Negative amounts blocked by CHECK (amount > 0) on all financial tables
- [x] Payment approver cannot be the same person as the payer (CHECK constraint + RPC guard)
- [x] `webhook_payload` column in mobile_money_transactions never exposed via views or policies
- [x] `passcode_hash` and `secret_pin` never exposed via views
- [x] All views use `security_invoker = true` — RLS is enforced on underlying tables

## ✅ RLS Helper Functions

- [x] `current_user_role()` — reads from `user_roles`, not JWT metadata
- [x] `is_super_admin()` — DB lookup, not JWT claim
- [x] `is_org_admin(org_id)` — scoped to specific org
- [x] `is_collector_for_group(group_id)` — validates active assignment + active collector
- [x] `is_collector_for_member(member_id)` — validates assignment chain
- [x] `can_view_group(group_id)` — union of member / collector / creator / super_admin
- [x] `can_manage_group(group_id)` — restricted to creator / org_admin / super_admin
- [x] All helpers use `(SELECT auth.uid())` pattern for per-query caching

## ✅ RPC Functions

- [x] `create_osusu_group` — validates amount > 0, min members, creates escrow atomically
- [x] `add_member_to_group` — checks group capacity; logs audit event
- [x] `assign_collector` — requires KYC-verified collector; logs audit
- [x] `record_physical_collection` — validates period, amount, duplicate, idempotency; generates receipt server-side
- [x] `approve_payment` — blocks self-approval; transitions status; credits vault via `_credit_vault`
- [x] `reject_payment` — blocks self-rejection; requires reason
- [x] `calculate_vault_balance` — computed from ledger, not stored field
- [x] `calculate_savings_balance` — computed from ledger
- [x] `calculate_group_progress` — server-computed totals
- [x] `calculate_collector_summary` — server-computed; only own data unless super_admin
- [x] `request_withdrawal` — KYC check enforced; balance check; idempotency
- [x] `approve_withdrawal` / `reject_withdrawal` — super_admin only
- [x] `generate_contribution_schedule` — server-generated periods; no client date injection
- [x] `create_audit_log` — SECURITY DEFINER; the only write path to audit_logs
- [x] `get_next_payable_period` — server determines next payable period; client cannot fake it

## ⚠️ Manual Steps Required (see DASHBOARD_STEPS.md)

- [ ] Rotate Supabase anon key if previously exposed in git history
- [ ] Set Edge Function secrets in Supabase Dashboard
- [ ] Create first super_admin user via Dashboard and run role UPDATE
- [ ] Enable `pg_cron` extension for auto-save sweep
- [ ] Configure Storage bucket for `payment_proofs` with appropriate policies
- [ ] Set up webhook endpoint secret for mobile money providers
- [ ] Enable email/SMS auth providers in Supabase Auth settings
- [ ] Set JWT expiry to ≤ 1 hour for sensitive admin sessions
- [ ] Lock down `ADMIN_IP_ALLOWLIST` in production

## ❌ Not Yet Implemented (Next Sprint)

- [ ] `initiate_mobile_money_payment` Edge Function (requires provider credentials)
- [ ] `confirm_mobile_money_payment` webhook Edge Function
- [ ] `approve_payment_proof` (proof image review workflow)
- [ ] `pg_cron` auto-save job (daily server-side sweep)
- [ ] SMS/push notification delivery (Edge Function)
- [ ] Rate limiting per user/IP on all RPCs
- [ ] Failed login attempt logging to audit_logs
- [ ] Escrow release automation on payout approval
