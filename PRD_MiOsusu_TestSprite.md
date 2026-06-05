# Mi Osusu — Product Requirements Document (Test Specification)

> **Purpose of this document:** This PRD is written to be consumed by TestSprite to
> auto-generate and execute **frontend** and **backend** test plans for the Mi Osusu
> application. It describes the system as it is *actually implemented* in this codebase,
> the user roles, every screen/route, every backend Edge Function and RPC, data models,
> validation rules, security guarantees, and explicit, testable acceptance criteria.
>
> Where a requirement is testable, it is phrased as a verifiable assertion so a test case
> can be derived directly from it.

---

## 1. Product Overview

**Name:** Mi Osusu
**Tagline:** "Save Together, Grow Together"
**Domain:** Fintech / community rotating-savings (Osusu / "esusu") for Sierra Leone and diaspora users.
**Primary platform:** Cross-platform mobile app (iOS + Android) built with **React Native + Expo**, with **web** support via `react-native-web`.
**Backend:** **Supabase** (PostgreSQL + Auth + Storage + Realtime + Deno Edge Functions).
**Payments:** Mobile money via the **Monime** aggregator (Orange Money, AfriMoney) using the Payment Codes (USSD) API; payouts via Monime Payout.
**Primary currency:** NLe (New Leone) — displayed as `NLe`, ISO `SLE` at API level.
**Locale focus:** Sierra Leone (phone format `+232XXXXXXXX`).

### 1.1 Core modules

1. **Authentication & session** — email/phone + password, Google OAuth (PKCE), OTP, password reset, biometric unlock.
2. **KYC & profile** — National ID front/back, selfie, address, guarantor; admin review.
3. **Osusu groups** — create, discover, join, member/collector management, contribution schedule, payouts.
4. **Collector workflow** — assign collectors, record physical (cash/mobile-money) collections, deactivate collectors, fraud controls.
5. **Personal vault** — top-up via mobile money, server-authoritative balances (posted/reserved/available), pay Osusu from vault, deposit to savings from vault, withdrawals.
6. **Savings goals** — create goals, deposit, withdraw, track progress, optional auto-save.
7. **Payments engine** — initiate payment (USSD), poll status (display-only), webhook-driven authoritative settlement, idempotency/replay protection, receipts.
8. **Disputes** — raise, message thread, resolve/escalate.
9. **Notifications** — in-app inbox + push (Expo notifications).
10. **Admin / oversight (backend)** — KYC review, withdrawal approval/rejection, group-deletion approval, audit logs, reports. Implemented at the data/RPC/Edge-Function layer guarded by Row Level Security and DB roles.

### 1.2 Architectural principles (must hold during testing)

- **Thin client / server-authoritative finance.** The frontend **never** computes balances, fees, eligibility, receipts, or payment outcomes. Every monetary decision is made by a Supabase RPC (`SECURITY DEFINER`) or Edge Function. Tests must assert that displayed amounts originate from the server, not the client.
- **Roles come from the database** (`user_roles` / `profiles.role`), never from JWT metadata or client claims.
- **KYC status comes from the database** (`profiles.kyc_status`), never a client claim.
- **Webhooks are the only authoritative "payment complete" signal.** Status polling endpoints are display-only and must never be used to mark a payment complete.
- **All tables enforce Row Level Security (RLS).** A user can only read/write rows they are entitled to.

---

## 2. Tech Stack (as implemented)

| Layer | Technology |
|---|---|
| Mobile framework | React Native `0.81.5`, Expo SDK `~54`, React `19.1` |
| Routing | Expo Router `~6` (file-based, route groups) |
| Client state | Zustand `5` |
| Server state | TanStack React Query `5` |
| Styling | NativeWind `4` (Tailwind) + StyleSheet + light/dark theme |
| Forms/validation | React Hook Form `7` + Zod `4` |
| Secure storage | `expo-secure-store` (chunked, encrypted session); AsyncStorage on web |
| Auth/session | `@supabase/supabase-js` `2` with custom secure storage adapter |
| Biometrics | `expo-local-authentication` |
| Camera / media | `expo-camera`, `expo-image-picker`, `expo-file-system` |
| Notifications | `expo-notifications` |
| Backend | Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions in Deno) |
| Payments | Monime Payment Codes API + Payout API |
| Tests (unit) | Vitest `4` |

---

## 3. User Roles & Permissions

Roles (DB enum `user_role`): `super_admin`, `group_creator`, `collector`, `member`.

| Capability | Super Admin | Group Creator | Collector | Member |
|---|:--:|:--:|:--:|:--:|
| Register / login / manage own profile | ✅ | ✅ | ✅ | ✅ |
| Submit KYC | ✅ | ✅ | ✅ | ✅ |
| Approve / reject KYC | ✅ | ❌ | ❌ | ❌ |
| Create Osusu group | ✅ | ✅ | ❌ | ❌ |
| Edit / delete own group | ✅ | ✅ (own) | ❌ | ❌ |
| Assign / deactivate collectors | ✅ | ✅ (own) | ❌ | ❌ |
| Record physical collection | ✅ | ✅ | ✅ (assigned) | ❌ |
| View group ledger | ✅ | ✅ | ✅ (own group) | ✅ (own group) |
| Pay contribution (self) | ✅ | ✅ | ✅ | ✅ |
| Manage own savings goals & vault | ✅ | ✅ | ✅ | ✅ |
| Raise disputes | ✅ | ✅ | ✅ | ✅ |
| Resolve disputes | ✅ | ✅ (own group) | ❌ | ❌ |
| Approve / reject withdrawals | ✅ | ❌ | ❌ | ❌ |
| Approve pending group deletions | ✅ | ❌ | ❌ | ❌ |
| View audit logs | ✅ | ❌ | ❌ | ❌ |
| Platform reports / user management | ✅ | ❌ | ❌ | ❌ |

**Negative-path requirement:** Any non-admin attempting an admin-only action (KYC approval, withdrawal approval, audit-log read, user list) must be denied by RLS / role check and receive an authorization error — never the protected data.

---

## 4. Screens & Navigation (Frontend)

Expo Router route groups. Each route below is a real screen file under `app/`.

### 4.1 Public / onboarding
- `welcome` — landing for new users (pre-auth).
- `(auth)/intro` — onboarding slides.
- `(settings)/terms`, `(settings)/privacy` — legal screens reachable pre-auth; acceptance is recorded in the compliance store and gates onboarding completion.

### 4.2 Authentication — `app/(auth)/`
- `login` — sign in with email **or** Sierra Leone phone + password; biometric unlock option after first login; Google sign-in.
- `register` — first name, last name, phone (+232), email, date of birth, address, password, confirm password, country.
- `otp` — 6-digit verification code; resend timer.
- `forgot-password` — request password reset.
- `app/auth/callback` — OAuth/redirect handler (web detects session in URL; native uses WebBrowser + `exchangeCodeForSession`).

### 4.3 KYC — `app/(kyc)/`
- `details` — identity details + address; national ID type/number.
- `id-photos` — upload National ID front and back.
- `selfie` — live selfie capture (camera only).
- `guarantor` — guarantor name, phone, email, address, relationship, ID type/number, ID document.
- `pending` — shows KYC status (`pending` / `submitted` / `approved` / `rejected`); rejection reason + resubmit.

### 4.4 Main tabs — `app/(main)/`
- `home` — dashboard: active groups summary, next due date, vault/savings snapshot, quick actions.
- `groups` — list of the user's groups with role badges and status.
- `savings` — savings goals list with progress.
- `savings-create` — create savings goal.
- `vault` — vault balances (posted / reserved / available), top-up, transaction history, biometric gate for sensitive actions.

### 4.5 Groups — `app/(groups)/`
- `create` — create group: name, description, logo, contribution amount, frequency, max members, cycle start, total cycles, payout order, public/approval flags, rules, admin collection phone.
- `discover` — search/browse public groups, request to join.
- `invite` — invite contacts / share invite code.
- `[id]` — group detail (info, members, schedule, rules, ledger).
- `manage/[id]` — creator management (members, pending requests, collectors).
- `creator-dashboard` — creator overview/stats.
- `assign-contributors` — assign a registered user as collector/contributor.
- `collector` — collector home / recording entry point.
- `physical-collect` — record a physical (cash/mobile-money) collection for a member.
- `contribute` — member contribution flow entry.
- `monime-payment` — Monime USSD payment screen (dial code, poll status).
- `payment-success` — success/receipt state.
- `rules` — group rules.
- `setup-complete` — post-creation confirmation.
- `chat/[id]` — group chat/thread.

### 4.6 Send/pay — `app/(send)/`
- `select` — choose recipient/target.
- `detail` — amount & payment method detail.
- `summary` — confirm & submit.

### 4.7 Settings — `app/(settings)/`
- `2fa` — enable/disable two-factor.
- `change-password` — change password (re-auth).
- `about`, `help`, `terms`, `privacy`.

### 4.8 Shared components/screens — `app/components/`
- `profile`, `profile-edit` — view/edit profile, avatar, KYC status, guarantor.
- `notifications` — in-app notification inbox; mark read.
- `receipts` — receipt list/preview.
- `disputes` — raise & view disputes, message thread.
- `settings`, `payment-methods` — settings hub & payment method linking.

### 4.9 Global routing rules (testable)
- Unauthenticated users hitting a protected route are redirected: returning users (terms+privacy accepted) → `(auth)/login`; brand-new users → `welcome`.
- Authenticated users remain in the main app.
- The splash animation displays on cold start until session resolution completes.
- When Supabase is **not configured**, the app degrades gracefully to a local/demo mode (no crash) — see §9.

---

## 5. Backend Surface (must be tested at the API layer)

Base URL pattern for Edge Functions: `{SUPABASE_URL}/functions/v1/{function-name}`.
All authenticated calls require `Authorization: Bearer <access_token>`.

### 5.1 Edge Functions (`supabase/functions/`)

| Function | Purpose | Auth | Key behaviors to test |
|---|---|---|---|
| `initiate-payment` | Create a group contribution payment; returns Monime USSD code | User JWT | Validates membership + amount server-side; rejects non-members (403); enforces idempotency key; returns `ussd_code`, `expires_at`, `monime_payment_code_id`, `contribution_id`, `status`. |
| `verify-payment` | Poll Monime payment-code status (display only) | User JWT | Returns `effective_status` (`pending/processing/completed/failed/expired/cancelled/not_found`); must **not** itself settle the payment. |
| `verify-payment-status` | Alternate status verification | User JWT | Read-only status reporting. |
| `mobile-money-webhook` | Authoritative settlement from Monime for contributions | Provider signature | Verifies HMAC signature; deduplicates by webhook event id; updates payment → contribution; triggers notification + receipt. Replays must not double-credit. |
| `payment-webhook` | Generic provider webhook | Provider signature | Signature verification + dedup + idempotent state transition. |
| `confirm-payment` | Confirm a contribution after verification | User/Service | Confirming twice must not create duplicates. |
| `upload-payment-proof` | Upload proof for manual/cash payments | User JWT | Rejects unsupported file types/sizes; stores in private bucket. |
| `initiate-vault-topup` | Start a vault top-up via Monime | User JWT | Returns `topup_id`, `monime_payment_code_id`, `ussd_code`, `expires_at`, `amount`, `status`; idempotent on `idempotency_key`. Methods limited to `orange_money`, `afrimoney`. |
| `vault-webhook` | Authoritative vault top-up settlement | Provider signature | Signature + dedup; credits posted balance once; replays ignored. |
| `verify-vault-topup-status` | Poll vault top-up status (display only) | User JWT | Returns `effective_status`; does not settle. |
| `process-withdrawal` | Member requests a vault/savings withdrawal | User JWT | Validates available balance server-side; creates pending withdrawal. |
| `approve-withdrawal` | Admin approves a pending withdrawal | Admin JWT | Requires admin role (DB-verified); triggers Monime payout; idempotent. |
| `reject-withdrawal` | Admin rejects a withdrawal | Admin JWT | Requires admin role; **requires a rejection reason**; returns funds to available balance. |
| `provider-kyc-check` | Provider-side KYC verification hook | Service | Updates KYC verification state. |
| `send-notification` | Send push/in-app notification | Service/Admin | Creates notification row + dispatches push. |

### 5.2 Database RPCs (PostgREST `rpc/…`, `SECURITY DEFINER`)

These hold the business logic. Tests should exercise them directly and via the UI.

**Groups**
- `create_osusu_group(p_name, p_description, p_contribution_amount, p_frequency, p_max_members, p_cycle_start_date, p_total_cycles)` — validates input, creates the group + creator membership + server-side invite code, audits atomically.
- `update_group_logo(p_group_id, p_avatar_url)` — enforces `created_by = auth.uid()`.
- `request_group_deletion(p_group_id, p_reason)` — returns `outcome` = `deleted` (no other members) or `pending_super_admin` (atomic).

**Contributions / schedule**
- `get_member_contribution_status(p_group_id, p_member_id)` — totals, outstanding balance, paid/total cycles, next due date, `is_fully_paid`.
- `validate_member_eligibility(p_group_id, p_member_id)` — `eligible`, `reason`, `expected_amount`, `outstanding_amount`.
- `generate_contribution_schedule(p_group_id, p_member_id)` — schedule rows with `is_paid`, `is_overdue`, frequency.

**Collector**
- `record_physical_collection(p_group_id, p_member_id, p_period_id, p_amount, p_payment_method, p_notes, p_idempotency_key)` — atomic, rate-limited, fraud-logged; validates secret code/passcode server-side; generates receipt number; idempotent.
- `assign_collector_validated(p_group_id, p_user_id, p_display_name, p_photo_url, p_passcode)` — KYC-gated; caller must be group creator; auto-generates passcode if omitted; notifies all members; returns `member_secret_code`, `collector_passcode`.
- `deactivate_collector_atomic(p_group_id, p_collector_profile_id)` — deactivates + alerts members atomically.
- `calculate_collector_summary(p_collector_id)` — aggregated performance.

**Vault**
- `get_vault_summary()` — `posted_balance`, `reserved_balance`, `available_balance`, `pending_topup_count`, `pending_topup_amount`, `currency`.
- `pay_osusu_from_vault(p_group_id, p_period_id, p_idempotency_key, p_notes)` — reserves & pays a contribution; returns `contribution_id`, `reservation_id`, `amount`, `fee`; idempotent.
- `deposit_savings_from_vault(p_goal_id, p_amount, p_idempotency_key)` — moves vault → savings; idempotent.

**Savings**
- `create_savings_goal(p_owner_id, p_title, p_description, p_category, p_target_amount, p_target_date, p_auto_save_enabled, p_auto_save_amount, p_auto_save_frequency)` — enforces `auth.uid() = owner_id`, sets `current_amount = 0`, audits.
- `initiate_savings_deposit(p_goal_id, p_amount, p_method, p_idempotency_key)` — creates a payment toward a goal.
- `record_savings_transaction(p_savings_goal_id, p_amount, p_type, p_note)` — deposit/withdrawal; validates balance for withdrawals; returns new `current_amount`.
- `get_vault_balance()` — total/active/completed savings balances + goals.

### 5.3 Direct table reads (RLS-guarded)
Frontend reads (display only) from: `profiles`, `osusu_groups`, `osusu_group_members`, `contribution_payments`, `collectors`, `collector_group_view`, `payment_periods`, `savings_goals`. RLS must restrict every read to the caller's entitlement.

---

## 6. Data Model (key entities)

> Field names reflect the live schema used by the services. Enums are PostgreSQL enums.

- **profiles** — extends `auth.users`: name, phone (unique, +232), email (unique), DOB, gender, address fields, country, national ID fields, `kyc_status` (`pending|submitted|approved|rejected`), `role`, currency/language prefs, push token, security flags (`is_active`, `is_verified`, `two_fa_enabled`, `failed_login_attempts`, `locked_until`, `last_login_at`).
- **guarantors** — per member: contact, relationship, national ID, verification state.
- **osusu_groups** — name, description, avatar, `created_by`, `contribution_amount`, `currency_code`, `frequency` (`daily|weekly|biweekly|monthly`), `max_members`, `total_cycles`, `cycle_start_date`, `status` (`active|paused|completed|disbanded|pending`), `is_public`, `join_requires_approval`, `payout_order` (`sequential|random|custom`), `invite_code` (unique), `custom_rules` (JSON), `contribution_number`.
- **osusu_group_members** — `group_id`, `user_id`, `payout_position`, `is_active`, `joined_at`.
- **collectors** — `group_id`, `profile_id`, display name/photo, passcode (server-managed), `is_active`, performance totals; `collector_group_view` exposes `assignment_status`.
- **payment_periods** — `group_id`, `period_label`, `period_start`, `period_end`, `status` (`open`/closed).
- **contribution_payments** — `group_id`, `member_id`, `amount`, `currency`, `status` (`pending|collected|verified|disputed|refunded` / `submitted|approved`), `payment_method`, `receipt_number`, `collected_at`, `created_at`.
- **payments** — financial transactions: payer, group/savings link, amount, method, provider, provider reference/response, status (`pending|processing|completed|failed|reversed`), webhook payload, idempotency, reversal fields.
- **savings_goals** — owner, title, description, `category` (`car|house|rent|school_fees|business|travel|emergency|other`), `target_amount`, `current_amount`, `currency_code`, `target_date`, `status` (`active|completed|withdrawn|cancelled`), auto-save config.
- **savings_transactions** — goal link, payment link, amount, type (`deposit|withdrawal`).
- **vault** balances — posted / reserved / available (server-computed; no client column writes).
- **withdrawals** — request, amount, status, approver, reason (on reject).
- **disputes** + **dispute_messages** — type, status (`open|under_review|resolved|escalated`), evidence, resolution, SLA.
- **notifications** — recipient, type, title, body, data, `is_read`, channels.
- **audit_logs** — immutable (no update/delete) action trail.
- **payment_webhook_events** — unique constraint enforces idempotent webhook processing.

Supported payment methods (enum): `orange_money`, `afrimoney`, `bank_transfer`, `card`, `cash_collected`. **Monime-routed methods:** `orange_money`, `afrimoney` only. (`qmoney` is intentionally excluded.)

---

## 7. Validation Rules (frontend + server, must be tested)

These are enforced by Zod (`src/utils/validation/auth.ts`) and mirrored server-side.

- **Phone:** Sierra Leone E.164 `^\+232[0-9]{8}$`. Input normalization accepts 8 local digits, `0XXXXXXXX`, or `232XXXXXXXX`.
- **Email:** trimmed, lowercased, RFC-ish, ASCII-only (rejects emoji/non-ASCII), single `@`, valid TLD, no consecutive dots, ≤ 254 chars.
- **Name (first/last):** 2–50 chars, letters/accents/hyphen/apostrophe/single interior space; rejects digits, symbols, emoji, XSS payloads.
- **Date of birth:** required, in the past, age **≥ 18** and **≤ 120**.
- **Address:** 5–150 chars, must contain a letter; rejects `<`, `>`, `script`, `select`, `insert`, `drop`, `--` (injection guard).
- **Password:** 8–72 chars; ≥1 uppercase, ≥1 lowercase, ≥1 digit, ≥1 special char; rejected if in the common-password blocklist. Strength meter 0–4.
- **Confirm password:** must equal password.
- **Login identifier:** auto-detects email (`contains @`) vs phone; validates accordingly.
- **Contribution / top-up / savings amounts:** must be finite and **> 0**; server is authoritative on the *expected* contribution amount (client cannot override).
- **Savings goal deadline:** a past `target_date` must be rejected.

---

## 8. Security Requirements (testable assertions)

1. **Server-authoritative money:** No balance, fee, eligibility, or "payment complete" decision is computed on the client. Tampering with client-side amounts must not change the charged/credited amount.
2. **Role enforcement from DB:** Forging `role` in JWT/user metadata must not grant admin powers. Admin Edge Functions (`approve-withdrawal`, `reject-withdrawal`) and admin reads (user list, audit logs) must verify role against the DB.
3. **KYC enforcement from DB:** A client claiming KYC-approved must still be blocked from KYC-gated actions (contributions, collector assignment, withdrawals) unless `profiles.kyc_status = approved`.
4. **Webhook authenticity:** Webhooks must verify the provider HMAC-SHA256 signature; unsigned/invalid-signature payloads are rejected.
5. **Idempotency / replay:** Duplicate webhook deliveries (same event id) and duplicate client requests (same `idempotency_key`) must be no-ops — no double credit/charge. Confirming a contribution twice must not duplicate it.
6. **RLS isolation:** A user cannot read another user's profile, contributions, vault, savings, or notifications. A collector cannot see other collectors' collections.
7. **Secrets:** The Supabase service-role key and Monime secrets never reach the client; provider calls happen only inside Edge Functions.
8. **Session security:** Sessions stored encrypted (`expo-secure-store`, chunked for the iOS 2 KB limit); `getUser()` (network-verified) is used to confirm a session is still valid (revoked/suspended users are not treated as authenticated); logout clears all local/secure storage and KYC draft state.
9. **Account protection:** Account lockout after repeated failed logins (`failed_login_attempts` / `locked_until`); rate limiting on sensitive RPCs (e.g., physical collection).
10. **Private documents:** KYC documents live in a private bucket; access only via short-lived signed URLs.
11. **Collector anti-fraud:** Recorded collections are immutable; daily limits enforced server-side; deactivating a collector instantly alerts members; secret code/passcode validated server-side only.

---

## 9. Non-Functional & Environment

- **Graceful degradation:** When `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are absent, `supabaseConfigured` is false and the app runs in a local/demo mode: reads return empty/zeroed data, writes succeed locally, and no network hang occurs (network calls reject immediately). Tests for "unconfigured" mode must assert no crash and sensible empty states.
- **Network resilience:** Supabase fetches time out at 20 s to avoid indefinite hangs.
- **Currency display:** `NLe` symbol in UI; `SLE` ISO at API.
- **Localization:** SL phone formatting; English default.
- **Scale targets:** designed for ~100k users / ~1M transactions.
- **Offline (collector):** cash collections can be captured and synced on reconnect (verification workflow triggers on sync).

---

## 10. Acceptance Criteria & Test Scenarios

Each scenario is phrased for direct conversion into a TestSprite test case (Given/When/Then). FE = frontend (UI), BE = backend (API/RPC/Edge Function).

### 10.1 Authentication
- **AUTH-1 (FE/BE):** Given valid registration data, when the user submits, then an account is created and OTP verification is initiated.
- **AUTH-2 (FE):** Given an invalid email/phone/password/DOB/name/address per §7, when the user submits, then the matching inline validation error is shown and submission is blocked.
- **AUTH-3 (BE):** Given a user under 18, when registering, then registration is rejected ("must be at least 18").
- **AUTH-4 (FE/BE):** Given valid credentials, when the user logs in, then a session is established and the user lands in the main app.
- **AUTH-5 (BE):** Given a common/blocklisted password, when registering, then it is rejected.
- **AUTH-6 (FE/BE):** Given a password-reset request for a known account, when submitted, then a reset is initiated; an invalid/expired reset token must be rejected.
- **AUTH-7 (BE):** Given logout, then secure session storage and KYC draft are cleared and protected routes redirect to login.
- **AUTH-8 (BE/security):** Given repeated failed logins, then the account is locked per policy.

### 10.2 KYC
- **KYC-1 (FE/BE):** Given an authenticated user, when they upload ID front, ID back, and a selfie and submit, then `kyc_status` becomes `submitted`.
- **KYC-2 (BE):** Given KYC `submitted`, when an admin approves, then `kyc_status = approved`; when rejected, a reason is stored and the user may resubmit.
- **KYC-3 (BE/security):** Given a non-admin, when calling KYC approval, then the action is denied.
- **KYC-4 (BE):** Given KYC not approved, when the user attempts a KYC-gated action (contribution / collector assignment / withdrawal), then it is blocked.

### 10.3 Osusu Groups
- **GRP-1 (FE/BE):** Given valid inputs, when a creator creates a group, then `create_osusu_group` creates the group + creator membership + invite code atomically.
- **GRP-2 (BE):** Given a contribution amount ≤ 0 or invalid frequency/max members, when creating, then creation is rejected.
- **GRP-3 (FE/BE):** Given an invite code, when a member joins, then a membership is created (pending approval if `join_requires_approval`).
- **GRP-4 (BE/security):** Given a non-creator, when updating a group or its logo, then the write is denied (RLS / RPC ownership check).
- **GRP-5 (BE):** Given a group with no other members, when the creator requests deletion, then `outcome = deleted`; with other members, `outcome = pending_super_admin`.
- **GRP-6 (FE/BE):** Given a member in a group, when viewing the ledger, then they see that group's contributions and nothing from groups they don't belong to.

### 10.4 Collector
- **COL-1 (BE):** Given a group creator, when assigning a collector to a KYC-approved user, then a collector record is created, a passcode is generated, and all members are notified.
- **COL-2 (BE/security):** Given a non-creator, when assigning a collector, then it is denied.
- **COL-3 (BE):** Given a valid open period and member secret code, when a collector records a physical collection, then a contribution + receipt number is created atomically; a duplicate with the same idempotency key is a no-op.
- **COL-4 (BE/security):** Given an invalid secret code/passcode, when recording a collection, then it is rejected server-side.
- **COL-5 (BE):** Given an active collector, when the creator deactivates them, then the collector is inactive and members are alerted; the collector can no longer record collections.

### 10.5 Vault
- **VLT-1 (FE/BE):** Given an authenticated user, when requesting the vault summary, then posted/reserved/available balances and currency are returned from the server.
- **VLT-2 (FE/BE):** Given a valid top-up amount and method (`orange_money`/`afrimoney`), when initiating, then a `ussd_code`, `expires_at`, and `monime_payment_code_id` are returned; status is pending until webhook.
- **VLT-3 (BE/security):** Given the vault-webhook settles a top-up once, when the same webhook event is replayed, then the balance is credited only once.
- **VLT-4 (FE):** Given an invalid top-up amount (≤ 0 or non-numeric), when initiating, then it is blocked with a validation error.
- **VLT-5 (BE):** Given sufficient available balance, when paying Osusu from vault, then a contribution + reservation are created and the call is idempotent.
- **VLT-6 (BE):** Given insufficient available balance, when paying from vault or withdrawing, then it is rejected server-side.
- **VLT-7 (BE):** Given a withdrawal request, when an admin approves, then a Monime payout is triggered; when an admin rejects **without a reason**, the action is refused; with a reason, funds return to available.

### 10.6 Savings Goals
- **SAV-1 (FE/BE):** Given valid input, when creating a goal, then `current_amount = 0` and the goal is owned by the caller.
- **SAV-2 (FE/BE):** Given a past `target_date`, when creating a goal, then it is rejected.
- **SAV-3 (BE):** Given a goal, when depositing from vault, then balance moves vault → goal and the operation is idempotent.
- **SAV-4 (BE):** Given a withdrawal exceeding the goal balance, when requested, then it is rejected; a valid withdrawal returns the new `current_amount`.
- **SAV-5 (BE/security):** Given a non-owner, when deleting/withdrawing from a goal, then it is denied.

### 10.7 Payments
- **PAY-1 (FE/BE):** Given an eligible member and correct amount, when initiating a contribution payment, then a USSD payment code is returned and a pending contribution is created.
- **PAY-2 (BE/security):** Given a non-member of the group, when initiating a payment, then it is rejected (403).
- **PAY-3 (BE):** Given a tampered client amount that differs from the group's expected amount, when initiating, then the server uses/enforces the authoritative amount (no manipulation).
- **PAY-4 (BE):** Given polling `verify-payment` shows `completed`, then the client must still treat the payment as authoritative only after the webhook updates the DB.
- **PAY-5 (BE/security):** Given the mobile-money webhook with a valid signature, when delivered once it settles; when replayed it does not double-credit; an invalid signature is rejected.
- **PAY-6 (BE):** Given `confirm-payment` is called twice for the same contribution, then no duplicate contribution is created.
- **PAY-7 (FE/BE):** Given an unsupported file type/size, when uploading payment proof, then it is rejected.

### 10.8 Disputes
- **DSP-1 (FE/BE):** Given a user, when raising a dispute with type/description/evidence, then a dispute is created in `open` status.
- **DSP-2 (FE/BE):** Given an open dispute, when the creator/admin resolves it, then status becomes `resolved` with resolution notes.
- **DSP-3 (BE/security):** Given a member, when attempting to resolve a dispute they don't own/aren't admin for, then it is denied.

### 10.9 Notifications
- **NOT-1 (FE/BE):** Given events (payment confirmation, KYC status, withdrawal status, new collector), then a notification row is created for the recipient and appears in the inbox.
- **NOT-2 (FE):** Given an unread notification, when the user opens/marks it, then `is_read = true`.
- **NOT-3 (BE/security):** A user can only read their own notifications.

### 10.10 Admin / oversight (backend)
- **ADM-1 (BE/security):** Given a non-admin, when listing all users, reading audit logs, or monitoring transactions, then access is denied.
- **ADM-2 (BE):** Given an admin, when reviewing the KYC queue / withdrawal queue / dispute centre, then the protected data is returned.
- **ADM-3 (BE):** Audit log rows cannot be updated or deleted (immutability).
- **ADM-4 (BE):** Given an admin, when exporting reports, then aggregated platform data is produced.

### 10.11 Resilience
- **RES-1 (FE):** Given Supabase is not configured, when launching and navigating core screens, then the app does not crash and shows empty/zeroed states.
- **RES-2 (FE):** Given an unreachable backend, when a request is made, then it fails within the timeout and surfaces a user-facing error rather than hanging.

---

## 11. Out of Scope / Notes for the Test Generator

- A separate **Next.js web admin dashboard** is described in internal architecture docs but is **not** part of this codebase. Admin capabilities here are exercised through Supabase RPCs, Edge Functions, and RLS — test them at the API layer (with an admin-role token) and, where present, through the Expo app's admin-facing screens/components.
- `qmoney` appears in some legacy method enums but is **not** a supported live payment route (Monime only supports Orange Money and AfriMoney here).
- Some screens (e.g., maps, full offline sync, PDF generation) may be partially implemented; treat UI presence + server contract as the source of truth and prefer the acceptance criteria above.
- For end-to-end payment tests, Monime should be in sandbox/mock mode; authoritative settlement must be driven by simulating the signed webhook, not by status polling.

---

## 12. Suggested Test Environment

- **Backend:** a Supabase test/staging project with the schema, RPCs, and Edge Functions deployed; Monime in sandbox.
- **Test accounts:** one per role — `super_admin`, `group_creator`, `collector`, `member` — each with a known KYC state (one approved, one pending) to cover gated paths.
- **Env vars:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` for the app; service-role + Monime secrets only in the Edge Function environment.
- **Seed data:** at least one public group (joinable), one private group, one open `payment_period`, one savings goal, and one pending withdrawal for the admin queue.
