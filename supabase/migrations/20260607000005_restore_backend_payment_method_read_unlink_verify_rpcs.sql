-- Restore backend-owned payment method listing and management RPCs.
-- The client must never read raw phone numbers directly; these functions return
-- only masked numbers and derive ownership from auth.uid().

CREATE OR REPLACE FUNCTION public.get_my_payment_methods()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  RETURN jsonb_build_object(
    'methods',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',            m.id,
            'provider',      m.provider,
            'masked_number', m.masked_number,
            'is_verified',   m.is_verified,
            'is_active',     m.is_active,
            'verified_at',   m.verified_at,
            'created_at',    m.created_at
          )
          ORDER BY m.created_at DESC
        )
        FROM public.linked_payment_methods m
        WHERE m.user_id = v_uid
      ),
      '[]'::jsonb
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_payment_method(
  p_method_id UUID
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID;
  v_method public.linked_payment_methods%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT * INTO v_method
  FROM public.linked_payment_methods
  WHERE id = p_method_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment method not found.');
  END IF;

  IF v_method.user_id <> v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied.');
  END IF;

  DELETE FROM public.linked_payment_methods WHERE id = p_method_id;

  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data)
  VALUES (
    v_uid, 'unlink_payment_method', 'linked_payment_methods', p_method_id,
    jsonb_build_object('provider', v_method.provider, 'masked', v_method.masked_number)
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Failed to unlink payment method. Please try again.');
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_payment_method(
  p_method_id UUID,
  p_otp_code  TEXT
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID;
  v_method public.linked_payment_methods%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT * INTO v_method
  FROM public.linked_payment_methods
  WHERE id = p_method_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment method not found.');
  END IF;

  IF v_method.user_id <> v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied.');
  END IF;

  IF v_method.is_verified AND v_method.is_active THEN
    RETURN jsonb_build_object('success', true, 'is_active', true);
  END IF;

  IF v_method.otp_code_hash IS NULL THEN
    RETURN jsonb_build_object('error', 'This payment method cannot be verified with an OTP code. Please link it again.');
  END IF;

  IF v_method.otp_sent_at IS NULL OR v_method.otp_sent_at < NOW() - INTERVAL '10 minutes' THEN
    RETURN jsonb_build_object('error', 'Verification code has expired. Please request a new one.');
  END IF;

  IF v_method.otp_attempts >= 3 THEN
    RETURN jsonb_build_object('error', 'Too many failed attempts. Please request a new verification code.');
  END IF;

  IF encode(sha256(p_otp_code::bytea), 'hex') <> v_method.otp_code_hash THEN
    UPDATE public.linked_payment_methods
    SET otp_attempts = otp_attempts + 1, updated_at = NOW()
    WHERE id = p_method_id;

    RETURN jsonb_build_object('error', 'Invalid verification code.');
  END IF;

  UPDATE public.linked_payment_methods SET
    is_verified   = TRUE,
    is_active     = TRUE,
    verified_at   = NOW(),
    otp_code_hash = NULL,
    otp_sent_at   = NULL,
    otp_attempts  = 0,
    updated_at    = NOW()
  WHERE id = p_method_id;

  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid, 'verify_payment_method', 'linked_payment_methods', p_method_id,
    jsonb_build_object('provider', v_method.provider, 'masked', v_method.masked_number, 'verified', true)
  );

  RETURN jsonb_build_object('success', true, 'is_active', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Verification failed. Please try again.');
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_payment_methods() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_payment_methods() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_methods() TO authenticated;

REVOKE ALL ON FUNCTION public.unlink_payment_method(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlink_payment_method(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlink_payment_method(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_payment_method(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_payment_method(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_payment_method(UUID, TEXT) TO authenticated;
