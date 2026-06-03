# Mi Osusu — Super Admin Risk Dashboard Audit (Phase 1)

> Generated from live Supabase production introspection (project schema `public`).
> Date: 2026-06-02. Owner: Super Admin (Osman Abass Kamara).
> This document is the data-collection audit that drives the risk-monitoring
> command-center build (Phases 2–18).

---

## 1. Executive summary

The platform already has a solid transactional backbone (SECURITY DEFINER RPCs,
RLS on every table, an `audit_logs` table, a `rate_limit_log` table, KYC tables).
The Super Admin dashboard (`apps/admin`, Next.js 15) reads this data with a
service-role client behind a DB-verified `super_admin` gate.

However, for a true **fraud / attack / compliance monitoring center** the system
is missing the dedicated risk-intelligence layer:

- **No risk scoring** — nothing classifies users/transactions/actions as
  Low→Extreme. No `risk_events` table.
- **No fraud case management** — disputes exist, but there is no investigator
  workflow for fraud (`fraud_cases`).
- **No first-class security telemetry** — only `rate_limit_log` exists. There is
  no `security_events`, `login_attempts`, or `device_sessions` capture, so
  account-takeover / password-spraying / device-change signals are invisible.
- **Admin-action audit logging is BROKEN** (see §4.1) — admin mutations are not
  being recorded at all, which defeats insider-fraud protection.
- **Dashboard metrics are computed client-side** in `lib/admin-data.ts` by
  pulling rows and reducing in JS, instead of secure server RPCs.

The good news: the DB is essentially empty (production not yet live — 2 profiles,
0 financial rows), so additive migrations are low-risk and there is no data to
backfill.

---

## 2. Existing data sources (verified live)

### 2.1 Tables present (37)

| Domain | Tables |
|---|---|
| Identity | `profiles`, `user_roles`, `kyc_applications`, `kyc_documents`, `kyc_reviews`, `guarantors`, `countries`, `country_regions` |
| Osusu | `osusu_groups`, `osusu_group_members`, `payment_periods`, `contribution_payments`, `contribution_schedules`, `collectors`, `collector_assignments`, `commissions`, `commission_rules` |
| Finance | `vault_accounts`, `vault_topups`, `vault_transactions`, `vault_reservations`, `savings_goals`, `savings_transactions`, `escrow_accounts`, `escrow_transactions`, `withdrawal_requests`, `mobile_money_transactions`, `payment_proofs`, `provider_kyc_checks` |
| Webhooks | `webhook_events`, `payment_webhook_events` |
| Compliance | `disputes`, `audit_logs`, `rate_limit_log` |
| Platform | `organizations`, `organization_members`, `notifications`, `app_settings` |

### 2.2 Key columns relevant to risk

- `audit_logs(id, actor_id, action audit_action, table_name, record_id, old_data, new_data, ip_address inet, user_agent, metadata, created_at)` — **note: `actor_id` / `new_data`, NOT `user_id` / `new_values`**.
- `rate_limit_log(id, user_id, ip_address inet, action, created_at)` — single source of abuse telemetry today.
- `profiles(... role text, kyc_status text, status text, is_active bool, kyc_verified bool, date_of_birth, national_id_number, phone, email, country_id text ...)`.
- `withdrawal_requests(... status withdrawal_status, payout_status, reviewed_by, destination_number ...)`.
- `mobile_money_transactions(provider_reference UNIQUE, internal_reference UNIQUE, status mobile_money_status, direction, webhook_payload jsonb)`.
- `contribution_payments(group_id, period_id, member_id` **UNIQUE together**, `receipt_number UNIQUE, idempotency_key UNIQUE, approved_by, collected_at, status payment_status)`.
- `kyc_documents(checksum text, storage_path, mime_type, file_size)` — checksum enables duplicate-document detection.

### 2.3 RPC inventory (90 functions; all financial mutations are SECURITY DEFINER)

Auth/role: `is_super_admin()`, `get_my_role()`, `current_user_role()`.
Financial: `approve_withdrawal`, `reject_withdrawal`, `approve_payment`,
`reject_payment`, `process_withdrawal_request`, `finalize_*`, `fail_*`.
KYC: `approve_kyc_application`, `reject_kyc_application`, `submit_kyc_package`.
Osusu: `record_physical_collection`, `calculate_collector_summary`, `get_group_admin_report`.
Audit: `create_audit_log(p_action audit_action, ...)`.
Rate limit: `consume_admin_rate_limit(p_ip)`, `cleanup_rate_limit_log()`.

> There are **no** super-admin dashboard aggregation RPCs. All KPIs are computed
> in the Next.js layer.

### 2.4 Admin app surface (`apps/admin`)

Pages: `dashboard, users, users/[id], kyc, vault, savings, transactions,
payments, payouts, groups, osusu (contributions), collectors, disputes, audit,
security, reports`. Auth via `requireSuperAdmin()` (reads `user_roles`).
Writes via `POST /api/admin/action` (14 actions) + `/api/admin/reports/export`.

---

## 3. Missing data sources (to be created)

| Needed | Status | Plan |
|---|---|---|
| `risk_events` (risk scoring backbone) | **MISSING** | Migration A |
| `fraud_cases` (investigation workflow) | **MISSING** | Migration A |
| `admin_actions` (admin activity log, free-text action) | **MISSING** | Migration A |
| `security_events` (failed login, otp, device change, rls denial, api abuse) | **MISSING** | Migration A |
| `login_attempts` (success/fail, ip, device, reason) | **MISSING** | Migration A |
| `device_sessions` (device fingerprint, last seen, revoked) | **MISSING** | Migration A |
| `mobile_money_references` dedicated table | Not needed — `mobile_money_transactions.provider_reference` is already `UNIQUE` (duplicates are DB-blocked). Risk view derives from it. |
| `auth.users` direct access | Not exposed to dashboard; `profiles` mirror used. Last-login requires `auth.users.last_sign_in_at` via service role or `login_attempts`. |

---

## 4. Weak / broken dashboard queries

### 4.1 🔴 CRITICAL — admin-action audit logging is silently failing

`apps/admin/lib/audit.ts` inserts into `audit_logs` using:
- `user_id` → column **does not exist** (real column: `actor_id`)
- `new_values` → column **does not exist** (real column: `new_data`)
- `action` set to free-text like `'approve_withdrawal'`, `'suspend_user'`,
  `'request_kyc_resubmission'` → `audit_logs.action` is the **`audit_action`
  ENUM**, which does not contain those labels → **insert is rejected**.

The error is swallowed (`console.error` only), so **no admin action has ever been
recorded**. This breaks Phase 11/12 (insider-fraud protection) entirely.
→ Fixed by routing admin actions to a dedicated `admin_actions` table.

### 4.2 🔴 `suspend_collector` / `reinstate_collector` target wrong column

`route.ts` updates `collectors` filtered by `profile_id`, but the column is
`user_id`. These actions are no-ops. → Fixed.

### 4.3 🟠 Metrics computed in JS over capped row pulls

`getVaultSummary`, `getSavingsSummary`, `getDashboardKpis` fetch up to 300 rows
then reduce in JS. At scale this under-counts (LIMIT) and is slow.
→ Replaced/Supplemented by SECURITY DEFINER aggregation RPCs (Phase 16).

### 4.4 🟠 Hard-coded zeros / placeholder risk fields

`getCollectorMonitor` returns `disputeCount: 0`, `verificationRate: 0`;
`getGroupMonitor` uses `disputeRate: 0` and `suspicious = volume > 25_000`
(a magic number, not a real signal). → Replaced with real risk summaries.

### 4.5 🟠 `country_id` mismatch

`profiles.country_id` is `text` but joined/treated like a country code; country
breakdown shows raw ids. Cosmetic; noted.

---

## 5. Missing fraud signals (to implement as risk_events)

| Signal | Source available? | Detection |
|---|---|---|
| repeated_failed_login | needs `login_attempts` | count fails/ip/user in window |
| password_spraying_pattern | needs `login_attempts` | many users, 1 ip |
| otp_spam | needs `security_events` | otp requests/window |
| device_change | needs `device_sessions` | new fingerprint for user |
| suspicious_location | needs ip geo (optional) | ip country != profile country |
| duplicate_payment_reference | ✅ `mobile_money_transactions` | provider_reference reused (UNIQUE blocks, count attempts) |
| duplicate_payment_proof | ✅ `payment_proofs` / `kyc_documents.checksum` | same checksum/path reused |
| duplicate_contribution_period | ✅ `contribution_payments` UNIQUE(group,period,member) | conflict attempts |
| negative_amount_attempt / zero_amount | ✅ amounts | amount <= 0 |
| payout_request_abuse | ✅ `withdrawal_requests` | many requests/user/window |
| collector_many_manual_edits | ✅ `contribution_payments` | edits/collector |
| admin_role_change | needs hook | `user_roles` change |
| admin_failed_mfa | needs `security_events` | mfa fail for admin |
| rls_denial_spike | `audit_logs.action='permission_denied'` | count/window |
| rate_limit_spike | ✅ `rate_limit_log` | count/window |
| kyc_repeated_document | ✅ `kyc_documents.checksum` | checksum across users |
| same_phone_multiple_accounts | ✅ `profiles.phone` | phone count > 1 |
| same_device_multiple_accounts | needs `device_sessions` | fingerprint count > 1 |
| unusual_vault_activity | ✅ `vault_transactions` | velocity/amount |
| suspicious_group_creation | ✅ `osusu_groups` | create/delete churn |
| contribution_backdating_attempt | ✅ `collected_at` vs `created_at` | backdate gap |

---

## 6. Missing audit events

`audit_action` enum currently covers system events (payment_*, withdrawal_*,
kyc_*, dispute_*, login, logout, settings_changed, role_changed,
permission_denied). It is **missing**: explicit `signup`,
`login_failed`, `password_reset_requested/completed`, `user_suspended`,
`payout_frozen`, `export_generated`, `account_locked`, `force_logout`.

Because the enum is hard to extend transactionally and admin/security events need
free-text + severity, we record those in the new `admin_actions` /
`security_events` tables instead of forcing them into the enum. The enum-based
`audit_logs` remains the system-event ledger.

---

## 7. Missing admin controls

Present: approve/reject KYC, request KYC resubmission, suspend/unsuspend/ban user,
pause/disband group, suspend/reinstate collector, resolve/reject dispute,
approve/reject withdrawal.

Missing (to add, all audit-logged): **lock account, force logout, freeze payouts,
mark KYC verified, escalate KYC, add admin note, mark risk event reviewed,
update risk status, create fraud case, update fraud case, freeze transaction.**

---

## 8. Tables requiring indexes

New tables (Migration A) ship with their indexes. Additional supporting indexes:

- `mobile_money_transactions(provider_reference)` — exists (unique). For dup
  *attempt* analytics add `(user_id, created_at desc)` — exists (`idx_mmt_user_id` + `idx_mmt_created_at`).
- `withdrawal_requests(user_id, requested_at desc)` — partial exists; add composite for payout-abuse window queries.
- `kyc_documents(checksum)` — **MISSING**, needed for duplicate-document detection → add.
- `profiles(phone)` exists; add `lower(email)` for same-email detection → add.
- `audit_logs(action, created_at desc)` — `idx_audit_action` exists but not composite with time → add for rls_denial spike windowing.

## 9. Tables requiring RLS improvements

- 🟠 `rate_limit_log` — **RLS enabled but NO policy** (advisor `rls_enabled_no_policy`).
  Service role bypasses RLS so the dashboard still reads it, but add an explicit
  `is_super_admin()` SELECT policy for least-surprise + future anon-key reads.
- All new tables: RLS enabled, `is_super_admin()` SELECT only, writes via
  service role / SECURITY DEFINER RPC only (no authenticated INSERT/UPDATE).
- `kyc_applications` policies check `profiles.role = 'super_admin'` (text column)
  while the rest of the system uses `user_roles`. Inconsistent source of truth —
  noted; dashboard uses service role so unaffected, but should be unified later.

## 10. Tables requiring new constraints

- `risk_events.risk_score` CHECK between 0 and 100.
- `risk_events.severity` / `status` constrained to enums.
- `login_attempts.outcome` constrained (`success|failed|locked|mfa_failed`).
- Existing UNIQUE constraints already protect against the two biggest fraud
  vectors: duplicate mobile-money reference and duplicate contribution period.

## 11. Security advisor findings (live)

| Level | Finding | Count | Action |
|---|---|---|---|
| WARN | `authenticated_security_definer_function_executable` | 79 | Intentional RPC design; documented. |
| WARN | `anon_security_definer_function_executable` | 79 | Intentional; RPCs self-check role. |
| WARN | `function_search_path_mutable` (`set_updated_at`, `sync_profile_names`, `sync_savings_goal_owner`, `set_disputes_updated_at`) | 4 | Pin `search_path`; new fns all pinned. |
| WARN | `rls_enabled_no_policy` (`rate_limit_log`) | 1 | Add super_admin SELECT policy (Migration A). |
| INFO | `auth_leaked_password_protection` disabled | 1 | **Manual Supabase dashboard step.** |

---

## 12. Build plan mapping (Phases 2–18)

- **Migration A** → `risk_events`, `fraud_cases`, `admin_actions`,
  `security_events`, `login_attempts`, `device_sessions`, indexes, RLS, the
  `rate_limit_log` policy, `kyc_documents(checksum)` index.
- **Migration B** → `severity_for_score()`, `record_risk_event()`,
  `record_admin_action()`, `log_security_event()`, dashboard RPCs
  (`get_super_admin_overview_metrics`, `get_security_risk_summary`,
  `get_financial_risk_summary`, `get_osusu_risk_summary`,
  `get_user_risk_profile`, `get_live_risk_events`, `get_admin_activity`,
  `get_system_health_summary`), and detection views
  (`v_duplicate_payment_references`, `v_duplicate_contribution_attempts`,
  `v_same_phone_accounts`, `v_collector_risk`, `v_group_risk`).
- **Code** → fix `lib/audit.ts` + collector bug; restructure sidebar to 22
  sections; add risk badge / severity UI; build Live Risk Monitor, Fraud Cases,
  Security Events, Rate Limits, Admin Activity, Devices & Sessions, Login
  Attempts, System Health; enrich Overview / User detail / KYC / Payouts;
  extend `/api/admin/action`; extend exports; add tests.

---

## 13. Implementation status (completed 2026-06-02)

All migrations applied to production (additive, idempotent, non-destructive):

| Migration | Contents |
|---|---|
| `risk_dashboard_a_tables` | 6 new tables + indexes + RLS + `rate_limit_log` policy + checksum/email/withdrawal indexes |
| `risk_dashboard_b1_scoring_writers_views` | `severity_for_score`, `record_risk_event`, `record_admin_action`, `log_security_event`, 7 detection views |
| `risk_dashboard_b2_read_rpcs` | overview / security / financial / osusu / system-health RPCs |
| `risk_dashboard_b3_user_live_admin` | `get_user_risk_profile`, `get_live_risk_events`, `get_admin_activity` |
| `risk_dashboard_b4_harden_rpc_access` | **Security fix** — revoked `PUBLIC`/`anon` EXECUTE; `_require_admin()` made JWT-claims aware (anon + non-admin denied) |
| `risk_dashboard_b5_views_security_invoker` | **Security fix** — detection views set `security_invoker=true` (RLS applies to caller) |

**Bugs fixed in code:** admin-action audit logging (was silently failing — wrong columns + invalid enum action → now `admin_actions`); `suspend_collector` keyed on non-existent `collectors.profile_id` → `user_id`; `force_disband_group` set invalid `group_status` `'disbanded'` → `'archived'`.

**Advisor deltas:** `rls_enabled_no_policy` (rate_limit_log) → resolved. `security_definer_view` (7, from new views) → resolved via `security_invoker`. Remaining advisors are pre-existing (intentional SECURITY DEFINER RPC pattern; 4 legacy trigger functions with mutable search_path; leaked-password-protection = manual dashboard toggle).

**Tests:** 508 vitest tests pass; 25-assertion SQL suite (`supabase/tests/risk_dashboard_tests.sql`) passes against the live DB and rolls itself back (no test data persisted). Production build green.
</content>
</invoke>
