# Archived: stale pre-refactor SQL — DO NOT APPLY

These files were written against the **pre-vault-first schema** and are kept only for
historical reference. They reference tables/columns that no longer exist in the live
database and **will fail or create broken objects if applied**. Verified against the
live DB on 2026-06-03.

## Why they are stale

The live schema was rebuilt by the vault-first refactor. Renamed/removed objects these
files still target:

| Referenced here (old) | Live equivalent |
|---|---|
| `group_memberships`        | `osusu_group_members` |
| `contributions`           | `contribution_payments` |
| `payments`                | `vault_transactions` / `mobile_money_transactions` |
| `commission_records`      | `commissions` |
| `app_config`              | `app_settings` |
| `fraud_events`            | `fraud_cases` / `risk_events` |
| `group_deletion_requests` | (removed) |
| `notifications.recipient_id` | `notifications.user_id` |
| `audit_logs (user_id, new_values)` | `audit_logs (actor_id, new_data)` |

## File-by-file

- **prompt2_audit_fixes.sql** — its still-valid objects (guarantors table,
  `expo_push_token`, capacity/collector-KYC triggers, indexes) already exist live.
  Its `consume_admin_rate_limit(TEXT)` was superseded by the 2-arg version
  (migration `prompt10_login_rate_limit`).
- **prompt8_security_hardening_v2.sql** — the `protect_profile_immutable_columns`
  trigger it defines IS live. But its KYC RPCs would have BROKEN audit logging by
  switching the correct `actor_id`/`new_data` columns to nonexistent
  `user_id`/`new_values`. The intended fix (KYC RPCs checking `user_roles`) was
  applied separately and schema-correct as migration `kyc_rpcs_check_user_roles`.
- **prompt9_privilege_escalation_audit.sql** — payment RPCs already rewritten for the
  new schema; `fraud_events` table does not exist; `group_peer_profiles` view never
  created. Superseded.

## Authoritative source

The live schema's truth is the applied migrations (see `supabase migration list` /
the MCP `list_migrations`), not these loose root-level `.sql` files. `user_roles` is
the canonical role table; `profiles.role` is locked by `trg_protect_profile_immutable`.
