# Phase 10 Pre-Launch Checklist

## Security hardening
- [ ] Run `npm run phase10:check`.
- [ ] Execute full Supabase RLS audit with role test users (anonymous/member/collector/creator/admin).
- [ ] Verify Edge Functions enforce auth, Zod input validation, and webhook signature checks.
- [ ] Confirm admin API middleware enforces super-admin role, IP allowlist, and 500 req/min limit.
- [ ] Confirm admin self-action prevention blocks own account mutations.

## Payment integrity
- [ ] Validate sandbox payment flow end to end.
- [ ] Replay duplicate webhook events and verify idempotency.
- [ ] Validate failure/reversal paths keep contribution state consistent.
- [ ] Verify immutable contribution records after creation.

## Anti-fraud controls
- [ ] Verify collector threshold rule blocks over-limit manual entries.
- [ ] Confirm collector geolocation capture strategy in production build.
- [ ] Validate duplicate contribution prevention rule by member/group/period.
- [ ] Review suspicious-group and collector red-flag monitor pages.

## Compliance
- [ ] Validate onboarding legal acceptance flow before registration.
- [ ] Verify legal acceptance is logged into `audit_logs`.
- [ ] Validate Terms and Privacy pages for latest policy revisions.

## Performance and launch
- [ ] Enable PgBouncer and verify pool settings.
- [ ] Wire Sentry and PostHog in mobile + admin apps.
- [ ] Build preview APK with EAS.
- [ ] Complete app-store assets (icons, screenshots, descriptions).
