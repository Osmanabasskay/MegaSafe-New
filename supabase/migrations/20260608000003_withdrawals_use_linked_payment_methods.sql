-- Withdrawals must use the same verified linked payment methods as send/top-up flows.
-- The client sends only a payment_method_id; provider and phone number are resolved
-- server-side after ownership, active, and verified checks.

CREATE OR REPLACE FUNCTION public.process_withdrawal_request_with_method(
  p_savings_goal_id   uuid DEFAULT NULL,
  p_amount            numeric DEFAULT NULL,
  p_currency          text DEFAULT 'NLe',
  p_payment_method_id uuid DEFAULT NULL,
  p_idempotency_key   text DEFAULT NULL,
  p_transaction_pin   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_verified jsonb;
  v_result jsonb;
  v_method public.linked_payment_methods%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  IF p_payment_method_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Payment method is required');
  END IF;

  v_verified := public.verify_transaction_pin(
    p_transaction_pin,
    'process_withdrawal_request',
    jsonb_build_object(
      'amount', p_amount,
      'savings_goal_id', p_savings_goal_id,
      'payment_method_id', p_payment_method_id
    )
  );
  IF COALESCE((v_verified->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_verified;
  END IF;

  SELECT *
  INTO v_method
  FROM public.linked_payment_methods
  WHERE id = p_payment_method_id
    AND user_id = v_uid
    AND is_active IS TRUE
    AND is_verified IS TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment method is not linked or verified');
  END IF;

  v_result := public.process_withdrawal_request(
    p_savings_goal_id,
    p_amount,
    p_currency,
    v_method.provider,
    v_method.phone_number,
    p_idempotency_key
  );

  IF COALESCE((v_result->>'success')::boolean, false) IS TRUE THEN
    PERFORM public._transaction_pin_audit(
      v_uid,
      'MONEY_ACTION_APPROVED_WITH_PIN',
      'success',
      'withdrawal_requests',
      (v_result->>'withdrawal_id')::uuid,
      jsonb_build_object(
        'purpose', 'process_withdrawal_request',
        'payment_method_id', p_payment_method_id
      )
    );
  END IF;

  RETURN v_result;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.process_withdrawal_request(uuid, numeric, text, text, text, text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.process_withdrawal_request(uuid, numeric, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.process_withdrawal_request(uuid, numeric, text, text, text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.process_withdrawal_request(uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.process_withdrawal_request(numeric, text, text, text, uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.process_withdrawal_request(numeric, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.request_withdrawal(numeric, public.mobile_money_provider, text, uuid, uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, public.mobile_money_provider, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.process_withdrawal_request_with_method(uuid, numeric, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_withdrawal_request_with_method(uuid, numeric, text, uuid, text, text) TO authenticated;
