-- Mobile Money to Vault Top Up hardening.
-- Keeps the existing Monime payment-code implementation, but binds each top-up
-- to a verified linked mobile money method owned by the authenticated user.

ALTER TABLE public.vault_topups
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES public.linked_payment_methods(id),
  ADD COLUMN IF NOT EXISTS provider_account_masked TEXT,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.vault_topups
SET total_amount = amount + fee_amount
WHERE total_amount IS NULL;

CREATE INDEX IF NOT EXISTS vault_topups_payment_method_idx
  ON public.vault_topups(payment_method_id)
  WHERE payment_method_id IS NOT NULL;

INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'vault_topup_limits',
  jsonb_build_object(
    'min_amount', 50,
    'max_amount', 500000,
    'daily_amount', 1000000,
    'monthly_amount', 10000000,
    'hourly_attempts', 10,
    'fee_flat', 0,
    'expiry_seconds', 600
  ),
  'Server-owned limits and fee configuration for mobile money vault top-ups.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_vault_topup_limits()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.platform_settings WHERE key = 'vault_topup_limits'),
    jsonb_build_object(
      'min_amount', 50,
      'max_amount', 500000,
      'daily_amount', 1000000,
      'monthly_amount', 10000000,
      'hourly_attempts', 10,
      'fee_flat', 0,
      'expiry_seconds', 600
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_vault_topup_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vault_topup_limits() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.initiate_vault_topup_record(
  p_amount            NUMERIC,
  p_idempotency_key   TEXT,
  p_payment_method_id UUID,
  p_description       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_vault_id        UUID;
  v_topup_id        UUID;
  v_profile         RECORD;
  v_method          public.linked_payment_methods%ROWTYPE;
  v_existing        RECORD;
  v_limits          JSONB := public.get_vault_topup_limits();
  v_min_amount      NUMERIC := COALESCE((v_limits->>'min_amount')::NUMERIC, 50);
  v_max_amount      NUMERIC := COALESCE((v_limits->>'max_amount')::NUMERIC, 500000);
  v_daily_amount    NUMERIC := COALESCE((v_limits->>'daily_amount')::NUMERIC, 1000000);
  v_monthly_amount  NUMERIC := COALESCE((v_limits->>'monthly_amount')::NUMERIC, 10000000);
  v_hourly_attempts INTEGER := COALESCE((v_limits->>'hourly_attempts')::INTEGER, 10);
  v_fee             NUMERIC := COALESCE((v_limits->>'fee_flat')::NUMERIC, 0);
  v_expiry_seconds  INTEGER := COALESCE((v_limits->>'expiry_seconds')::INTEGER, 600);
  v_daily_used      NUMERIC;
  v_monthly_used    NUMERIC;
  v_prefix_ok       BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN
    RETURN jsonb_build_object('error', 'A valid idempotency key is required.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RETURN jsonb_build_object('error', 'Enter a valid NLe amount.');
  END IF;

  SELECT id, is_active, status, kyc_verified, kyc_status
  INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND OR COALESCE(v_profile.is_active, true) IS NOT TRUE OR COALESCE(v_profile.status, 'active') <> 'active' THEN
    RETURN jsonb_build_object('error', 'Your account is not eligible for vault top-ups.');
  END IF;

  IF NOT public.is_user_verified_for_transactions(v_uid) THEN
    RETURN jsonb_build_object('error', 'KYC verification required before adding money to your vault.');
  END IF;

  IF p_amount < v_min_amount THEN
    RETURN jsonb_build_object('error', 'Amount is below the allowed minimum.');
  END IF;

  IF p_amount > v_max_amount THEN
    RETURN jsonb_build_object('error', 'Amount is above the allowed maximum.');
  END IF;

  SELECT * INTO v_method
  FROM public.linked_payment_methods
  WHERE id = p_payment_method_id
    AND user_id = v_uid
    AND is_verified = TRUE
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Select an active verified mobile money account.');
  END IF;

  IF v_method.provider NOT IN ('orange_money', 'afrimoney') THEN
    RETURN jsonb_build_object('error', 'Unsupported mobile money provider.');
  END IF;

  v_prefix_ok :=
    (v_method.provider = 'orange_money' AND (
      v_method.phone_number LIKE '+23272%' OR v_method.phone_number LIKE '+23273%' OR
      v_method.phone_number LIKE '+23274%' OR v_method.phone_number LIKE '+23275%' OR
      v_method.phone_number LIKE '+23276%' OR v_method.phone_number LIKE '+23278%' OR
      v_method.phone_number LIKE '+23279%'
    ))
    OR
    (v_method.provider = 'afrimoney' AND (
      v_method.phone_number LIKE '+23230%' OR v_method.phone_number LIKE '+23233%' OR
      v_method.phone_number LIKE '+23277%' OR v_method.phone_number LIKE '+23280%' OR
      v_method.phone_number LIKE '+23288%' OR v_method.phone_number LIKE '+23290%' OR
      v_method.phone_number LIKE '+23299%'
    ));

  IF NOT v_prefix_ok THEN
    PERFORM public.create_audit_log(
      'suspicious_vault_topup_blocked', 'linked_payment_methods', v_method.id,
      NULL, jsonb_build_object('provider', v_method.provider, 'reason', 'provider_prefix_mismatch')
    );
    RETURN jsonb_build_object('error', 'This phone number does not match the selected provider.');
  END IF;

  SELECT * INTO v_existing
  FROM public.vault_topups
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'topup_id', v_existing.id,
      'vault_id', v_existing.vault_account_id,
      'payment_method_id', v_existing.payment_method_id,
      'provider', v_existing.provider_method,
      'masked_phone', v_existing.provider_account_masked,
      'amount', v_existing.amount,
      'fee', v_existing.fee_amount,
      'total_amount', COALESCE(v_existing.total_amount, v_existing.amount + v_existing.fee_amount),
      'currency', v_existing.currency,
      'status', v_existing.status,
      'monime_payment_code_id', v_existing.monime_payment_code_id,
      'ussd_code', v_existing.ussd_code,
      'expires_at', v_existing.expires_at,
      'idempotent', true
    );
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.vault_topups
    WHERE user_id = v_uid
      AND created_at > now() - INTERVAL '1 hour'
      AND status NOT IN ('failed', 'cancelled', 'expired', 'completed')
  ) >= v_hourly_attempts THEN
    RETURN jsonb_build_object('error', 'Too many top-up requests. Please wait before trying again.');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_daily_used
  FROM public.vault_topups
  WHERE user_id = v_uid
    AND created_at >= date_trunc('day', now())
    AND status NOT IN ('failed', 'cancelled', 'expired');

  IF v_daily_used + p_amount > v_daily_amount THEN
    RETURN jsonb_build_object('error', 'Daily vault top-up limit exceeded.');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_monthly_used
  FROM public.vault_topups
  WHERE user_id = v_uid
    AND created_at >= date_trunc('month', now())
    AND status NOT IN ('failed', 'cancelled', 'expired');

  IF v_monthly_used + p_amount > v_monthly_amount THEN
    RETURN jsonb_build_object('error', 'Monthly vault top-up limit exceeded.');
  END IF;

  v_vault_id := public._ensure_vault_account(v_uid);

  INSERT INTO public.vault_topups (
    user_id, vault_account_id, payment_method_id, amount, fee_amount,
    total_amount, currency, status, provider, provider_method,
    provider_account_masked, idempotency_key, description, expires_at
  ) VALUES (
    v_uid, v_vault_id, v_method.id, p_amount, v_fee,
    p_amount + v_fee, 'NLe', 'pending', 'monime', v_method.provider,
    v_method.masked_number, p_idempotency_key,
    COALESCE(p_description, 'Vault top-up via mobile money'),
    now() + make_interval(secs => v_expiry_seconds)
  ) RETURNING id INTO v_topup_id;

  PERFORM public.create_audit_log(
    'vault_topup_initiated', 'vault_topups', v_topup_id,
    NULL, jsonb_build_object('amount', p_amount, 'provider', v_method.provider, 'masked_phone', v_method.masked_number)
  );

  RETURN jsonb_build_object(
    'topup_id', v_topup_id,
    'vault_id', v_vault_id,
    'payment_method_id', v_method.id,
    'provider', v_method.provider,
    'masked_phone', v_method.masked_number,
    'amount', p_amount,
    'fee', v_fee,
    'total_amount', p_amount + v_fee,
    'currency', 'NLe',
    'status', 'pending',
    'expires_at', now() + make_interval(secs => v_expiry_seconds),
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, UUID, TEXT) TO authenticated;
