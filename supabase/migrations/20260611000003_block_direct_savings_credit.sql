-- ============================================================================
-- Monime payment hardening — Part 3: block direct savings crediting
--
-- initiate_savings_deposit used to credit savings_goals.current_amount
-- immediately via record_savings_transaction, without any money being
-- collected. With withdrawals paying out real money, this allowed a client to
-- mint a fake savings balance and cash it out.
--
-- Mobile-money savings deposits now flow exclusively through:
--   create-send-payment-intent → confirm-send-payment (Monime payment code)
--   → mobile-money-webhook → finalize_savings_deposit (credits after the
--   provider confirms payment).
--
-- Vault-funded deposits use deposit_savings_from_vault (internal transfer,
-- balance-checked).
--
-- The 4-arg base and 5-arg PIN wrapper are kept (callers get a clear error
-- instead of PGRST function-not-found), but they no longer move money.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.initiate_savings_deposit(
  p_goal_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_goal   public.savings_goals%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN jsonb_build_object('error','Amount must be positive'); END IF;

  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND user_id = v_caller;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Goal not found or not yours'); END IF;
  IF v_goal.status <> 'active' THEN RETURN jsonb_build_object('error','Goal is not active'); END IF;

  -- Direct crediting is forbidden: money must be collected first.
  PERFORM public.create_audit_log('savings_deposit_initiated','savings_goals',p_goal_id,NULL,
    jsonb_build_object('amount',p_amount,'method',COALESCE(p_method,'unknown'),
      'idempotency_key',COALESCE(p_idempotency_key,''),
      'blocked','direct_credit_not_allowed'));

  RETURN jsonb_build_object(
    'error','Savings deposits must be paid through mobile money (Send flow) or from your vault. Direct deposits are not supported.',
    'code','use_send_flow'
  );
END;
$$;
