-- Payment method RPCs write audit rows after successful backend validation.
-- These enum values must exist or the audit insert rolls back the link/unlink/verify transaction.

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'link_payment_method';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'verify_payment_method';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'unlink_payment_method';
