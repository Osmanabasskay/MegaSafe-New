# Mi Osusu — Project Cleanup Audit (Phase 1)

> **Status:** Audit only. Per the cleanup brief, **nothing has been moved or deleted** as part of this document. This is the read-only inventory and risk assessment that must precede any destructive change.
>
> **Date:** 2026-06-03
> **Branch:** `MegaSafe2.1`
> **App name:** Mi Osusu (formerly MegaSafe)
> **Stack:** Expo (SDK 54) + Expo Router, React Native 0.81, Supabase backend, Next.js admin dashboard (`apps/admin`), NativeWind/Tailwind, Zustand, React Query, Zod.

---

## 0. ⚠️ Headline risk — the working tree is mid-refactor and uncommitted

Before any cleanup, understand this: **a large reorganization is already in flight and has not been committed.** `git status` shows the HEAD (committed) layout and the working-directory layout disagree significantly:

| Old location (tracked at HEAD, **deleted on disk**) | New location (**untracked on disk**) |
|---|---|
| `lib/auth/`, `lib/groupService.ts`, `lib/profileService.ts`, `lib/storageUpload.ts`, `lib/profileName.ts`, `lib/supabase.ts` | `src/services/`, `src/services/auth/`, `src/services/supabase.ts`, `src/utils/profileName.ts` |
| `stores/*.ts` | `src/store/*.ts` |
| `components/kyc/KycProgress.tsx` | `src/components/kyc/KycProgress.tsx` |
| `types/group.ts` | `src/types/group.ts` |
| `App.tsx`, root `index.ts` | (removed — Expo Router uses `expo-router/entry`, correct) |
| `MegaSafe Logo.png`, `assets/MegaSafe Logo.png`, `Afrimoney.png`, `Qmoney-logo-white.png`, `Top Navigation Bar.png`, `Setting Sidebar Features.png`, `unnamed.png`, `unnamed.webp` | `Mi Osusu Logo.png`, `AfriMoney Logo.png`, `Orange Money logo.png`, `Qmoney logo.png`, `assets/Mi Osusu Logo.png` |
| `MegaSafe_Complete_Build_Guide.md` | `Mi_Osusu_Complete_Build_Guide.md` |

New untracked screens also exist: `app/(send)/`, `app/auth/callback.tsx`, `app/(groups)/chat/`, `app/(groups)/monime-payment.tsx`, `app/(groups)/assign-contributors.tsx`, `app/(groups)/physical-collect.tsx`, `app/components/SplashAnimation.tsx`, plus the entire new `src/api/` layer.

**Implication:** The `lib/ → src/`, `stores/ → src/store`, and MegaSafe→Mi Osusu brand rename described as goals in the brief are **already ~80% done on disk but never committed.** Layering more file moves on top of this uncommitted state is dangerous: if anything breaks, `git checkout`/`reset` cannot cleanly separate "the in-flight refactor" from "the new cleanup," and work can be lost.

**Recommendation (do this first):** Commit (or stash) the current in-progress refactor as a checkpoint *before* any further moves, so every subsequent step is individually reversible. This is called out again in §12 and in the proposed plan.

---

## 1. Current folders found (top level)

**Source / app:**
- `app/` — Expo Router routes (auth, groups, kyc, main, settings, send, components, auth/callback). **Active.**
- `src/` — consolidated source: `api/`, `services/`, `store/`, `utils/`, `components/`, `hooks/`, `theme/`, `types/`. **Active (new home).**
- `apps/admin/` — Next.js Super Admin dashboard. **Active, correctly separated.**
- `supabase/` — SQL migrations, Edge Functions, docs. **Active backend.**

**Leftover / empty-on-disk (contents already migrated to `src/`):**
- `lib/` (only `lib/validation/kyc.ts` remains), `stores/`, `components/`, `types/`, `hooks/`, `constants/` — **empty or near-empty husks** of the old structure.

**Build output / generated (should be ignored, not tracked):**
- `dist/` (41 files, Expo web export — gitignored ✓), `coverage/` (test output — **NOT gitignored ✗**), `apps/admin/.next/` (**was committed ✗**, now staged for deletion), `.expo/` (ignored ✓).

**Tooling / config:**
- `.agents/`, `.claude/`, `.codex/`, `.mcp.json`, `skills-lock.json` — AI/agent tooling caches.
- Backend is Supabase only.
- `__tests__/` (untracked unit/security tests), `testsprite_tests/` (only `tmp/mcp.log`).

**Design / docs:**
- `docs/` (2 audit md files so far), `stitch_osusu_onboarding_and_authentication/` (28 design mockups: HTML + PNG screens).

## 2. Current loose files in the root folder

| File | Type | Disposition |
|---|---|---|
| `AfriMoney Logo.png`, `Orange Money logo.png`, `Orange-Money-Logo-1.svg`, `Qmoney logo.png`, `QMoney-logo-landscape-1.svg` | Payment-provider logos | → `apps/mobile/assets/payment-providers/` (or `assets/payment-providers/`) |
| `Mi Osusu Logo.png` | Brand logo | → `assets/logos/mi-osusu/` |
| `unnamed (1).webp` | Unknown image | Inspect → archive if unused |
| `CLAUDE1.md` | AI build notes (113 KB) | → `docs/prompts/` or `archive/old-prompts/` |
| `DESIGN.md` | Design notes | → `docs/design/` |
| `UI DESIGN SYSTEM RULES.txt` | Design rules | → `docs/design/ui-design-system-rules.md` |
| `Mi_Osusu_Complete_Build_Guide.md` | Build guide (73 KB) | → `docs/architecture/` |
| `nativewind-env.d.ts` | TS ambient types | **Stays at root** (needed by TS) |
| `.env`, `.env.local` | Real secrets | **Stay, gitignored** (do not move/commit) |

## 3. Duplicate folders

- `lib/` (HEAD) vs `src/services/` + `src/utils/` — **migration duplicate** (old deleted on disk, new untracked). One canonical home: `src/`.
- `stores/` (HEAD) vs `src/store/` — same.
- `components/` (HEAD) vs `src/components/` — same.
- `types/` (HEAD) vs `src/types/` — same.
- `lib/validation/kyc.ts` (still on disk) vs `src/utils/validation/kyc.ts` — **true duplicate to reconcile.**
- Supabase is the only backend.
- `app/components/` (route-group screens like `profile`, `settings`, `notifications`) vs `src/components/` (reusable UI) — *not* a duplicate, but the naming is confusing; `app/components/` are actually screens.

## 4. Duplicate config files

No conflicting duplicates at root. Single copy each of `app.json`, `app.config.js`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `tsconfig.json`, `vitest.config.ts`. The admin app has its own `tsconfig.json`, `tailwind.config.ts`, `next.config.mjs`, `package.json` (correct). Root `tsconfig.json` already `exclude`s `apps/**/*` (correct separation).

## 5. Old MegaSafe files

- Project folder is still named `MegaSafe/` on disk (cosmetic; package name is already `mi-osusu`).
- `MegaSafe Logo.png`, `assets/MegaSafe Logo.png`, `MegaSafe_Complete_Build_Guide.md` — deleted on disk, superseded by Mi Osusu versions (uncommitted).
- `supabase/_archive_stale_pre_refactor/` already holds stale pre-refactor SQL (good precedent for an archive pattern).
- Brand string scan (`MegaSafe`/`megasafe`) across tracked code still pending until §10 (Phase 10) — to be run before replacing.

## 6. Old or unused images

- `unnamed.png`, `unnamed.webp` (deleted on disk), `unnamed (1).webp` (still present) — generic dumped images, likely unused → archive candidates.
- `Top Navigation Bar.png`, `Setting Sidebar Features.png` — admin/design screenshots (deleted on disk) → `docs/design/` or archive.
- `assets/MegaSafe Logo.png` — superseded brand asset → `archive/old-assets/`.

## 7. Provider logos found

`AfriMoney Logo.png`, `Orange Money logo.png`, `Orange-Money-Logo-1.svg`, `Qmoney logo.png`, `QMoney-logo-landscape-1.svg`. Provider set in code: Orange Money, AfriMoney, Monime (gateway), QMoney. **Verify which are actually imported** before moving; move the live ones to `assets/payment-providers/`, archive the rest.

## 8. AI-generated prompt / guide files

- `CLAUDE1.md` (113 KB), `DESIGN.md`, `Mi_Osusu_Complete_Build_Guide.md` (73 KB), `UI DESIGN SYSTEM RULES.txt`.
- `supabase/new_backend/*.md`, `supabase/prompt*_*.sql` (prompt-numbered SQL), `scripts/phase10/*.md`.
- `.agents/`, `.codex/`, `.claude/skills/` — agent skill caches (leave in place; tooling).

## 9. Files that MUST stay in root

`package.json`, `package-lock.json`, `app.json`, `app.config.js`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `tsconfig.json`, `vitest.config.ts`, `nativewind-env.d.ts`, `.gitignore`, `.gitattributes`, `.env.example`, `.env`/`.env.local` (gitignored), `.mcp.json`.

> ⚠️ **Caveat on the target structure:** The brief's target puts the mobile app under `apps/mobile/`. Because `main` is `expo-router/entry` and Expo resolves `app/`, `app.json`, `metro.config.js`, `babel.config.js` **relative to the project root it is launched from**, moving the Expo app into `apps/mobile/` is a *large, breaking* change (entry point, Metro roots, NativeWind input path `./app/global.css`, EAS config, every relative import). It is achievable but must be its own carefully-tested step, not bundled with low-risk cleanup. See the plan.

## 10. Files that should move (summary)

- Root loose images/logos → `assets/` subfolders (or `apps/mobile/assets/` if/when the app is relocated).
- Root docs (`CLAUDE1.md`, `DESIGN.md`, build guide, UI rules) → `docs/`.
- `stitch_osusu_onboarding_and_authentication/` → `docs/design/mockups/` (or `archive/`).
- Scattered `supabase/*.sql` → `supabase/migrations/` vs `supabase/sql/` (carefully — see §12).
- `lib/validation/kyc.ts` → reconcile into `src/utils/validation/`.

## 11. Files that may be DELETED later (only after archive + verification)

- `coverage/`, `dist/` — regenerable build output (delete + gitignore).
- `apps/admin/.next/` — build output (already staged for deletion; add to `.gitignore`).
- `testsprite_tests/tmp/mcp.log` — log artifact.
- Superseded MegaSafe brand assets, `unnamed*` images — after archiving.

**Nothing is deleted in this phase.** Deletion candidates go to `archive/` first and are logged in `docs/architecture/unused-files-report.md` (Phase 9).

## 12. Risks before cleanup

1. **Uncommitted mid-refactor (highest risk)** — see §0. Commit/stash first.
2. **Relocating Expo app to `apps/mobile/`** — breaks entry point, Metro config, NativeWind `./app/global.css` input, EAS, and all relative imports. High effort, must be isolated and tested with `expo start`.
3. **Supabase SQL files** — `supabase/prompt*.sql`, `*_migration.sql` may already be **applied to the production database.** Reordering/renaming them into `migrations/` can desync migration history. Per project memory, `prompt2/8/9` SQL is already known-stale and archived. **Do not reorganize applied SQL without confirming what's deployed** (use Supabase `list_migrations`).
4. **No `@/` path aliases exist yet** — all imports are relative. Moving files *will* break relative imports; adding aliases (Phase 11) should happen alongside, with `tsc --noEmit` after.
5. **Brand rename in code** — renaming DB tables / env var names / Supabase function names would break production. Only rename display strings; keep technical identifiers (documented in `brand-name-cleanup-report.md`).
6. **`.gitignore` gaps** — `coverage/`, `apps/admin/.next/`, `*.tsbuildinfo` (partially covered) should be added so build output stops being tracked.
7. **Committed build artifacts** — `apps/admin/.next/` was committed; needs `git rm -r --cached` + ignore.

---

## Security note (preview of Phase 12)

A scan of **tracked** files found **no hardcoded live secrets.** All `service_role` references are correct server-side `process.env.SUPABASE_SERVICE_ROLE_KEY` usage inside `apps/admin/` (never shipped to the browser), plus SQL `GRANT` statements and comments. `.env.example` and `apps/admin/.env.example` contain placeholders only. Real `.env`, `.env.local`, and `apps/admin/.env` exist on disk but are correctly **gitignored and untracked.** Full report to follow in `docs/security/secrets-audit-report.md`.

---

## Proposed execution order (lowest → highest risk)

1. **Checkpoint commit** of the in-flight refactor (§0). *(needs user OK — repo policy: commit only when asked)*
2. **`.gitignore` hardening** + untrack build output (`coverage/`, `apps/admin/.next/`). Non-breaking.
3. **Docs consolidation** — move root `.md`/`.txt` guides + `stitch_*` mockups into `docs/`. Non-code, low risk.
4. **Asset organization** — relocate loose root logos/images into `assets/` subfolders; archive superseded brand assets; update the (few) imports. Verify with grep + typecheck.
5. **Finish the `src/` consolidation** — remove the empty `lib/`/`stores/`/`components/`/`types/` husks; reconcile the `lib/validation/kyc.ts` duplicate. Typecheck.
6. **Supabase SQL organization** — *only after* confirming deployed migrations; reorganize into `migrations/`/`sql/`/`functions/`/`seed/`.
7. **Brand-string cleanup** in code (display strings only).
8. **Path aliases** (`@/*`) + import updates + typecheck + tests.
9. **(Optional / separate project) Monorepo move** of the Expo app into `apps/mobile/` — highest risk, isolated, tested end-to-end.
10. **Final reports** (Phases 9, 10, 12, 15).

Steps 2–9 deliver ~90% of the "clean, scalable, maintainable" benefit at low risk. Step 10 is the large structural change and should be a deliberate, separately-verified effort.
