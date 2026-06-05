# Mi Osusu — Code Quality & Performance Audit

**Audit date:** 2026-06-03
**Auditor:** Automated production-readiness pass (Claude)
**Scope:** Whole repo — mobile app (`app/`, `src/`), admin web app (`apps/admin/`), Supabase backend (`supabase/` SQL + edge functions), tests (`__tests__/`).
**Live DB project:** `upuhjekwmtjnjksqikdu` (Mi Osusu, Postgres 17, eu-central-1).

This audit follows the principle **"inspect first, fix the real issues, do not rewrite working code blindly."**
Mi Osusu is a relatively mature codebase that was recently reorganised (the "vault-first" refactor + a `src/` consolidation). Much of the security architecture is already strong (see [§7 Verified-good](#7-verified-good-baseline)). The most valuable findings were **drift and regressions introduced by the reorg** plus **one real authorization inconsistency in the live database**.

---

## 0. Executive summary

| Metric | Before | After |
|---|---|---|
| `tsc --noEmit` (typecheck) | **18 errors** | **0 errors** |
| Vitest suite | **11 failing / 512 passing**, 1 suite red | **0 failing / 629 passing**, 19 suites green |
| Active validation tests | 106-test auth suite **orphaned (never ran)** | **activated & green** |
| Security advisors (live DB) | 0 ERROR / 147 WARN | 0 ERROR / 147 WARN (triaged, see §6) |
| KYC RLS authorization source | **inconsistent** (`profiles.role` vs `user_roles`) | **unified** (`is_super_admin()` → `user_roles`) |

**Net effect:** the build is green for the first time since the reorg, a latent KYC-admin authorization bug in production was fixed, and a large dormant validation test suite is now executing in CI.

---

## 1. Issues found and fixed

Each issue uses the required template: *Feature · File · Bad method · Why bad · Good method · Security impact · Performance impact · Test result.*

### Issue 1 — QMoney offered as a Monime payment method it cannot process

- **Feature affected:** Monime Payments (Feature 8), Vault top-up, Send money.
- **File path:** `src/store/appDataStore.ts`, `src/services/paymentMethodLinks.ts`, `app/(send)/detail.tsx`, `app/components/payment-methods.tsx`.
- **Bad method found:** `MobileMoneyNetwork` and several UI selection lists still included `'qmoney'`, while the canonical `SupportedPaymentMethod` (in `paymentService.ts`) had **deliberately removed** QMoney ("not confirmed in Monime API docs"). The two type sets diverged, producing 5 typecheck errors and a UI that could offer QMoney.
- **Why it is bad:** A user could select **QMoney → the Monime initiate-payment call would fail** (unsupported provider), causing a dead-end payment. It also broke the build (type mismatch between `MobileMoneyNetwork` and `SupportedPaymentMethod`).
- **Good method implemented:** Removed `qmoney` from `MobileMoneyNetwork`, the `MOBILE_MONEY_METHODS` list, `PAYMENT_METHOD_LABELS`, the `ALL_METHODS` send-flow list, and the payment-methods logo map. QMoney is now consistently excluded everywhere a Monime payment can be initiated (matching Phase 8 requirement "QMoney excluded if not supported"). The collector "record physical collection" flow keeps its own independent local enum (a collector physically receiving QMoney cash is a record, not a Monime charge) and is intentionally untouched.
- **Security impact:** None directly; removes an avenue for confusing failed-payment states.
- **Performance impact:** None.
- **Test result:** Typecheck errors for `qmoney` eliminated; full suite green (629/629).

### Issue 2 — `recordPhysicalCollection` offline fallback referenced a non-existent field

- **Feature affected:** Collectors (Feature 10).
- **File path:** `src/services/collectorService.ts` (offline fallback branch).
- **Bad method found:** `return { …, period: input.period, … }` — `RecordCollectionResult` has no `period` field and `RecordCollectionInput` exposes `periodId`, not `period`. The real (online) success branch never returns `period`.
- **Why it is bad:** Dead/incorrect field that broke typecheck and meant the offline mock returned a shape inconsistent with the real path — exactly the kind of "works in demo, diverges in prod" trap.
- **Good method implemented:** Removed the stray `period` field so the offline fallback matches the real success shape.
- **Security impact:** None.
- **Performance impact:** None.
- **Test result:** Typecheck error resolved; `collectorService` unit tests green.

### Issue 3 — KYC RLS policies authorized off a locked/immutable `profiles.role` (LIVE DB)

- **Feature affected:** KYC (Feature 3), Super Admin Dashboard (Feature 12), Phase 7 security.
- **File path (DB):** policies `kyc_apps_select_admin`, `kyc_apps_update_admin`, `kyc_docs_select_admin`, `kyc_reviews_admin_all`. Migration added: `supabase/prompt11_kyc_rls_user_roles_alignment.sql` (applied as migration `prompt11_kyc_rls_user_roles_alignment`).
- **Bad method found:** The 4 KYC **admin RLS policies** checked `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')`, while every KYC **RPC** (`approve/reject/submit`) and the canonical helper `is_super_admin()` check the **`user_roles`** table. `profiles.role` is a **locked, immutable column** (`trg_protect_profile_immutable`) and is *not* the maintained source of truth.
- **Why it is bad:** Split-brain authorization. Verified on the live DB: the single `super_admin` in `user_roles` **did not match** `profiles.role` (`mismatched_admins = 1`). So those RLS policies **denied the real admin direct table access** to KYC data. (The admin web app reads via a service-role server client, which bypasses RLS and masked the bug — but the RLS boundary itself was wrong and fragile, and any non-service-role admin path would silently return zero rows.)
- **Good method implemented:** Migrated all 4 policies to `USING (public.is_super_admin())` (and `WITH CHECK` for the `ALL` policy) so the entire app authorizes from one canonical source (`user_roles`). Own-row policies for regular users are unchanged. Fully reversible (rollback documented in the migration file). A verified snapshot of the canonical objects is committed at `supabase/_live_snapshot/canonical_security_objects.sql`.
- **Security impact:** **Positive.** Single source of truth for admin authorization; removes reliance on a column that can drift. Not an escalation vector (the immutability trigger already blocks self-elevation of `profiles.role`), but it is a defense-in-depth correctness fix.
- **Performance impact:** Neutral/positive — `is_super_admin()` is `STABLE` and index-friendly on `user_roles(user_id, role)`.
- **Test result:** Post-migration verification confirms all 4 policies now read `is_super_admin()`. Security test "KYC RLS admin policies authorize via is_super_admin()" passes. RLS remains **enabled** on all three tables.

### Issue 4 — Security test suite asserted an *archived, schema-incorrect* migration

- **Feature affected:** Testing (Phase 9), KYC, Authorization.
- **File path:** `__tests__/security/advancedAttackSurface.test.ts`.
- **Bad method found:** 11 tests read `supabase/prompt8_security_hardening_v2.sql`, which the `src/` reorg moved into `supabase/_archive_stale_pre_refactor/`. Worse, two tests **asserted the broken audit schema** the archive README explicitly documents as a bug: `INSERT INTO audit_logs (user_id, …, new_values)` — the live table uses `(actor_id, …, new_data)`.
- **Why it is bad:** The tests validated a file that "will fail or create broken objects if applied," and actively enforced the **wrong** audit columns. Green-but-meaningless once the file existed; red-and-misleading once it was archived.
- **Good method implemented:**
  1. Pulled the **canonical live definitions** (KYC RPCs, profile-lock trigger, KYC RLS) from the production DB via `pg_get_functiondef`/`pg_policies` and committed them as `supabase/_live_snapshot/canonical_security_objects.sql`.
  2. Repointed all 11 tests to that snapshot (`KYC_SEC` constant).
  3. **Corrected** the audit-column assertions to require `actor_id`/`new_data` and forbid `new_values`.
  4. Rewrote the RLS assertion to require the canonical `is_super_admin()` pattern.
- **Security impact:** **Positive.** Tests now defend the *real* deployed security posture, including the correct, working audit-logging schema.
- **Performance impact:** None.
- **Test result:** `advancedAttackSurface.test.ts` — **113/113 passing**.

### Issue 5 — A 106-test signup/login/phone validation suite never ran

- **Feature affected:** Signup (Feature 1), Login (Feature 2), Phone validation (Phase 9).
- **File path:** `src/utils/validation/__tests__/auth.test.ts`, `vitest.config.ts`.
- **Bad method found:** `vitest.config.ts` `include` was `['__tests__/**/*.test.ts']` only — so the comprehensive auth-validation suite under `src/` was **never collected**. It also had a broken import (`../../services/auth/phone` → resolved to a non-existent path after the reorg), and one test bug (`'a'.repeat(245)+'@b.com'` = 251 chars, under the 254 limit, so it never failed validation as the test claimed).
- **Why it is bad:** The exact tests the task requires for Phase 9 (signup validation, phone validation, role-injection, etc.) existed but contributed **zero** CI coverage — a false sense of safety.
- **Good method implemented:** Added `'src/**/*.test.ts'` to vitest `include`; fixed the import path to `../../../services/auth/phone`; fixed the 254-char boundary test to use a genuinely over-length address.
- **Security impact:** **Positive** — strict-validation guarantees (SL phone `^\+232\d{8}$`, email lowercase/length, strong-password blocklist, adult-DOB) are now continuously verified.
- **Performance impact:** None (test-time only).
- **Test result:** Suite now runs — **106/106 passing**.

### Issue 6 — Typecheck red across test/mocks/scripts

- **Feature affected:** Maintainability / CI (cross-cutting).
- **File path:** `__tests__/mocks/{async-storage,expo-secure-store,react-native}.ts`, `__tests__/unit/googleOAuth.test.ts`, `__tests__/unit/vaultWithdrawal.test.ts`, `scripts/test-privilege-escalation.ts`.
- **Bad method found:** Mock files used the global `vi` without importing it (8 errors); `googleOAuth` mocks resolved bare `{type:'cancel'}` against a stricter expo type (3 errors); a mock assigned `.then` to a typed handle; a script cast `GenericStringError → Record` without going through `unknown`.
- **Why it is bad:** A red `tsc` masks *real* type regressions (it hid Issues 1 & 2 in the noise) and blocks any "typecheck gate" in CI.
- **Good method implemented:** `import { vi } from 'vitest'` in the three mocks; cast OAuth mock results to `Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>`; cast the handle to `Record<string, unknown>`; cast the script value via `unknown`.
- **Security impact:** Indirect — restores the ability to detect type regressions in financial/service code.
- **Performance impact:** None.
- **Test result:** `tsc --noEmit` — **0 errors**; full suite green.

---

## 2. Findings documented (not auto-changed — see rationale)

These are real observations where the safest action was to **document + recommend** rather than rewrite working code mid-audit.

### F1 — `toBackendError` fallback can pass a raw message through; mapped messages leak infra hints

- **Feature:** Error handling (Phase 5/7), all services.
- **File:** `src/services/backendErrors.ts` + ~13 `Alert.alert('…', error.message)` call sites (`app/(main)/savings-create.tsx`, `app/(send)/summary.tsx`, `app/(groups)/...`, etc.).
- **Observation:** `toBackendError` maps known Postgres error signatures to friendly text but its **fallback returns `new Error(rawMessage)`**, and several mapped messages mention internal artifacts (e.g. *"Run supabase/core_platform_bootstrap.sql in the Supabase SQL Editor"*).
- **Mitigating reality:** Supabase-js surfaces `PostgrestError` as a **plain object**, not an `Error` instance, so in practice it lands on the generic `"Unable to {action}."` branch — most raw DB text never reaches users. The infra-hint strings are deliberate developer aids for a pre-production deployment.
- **Recommendation (next refactor):** Introduce a structured result `{ ok:false, userMessage, code }`; gate infra-hint strings behind `__DEV__`; ensure the fallback always returns a generic user-safe message. This is a ~14-file change best done as its own PR with snapshot tests, not folded into a stability pass. Tests at `collectorService.test.ts:119`, `groupService.test.ts:105`, `paymentService.test.ts:225` currently pin the existing strings and must be updated together.

### F2 — `anon` role can `EXECUTE` SECURITY DEFINER RPCs (147 WARN advisors, 0 ERROR)

- **Feature:** Phase 7 security / DB hardening.
- **Observation:** Live security advisors report `anon_security_definer_function_executable` (65) and `authenticated_security_definer_function_executable` (77). Each RPC internally calls `auth.uid()` and returns *"Not authenticated"* for anon, so this is defense-in-depth rather than an open hole. Migration `lockdown_anon_financial_rpcs` already revoked anon on the financial set; the remaining warnings are largely read/utility RPCs.
- **Recommendation:** Extend the lockdown — `REVOKE EXECUTE … FROM anon` on every non-public RPC, granting only `authenticated` where a logged-in user is required. Also fix the 4 `function_search_path_mutable` functions with `SET search_path = public`.

### F3 — `select('*')` in services

- **Feature:** Phase 1/3 performance.
- **File:** `src/services/{savingsService,profileService,notificationService,groupService}.ts` (7 sites).
- **Observation:** A handful of single-row `.select('*').maybeSingle()` reads and small list reads use `*`. Low impact (mostly single-row by PK, already `.limit()`-bounded), but column-projection is cheaper and contract-stable.
- **Recommendation:** Replace `*` with explicit column lists on the list-returning queries (`notificationService` feed, `groupService` member lists) and add `.range()` pagination where lists can grow.

---

## 3. Feature-by-feature status (audited)

Legend: ✅ verified good · 🔧 fixed this pass · 📝 documented finding.

| Feature | Backend-driven? | Notes |
|---|---|---|
| **1. Signup** | ✅ | Zod schemas (`src/utils/validation/auth.ts`): strict name/email/SL-phone/DOB/strong-password. No role in signup metadata; role assigned `member` by DB trigger. 🔧 validation tests now actually run. |
| **2. Login** | ✅ | Generic auth errors via `src/utils/auth/authErrors.ts`; login rate-limit RPC (`prompt10_login_rate_limit`); Google OAuth has no secrets in client. |
| **3. KYC** | ✅ 🔧 | Submit/approve/reject via SECURITY DEFINER RPCs; rate-limited (3/10min); file-path ownership check; private bucket + MIME allow-list; self-approval guards; audit logs use correct `actor_id/new_data`. 🔧 RLS unified to `is_super_admin()`. |
| **4. Osusu Groups** | ✅ | `create_osusu_group` / invite-code RPCs; `is_super_admin()`-style SECURITY DEFINER helpers avoid RLS recursion. |
| **5. Contributions** | ✅ | `submit_contribution` / period generation RPCs + trigger; uniqueness enforced server-side. Frontend does not set `status`. |
| **6. Savings Goals** | ✅ | Enum mapping handled; deposits via RPC; progress server-side. (`savingsService.select('*')` → see F3.) |
| **7. Vault** | ✅ | Ledger-derived balance; `initiate_vault_topup` + webhook verification; withdrawals gated. No direct balance writes from client. |
| **8. Monime Payments** | ✅ 🔧 | HMAC `Monime-Signature` verified in both webhooks; re-verify via Monime API before crediting; dedupe via `payment_webhook_events` (23505); webhook always 200. Secrets only in `supabase/functions/_shared/monime.ts`. 🔧 QMoney removed from selectable methods. |
| **9. Payouts** | ✅ | `request_payout` / approve / reject RPCs; status transitions + approver-≠-requester enforced server-side; audit logged. |
| **10. Collectors** | ✅ 🔧 | Assigned-contributor reads via RPC; physical collection via `record_physical_collection` with idempotency key. 🔧 fixed offline-fallback shape. |
| **11. Notifications** | ✅ | `send-notification` edge function; templated. (`notificationService.select('*')` feed → see F3.) |
| **12. Super Admin** | ✅ | Separate `apps/admin/` Next.js app; server-side service-role only (never shipped to browser); metrics via RPC/views; actions audit-logged. |
| **13. Audit Logs** | ✅ | `actor_id, action, table_name, record_id, new_data, created_at`; written inside SECURITY DEFINER RPCs; immutable to normal users via RLS. |

---

## 4. Files changed

| File | Change |
|---|---|
| `src/store/appDataStore.ts` | Remove `qmoney` from `MobileMoneyNetwork` |
| `src/services/paymentMethodLinks.ts` | Remove `qmoney` from method list / labels / guard |
| `app/(send)/detail.tsx` | Remove `qmoney` from send-flow method list + logo map |
| `app/components/payment-methods.tsx` | Remove `qmoney` logo entry |
| `src/services/collectorService.ts` | Remove stray `period` field in offline fallback |
| `vitest.config.ts` | Collect `src/**/*.test.ts` |
| `src/utils/validation/__tests__/auth.test.ts` | Fix import path + 254-char boundary test |
| `__tests__/security/advancedAttackSurface.test.ts` | Repoint to live snapshot; correct audit/RLS assertions |
| `__tests__/mocks/{async-storage,expo-secure-store,react-native}.ts` | `import { vi }` |
| `__tests__/unit/googleOAuth.test.ts` | Type-cast OAuth mock results |
| `__tests__/unit/vaultWithdrawal.test.ts` | Type-cast mock handle |
| `scripts/test-privilege-escalation.ts` | Cast via `unknown` |
| `supabase/prompt11_kyc_rls_user_roles_alignment.sql` | **New** — KYC RLS alignment migration (applied) |
| `supabase/_live_snapshot/canonical_security_objects.sql` | **New** — verified snapshot of deployed security objects |
| `docs/code-quality-and-performance-audit.md` | **New** — this report |

---

## 5. Phase-10 final report

1. **Files changed:** 15 (see §4).
2. **Bad methods found:** type drift (QMoney), dead field (collector fallback), split-source authorization (KYC RLS), tests bound to an archived/broken migration, an orphaned test suite, red typecheck. Plus documented findings F1–F3.
3. **Good methods implemented:** single canonical authorization source (`is_super_admin()`/`user_roles`); tests assert the live deployed schema via a committed snapshot; strict-validation suite activated in CI; consistent payment-method type set.
4. **Performance improvements:** none required at the algorithmic level this pass (no O(n²) hot loops found in changed code); documented `select('*')`→projection + pagination as F3.
5. **Security improvements:** KYC admin authorization unified and made consistent with the canonical role table (Issue 3); security tests now defend the correct audit schema and RLS pattern (Issue 4).
6. **Database constraints added:** none this pass (existing money columns already use `*_minor bigint CHECK > 0`; uniqueness on contribution/period and provider reference already present).
7. **Indexes added:** none this pass (recommended: confirm/extend composite indexes per F3 + Phase 3 list).
8. **RPC functions added:** none (existing RPC coverage is comprehensive).
9. **Edge Functions changed:** none (webhook verification already correct).
10. **Tests added/activated:** 106-test auth suite activated; 11 security tests corrected; +117 net executing tests.
11. **Test results:** `tsc --noEmit` 0 errors; **vitest 629/629 passing across 19 files**; live-DB policy verification passed.
12. **Remaining risks:**
    - Error-handling standardization (F1) not yet applied across all call sites.
    - `anon` EXECUTE on SECURITY DEFINER RPCs + 4 mutable search-path functions (F2) — WARN-level hardening outstanding.
    - `select('*')` projection/pagination cleanup (F3).
    - Admin MFA enforcement should be verified at the auth-provider level (not visible in code).
13. **Recommended next refactor (priority order):** (a) F2 anon-EXECUTE lockdown + search-path; (b) F1 structured error result type; (c) F3 projections/pagination + index review; (d) regenerate `canonical_security_objects.sql` into a real CI step that diffs against the live DB.
14. **Production readiness:** **~88%.** Core financial logic is backend-enforced, RLS is on everywhere (0 ERROR advisors), payments are Monime-verified server-side, secrets are server-only, and the build is green. The remaining 12% is hardening (F1–F3) and operational verification (admin MFA, CI gates), not architectural rework.

---

## 6. Completion checklist

| Requirement | Status |
|---|---|
| All tests pass | ✅ 629/629 |
| No service-role key in frontend | ✅ verified (`src/`+`app/` clean) |
| No financial logic trusted from frontend | ✅ balances/fees/status server-side |
| No raw Supabase errors shown to users | ⚠️ largely (generic mapping); F1 hardening recommended |
| Signup & login validation strict | ✅ zod + activated tests |
| Payments Monime-verified server-side | ✅ HMAC + API re-verify + dedupe |
| Admin access server-side verified | ✅ `is_super_admin()` / service-role server only |
| RLS remains enabled | ✅ 0 ERROR advisors; all KYC tables RLS-on |
| Critical operations audit logged | ✅ `actor_id/new_data` inside RPCs |

---

## 7. Verified-good baseline

Confirmed during the audit (no change needed):

- **No secrets in the client.** No `service_role` key or Monime secret in `src/`/`app/`. Monime secrets live only in `supabase/functions/_shared/monime.ts` and the two webhook functions.
- **Webhook security.** `mobile-money-webhook` and `vault-webhook` verify `Monime-Signature`, re-verify via the Monime API before crediting, dedupe via `payment_webhook_events` (unique-violation `23505` → `already_processed`), and always return HTTP 200 to prevent retry storms.
- **Profile immutability.** `trg_protect_profile_immutable` blocks direct user updates to `role`, `kyc_status`, `is_active`, `kyc_verified`, `status` — role injection is not possible from the client.
- **Role source.** `get_my_role()` and `is_super_admin()` read `user_roles` (not JWT metadata, not local storage).
- **Admin app isolation.** Super-admin features live in a separate `apps/admin/` Next.js app using a server-side service-role client; nothing privileged ships to the browser.

> **Snapshot maintenance:** `supabase/_live_snapshot/canonical_security_objects.sql` is a verified copy of the deployed KYC/profile-protection objects as of 2026-06-03. Regenerate it (via `pg_get_functiondef`/`pg_policies`) whenever those objects change so the security tests keep asserting reality.
