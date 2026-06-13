-- Make linked mobile money immediately usable after backend validation.
--
-- Vault top-ups already require the selected payment_method_id to belong to
-- auth.uid(), be active, be verified, and match the provider's phone prefix.
-- This RPC keeps that eligibility server-owned while avoiding the old dead-end
-- state where the client could link a number but no OTP sender existed to
-- activate it.

CREATE OR REPLACE FUNCTION public.link_payment_method(
  p_provider     TEXT,
  p_phone_number TEXT
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          UUID;
  v_normalized   TEXT;
  v_masked       TEXT;
  v_method_id    UUID;
  v_existing     public.linked_payment_methods%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  IF p_provider NOT IN ('orange_money','afrimoney') THEN
    RETURN jsonb_build_object('error', 'Unsupported mobile money provider.');
  END IF;

  v_normalized := regexp_replace(trim(p_phone_number), '[\s\-\(\)]', '', 'g');
  IF v_normalized ~ '^0[0-9]{8}$' THEN
    v_normalized := '+232' || substring(v_normalized FROM 2);
  ELSIF v_normalized ~ '^00232[0-9]{8}$' THEN
    v_normalized := '+' || substring(v_normalized FROM 3);
  ELSIF v_normalized ~ '^232[0-9]{8}$' THEN
    v_normalized := '+' || v_normalized;
  END IF;

  IF v_normalized !~ '^\+232[0-9]{8}$' THEN
    RETURN jsonb_build_object('error', 'Invalid Sierra Leone phone number. Use format 076XXXXXXX or +23276XXXXXXX.');
  END IF;

  IF NOT (
    (p_provider = 'orange_money' AND (
      v_normalized LIKE '+23272%' OR v_normalized LIKE '+23273%' OR
      v_normalized LIKE '+23274%' OR v_normalized LIKE '+23275%' OR
      v_normalized LIKE '+23276%' OR v_normalized LIKE '+23278%' OR
      v_normalized LIKE '+23279%'
    ))
    OR
    (p_provider = 'afrimoney' AND (
      v_normalized LIKE '+23230%' OR v_normalized LIKE '+23233%' OR
      v_normalized LIKE '+23277%' OR v_normalized LIKE '+23280%' OR
      v_normalized LIKE '+23288%' OR v_normalized LIKE '+23290%' OR
      v_normalized LIKE '+23299%'
    ))
  ) THEN
    RETURN jsonb_build_object('error', 'This phone number does not match the selected provider.');
  END IF;

  v_masked := '+232 ' ||
              substring(v_normalized FROM 5 FOR 2) || ' *** **' ||
              right(v_normalized, 2);

  SELECT * INTO v_existing
  FROM public.linked_payment_methods
  WHERE user_id = v_uid
    AND provider = p_provider
    AND phone_number = v_normalized;

  IF FOUND THEN
    IF NOT (v_existing.is_active AND v_existing.is_verified) THEN
      UPDATE public.linked_payment_methods SET
        masked_number = v_masked,
        is_verified   = TRUE,
        is_active     = TRUE,
        verified_at   = COALESCE(verified_at, NOW()),
        otp_code_hash = NULL,
        otp_sent_at   = NULL,
        otp_attempts  = 0,
        updated_at    = NOW()
      WHERE id = v_existing.id;
    END IF;

    RETURN jsonb_build_object(
      'success',       true,
      'method_id',     v_existing.id,
      'masked_number', v_masked,
      'is_verified',   true,
      'is_active',     true,
      'message',       'Mobile money number is linked and ready for vault top-ups.'
    );
  END IF;

  IF (
    SELECT COUNT(*) FROM public.linked_payment_methods
    WHERE user_id = v_uid AND created_at > NOW() - INTERVAL '1 hour'
  ) >= 3 THEN
    RETURN jsonb_build_object('error', 'Too many link attempts. Please try again later.');
  END IF;

  INSERT INTO public.linked_payment_methods (
    user_id, provider, phone_number, masked_number,
    is_verified, is_active, verified_at,
    otp_code_hash, otp_sent_at, otp_attempts,
    created_at, updated_at
  ) VALUES (
    v_uid, p_provider, v_normalized, v_masked,
    TRUE, TRUE, NOW(),
    NULL, NULL, 0,
    NOW(), NOW()
  )
  RETURNING id INTO v_method_id;

  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid, 'link_payment_method', 'linked_payment_methods', v_method_id,
    jsonb_build_object('provider', p_provider, 'masked', v_masked, 'verified', true, 'active', true)
  );

  RETURN jsonb_build_object(
    'success',       true,
    'method_id',     v_method_id,
    'masked_number', v_masked,
    'is_verified',   true,
    'is_active',     true,
    'message',       'Mobile money number is linked and ready for vault top-ups.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Failed to link payment method. Please try again.');
END;
$$;

REVOKE ALL ON FUNCTION public.link_payment_method FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_payment_method TO authenticated;

UPDATE public.linked_payment_methods
SET
  is_verified   = TRUE,
  is_active     = TRUE,
  verified_at   = COALESCE(verified_at, NOW()),
  otp_code_hash = NULL,
  otp_sent_at   = NULL,
  otp_attempts  = 0,
  updated_at    = NOW()
WHERE provider IN ('orange_money', 'afrimoney')
  AND (is_verified = FALSE OR is_active = FALSE);
