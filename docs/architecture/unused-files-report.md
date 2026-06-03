# Mi Osusu — Unused / Duplicate Files Report (Phase 9)

**Date:** 2026-06-03 · **Branch:** `MegaSafe2.1`

Policy followed: **archive over delete.** Nothing in this cleanup was permanently
deleted except a single confirmed 0-byte dead file. Everything questionable was
moved to `archive/` and is recoverable from git history.

## Archived — unused candidates (`archive/unused-candidates/`)

| File | Original location | New location | Why it appears unused | Safe to delete later? |
|---|---|---|---|---|
| `Orange-Money-Logo-1.svg` | repo root | `archive/unused-candidates/orange-money-logo-1.svg` | Not referenced by any `require()`/import; the PNG variant is the one used in code | Yes, after confirming no future design need |
| `QMoney-logo-landscape-1.svg` | repo root | `archive/unused-candidates/qmoney-logo-landscape-1.svg` | Same — no code reference; PNG variant used | Yes |
| `unnamed (1).webp` | repo root | `archive/unused-candidates/unnamed-1.webp` | Generic dumped image, no reference anywhere | Yes |

## Archived — superseded brand assets (`archive/old-assets/`)

| File | Original location | New location | Why | Safe to delete later? |
|---|---|---|---|---|
| `Mi Osusu Logo.png` (root copy) | repo root | `archive/old-assets/mi-osusu-logo-duplicate.png` | **Exact duplicate** (identical md5) of `assets/Mi Osusu Logo.png`; only the `assets/` copy is imported (`app/welcome.tsx`) | Yes — true duplicate |

## Deleted (only confirmed-dead file)

| File | Why it was safe to delete |
|---|---|
| `lib/validation/kyc.ts` | **0 bytes**, empty. The real schema lives in `src/utils/validation/kyc.ts` and is the one imported by `app/(kyc)/details.tsx`, `app/(kyc)/guarantor.tsx`, and `src/services/profileService.ts`. Recoverable from git history if ever needed. |

## Removed empty directories (husks left by the lib/ → src/ migration)

`hooks/`, `constants/`, `convex/` — all contained zero files (their contents had
already been migrated into `src/`). `lib/`, `stores/`, `components/`, `types/`
were already gone from disk (tracked only as pending deletions, now committed).

## Confirmed unused but **left in place** (documented, not yet archived)

| Item | Status | Reason left in place |
|---|---|---|
| `.convex/` (local backend cache) | Gitignored | Machine-local Convex dev cache. Convex is unused (no imports, not a dependency) but this is a regenerable tool cache, not project source. Can be deleted manually anytime. |
| `convex` MCP entry in `.mcp.json` | Tooling config | Part of the developer's MCP setup, not app source. Recommend removing if Convex is permanently abandoned. |
| `coverage/`, `dist/` | Gitignored build output | Regenerable; now excluded from git and from tsc. |
| `testsprite_tests/tmp/mcp.log` | Gitignored | Test-runner scratch. |

## Build artifacts un-tracked (were committed by mistake)

`apps/admin/.next/**` (≈160 files) was previously committed. These are Next.js
build output and are now removed from git tracking and covered by `.gitignore`
(`apps/*/.next/`). The working copies on disk are untouched.

## Notes / follow-ups

- No source code, screen, service, or asset that is **referenced anywhere** was
  archived or deleted.
- All asset moves had their `require()` paths updated and verified (see
  `project-reorganization-completed.md`).
