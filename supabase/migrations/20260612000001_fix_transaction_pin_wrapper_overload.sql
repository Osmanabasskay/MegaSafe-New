-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: transaction-PIN wrapper / base overload ambiguity (SQLSTATE 42725)
--
-- Symptom (user-facing):
--   Vault top-up failed with:
--     "function public.initiate_vault_topup_record(numeric, text, uuid, text)
--      is not unique"
--
-- Root cause:
--   The transaction-PIN system (20260608000002 / 20260611000002) added a
--   "wrapper" overload for each money action that takes an extra
--   `p_transaction_pin text DEFAULT NULL`, verifies the PIN, then delegates to
--   the original "base" function. The wrapper kept the SAME name as the base.
--   Because the wrapper's `p_transaction_pin` has a default, the wrapper itself
--   is also a candidate for the base-arity positional call it makes internally,
--   so PostgreSQL cannot choose between the base and the wrapper and raises
--   42725 ("function ... is not unique"). Every PIN-protected money flow was
--   affected (vault top-up, pay-osusu-from-vault, savings deposit, savings
--   transaction, deposit-savings-from-vault, link-payment-method, group payment).
--
-- Fix:
--   Rename each base function to a distinct internal `*_core` name (metadata-only;
--   the body — including audit string literals like created_by_fn — is preserved)
--   and repoint each PIN wrapper to call the renamed `*_core` base. The wrapper
--   names/signatures that the frontend and edge functions call are unchanged.
--   Grants and ownership are preserved (RENAME and CREATE OR REPLACE keep ACLs).
--
-- Idempotent: renames are guarded by to_regprocedure() so this is safe to
-- re-apply (e.g. via `supabase db push`) after being applied to production.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Rename the base functions out of the colliding name (guarded / idempotent).
DO $$
BEGIN
  IF to_regprocedure('public.initiate_vault_topup_record(numeric,text,uuid,text)') IS NOT NULL
     AND to_regprocedure('public.initiate_vault_topup_record_core(numeric,text,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.initiate_vault_topup_record(numeric, text, uuid, text)
      RENAME TO initiate_vault_topup_record_core;
  END IF;

  IF to_regprocedure('public.pay_osusu_from_vault(uuid,uuid,text)') IS NOT NULL
     AND to_regprocedure('public.pay_osusu_from_vault_core(uuid,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.pay_osusu_from_vault(uuid, uuid, text)
      RENAME TO pay_osusu_from_vault_core;
  END IF;

  IF to_regprocedure('public.initiate_savings_deposit(uuid,numeric,text,text)') IS NOT NULL
     AND to_regprocedure('public.initiate_savings_deposit_core(uuid,numeric,text,text)') IS NULL THEN
    ALTER FUNCTION public.initiate_savings_deposit(uuid, numeric, text, text)
      RENAME TO initiate_savings_deposit_core;
  END IF;

  IF to_regprocedure('public.record_savings_transaction(uuid,numeric,text,text)') IS NOT NULL
     AND to_regprocedure('public.record_savings_transaction_core(uuid,numeric,text,text)') IS NULL THEN
    ALTER FUNCTION public.record_savings_transaction(uuid, numeric, text, text)
      RENAME TO record_savings_transaction_core;
  END IF;

  IF to_regprocedure('public.deposit_savings_from_vault(uuid,numeric,text)') IS NOT NULL
     AND to_regprocedure('public.deposit_savings_from_vault_core(uuid,numeric,text)') IS NULL THEN
    ALTER FUNCTION public.deposit_savings_from_vault(uuid, numeric, text)
      RENAME TO deposit_savings_from_vault_core;
  END IF;

  IF to_regprocedure('public.link_payment_method(text,text)') IS NOT NULL
     AND to_regprocedure('public.link_payment_method_core(text,text)') IS NULL THEN
    ALTER FUNCTION public.link_payment_method(text, text)
      RENAME TO link_payment_method_core;
  END IF;

  IF to_regprocedure('public.initiate_group_payment(uuid,uuid,uuid,numeric,text,text,text)') IS NOT NULL
     AND to_regprocedure('public.initiate_group_payment_core(uuid,uuid,uuid,numeric,text,text,text)') IS NULL THEN
    ALTER FUNCTION public.initiate_group_payment(uuid, uuid, uuid, numeric, text, text, text)
      RENAME TO initiate_group_payment_core;
  END IF;
END $$;

-- 2. Repoint each PIN wrapper to the renamed *_core base (unambiguous now).

CREATE OR REPLACE FUNCTION public.initiate_vault_topup_record(
  p_amount numeric,
  p_idempotency_key text,
  p_payment_method_id uuid,
  p_description text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'initiate_vault_topup', jsonb_build_object('amount', p_amount, 'payment_method_id', p_payment_method_id));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.initiate_vault_topup_record_core(p_amount, p_idempotency_key, p_payment_method_id, p_description);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'vault_topups', (v_result->>'topup_id')::uuid, jsonb_build_object('purpose', 'initiate_vault_topup'));
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_osusu_from_vault(
  p_group_id uuid,
  p_period_id uuid,
  p_idempotency_key text,
  p_notes text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'pay_osusu_from_vault', jsonb_build_object('group_id', p_group_id, 'period_id', p_period_id));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.pay_osusu_from_vault_core(p_group_id, p_period_id, p_idempotency_key);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'contribution_payments', (v_result->>'contribution_id')::uuid, jsonb_build_object('purpose', 'pay_osusu_from_vault'));
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.initiate_savings_deposit(
  p_goal_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_verified jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'initiate_savings_deposit', jsonb_build_object('goal_id', p_goal_id, 'amount', p_amount));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  RETURN public.initiate_savings_deposit_core(p_goal_id, p_amount, p_method, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_savings_transaction(
  p_savings_goal_id uuid,
  p_amount numeric,
  p_type text,
  p_note text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  IF p_type = 'withdrawal' THEN
    v_verified := public.verify_transaction_pin(p_transaction_pin, 'record_savings_withdrawal', jsonb_build_object('goal_id', p_savings_goal_id, 'amount', p_amount));
    IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  END IF;
  v_result := public.record_savings_transaction_core(p_savings_goal_id, p_amount, p_type, p_note);
  IF p_type = 'withdrawal' AND COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'savings_goals', p_savings_goal_id, jsonb_build_object('purpose', 'record_savings_withdrawal'));
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.deposit_savings_from_vault(
  p_goal_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'deposit_savings_from_vault', jsonb_build_object('goal_id', p_goal_id, 'amount', p_amount));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.deposit_savings_from_vault_core(p_goal_id, p_amount, p_idempotency_key);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'savings_goals', p_goal_id, jsonb_build_object('purpose', 'deposit_savings_from_vault'));
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_payment_method(
  p_provider text,
  p_phone_number text,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'link_payment_method', jsonb_build_object('provider', p_provider));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.link_payment_method_core(p_provider, p_phone_number);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'linked_payment_methods', (v_result->>'method_id')::uuid, jsonb_build_object('purpose', 'link_payment_method'));
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.initiate_group_payment(
  p_group_id uuid,
  p_member_id uuid,
  p_period_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'cash',
  p_idempotency_key text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_verified jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'initiate_group_payment', jsonb_build_object('group_id', p_group_id, 'amount', p_amount));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  RETURN public.initiate_group_payment_core(p_group_id, p_member_id, p_period_id, p_amount, p_payment_method, p_idempotency_key, p_notes);
END;
$$;
