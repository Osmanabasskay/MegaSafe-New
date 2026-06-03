# Mi Osusu — Brand Name Cleanup Report (Phase 10)

**Date:** 2026-06-03 · Old name: **MegaSafe** → New name: **Mi Osusu**

## Summary

The MegaSafe → Mi Osusu rename in **user-facing code and content was already
complete** by the time this cleanup ran (it was part of the in-flight refactor
captured in the checkpoint commit). A full scan of tracked files found **no
literal "MegaSafe" / "Mega Safe" / "megasafe" string in any app, src, or admin
source file.** No string replacements were required.

## Verified already-correct brand strings

| Location | Value |
|---|---|
| `app.json` → `expo.name` | `Mi Osusu` |
| `app.json` → `expo.slug` | `mi-osusu` |
| `app.json` → `expo.scheme` | `miosusu` |
| `package.json` → `name` | `mi-osusu` |
| `apps/admin/app/layout.tsx` → title | `Mi Osusu Admin` |
| `apps/admin/README.md` | `# Mi Osusu Super Admin Dashboard` |
| `src/services/backendErrors.ts` | user messages say "the Mi Osusu Supabase schema…" |

## Brand assets renamed (during the in-flight refactor + this cleanup)

- `MegaSafe Logo.png` / `assets/MegaSafe Logo.png` → `assets/logos/mi-osusu/mi-osusu-logo.png`
- `Afrimoney.png`, `Qmoney-logo-white.png` (old) → current provider logos in `assets/payment-providers/`
- `MegaSafe_Complete_Build_Guide.md` → `docs/architecture/mi-osusu-complete-build-guide.md`

## ⚠️ Old identifier intentionally KEPT for compatibility

| Identifier | Where | Why it must stay |
|---|---|---|
| **`MSF-` prefix** | Group invite codes — generated in `src/services/groupService.ts` (`MSF-${token}`) and `src/store/appDataStore.ts`; validated by regex `^MSF-[A-Z2-9]{6}$` in tests; shown as placeholder `e.g. MSF-A1B2C3` in `app/(main)/groups.tsx`; generated server-side in archived SQL | This is a **functional identifier stored in the production database**. Existing groups have codes like `MSF-A1B2C3`. Renaming the prefix (e.g. to `MIO-`) would orphan every existing group code and break join-by-code. It is *not* a display brand string and should **not** be changed without a coordinated data migration. |

## Other "MegaSafe" occurrences (non-code, no action needed)

- Git branch name `MegaSafe2.1` — cosmetic; rename at the team's discretion.
- On-disk project folder `MegaSafe/` — cosmetic; the package is already `mi-osusu`.
- This cleanup's own audit docs reference "MegaSafe" when describing history.
- A base64 payload in `app/(groups)/collector.tsx` coincidentally contains the
  substring `MSF` — not a brand reference.

## Recommendation

Leave `MSF-` as-is permanently (or plan a versioned code-migration if rebranding
group codes is ever required). No further brand string changes are needed.
