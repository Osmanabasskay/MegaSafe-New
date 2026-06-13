CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public._is_weak_transaction_pin(
  p_pin text,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_column text;
  v_birth_column text;
  v_phone_digits text := '';
  v_birth_year text := '';
BEGIN
  IF p_pin IN ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','1122','1212') THEN
    RETURN true;
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RETURN false;
  END IF;

  SELECT column_name
  INTO v_phone_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name IN ('phone', 'phone_number', 'mobile_number')
  ORDER BY CASE column_name
    WHEN 'phone' THEN 1
    WHEN 'phone_number' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_phone_column IS NOT NULL THEN
    EXECUTE format(
      'SELECT regexp_replace(COALESCE(%I::text, ''''), ''\D'', '''', ''g'') FROM public.profiles WHERE id::text = $1::text LIMIT 1',
      v_phone_column
    )
    INTO v_phone_digits
    USING p_user_id;
  END IF;

  IF length(COALESCE(v_phone_digits, '')) >= 4 AND p_pin = right(v_phone_digits, 4) THEN
    RETURN true;
  END IF;

  SELECT column_name
  INTO v_birth_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name IN ('date_of_birth', 'dob', 'birth_date')
  ORDER BY CASE column_name
    WHEN 'date_of_birth' THEN 1
    WHEN 'dob' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_birth_column IS NOT NULL THEN
    EXECUTE format(
      'SELECT substring(COALESCE(%I::text, '''') from ''^\d{4}'') FROM public.profiles WHERE id::text = $1::text LIMIT 1',
      v_birth_column
    )
    INTO v_birth_year
    USING p_user_id;
  END IF;

  IF length(COALESCE(v_birth_year, '')) = 4 AND p_pin = v_birth_year THEN
    RETURN true;
  END IF;

  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN p_pin IN ('0000','1111','1234','4321','1122','1212');
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

REVOKE ALL ON FUNCTION public.create_transaction_pin(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._transaction_pin_audit(uuid, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_weak_transaction_pin(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_transaction_pin(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.change_transaction_pin(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_transaction_pin_reset(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_transaction_pin(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_transaction_pin(text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_transaction_pin(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_transaction_pin_reset(text, text, text) TO authenticated;
