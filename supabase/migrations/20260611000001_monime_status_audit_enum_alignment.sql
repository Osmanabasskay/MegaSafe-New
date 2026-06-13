-- ============================================================================
-- Monime payment hardening — Part 1: status model + audit enum alignment
--
-- Why this migration exists (confirmed against the live DB):
--   1. mobile_money_status enum was {initiated,pending,success,failed,expired,
--      reversed} but every edge function and RPC writes 'processing' /
--      'completed' / 'cancelled'. Those writes either error or are silently
--      swallowed. Aligns the enum with the canonical lifecycle:
--      pending → processing → completed | failed | cancelled | expired.
--   2. audit_logs.action is the audit_action ENUM, but the payment edge
--      functions and several SECURITY DEFINER RPCs log actions that are not
--      labels of that enum (e.g. 'payment_succeeded', 'payout_completed',
--      'savings_transaction'). Every such insert currently fails — payment
--      audit logging is effectively disabled. This adds the missing labels.
--   3. savings_transactions.idempotency_key had no UNIQUE constraint, so a
--      replayed webhook could double-credit a savings goal. Partial unique
--      index added (NULLs exempt for legacy rows).
--   4. mobile_money_transactions.phone_number was NOT NULL but initiation
--      flows create the row before the provider phone is bound; inserts were
--      failing silently. Relaxed to nullable — the linked-method phone is now
--      supplied by the edge functions whenever available.
-- ============================================================================

-- 1. mobile_money_status lifecycle labels --------------------------------------
ALTER TYPE public.mobile_money_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE public.mobile_money_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.mobile_money_status ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. audit_action labels used by payment/payout/provider-KYC flows -------------
-- Send-payment intent lifecycle (create-send-payment-intent / confirm-send-payment)
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_intent_created';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_intent_create_rejected';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_intent_rate_limited';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_intent_unlinked_method';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_intent_unauthorized_target';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_intent_expired';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_confirmation_attempted';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_confirmation_rate_limited';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_confirmation_unlinked_method';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_duplicate_idempotency_attempt';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_provider_confirmation_started';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_succeeded';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payment_finalized_via_webhook';

-- Savings deposit lifecycle
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'savings_transaction';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'savings_deposit_initiated';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'savings_deposit_processing';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'savings_deposit_completed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'savings_deposit_failed';

-- Send payment finalization
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'send_payment_completed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'send_payment_failed';

-- Payout / withdrawal disbursement lifecycle (record_monime_payout_result + payout-webhook)
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_pending';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_processing';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_completed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_failed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_cancelled';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_duplicate_ignored';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_amount_mismatch';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'payout_unknown';

-- Provider KYC gating (initiate-payment / initiate-vault-topup / confirm-send-payment)
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_passed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_failed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_unavailable';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_unsupported';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_cached';

-- Webhook routing / security observability
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'webhook_signature_invalid';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'webhook_unknown_payment_type';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'webhook_misrouted_payment';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'suspicious_vault_topup_mismatch';

-- 3. Idempotency barrier for savings credits -----------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS savings_transactions_idempotency_key_uq
  ON public.savings_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. mobile_money_transactions: allow row creation before phone binding ---------
ALTER TABLE public.mobile_money_transactions
  ALTER COLUMN phone_number DROP NOT NULL;
