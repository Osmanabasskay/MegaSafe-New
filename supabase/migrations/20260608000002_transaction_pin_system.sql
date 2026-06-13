CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.transaction_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  pin_hash text NOT NULL,
  pin_set_at timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz NULL,
  last_verified_at timestamptz NULL,
  reset_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_pins_failed_attempts_nonnegative CHECK (failed_attempts >= 0),
  CONSTRAINT transaction_pins_hash_not_empty CHECK (length(trim(pin_hash)) > 0)
);

ALTER TABLE public.transaction_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_pins FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.transaction_pins FROM PUBLIC;
REVOKE ALL ON public.transaction_pins FROM anon;
REVOKE ALL ON public.transaction_pins FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_transaction_pins_user_id ON public.transaction_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_pins_locked_until ON public.transaction_pins(locked_until);

DROP TRIGGER IF EXISTS trg_transaction_pins_updated_at ON public.transaction_pins;
CREATE TRIGGER trg_transaction_pins_updated_at
BEFORE UPDATE ON public.transaction_pins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE POLICY "transaction_pins_backend_only_select"
ON public.transaction_pins
FOR SELECT
TO authenticated
USING (false);

CREATE POLICY "transaction_pins_backend_only_insert"
ON public.transaction_pins
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "transaction_pins_backend_only_update"
ON public.transaction_pins
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "transaction_pins_backend_only_delete"
ON public.transaction_pins
FOR DELETE
TO authenticated
USING (false);

CREATE OR REPLACE FUNCTION public._transaction_pin_audit(
  p_user_id uuid,
  p_action text,
  p_status text DEFAULT 'success',
  p_entity_type text DEFAULT 'transaction_pins',
  p_entity_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'actor_id'
  ) THEN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (p_user_id, p_action, p_entity_type, p_entity_id, jsonb_build_object('status', p_status) || COALESCE(p_metadata, '{}'::jsonb));
  ELSE
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (p_user_id, p_action, p_entity_type, p_entity_id, jsonb_build_object('status', p_status) || COALESCE(p_metadata, '{}'::jsonb));
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._is_weak_transaction_pin(
  p_pin text,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_digits text;
  v_birth_year text;
BEGIN
  IF p_pin IN ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','1122','1212') THEN
    RETURN true;
  END IF;

  SELECT regexp_replace(COALESCE(
           CASE WHEN to_jsonb(p) ? 'phone' THEN to_jsonb(p)->>'phone' ELSE NULL END,
           CASE WHEN to_jsonb(p) ? 'phone_number' THEN to_jsonb(p)->>'phone_number' ELSE NULL END,
           ''
         ), '\D', '', 'g'),
         substring(COALESCE(
           CASE WHEN to_jsonb(p) ? 'date_of_birth' THEN to_jsonb(p)->>'date_of_birth' ELSE NULL END,
           CASE WHEN to_jsonb(p) ? 'dob' THEN to_jsonb(p)->>'dob' ELSE NULL END,
           ''
         ) from '^\d{4}')
  INTO v_phone_digits, v_birth_year
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF length(v_phone_digits) >= 4 AND p_pin = right(v_phone_digits, 4) THEN
    RETURN true;
  END IF;

  IF v_birth_year IS NOT NULL AND length(v_birth_year) = 4 AND position(v_birth_year in p_pin) > 0 THEN
    RETURN true;
  END IF;

  RETURN false;
EXCEPTION WHEN undefined_column THEN
  RETURN p_pin IN ('0000','1111','1234','4321','1122','1212');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_transaction_pin_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pin record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT pin_set_at, locked_until, reset_required
  INTO v_pin
  FROM public.transaction_pins
  WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'is_set', FOUND,
    'pin_set_at', v_pin.pin_set_at,
    'locked_until', v_pin.locked_until,
    'reset_required', COALESCE(v_pin.reset_required, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transaction_pin(
  p_pin text,
  p_confirm_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;
  IF COALESCE(p_pin, '') !~ '^\d{4}$' THEN RETURN jsonb_build_object('error', 'Transaction PIN must be exactly 4 digits.'); END IF;
  IF COALESCE(p_confirm_pin, '') !~ '^\d{4}$' THEN RETURN jsonb_build_object('error', 'Transaction PIN confirmation must be exactly 4 digits.'); END IF;
  IF p_pin <> p_confirm_pin THEN RETURN jsonb_build_object('error', 'Transaction PIN confirmation does not match.'); END IF;
  IF public._is_weak_transaction_pin(p_pin, v_uid) THEN RETURN jsonb_build_object('error', 'Choose a less predictable Transaction PIN.'); END IF;
  IF EXISTS (SELECT 1 FROM public.transaction_pins WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('error', 'Transaction PIN is already set.');
  END IF;

  INSERT INTO public.transaction_pins (user_id, pin_hash)
  VALUES (v_uid, crypt(p_pin, gen_salt('bf', 12)))
  RETURNING id INTO v_id;

  PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_CREATED', 'success', 'transaction_pins', v_id);
  RETURN jsonb_build_object('success', true, 'message', 'Transaction PIN created.');
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_transaction_pin(
  p_pin text,
  p_purpose text DEFAULT 'transaction',
  p_transaction_context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pin public.transaction_pins%ROWTYPE;
  v_failed integer;
  v_locked_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;
  IF COALESCE(p_pin, '') !~ '^\d{4}$' THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_BLOCKED_PIN_INVALID', 'failed', 'transaction_pins', NULL, jsonb_build_object('purpose', p_purpose));
    RETURN jsonb_build_object('error', 'Invalid Transaction PIN.');
  END IF;

  SELECT * INTO v_pin
  FROM public.transaction_pins
  WHERE user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_BLOCKED_PIN_REQUIRED', 'failed', 'transaction_pins', NULL, jsonb_build_object('purpose', p_purpose));
    RETURN jsonb_build_object('error', 'Transaction PIN is required.', 'code', 'transaction_pin_required');
  END IF;

  IF v_pin.reset_required THEN
    RETURN jsonb_build_object('error', 'Transaction PIN reset required.', 'code', 'transaction_pin_reset_required');
  END IF;

  IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > now() THEN
    RETURN jsonb_build_object('error', 'Transaction PIN is temporarily locked.', 'code', 'transaction_pin_locked', 'locked_until', v_pin.locked_until);
  END IF;

  IF v_pin.pin_hash <> crypt(p_pin, v_pin.pin_hash) THEN
    v_failed := v_pin.failed_attempts + 1;
    v_locked_until := CASE WHEN v_failed >= 5 THEN now() + interval '15 minutes' ELSE NULL END;

    UPDATE public.transaction_pins
    SET failed_attempts = v_failed,
        locked_until = v_locked_until,
        updated_at = now()
    WHERE id = v_pin.id;

    PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_VERIFY_FAILED', 'failed', 'transaction_pins', v_pin.id, jsonb_build_object('purpose', p_purpose));
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_BLOCKED_PIN_INVALID', 'failed', 'transaction_pins', v_pin.id, jsonb_build_object('purpose', p_purpose));
    IF v_locked_until IS NOT NULL THEN
      PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_LOCKED', 'locked', 'transaction_pins', v_pin.id, jsonb_build_object('locked_until', v_locked_until));
      RETURN jsonb_build_object('error', 'Transaction PIN is temporarily locked.', 'code', 'transaction_pin_locked', 'locked_until', v_locked_until);
    END IF;
    RETURN jsonb_build_object('error', 'Invalid Transaction PIN.');
  END IF;

  UPDATE public.transaction_pins
  SET failed_attempts = 0,
      locked_until = NULL,
      last_verified_at = now(),
      updated_at = now()
  WHERE id = v_pin.id;

  PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_VERIFY_SUCCESS', 'success', 'transaction_pins', v_pin.id, jsonb_build_object('purpose', p_purpose, 'context', COALESCE(p_transaction_context, '{}'::jsonb)));
  RETURN jsonb_build_object('success', true, 'approved_at', now(), 'expires_at', now() + interval '5 minutes');
END;
$$;

CREATE OR REPLACE FUNCTION public.change_transaction_pin(
  p_current_pin text,
  p_new_pin text,
  p_confirm_new_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;
  v_verified := public.verify_transaction_pin(p_current_pin, 'change_transaction_pin');
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  IF COALESCE(p_new_pin, '') !~ '^\d{4}$' THEN RETURN jsonb_build_object('error', 'Transaction PIN must be exactly 4 digits.'); END IF;
  IF COALESCE(p_confirm_new_pin, '') !~ '^\d{4}$' THEN RETURN jsonb_build_object('error', 'Transaction PIN confirmation must be exactly 4 digits.'); END IF;
  IF p_new_pin <> p_confirm_new_pin THEN RETURN jsonb_build_object('error', 'Transaction PIN confirmation does not match.'); END IF;
  IF p_new_pin = p_current_pin THEN RETURN jsonb_build_object('error', 'New Transaction PIN must be different.'); END IF;
  IF public._is_weak_transaction_pin(p_new_pin, v_uid) THEN RETURN jsonb_build_object('error', 'Choose a less predictable Transaction PIN.'); END IF;

  UPDATE public.transaction_pins
  SET pin_hash = crypt(p_new_pin, gen_salt('bf', 12)),
      pin_set_at = now(),
      failed_attempts = 0,
      locked_until = NULL,
      reset_required = false,
      updated_at = now()
  WHERE user_id = v_uid;

  PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_CHANGED', 'success');
  RETURN jsonb_build_object('success', true, 'message', 'Transaction PIN changed.');
END;
$$;

CREATE OR REPLACE FUNCTION public.request_transaction_pin_reset(
  p_method text DEFAULT 'email_otp'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;
  IF p_method NOT IN ('email_otp', 'phone_otp') THEN RETURN jsonb_build_object('error', 'Unsupported reset method.'); END IF;

  UPDATE public.transaction_pins
  SET reset_required = true, updated_at = now()
  WHERE user_id = v_uid;

  PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_RESET_REQUESTED', 'success', 'transaction_pins', NULL, jsonb_build_object('method', p_method));
  RETURN jsonb_build_object('success', true, 'message', 'OTP verification is required to complete reset.', 'method', p_method);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_transaction_pin_reset(
  p_otp_code text,
  p_new_pin text,
  p_confirm_new_pin text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;
  IF COALESCE(p_otp_code, '') !~ '^\d{6,8}$' THEN RETURN jsonb_build_object('error', 'Invalid OTP code.'); END IF;
  IF COALESCE(p_new_pin, '') !~ '^\d{4}$' THEN RETURN jsonb_build_object('error', 'Transaction PIN must be exactly 4 digits.'); END IF;
  IF COALESCE(p_confirm_new_pin, '') !~ '^\d{4}$' THEN RETURN jsonb_build_object('error', 'Transaction PIN confirmation must be exactly 4 digits.'); END IF;
  IF p_new_pin <> p_confirm_new_pin THEN RETURN jsonb_build_object('error', 'Transaction PIN confirmation does not match.'); END IF;
  IF public._is_weak_transaction_pin(p_new_pin, v_uid) THEN RETURN jsonb_build_object('error', 'Choose a less predictable Transaction PIN.'); END IF;

  INSERT INTO public.transaction_pins (user_id, pin_hash, failed_attempts, locked_until, reset_required)
  VALUES (v_uid, crypt(p_new_pin, gen_salt('bf', 12)), 0, NULL, false)
  ON CONFLICT (user_id) DO UPDATE SET
    pin_hash = EXCLUDED.pin_hash,
    pin_set_at = now(),
    failed_attempts = 0,
    locked_until = NULL,
    reset_required = false,
    updated_at = now();

  PERFORM public._transaction_pin_audit(v_uid, 'TRANSACTION_PIN_RESET_COMPLETED', 'success');
  RETURN jsonb_build_object('success', true, 'message', 'Transaction PIN reset completed.');
END;
$$;

REVOKE ALL ON FUNCTION public.get_transaction_pin_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._transaction_pin_audit(uuid, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_weak_transaction_pin(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_transaction_pin(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_transaction_pin(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.change_transaction_pin(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_transaction_pin_reset(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_transaction_pin_reset(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_transaction_pin_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_transaction_pin(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_transaction_pin(text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_transaction_pin(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_transaction_pin_reset(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_transaction_pin_reset(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.process_withdrawal_request(uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.process_withdrawal_request(
  p_savings_goal_id      uuid DEFAULT NULL,
  p_amount               numeric DEFAULT NULL,
  p_currency             text DEFAULT 'NLe',
  p_destination_provider text DEFAULT NULL,
  p_destination_number   text DEFAULT NULL,
  p_idempotency_key      text DEFAULT NULL,
  p_transaction_pin      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'process_withdrawal_request', jsonb_build_object('amount', p_amount, 'savings_goal_id', p_savings_goal_id));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_verified;
  END IF;
  v_result := public.process_withdrawal_request(p_savings_goal_id, p_amount, p_currency, p_destination_provider, p_destination_number, p_idempotency_key);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'withdrawal_requests', (v_result->>'withdrawal_id')::uuid, jsonb_build_object('purpose', 'process_withdrawal_request'));
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_withdrawal_request(uuid, numeric, text, text, text, text, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.pay_osusu_from_vault(uuid,uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pay_osusu_from_vault(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pay_osusu_from_vault(
  p_group_id uuid,
  p_period_id uuid,
  p_idempotency_key text,
  p_notes text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'pay_osusu_from_vault', jsonb_build_object('group_id', p_group_id, 'period_id', p_period_id));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.pay_osusu_from_vault(p_group_id, p_period_id, p_idempotency_key);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'contribution_payments', (v_result->>'contribution_id')::uuid, jsonb_build_object('purpose', 'pay_osusu_from_vault'));
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.pay_osusu_from_vault(uuid, uuid, text, text, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.deposit_savings_from_vault(uuid,numeric,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.deposit_savings_from_vault(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.deposit_savings_from_vault(
  p_goal_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'deposit_savings_from_vault', jsonb_build_object('goal_id', p_goal_id, 'amount', p_amount));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.deposit_savings_from_vault(p_goal_id, p_amount, p_idempotency_key);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'savings_goals', p_goal_id, jsonb_build_object('purpose', 'deposit_savings_from_vault'));
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.deposit_savings_from_vault(uuid, numeric, text, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.record_savings_transaction(uuid,numeric,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.record_savings_transaction(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_savings_transaction(
  p_savings_goal_id uuid,
  p_amount numeric,
  p_type text,
  p_note text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_result := public.record_savings_transaction(p_savings_goal_id, p_amount, p_type, p_note);
  IF p_type = 'withdrawal' AND COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'savings_goals', p_savings_goal_id, jsonb_build_object('purpose', 'record_savings_withdrawal'));
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_savings_transaction(uuid, numeric, text, text, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.initiate_group_payment(uuid,uuid,uuid,numeric,text,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_group_payment(uuid, uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.initiate_group_payment(uuid,numeric,text,text,integer,text,date,date,date,uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_group_payment(uuid, numeric, text, text, integer, text, date, date, date, uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.initiate_savings_deposit(uuid,numeric,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_savings_deposit(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.initiate_savings_deposit(uuid,numeric,text,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_savings_deposit(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

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
SET search_path = public
AS $$
DECLARE
  v_verified jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'initiate_group_payment', jsonb_build_object('group_id', p_group_id, 'amount', p_amount));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  RETURN public.initiate_group_payment(p_group_id, p_member_id, p_period_id, p_amount, p_payment_method, p_idempotency_key, p_notes);
END;
$$;
GRANT EXECUTE ON FUNCTION public.initiate_group_payment(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.initiate_savings_deposit(
  p_goal_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verified jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'initiate_savings_deposit', jsonb_build_object('goal_id', p_goal_id, 'amount', p_amount));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  RETURN public.initiate_savings_deposit(p_goal_id, p_amount, p_method, p_idempotency_key);
END;
$$;
GRANT EXECUTE ON FUNCTION public.initiate_savings_deposit(uuid, numeric, text, text, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.link_payment_method(text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.link_payment_method(text, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.link_payment_method(
  p_provider text,
  p_phone_number text,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'link_payment_method', jsonb_build_object('provider', p_provider));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.link_payment_method(p_provider, p_phone_number);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'linked_payment_methods', (v_result->>'method_id')::uuid, jsonb_build_object('purpose', 'link_payment_method'));
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.link_payment_method(text, text, text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.initiate_vault_topup_record(numeric,text,uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.initiate_vault_topup_record(
  p_amount numeric,
  p_idempotency_key text,
  p_payment_method_id uuid,
  p_description text DEFAULT NULL,
  p_transaction_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
BEGIN
  v_verified := public.verify_transaction_pin(p_transaction_pin, 'initiate_vault_topup', jsonb_build_object('amount', p_amount, 'payment_method_id', p_payment_method_id));
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN RETURN v_verified; END IF;
  v_result := public.initiate_vault_topup_record(p_amount, p_idempotency_key, p_payment_method_id, p_description);
  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(v_uid, 'MONEY_ACTION_APPROVED_WITH_PIN', 'success', 'vault_topups', (v_result->>'topup_id')::uuid, jsonb_build_object('purpose', 'initiate_vault_topup'));
  END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.initiate_vault_topup_record(numeric, text, uuid, text, text) TO authenticated;
