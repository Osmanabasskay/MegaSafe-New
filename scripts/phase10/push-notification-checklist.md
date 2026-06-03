# Push Notification Manual Verification Checklist (Phase 7)

This checklist must be completed before closed-beta deployment.
Expo Push credentials are required to run live notification tests.

## Architecture Verification (AUTOMATED — check code)

- [x] `notificationService.ts` does NOT contain direct INSERT into `notifications` table
  - `sendContributionAlert()` and `sendAssignmentNotification()` are removed
  - Only `fetchNotifications()` (SELECT) and `markNotificationRead()` (UPDATE own row) are client-side
- [x] Notification dispatch is server-side only:
  - `record_physical_collection` RPC creates notifications atomically
  - `assign_collector_validated` RPC notifies members atomically
- [x] `expo_push_token` is stored in `profiles` table (backend), not in frontend-accessible store
- [x] `profiles` RLS: users can only read/update their own row (includes push token)

## Edge Function Verification (MANUAL — requires deployment)

### `send-notification` Edge Function
- [ ] Verify the function exists (check Supabase Dashboard → Edge Functions)
- [ ] Verify `verify_jwt: true` is set in function config
- [ ] Verify function reads `expo_push_token` from `profiles` server-side
- [ ] Verify function does NOT accept token from the request body (prevents token injection)
- [ ] Verify invalid/expired tokens are handled without throwing (log + skip)
- [ ] Verify notification failure is logged to `notification_delivery_log` or equivalent

### Live Push Test (requires real Expo Push Token)
1. Install the app on a device
2. Grant notification permissions
3. Verify `expo_push_token` is stored in `profiles.expo_push_token` for the device user
4. Trigger a backend event that dispatches a notification (e.g., collector records a collection)
5. Verify push notification is received on device within 30 seconds
6. Verify the notification body matches what was stored in `notifications` table
7. Test with invalid push token (delete one character) — verify graceful failure logged

## Frontend Security Checks (AUTOMATED — see noDirectInserts.test.ts)

- [x] `notificationService.ts` has no `.from('notifications').insert()`
- [x] Frontend can only: SELECT own notifications + UPDATE `is_read` on own rows

## Remaining Manual Tasks

- [ ] Register Expo project and obtain `EXPO_ACCESS_TOKEN` for production
- [ ] Set `EXPO_ACCESS_TOKEN` in Supabase Edge Function secrets
- [ ] Test notification delivery rate (should be >95% for Sierra Leone mobile networks)
- [ ] Test notification delivery when app is backgrounded vs. foreground
- [ ] Verify deep-link from notification navigates to correct screen

## Risk Assessment

| Risk | Severity | Status |
|------|----------|--------|
| Frontend can insert into notifications table | CRITICAL | FIXED |
| Push token stored insecurely on device | HIGH | LOW RISK — stored in profiles via Supabase |
| Notification delivery failure causes crash | MEDIUM | ACCEPTABLE — service degrades gracefully |
| Expo push credentials not configured | HIGH | MANUAL REQUIRED before beta |
