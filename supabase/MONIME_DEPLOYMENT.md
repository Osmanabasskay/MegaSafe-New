# Monime Payment Integration — Deployment Guide

## Overview

Mi Osusu uses the **Monime Payment Codes API** (not Checkout Sessions) to accept mobile money
payments in Sierra Leone. Users receive a USSD dial string (`*XXX*Y*NNNNNN#`) and dial it on
their phone — no browser redirect required.

**Base URL:** `https://api.monime.io`
**API version prefix:** `/v1`
**Currency:** `SLE` (ISO 4217) — Monime accepts SLE. Internal display uses NLe (1:1 ratio, same
unit, different label convention).
**Amounts:** Minor units — 100 = SLE 1.00

### Supported providers

| Method        | Monime Provider ID | Notes                                |
|---------------|--------------------|--------------------------------------|
| orange_money  | m17                | Confirmed in Monime docs             |
| afrimoney     | m18                | Confirmed in Monime docs             |
| qmoney        | —                  | NOT confirmed — reject at API layer  |

---

## Required Supabase Secrets

Set these via the Supabase dashboard or CLI before deploying **any** edge function:

```bash
supabase secrets set MONIME_ACCESS_TOKEN=your_monime_bearer_token
supabase secrets set MONIME_SPACE_ID=your_monime_space_id
supabase secrets set MONIME_WEBHOOK_SECRET=your_monime_webhook_signing_secret
```

### Optional secrets

```bash
# Override API base URL — used for sandbox/live switching (see Sandbox Testing below)
supabase secrets set MONIME_BASE_URL=https://sandbox.api.monime.io

# Bank transfer payouts via Flutterwave (approve-withdrawal only)
supabase secrets set FLUTTERWAVE_SECRET_KEY=your_flutterwave_key

# CORS allow-list
supabase secrets set ALLOWED_ORIGIN=https://your-app-domain.com
```

> **Legacy fallback:** `MONIME_SECRET_KEY` is also checked if `MONIME_ACCESS_TOKEN` is absent.
> All new deployments must use `MONIME_ACCESS_TOKEN`.

---

## Active Edge Functions

These are the **current, production-ready** edge functions for Monime payments:

| Function                    | JWT required | Purpose                                                   |
|-----------------------------|:------------:|-----------------------------------------------------------|
| `initiate-payment` v3       | ✅ yes       | Create Monime Payment Code for Osusu contributions        |
| `verify-payment` v2         | ✅ yes       | Poll payment status (display-only, read-only)             |
| `mobile-money-webhook` v2   | ❌ no (HMAC) | Receive `payment_code.*` events; finalize contributions   |
| `initiate-vault-topup` v2   | ✅ yes       | Create Monime Payment Code for vault top-ups              |
| `verify-vault-topup-status` v2 | ✅ yes    | Poll vault top-up status (display-only, read-only)        |
| `vault-webhook` v2          | ❌ no (HMAC) | Receive `payment_code.*` events; credit vault             |
| `approve-withdrawal` v2     | ✅ yes       | Admin approves payout; calls Monime Payouts API           |
| `provider-kyc-check` v1     | ✅ yes       | Backend-only Provider KYC lookup                          |
| `send-notification` v1      | ❌ no (service key) | Expo push + DB notification log                  |

### Deploy all active functions

```bash
supabase functions deploy initiate-payment
supabase functions deploy verify-payment
supabase functions deploy mobile-money-webhook
supabase functions deploy initiate-vault-topup
supabase functions deploy verify-vault-topup-status
supabase functions deploy vault-webhook
supabase functions deploy approve-withdrawal
supabase functions deploy provider-kyc-check
supabase functions deploy send-notification
```

---

## Webhook Configuration

In the **Monime Dashboard**, register **two** webhook endpoints:

| Endpoint URL                                                            | Events to subscribe                                                                                            |
|-------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| `https://<project-ref>.supabase.co/functions/v1/vault-webhook`          | `payment_code.processed`, `payment_code.completed`, `payment_code.expired`, `payment_code.cancelled`           |
| `https://<project-ref>.supabase.co/functions/v1/mobile-money-webhook`   | `payment_code.processed`, `payment_code.completed`, `payment_code.expired`, `payment_code.cancelled`           |

> The old `payment-webhook` slug is **decommissioned** (see Stale Functions below). Do NOT point
> Monime webhooks at it.

### Webhook security contract

- Signature header: **`Monime-Signature`** (NOT `X-Monime-Signature`)
- Algorithm: HMAC-SHA256 of raw request body, hex-encoded
- Both endpoints **always return HTTP 200** — invalid signatures are logged but acknowledged
  (Monime retries on non-200, which would cause double-processing if we returned 4xx/5xx)
- Re-verification: webhooks re-verify via `GET /v1/payment-codes/{id}` before crediting any balance

---

## Payment Flows

### Osusu Contribution (member pays via mobile money)

```
User taps "Pay with Orange Money / AfriMoney" in contribute.tsx
  → initiateGroupPayment() [paymentService.ts]
    → POST initiate-payment [Edge Fn]
      → Verify KYC (server-side, profiles table)
      → Resolve open payment_period for group
        (status = 'open' — enum: upcoming|open|paid|overdue|locked|skipped)
      → initiate_group_payment RPC → creates contribution_payments row
      → INSERT mobile_money_transactions (status='pending')
      → createPaymentCode() [Monime POST /v1/payment-codes]
      → UPDATE mobile_money_transactions (monime_payment_code_id, status='processing')
      ← Returns { ussd_code, monime_payment_code_id, expires_at }
  → navigate to monime-payment.tsx (paymentType='osusu_contribution')
    → User dials USSD code on phone
    → AppState return → poll verifyMonimeCheckout() → verify-payment Edge Fn
      (read-only — never self-confirms)
    ← Monime sends payment_code.completed to mobile-money-webhook
      → HMAC verify → dedup insert → finalize_monime_checkout RPC
        → contribution_payments.status = 'approved'
        → mobile_money_transactions.status = 'completed'
      ← HTTP 200 always
    → Next poll: verify-payment returns effective_status='completed'
    → monime-payment.tsx shows success, routes back to group screen
```

### Vault Top-Up (user funds their vault)

```
User taps "Add Money" in vault.tsx
  → initiateVaultTopup() [vaultService.ts]
    → POST initiate-vault-topup [Edge Fn]
      → initiate_vault_topup_record RPC (KYC + rate-limit + idempotency)
      → createPaymentCode() [Monime POST /v1/payment-codes]
      ← Returns { ussd_code, monime_payment_code_id, topup_id, expires_at }
  → navigate to monime-payment.tsx (paymentType='vault_topup')
    → User dials USSD code on phone
    → AppState return → poll verifyVaultTopupStatus() → verify-vault-topup-status Edge Fn
      (read-only — never self-confirms)
    ← Monime sends payment_code.completed to vault-webhook
      → HMAC verify → dedup insert → finalize_vault_topup RPC
        → vault_topups.status = 'completed'
        → vault_transactions row inserted (credits vault)
      ← HTTP 200 always
    → Next poll: effective_status='completed'
    → monime-payment.tsx shows success, routes back to vault screen
```

### Withdrawal / Payout (admin disbursing funds)

```
Admin approves withdrawal in admin dashboard
  → POST approve-withdrawal [Edge Fn]
    → approve_withdrawal_request RPC (amounts/destinations from DB, never from client)
    → createMonimePayout() [Monime POST /v1/payouts, destination.type='momo']
    → record_monime_payout_result RPC
    ← Returns payout status
Note: QMoney payouts are rejected — must be done manually via provider dashboard.
```

---

## Sandbox Testing

### 1. Configure secrets for sandbox

```bash
supabase secrets set MONIME_BASE_URL=https://sandbox.api.monime.io
supabase secrets set MONIME_ACCESS_TOKEN=<sandbox_bearer_token>
supabase secrets set MONIME_SPACE_ID=<sandbox_space_id>
supabase secrets set MONIME_WEBHOOK_SECRET=<sandbox_webhook_secret>
```

### 2. Create a Payment Code (vault top-up initiation)

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/initiate-vault-topup \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "method": "orange_money"}'
```

Expected:
```json
{
  "success": true,
  "ussd_code": "*XXX*...*NNNNNN#",
  "monime_payment_code_id": "pc_...",
  "topup_id": "uuid",
  "expires_at": "2025-..."
}
```

### 3. Check vault topup status

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/verify-vault-topup-status \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"topup_id": "<topup-uuid>"}'
```

### 4. Create an Osusu contribution Payment Code

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/initiate-payment \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"group_id": "<group-uuid>", "amount": 50, "method": "orange_money"}'
```

Expected:
```json
{
  "success": true,
  "ussd_code": "*XXX*...*NNNNNN#",
  "monime_payment_code_id": "pc_...",
  "contribution_id": "uuid",
  "expires_at": "2025-..."
}
```

### 5. Simulate a valid webhook (test HMAC signing)

```bash
BODY='{"event":"payment_code.completed","data":{"id":"pc_test123","status":"completed","amount":1000,"currency":"SLE","reference":"test-ref"}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$MONIME_WEBHOOK_SECRET" -hex | awk '{print $2}')

curl -X POST https://<project-ref>.supabase.co/functions/v1/vault-webhook \
  -H "Content-Type: application/json" \
  -H "Monime-Signature: $SIG" \
  -d "$BODY"
```

Expected: HTTP 200 always. Body will show `rpc_app_error` if the payment code isn't in the DB
(expected for a test value) — never a 4xx/5xx.

### 6. Simulate a tampered signature (security check)

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/vault-webhook \
  -H "Content-Type: application/json" \
  -H "Monime-Signature: 0000000000000000000000000000000000000000000000000000000000000000" \
  -d "$BODY"
```

Expected: HTTP 200 with `{"status":"invalid_signature"}`. No DB mutation.

### 7. Resend identical webhook (idempotency check)

Repeat step 5 with the **same body and signature**. Expected: HTTP 200 with
`{"status":"already_processed"}`. No double-crediting.

### 8. Sandbox full flow checklist

- [ ] `MONIME_BASE_URL` set to sandbox
- [ ] `MONIME_ACCESS_TOKEN` set (sandbox credential)
- [ ] `MONIME_SPACE_ID` set
- [ ] `MONIME_WEBHOOK_SECRET` set
- [ ] Register `vault-webhook` URL in Monime dashboard (sandbox project)
- [ ] Register `mobile-money-webhook` URL in Monime dashboard (sandbox project)
- [ ] Subscribe both webhooks to: `payment_code.processed`, `payment_code.completed`, `payment_code.expired`, `payment_code.cancelled`
- [ ] Create Payment Code for vault top-up → receives USSD code
- [ ] Create Payment Code for Osusu contribution → receives USSD code
- [ ] Dial/test payment in Monime sandbox
- [ ] Receive `payment_code.completed` webhook; verify `vault_topups` or `contribution_payments` reaches completed/approved
- [ ] Resend identical webhook — confirm `already_processed`, no double-credit
- [ ] Send tampered `Monime-Signature` — confirm `invalid_signature`, no DB mutation
- [ ] Send `payment_code.expired` — confirm payment status set to failed
- [ ] Send `payment_code.cancelled` — confirm payment status set to failed

---

## Database Migration

Run the migration before deploying edge functions:

```bash
# Already applied to live DB — kept here for reference
supabase db push --file supabase/prompt6_monime_payment_code_fix.sql
```

Key schema changes (already applied):
- `vault_topups`: added `monime_payment_code_id`, `ussd_code`, `phone_number`, `monime_order_number`
- `mobile_money_transactions`: added `monime_payment_code_id`, `monime_order_number`, `ussd_code`
- `withdrawal_requests`: added payout tracking columns
- New `provider_kyc_checks` table (RLS blocks all frontend writes)
- Rewrote `finalize_vault_topup`, `fail_vault_topup`, `get_vault_summary` RPCs
- New `record_monime_payout_result` RPC
- New `finalize_monime_checkout`, `fail_monime_checkout` RPCs

**payment_periods.status enum values** (live DB, confirmed):
`upcoming` | `open` | `paid` | `overdue` | `locked` | `skipped`
→ `initiate-payment` queries `.eq('status', 'open')` (fixed from the incorrect `'active'`)

---

## Stale Edge Functions — Decommissioned

The following edge functions are **pre-migration relics** and must be deleted from the Supabase
project. None of them are referenced by any active frontend, backend service, or test code.

| Slug                    | Why decommissioned                                                       |
|-------------------------|--------------------------------------------------------------------------|
| `payment-webhook`       | Replaced by `mobile-money-webhook` v2 (correct HMAC header + events)   |
| `confirm-payment`       | Replaced by automatic finalization in `mobile-money-webhook` via RPC    |
| `verify-payment-status` | Replaced by `verify-payment` v2 (correct Payment Codes API polling)     |
| `process-withdrawal`    | Replaced by `approve-withdrawal` v2 (admin-only, Monime Payouts API)    |
| `reject-withdrawal`     | Rejection is now handled by `reject_withdrawal_request` RPC directly    |

### ⚠️ Security note

`payment-webhook` has `verify_jwt=false` and is publicly reachable. It must be deleted
immediately to prevent accidental webhook registration against a dead endpoint.

### Delete commands

```bash
# Run these against the target Supabase project
supabase functions delete payment-webhook
supabase functions delete confirm-payment
supabase functions delete verify-payment-status
supabase functions delete process-withdrawal
supabase functions delete reject-withdrawal
```

If the Supabase CLI is not linked to the project:
```bash
supabase link --project-ref <project-ref>
supabase functions delete payment-webhook
# ... etc.
```

Or delete via the Supabase Dashboard → Edge Functions → select function → Delete.

### Pre-deletion verification (run first)

```bash
# Confirm no live traffic to stale functions in the last 7 days
# Supabase Dashboard → Edge Functions → Logs → filter by slug
```

The source files remain in the repo under `supabase/functions/` for audit purposes only.
They are NOT deployed as part of any build process.

---

## Security Checklist

- [ ] `MONIME_ACCESS_TOKEN` set in Supabase secrets (not in code)
- [ ] `MONIME_SPACE_ID` set in Supabase secrets
- [ ] `MONIME_WEBHOOK_SECRET` set in Supabase secrets
- [ ] Webhook endpoints registered in Monime Dashboard with correct URLs
- [ ] Both webhooks subscribed to `payment_code.*` events only
- [ ] `payment_webhook_events` UNIQUE constraint in place (deduplication)
- [ ] `provider_kyc_checks` RLS verified — no frontend insert/update/delete
- [ ] `vault_topups` RLS verified — users can only read their own rows
- [ ] QMoney rejected at `initiate-payment` and `approve-withdrawal`
- [ ] `get_vault_summary` returns `pending_topup_count` (integer, not sum)
- [ ] No `MONIME_ACCESS_TOKEN` or `MONIME_SPACE_ID` in frontend bundle or `.env` files
- [ ] Stale edge functions deleted (see above)
