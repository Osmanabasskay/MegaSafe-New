# Mi Osusu — Secrets Audit Report (Phase 12)

**Date:** 2026-06-03 · **Scope:** all git-tracked files on branch `MegaSafe2.1`

## Verdict: ✅ No hardcoded secrets found in tracked files

A scan for `service_role`, `SERVICE_ROLE`, `sk_live`, `sbp_`, JWT-shaped tokens
(`eyJ…`), `MONIME_*_SECRET`, and `api_secret` across all tracked files (excluding
`.env.example` and lockfiles) found **no real credentials**. Every match was a
legitimate, safe usage:

| Finding | File | Assessment |
|---|---|---|
| `process.env.SUPABASE_SERVICE_ROLE_KEY` | `apps/admin/lib/security.ts`, `apps/admin/middleware.ts` | ✅ Correct. Service-role key read from server-side env in the Next.js admin app. **Never** shipped to the browser. |
| `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here` | `apps/admin/.env.example` | ✅ Placeholder only. |
| `service_role` GRANTs / comments | `supabase/_archive_stale_pre_refactor/prompt2_audit_fixes.sql` | ✅ SQL grants and comments, not secrets. |
| `${TESTSPRITE_API_KEY}` | `.mcp.json` | ✅ Env-var reference, not a literal key. |

## Environment files

| File | Tracked? | Status |
|---|---|---|
| `.env` (real, project root) | ❌ No | ✅ Gitignored (`.gitignore` explicitly lists bare `.env`) |
| `.env.local` | ❌ No | ✅ Gitignored (`.env.*`) |
| `apps/admin/.env` | ❌ No | ✅ Gitignored by `apps/admin/.gitignore` |
| `.env.example` (root) | ✅ Yes | ✅ Placeholders only; documents required vars |
| `apps/admin/.env.example` | ✅ Yes | ✅ Placeholders only |

The root `.env.example` correctly documents the security boundary:
- Mobile vars are `EXPO_PUBLIC_*` (public by design; RLS is the defence layer).
- Admin `SUPABASE_SERVICE_ROLE_KEY` is server-side only and bypasses RLS.

## Admin dashboard browser-safety

- Service-role key is used only in server contexts (`middleware.ts`, server-side
  `lib/`), never in client components. ✅
- Admin routes are protected server-side via `apps/admin/middleware.ts`. ✅

## `.gitignore` hardening done in this cleanup

Added ignores so build output and machine-local caches can never be committed:
`coverage/`, `.next/`, `apps/*/.next/`, `out/`, `.convex/`, `convex/`,
`.agents/`, `.codex/`, `.claude/skills/`, `testsprite_tests/tmp/`, `*.log`.
Previously-committed `apps/admin/.next/**` build artifacts were removed from
tracking.

## Recommendations

1. **No key rotation required** from a tracked-file standpoint — no secret was
   ever committed in the history scanned here.
2. As routine hygiene, confirm the real `.env` values (Supabase service-role,
   Monime keys) have never been pushed to a remote in older history; if a remote
   exists and any historical commit contained `.env`, rotate those keys. (The
   most recent local history shows `.env` was deliberately removed in commit
   `53fadf5 "Remove .env with live credentials"` — verify nothing earlier leaked
   before that point if the repo was ever pushed.)
3. Keep `EXPO_PUBLIC_*` limited to genuinely public values only.
