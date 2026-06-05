# Mi Osusu — Complete Security, Payment & Quality Audit

**Date:** 2026-06-03 · **Auditor:** Claude Code + TestSprite MCP · **Scope:** Full app (Expo mobile/web frontend, Next.js admin, Supabase backend, Edge Functions, RLS, Monime payments) · **Posture:** Strict fintech review.

---

## A. TESTSPRITE MCP STATUS

- **Connected:** ✅ Yes. `testsprite_check_account_info` returned account *Osman Abass Kamara* (osmanabasskay@gmail.com), Starter plan, 550 credits.
- **TestSprite tools used:**
  1. `testsprite_check_account_info` — connection confirmed.
  2. `testsprite_generate_code_summary` — produced `testsprite_tests/tmp/code_summary.yaml`.
  3. `testsprite_generate_standardized_prd` — produced standardized PRD.
  4. `testsprite_bootstrap` — registered project path + port 3000, production mode.
  5. `testsprite_generate_frontend_test_plan` — **26 frontend test cases** (`testsprite_tests/testsprite_frontend_test_plan.json`).
  6. `testsprite_generate_backend_test_plan` — **not produced**: tool requires a `backend`-typed project; returned a constraint error. Backend covered by code inspection.
  7. `testsprite_generate_code_and_execute` — executed a curated, non-mutating subset (TC002, TC009) against the served build.
- **Generated:** 26-case frontend plan + standardized PRD + code summary.
- **Executed:** TC002 (login), TC009 (password reset).
- **Passed:** 0 · **Failed:** 0 · **Blocked:** 2.
- **Could not be tested via TestSprite browser automation:** All backend security (RLS, Edge Functions, webhook idempotency, RPC authority), admin dashboard (separate Next.js app, not in the Expo web build), and any auth-gated flow (no test credentials; production backend). These were assessed by source inspection.
- **Setup problems found:**
  - Previous run: 100% blocked by missing SPA fallback (404 on sub-routes). **Now fixed** (`dist/serve.json`).
  - This run: 100% blocked by **blank client render** — (a) plan used `/auth/login` but route groups make it `/login`; (b) a 5s blocking splash overlay on every load.
  - No `LOGIN_USER`/`LOGIN_PASSWORD` configured.
  - Build is wired to **production Supabase** → unsafe to run mutating E2E.

---

## B. EXECUTIVE SUMMARY

> Scores are deliberately strict for a fintech app. The backend security architecture is genuinely strong; scores are held back by unverified-at-runtime controls, SQL/RPC drift, the web render/test blocker, and the absence of an executable test pipeline.

| Dimension | Score (0–100) | Basis |
|---|---|---|
| **Security** | **72** | Strong server-authoritative design, DB-role checks, signed+deduped webhooks, private KYC storage. Held back by: web session in localStorage, multiple overlapping/possibly-divergent SQL definitions, controls not runtime-verified, committed API key. |
| **Production readiness** | **45** | Web build does not render in a clean automated browser; no executable test pipeline; production/staging separation unclear; payment E2E unproven. |
| **Code quality** | **63** | Clean thin-client service layer, good typing and validation. Held back by duplicated `getDbRole`, overlapping SQL files, RPC signature drift, deprecated web imports. |
| **Scalability** | **62** | Sensible RPC aggregation + indexes in spec. Risks: N+1 profile fetches in group lists, no verified pagination on admin tables, 4.5 MB web bundle. |
| **User-flow** | **40** | Could not be verified end-to-end (render blocker). Validation logic is solid in code. |
| **Safe for production?** | **NOT YET** | Resolve launch blockers (§G) and achieve a green E2E run on staging first. |

### Top 10 most serious risks
1. **No executable end-to-end test pipeline** — every prior TestSprite run is 100% blocked; payment/withdrawal correctness is unproven at runtime (only code-reviewed). *(High)*
2. **Web build renders blank in clean browsers** — 5s blocking splash + route-group URL confusion. Real users on some web contexts may see a blank screen. *(High)*
3. **Web session tokens in `AsyncStorage`/localStorage** — XSS-exfiltratable, unencrypted at rest on web. *(High)*
4. **SQL/RPC drift** — multiple definitions of core money RPCs (e.g., `initiate_group_payment` with two different signatures); the deployed version is ambiguous from the repo. *(High)*
5. **Build points at production Supabase with baked-in keys** — no clear staging separation; testing risks polluting production. *(High)*
6. **Idempotency of admin "approve withdrawal" not provable from repo** — double-approval safety depends on `approve_withdrawal_request` status guard, which must be confirmed. *(High)*
7. **No server-side MIME/size limits on storage buckets** — KYC/avatars buckets created without `allowed_mime_types`/`file_size_limit`; only client-side validation. *(Medium)*
8. **Committed TestSprite API key** in `testsprite_tests/tmp/config.json`. *(Medium)*
9. **Admin service-role client** must be provably server-only (`server-only` guard) to avoid bundling the service key. *(Medium)*
10. **Currency unit consistency** — Monime uses `SLE` minor units; Flutterwave fallback uses `SLL`; display uses `NLe`. Mixed units are a classic source of value bugs. *(Medium)*

---

## C. SEVERITY TABLE

### 🔴 Critical
*(None confirmed exploitable from source. The architecture blocks the usual fintech criticals. Items below are High because they are either unverified at runtime or materially raise risk.)*

### 🟠 High
| ID | Title | Area | File(s) | Description | Failure/Exploit scenario | Impact | Fix | Effort | Before launch? |
|---|---|---|---|---|---|---|---|---|---|
| H-1 | No runnable E2E pipeline | Testing | `dist/`, `testsprite_tests/` | All TestSprite runs blocked; payment/withdrawal/RLS unproven at runtime | Logic regressions ship unnoticed | Undetected money bugs | Staging Supabase + sandbox Monime + seeded users; fix render blocker; re-run | M | ✅ |
| H-2 | Web renders blank | Frontend/UX | `app/_layout.tsx`, `app/components/SplashAnimation.tsx` | 5s blocking splash + `(auth)` route-group URL confusion | User/automation sees blank white screen | Onboarding loss; blocks testing | Skip/curtail splash on web; non-blocking; document `/login` URLs | S | ✅ |
| H-3 | Web session in localStorage | Auth/Session | `src/services/supabase.ts:54` | On web, Supabase tokens stored in AsyncStorage→localStorage (unencrypted, XSS-readable) | XSS steals session → full account takeover | Account takeover on web | Strict CSP; consider sessionStorage/httpOnly cookie relay; treat web as higher-risk | M | ✅ (if web ships) |
| H-4 | SQL/RPC drift | DB/Maintainability | `supabase/*.sql`, `_live_snapshot/`, `_archive_stale_pre_refactor/` | Multiple definitions of money RPCs; `initiate_group_payment` exists with two different signatures | Wrong/stale version deployed; amount-validation bypass if a lax version is live | Payment integrity uncertainty | Establish one canonical migration set; delete/clearly-quarantine archives; verify live DB matches | M | ✅ |
| H-5 | Withdrawal double-approval unproven | Payments | `supabase/functions/approve-withdrawal/index.ts`, `approve_withdrawal_request` RPC | Edge fn relies on RPC to guard re-approval/double-debit; RPC body not confirmed in repo | Double payout if RPC lacks status/lock guard | Direct financial loss | Confirm RPC checks status='pending' + row lock + idempotency; add test | S–M | ✅ |
| H-6 | Production backend in build | Env/Release | `app.config.js`, `.env`, `dist/` | Web build embeds production Supabase keys; no staging split | Tests/users hit production; data pollution | Operational + data-integrity risk | Separate staging project + env; rebuild for test | M | ✅ |

### 🟡 Medium
| ID | Title | Area | File(s) | Description | Fix | Before launch? |
|---|---|---|---|---|---|---|
| M-1 | No server-side file type/size limits | Storage | `supabase/setup_storage.sql` | Buckets created without `allowed_mime_types`/`file_size_limit`; only client checks | Set bucket limits + validate content-type server-side | ✅ |
| M-2 | Committed TestSprite API key | Secrets hygiene | `testsprite_tests/tmp/config.json` | `sk-user-…` key under VCS | Git-ignore `testsprite_tests/tmp/`; rotate key | ✅ |
| M-3 | Admin service-role bundling risk | Admin | `apps/admin/lib/supabase/service.ts` | Service key client must be server-only | Add `import 'server-only'`; verify never imported by client component | ✅ |
| M-4 | Currency unit mixing | Payments | `supabase/functions/_shared/monime.ts`, `approve-withdrawal` (Flutterwave `SLL`) | NLe display / SLE minor units / SLL on FW fallback | Centralize currency+minor-unit conversion; assert ISO per provider | ◻ |
| M-5 | `confirmedAmount` fallback to client value | Payments | `initiate-payment/index.ts:154` | `Number(rpc.amount ?? body.amount)` — fallback to client amount | Require server amount; reject if absent (RPC already rejects mismatches, so impact is limited) | ◻ |
| M-6 | Duplicate `getDbRole` | Maintainability | `_shared/auth.ts` + `approve-withdrawal/index.ts` | Two impls risk divergence | Import the shared one | ◻ |
| M-7 | Error messages leak internal architecture | Info disclosure | `approve-withdrawal` (QMoney/Monime text) | Provider/flow details in responses | Generic client message; detail to server logs | ◻ |

### 🟢 Low / Informational
| ID | Title | Notes |
|---|---|---|
| L-1 | Deprecated `Clipboard` import from `react-native` | `app/(main)/vault.tsx` — use `expo-clipboard`; deprecated API can be undefined on web |
| L-2 | 4.5 MB web JS bundle | Code-split / lazy-load heavy screens |
| L-3 | `getDbRole` selects `kyc_verified/kyc_status` but doesn't use them | Dead select |
| L-4 | Stale config path (`MegaSafe`) in TestSprite config | Cleaned by re-bootstrap |
| L-5 | N+1 profile fetch pattern in group/member listing | `groupService.ts` batches by IDs — acceptable now, watch at scale |

---

## D. FEATURE-BY-FEATURE RESULT

| Feature | Score | Findings |
|---|---|---|
| Authentication | 70 | Strong Zod validation; network-verified `getUser()`; lockout fields exist. Web token storage (H-3); E2E unverified. |
| Signup | 68 | Robust client validation (phone +232, age ≥18, password policy, injection guards). Privileged fields not sent from client (good). Not runtime-verified. |
| Login | 65 | Email/phone detection + validation. Render blocker prevented E2E. |
| OTP | 55 | Resend timer in UI; server expiry not verified at runtime. |
| User profile | 65 | RLS-scoped reads; profile bootstrap via RPC. |
| KYC | 70 | Private bucket, per-user folder RLS, server-side `kyc_verified` gate. Missing bucket MIME/size limits (M-1). |
| Vault | 75 | Server-authoritative balances (posted/reserved/available); idempotent RPCs; topup via signed webhook. |
| Savings | 74 | Owner-scoped; server validates balance on withdrawal; idempotent deposits. |
| Osusu groups | 70 | `create_osusu_group` atomic + audited; member/amount validation server-side. |
| Contributions | 72 | Amount re-validated vs `contribution_amount`; duplicate-per-period guard; rate-limited. |
| Payments | 73 | USSD Payment Codes; provider secrets server-only; poll is display-only. Amount fallback (M-5); unit mixing (M-4). |
| Withdrawals | 60 | Admin DB-role gate; rejection reason required. Double-approval guard unproven (H-5). |
| Monime integration | 76 | Correct provider IDs (m17/m18), QMoney rejected, re-verify before credit, idempotency keys. |
| Webhooks | 82 | HMAC-SHA256 constant-time, dedup UNIQUE, API re-verification, always 200. Strongest area. |
| Notifications | 60 | Per-user; best-effort dispatch; body avoids deep PII (shows amount). |
| Admin dashboard | 68 | Server-side `requireSuperAdmin` from `user_roles`, suspends inactive/banned. Verify service-only (M-3); not E2E-tested. |
| Reports/exports | 50 | Present in admin app; data-minimization + injection-safe query building unverified. |
| Settings | 60 | 2FA/change-password screens present; not E2E-verified. |
| Navigation | 45 | Route-group URL confusion; splash blocks first paint (H-2). |
| Storage | 66 | Private KYC bucket + per-user RLS. Missing server file-type/size limits (M-1). |
| Database/RLS | 70 | RLS enabled across sensitive tables; SECURITY DEFINER + `SET search_path`. Drift (H-4); not live-verified. |
| Edge Functions | 75 | Auth + KYC + role checks server-side; secrets in `Deno.env`; clean error shapes mostly. |
| UI/UX | 45 | Unverified due to render blocker. |
| Performance | 62 | RPC aggregation good; bundle size + potential admin pagination gaps. |
| Code structure | 63 | Clean separation; SQL/RPC drift + duplication drag it down. |

---

## E. ATTACK SIMULATION REPORT

> E2E attacks could not be executed (render blocker + no creds + production backend). Each below is assessed against the code; "Result" = code-review verdict, not a live exploit. Items marked *VERIFY* need a live staging run.

| Attack | Code-review result | Risk | Required action |
|---|---|---|---|
| Inject `role:"super_admin"` at signup | Mitigated — roles come from `user_roles`; signup can't set it; admin checks read DB | Low | VERIFY no DB trigger copies `raw_user_meta_data.role` |
| Update own `profiles.role`/`kyc_verified`/`is_active` from client | Mitigated — writes go through RPCs; RLS should forbid these columns | Low | VERIFY UPDATE RLS excludes privileged columns |
| Access `/admin` as normal user / logged-out | Mitigated — `requireSuperAdmin` redirects | Low | VERIFY middleware + every admin data fn |
| Member reads another user's vault/savings/KYC/payments | Mitigated — RLS by `auth.uid()`/owner; KYC per-user folder | Low–Med | VERIFY RLS live with two users |
| Tamper payment amount in request | Mitigated — `initiate_group_payment` rejects amount ≠ contribution_amount | Low | VERIFY deployed RPC version (H-4) |
| Negative/zero/huge amount | Mitigated — `p_amount <= 0` rejected; positive check in edge fn | Low | VERIFY upper bounds/precision |
| Replay Monime webhook | Mitigated — dedup UNIQUE(provider,session_id,event_type) | Low | VERIFY constraint live |
| Forge webhook without signature | Mitigated — HMAC verify, skip if invalid | Low | VERIFY `MONIME_WEBHOOK_SECRET` set in prod |
| Webhook correct ref / wrong user | Mitigated — finalize RPC binds to stored txn | Low | VERIFY RPC mapping |
| Double-click payment confirm | Mitigated — idempotency key | Low | VERIFY |
| Approve same withdrawal twice | **UNPROVEN** — depends on RPC status guard | High | CONFIRM `approve_withdrawal_request` guards status + locks (H-5) |
| Withdraw above balance | Mitigated — server validates available balance | Low–Med | VERIFY |
| User approves own withdrawal | Mitigated — admin DB-role required | Low | VERIFY admin can't self-approve policy |
| Upload executable renamed as image to KYC | **Partially open** — no server MIME/size limit (M-1) | Med | Add bucket limits + server content check |
| Steal web session via XSS | **Open on web** — localStorage tokens (H-3) | High | CSP + storage hardening |

---

## F. BUG REPORT

| Bug ID | Feature | Repro | Expected | Actual | Root cause | Fix |
|---|---|---|---|---|---|---|
| BUG-1 | Web render | Open `http://localhost:3000/` in a clean browser/automation; snapshot within 5s | App/auth UI visible | Blank white viewport; 0 interactive elements | 5s blocking splash overlay restarts each load (`_layout.tsx` + `SplashAnimation` `setTimeout(onDone,5000)`) | Skip splash on web or make non-blocking + ~1s |
| BUG-2 | Routing/docs | Navigate to `/auth/login` | Login screen | Unmatched route → blank | `(auth)` is an Expo Router group; real URL is `/login` | Document canonical URLs; consider redirect from `/auth/login` |
| BUG-3 | Payments (latent) | Call `initiate-payment` when RPC omits `amount` | Use server amount | Falls back to `body.amount` | `Number(rpc.amount ?? body.amount)` | Require server amount (impact limited: RPC rejects mismatches) |
| BUG-4 | DB | Inspect repo for `initiate_group_payment` | One definition | Two signatures across files | SQL drift | Canonicalize migrations (H-4) |
| BUG-5 | Web util | Use copy-to-clipboard on vault | Copies value | `Clipboard` from `react-native` deprecated/undefined on web | Wrong import | Use `expo-clipboard` |

---

## G. REQUIRED FIXES BEFORE LAUNCH (blocker checklist)

**Security blockers**
- [ ] H-3 Harden web session storage (CSP at minimum) or restrict to native.
- [ ] M-1 Set `allowed_mime_types` + `file_size_limit` on `kyc-documents`/`avatars`; server-side content validation.
- [ ] M-2 Remove/rotate committed TestSprite API key; git-ignore `testsprite_tests/tmp/`.
- [ ] M-3 Confirm admin service-role client is server-only.

**Payment blockers**
- [ ] H-5 Prove `approve_withdrawal_request` is idempotent (status guard + row lock).
- [ ] M-5 Remove client-amount fallback in `initiate-payment`.
- [ ] M-4 Centralize currency/minor-unit handling (SLE vs SLL vs NLe).

**KYC blockers**
- [ ] Confirm UPDATE RLS forbids client changes to `kyc_status`/`kyc_verified`.

**Database blockers**
- [ ] H-4 Establish a single canonical migration set; verify the live DB matches; quarantine archives.

**Admin blockers**
- [ ] Verify admin RLS/role on every data function + middleware; verify exports minimize PII.

**User-flow / Frontend blockers**
- [ ] H-2/BUG-1/BUG-2 Fix web render (splash + URLs).

**Performance blockers**
- [ ] Confirm pagination on admin tables; code-split web bundle.

**Test pipeline blocker**
- [ ] H-1/H-6 Stand up staging Supabase + sandbox Monime + seeded role users; green TestSprite run.

---

## H. CODE-LEVEL FIX PLAN (safe ordering)

> Per your fixing rule, **only small/safe cleanups** are proposed for auto-apply. Auth/payment/RLS/webhook/withdrawal/KYC changes are **report-only pending your approval**.

**Safe to auto-apply now (with your go-ahead):**
1. `app/(main)/vault.tsx` — replace `import { Clipboard } from 'react-native'` with `expo-clipboard`. *(BUG-5/L-1)*
2. `.gitignore` — add `testsprite_tests/tmp/`; remove the committed key from VCS. *(M-2; key rotation is yours)*
3. `app/_layout.tsx` / `SplashAnimation` — gate splash behind `Platform.OS !== 'web'` or reduce to ~1s and render underlying UI immediately. *(H-2 — UX only, no auth logic)*
4. `supabase/functions/approve-withdrawal/index.ts` — import `getDbRole` from `_shared/auth.ts` instead of the local copy. *(M-6 — small, but touches admin auth → I will WAIT for approval.)*

**Report-only — needs your approval (do NOT auto-change):**
- `initiate-payment` amount fallback (M-5) · withdrawal idempotency (H-5) · SQL/RPC canonicalization (H-4) · storage bucket limits/RLS (M-1) · web session storage (H-3) · any RLS policy.

For each, after approval: change → re-deploy function/migration to **staging** → run the matching TestSprite case + a targeted RLS/webhook script → confirm green.

---

## I. RECOMMENDED AUTOMATED TESTS

**Unit (Vitest)** — extend existing `src/utils/validation/__tests__`:
- Amount/minor-unit conversion (NLe↔SLE), boundary + precision.
- Phone normalization edge cases; password blocklist; DOB age boundaries.

**Integration (RPC, on staging)**
- `initiate_group_payment`: rejects amount ≠ contribution_amount; idempotency replays.
- `pay_osusu_from_vault` / `deposit_savings_from_vault`: insufficient-balance + idempotency.
- `approve_withdrawal_request`: double-approval is a no-op; above-balance rejected.

**RLS tests (two users + service role)** — `npm run test:rls` style:
- Cross-user read denial on profiles/vault/savings/contributions/notifications/KYC objects.
- Privileged-column UPDATE denial (role/kyc/is_active/status/balance).

**Webhook tests (backend)**
- Valid signature settles once; replay no-ops; bad signature ignored (still 200); wrong-user reference safe.

**E2E (TestSprite, staging + seeded creds)**
- The 26 generated cases, starting with TC002/TC009, then KYC, group create/join, vault top-up, savings, withdrawal.

**Admin (Next.js)**
- Non-admin/logged-out `/admin` redirect; self-approval blocked; export PII minimization.

---

## J. FINAL RECOMMENDATION

- **Can it launch now?** **No — not yet.** The backend security *design* is strong, but no flow has been proven at runtime, the web build doesn't render in clean automation, and several money-path guarantees (withdrawal idempotency, deployed RPC version) are unverified.
- **Fix first (in order):** (1) web render blocker; (2) stand up staging + seeded creds and get a green E2E run; (3) confirm withdrawal idempotency + canonical RPCs; (4) web session hardening + storage limits + secret hygiene.
- **After MVP:** currency centralization, error-message hygiene, `getDbRole` dedup, bundle code-splitting.
- **Monitor post-launch:** webhook dedup hit-rate & signature failures; withdrawal approvals vs payouts reconciliation; failed-login lockouts; audit-log completeness on every financial action; Monime payout failures.
- **Scale later:** admin table pagination/indexes; reduce N+1 profile fetches; cache role lookups.
