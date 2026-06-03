# Mi Osusu — Project Reorganization Completed (Phase 15)

**Date:** 2026-06-03 · **Branch:** `MegaSafe2.1`
**Scope executed:** Targeted cleanup (low-risk steps). The large monorepo move
of the Expo app into `apps/mobile/` was **intentionally deferred** (see §14–15).

## 1. Final folder structure (top level)

```
mi-osusu/ (dir on disk: MegaSafe/)
├─ app/                  Expo Router routes (auth, groups, kyc, main, send, settings, components)
├─ src/                  App source: api/ services/ store/ utils/ components/ hooks/ theme/ types/
├─ apps/admin/           Next.js Super Admin dashboard (separate app, server-side service-role)
├─ supabase/             Backend: SQL scripts, functions/, tests/, _archive_stale_pre_refactor/
├─ assets/               icons/splash + home-hero/ signup-intro/ logos/mi-osusu/ payment-providers/
├─ docs/                 architecture/ security/ design/ design/mockups/ prompts/
├─ scripts/              security/RLS audit + maintenance scripts
├─ __tests__/            unit/ + security/ + mocks/
├─ archive/              old-assets/ unused-candidates/   (recoverable, not deleted)
├─ coverage/ dist/       build output (gitignored)
└─ standard root files   package.json, app.json, app.config.js, babel/metro/tailwind/tsconfig,
                         vitest.config.ts, nativewind-env.d.ts, .gitignore, .gitattributes,
                         .env.example, .mcp.json
```

The repo root no longer contains any loose images, logos, design files, or docs.

## 2. Files moved

**Docs → `docs/` (history preserved via `git mv`):**
| From | To |
|---|---|
| `CLAUDE1.md` | `docs/prompts/claude-build-notes.md` |
| `DESIGN.md` | `docs/design/design-notes.md` |
| `UI DESIGN SYSTEM RULES.txt` | `docs/design/ui-design-system-rules.md` |
| `Mi_Osusu_Complete_Build_Guide.md` | `docs/architecture/mi-osusu-complete-build-guide.md` |
| `stitch_osusu_onboarding_and_authentication/` (28 mockups) | `docs/design/mockups/` |
| `docs/auth-security-audit.md` | `docs/security/auth-security-audit.md` |
| `docs/super-admin-risk-dashboard-audit.md` | `docs/security/super-admin-risk-dashboard-audit.md` |

**Assets → `assets/` subfolders (require() paths updated):**
| From | To |
|---|---|
| `Orange Money logo.png` | `assets/payment-providers/orange-money.png` |
| `AfriMoney Logo.png` | `assets/payment-providers/afrimoney.png` |
| `Qmoney logo.png` | `assets/payment-providers/qmoney.png` |
| `assets/Mi Osusu Logo.png` | `assets/logos/mi-osusu/mi-osusu-logo.png` |

## 3. Files archived (recoverable, not deleted)

- `archive/old-assets/mi-osusu-logo-duplicate.png` — exact dup of the kept logo
- `archive/unused-candidates/orange-money-logo-1.svg`
- `archive/unused-candidates/qmoney-logo-landscape-1.svg`
- `archive/unused-candidates/unnamed-1.webp`

See `unused-files-report.md` for the full rationale per file.

## 4. Files deleted

- `lib/validation/kyc.ts` — single confirmed 0-byte dead file (canonical version
  is `src/utils/validation/kyc.ts`). Recoverable from git history.
- Empty husk directories removed: `hooks/`, `constants/`, `convex/`.

## 5. Import paths updated

- 4 files had payment-logo `require()`s repointed to `assets/payment-providers/`:
  `app/(groups)/collector.tsx`, `app/(main)/vault.tsx`, `app/(send)/detail.tsx`,
  `app/components/payment-methods.tsx`.
- `app/welcome.tsx` repointed to `assets/logos/mi-osusu/mi-osusu-logo.png`.
- Verified: **zero** remaining references to the old asset paths; all new paths
  resolve to files that exist on disk.
- No source imports referenced the removed husk dirs (the lib/→src/ migration was
  already complete in the working tree).

## 6. Config files

- All mobile config kept at root (app is **not** relocated): `app.json`,
  `app.config.js`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`,
  `tsconfig.json`, `vitest.config.ts`, `nativewind-env.d.ts`.
- `tsconfig.json` improved: added `@/*` → `src/*` path alias (Expo-native), and
  excluded `supabase/functions` (Deno), `dist`, `coverage` from the app typecheck.
- Admin config remains self-contained in `apps/admin/`.

## 7. Asset folders created

`assets/logos/mi-osusu/`, `assets/payment-providers/`
(existing `assets/home-hero/`, `assets/signup-intro/` retained).

## 8. Supabase files

**Intentionally left as-is.** Investigation found Supabase is **not** Supabase-CLI
managed (no `config.toml`, no `migrations/` dir) — the `.sql` files are manual,
order-dependent scripts. Crucially, several filenames are part of the app's
runtime contract: `src/services/backendErrors.ts` instructs operators to run
`supabase/core_platform_bootstrap.sql`, `supabase/phase2_storage.sql`, etc., and
`apps/admin/lib/security.ts` + deployment docs reference exact paths. Renaming or
moving them would break those instructions for zero functional gain and risk
desyncing a possibly-deployed database. Functions are already organized under
`supabase/functions/`; stale SQL already sits in
`supabase/_archive_stale_pre_refactor/`.

## 9. Documentation organized

All guides, prompts, design notes, and mockups now live under `docs/`
(`architecture/`, `security/`, `design/`, `design/mockups/`, `prompts/`).
Audit + cleanup reports produced this phase: `project-cleanup-audit.md`,
`unused-files-report.md`, `brand-name-cleanup-report.md`,
`secrets-audit-report.md`, and this file.

## 10. Brand name cleanup

Already complete in code — no literal "MegaSafe" remains in app/src/admin source.
`MSF-` group-code prefix kept for DB compatibility. Full detail in
`brand-name-cleanup-report.md`.

## 11. Security cleanup

No hardcoded secrets in tracked files; real `.env` files gitignored; admin
service-role key is server-side only. `.gitignore` hardened; committed
`apps/admin/.next/` build artifacts removed from tracking. Detail in
`docs/security/secrets-audit-report.md`.

## 12. Tests run

| Check | Result |
|---|---|
| `tsc --noEmit` | 20 errors — **all pre-existing** (vitest globals not in tsc scope; `qmoney`/`period` type-union bugs; one wrong relative import in a test). The reorganization introduced **none**; excluding Deno functions removed ~8 prior false errors. |
| `vitest run` | **512 / 523 tests pass**, 17/18 files pass. The 11 failures are all in `__tests__/security/advancedAttackSurface.test.ts`, which reads `supabase/prompt8_security_hardening_v2.sql` — a file deliberately archived to `_archive_stale_pre_refactor/` **before** this cleanup. Pre-existing and unrelated to reorganization. |
| Expo bundle (`expo start`) | **Not run in this environment.** Asset moves verified by path existence + grep; recommend a quick `npx expo start` smoke test before release. |

## 13. Errors found (pre-existing, out of cleanup scope)

1. `advancedAttackSurface.test.ts` reads archived `prompt8_security_hardening_v2.sql`
   (and `prompt9`) from `supabase/` → 11 failing assertions. The test is stale;
   per project memory those guarantees moved to the `user_roles` model. **Fix the
   test path (or assertions), not the structure.**
2. `qmoney` is used as a `SupportedPaymentMethod` in `app/(send)/detail.tsx`,
   `src/services/paymentMethodLinks.ts`, but the type union excludes it → type
   errors. Decide whether QMoney is supported and update the union accordingly.
3. `src/utils/validation/__tests__/auth.test.ts` imports `../../services/auth/phone`
   (resolves to `src/utils/services/...`, wrong) — should be `../../../services/...`.
4. Vitest globals (`vi`) aren't visible to `tsc` — add `"types": ["vitest/globals"]`
   or include vitest config types so the test mocks typecheck.

## 14. Remaining cleanup tasks (deferred by chosen scope)

- **Monorepo move**: relocate the Expo app into `apps/mobile/` and add a root
  workspace `package.json` with `dev:mobile` / `dev:admin` scripts. Breaking;
  needs entry-point, Metro, NativeWind `./app/global.css`, and EAS reconfig plus
  full end-to-end retest. Recommended as its own dedicated effort.
- **`packages/shared/`**: extract shared constants/types/validation once the
  mobile and admin apps need to share code (not currently required).
- **Convex teardown**: remove `.convex/` cache and the `convex` entry in
  `.mcp.json` if Convex is permanently abandoned.
- **Incremental `@/` alias adoption**: new/edited files should use `@/…` imports;
  optionally codemod existing relative imports later.

## 15. Recommendations for future structure

1. Keep the **one-app-per-folder** boundary: mobile at root (or future
   `apps/mobile/`), admin in `apps/admin/`, backend in `supabase/`.
2. Consider migrating Supabase to **CLI-managed migrations** (`supabase init` +
   timestamped `migrations/`) for a real, ordered, deployable history — but do it
   as a deliberate migration, updating the `backendErrors.ts` path references.
3. Adopt feature-folders under `src/features/<feature>/` incrementally as features
   grow, rather than a big-bang move.
4. Fix the pre-existing typecheck/test issues in §13 to restore a green baseline.
5. Run `npx expo start` and a quick smoke test of login/home/savings/vault/groups/
   payments after pulling these changes.
