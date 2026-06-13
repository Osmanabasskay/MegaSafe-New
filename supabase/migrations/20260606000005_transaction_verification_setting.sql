-- Admin-configurable verification gate for transaction and money movement flows.
-- Default is ON to preserve current production behavior until an admin disables it.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS "platform_settings_read_authenticated" ON public.platform_settings;
CREATE POLICY "platform_settings_read_authenticated"
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "platform_settings_admin_write" ON public.platform_settings;
CREATE POLICY "platform_settings_admin_write"
  ON public.platform_settings
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'verification_required_for_transactions',
  'true'::jsonb,
  'When true, users must be KYC/admin verified before transaction and money movement flows.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_transaction_verification_required()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN jsonb_typeof(value) = 'boolean' THEN (value #>> '{}')::boolean
          WHEN jsonb_typeof(value) = 'object' THEN COALESCE((value->>'enabled')::boolean, true)
          ELSE true
        END
      FROM public.platform_settings
      WHERE key = 'verification_required_for_transactions'
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_user_verified_for_transactions(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT public.is_transaction_verification_required()
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = p_user_id
        AND (kyc_verified = true OR kyc_status = 'approved')
    );
$$;

CREATE OR REPLACE FUNCTION public.set_transaction_verification_required(p_required BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin UUID := auth.uid();
BEGIN
  IF v_admin IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can update transaction verification settings.';
  END IF;

  INSERT INTO public.platform_settings (key, value, description, updated_by, updated_at)
  VALUES (
    'verification_required_for_transactions',
    to_jsonb(p_required),
    'When true, users must be KYC/admin verified before transaction and money movement flows.',
    v_admin,
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  RETURN jsonb_build_object(
    'key', 'verification_required_for_transactions',
    'required', p_required
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_transaction_verification_required() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_user_verified_for_transactions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_transaction_verification_required(BOOLEAN) FROM PUBLIC;

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_transaction_verification_required() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_user_verified_for_transactions(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_transaction_verification_required(BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_withdrawal_request(
  p_savings_goal_id      UUID DEFAULT NULL,
  p_amount               NUMERIC DEFAULT NULL,
  p_currency             TEXT DEFAULT 'NLe',
  p_destination_provider TEXT DEFAULT NULL,
  p_destination_number   TEXT DEFAULT NULL,
  p_idempotency_key      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_vault      public.vault_accounts%ROWTYPE;
  v_balance    NUMERIC(15,2);
  v_goal       public.savings_goals%ROWTYPE;
  v_request_id UUID;
  v_ikey       TEXT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error', 'Amount must be positive'); END IF;
  IF trim(COALESCE(p_destination_number, '')) = '' THEN
    RETURN jsonb_build_object('error', 'Destination number is required');
  END IF;

  IF NOT public.is_user_verified_for_transactions(v_caller) THEN
    RETURN jsonb_build_object('error', 'KYC verification required before withdrawal');
  END IF;

  v_ikey := COALESCE(p_idempotency_key, gen_random_uuid()::TEXT);

  SELECT id INTO v_request_id
  FROM public.withdrawal_requests
  WHERE idempotency_key = v_ikey AND user_id = v_caller;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'withdrawal_id', v_request_id, 'idempotent', true);
  END IF;

  IF p_savings_goal_id IS NOT NULL THEN
    SELECT * INTO v_goal
    FROM public.savings_goals
    WHERE id = p_savings_goal_id AND user_id = v_caller;

    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Savings goal not found'); END IF;
    IF v_goal.status <> 'active' THEN RETURN jsonb_build_object('error', 'Savings goal is not active'); END IF;
    IF v_goal.current_amount < p_amount THEN
      RETURN jsonb_build_object('error', 'Insufficient savings balance');
    END IF;

    INSERT INTO public.withdrawal_requests (
      user_id, savings_goal_id, amount, currency,
      destination_provider, destination_number, status, idempotency_key, requested_at
    ) VALUES (
      v_caller, p_savings_goal_id, p_amount, p_currency,
      p_destination_provider::mobile_money_provider, p_destination_number, 'pending', v_ikey, now()
    ) RETURNING id INTO v_request_id;
  ELSE
    SELECT va.* INTO v_vault
    FROM public.vault_accounts va
    WHERE va.user_id = v_caller
    LIMIT 1;

    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'No vault account found'); END IF;

    SELECT COALESCE(SUM(CASE WHEN type::TEXT = 'credit' THEN amount ELSE -amount END), 0)
    INTO v_balance
    FROM public.vault_transactions
    WHERE vault_id = v_vault.id;

    IF v_balance < p_amount THEN
      RETURN jsonb_build_object('error', 'Insufficient vault balance');
    END IF;

    INSERT INTO public.withdrawal_requests (
      user_id, vault_id, amount, currency,
      destination_provider, destination_number, status, idempotency_key, requested_at
    ) VALUES (
      v_caller, v_vault.id, p_amount, p_currency,
      p_destination_provider::mobile_money_provider, p_destination_number, 'pending', v_ikey, now()
    ) RETURNING id INTO v_request_id;
  END IF;

  PERFORM public.create_audit_log(
    'withdrawal_requested',
    'withdrawal_requests',
    v_request_id,
    NULL,
    jsonb_build_object('amount', p_amount, 'destination', p_destination_provider)
  );

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.process_withdrawal_request(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_withdrawal_request(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.initiate_vault_topup_record(
  p_amount          NUMERIC,
  p_idempotency_key TEXT,
  p_provider_method TEXT DEFAULT NULL,
  p_description     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_vault_id       UUID;
  v_topup_id       UUID;
  v_account_status TEXT;
  v_existing       RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than zero.');
  END IF;

  IF NOT public.is_user_verified_for_transactions(v_uid) THEN
    RETURN jsonb_build_object('error', 'KYC verification required before adding money to your vault.');
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.vault_topups
    WHERE user_id = v_uid
      AND created_at > now() - INTERVAL '1 hour'
      AND status NOT IN ('failed', 'cancelled', 'expired')
  ) >= 10 THEN
    RETURN jsonb_build_object('error', 'Too many top-up requests. Please wait before trying again.');
  END IF;

  v_vault_id := public._ensure_vault_account(v_uid);

  SELECT status INTO v_account_status
  FROM public.vault_accounts
  WHERE id = v_vault_id;

  IF v_account_status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Your vault account is not active. Contact support.');
  END IF;

  SELECT * INTO v_existing
  FROM public.vault_topups
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'topup_id', v_existing.id,
      'vault_id', v_existing.vault_account_id,
      'amount', v_existing.amount,
      'status', v_existing.status,
      'monime_payment_code_id', v_existing.monime_payment_code_id,
      'ussd_code', v_existing.ussd_code,
      'idempotent', true
    );
  END IF;

  INSERT INTO public.vault_topups (
    user_id, vault_account_id, amount, fee_amount, currency,
    status, provider, provider_method, idempotency_key, description
  ) VALUES (
    v_uid, v_vault_id, p_amount, 0, 'NLe',
    'pending', 'monime', p_provider_method,
    p_idempotency_key,
    COALESCE(p_description, 'Vault top-up via ' || COALESCE(p_provider_method, 'mobile money'))
  ) RETURNING id INTO v_topup_id;

  PERFORM public.create_audit_log(
    'vault_tx_created',
    'vault_topups',
    v_topup_id,
    NULL,
    jsonb_build_object('amount', p_amount, 'user_id', v_uid, 'action', 'topup_initiated')
  );

  RETURN jsonb_build_object(
    'topup_id', v_topup_id,
    'vault_id', v_vault_id,
    'amount', p_amount,
    'status', 'pending',
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
