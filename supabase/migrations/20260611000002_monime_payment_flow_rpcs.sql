-- ============================================================================
-- Monime payment hardening — Part 2: payment flow RPCs
--
-- Contents (all confirmed against the live schema before writing):
--   A. Transaction-PIN wrapper overloads that exist in the repo migration
--      20260608000002_transaction_pin_system.sql but were never applied to the
--      live DB ("transaction_pin_core_live_fix" only shipped the PIN core).
--      Without them, every edge function passing p_transaction_pin gets
--      PGRST202 (function not found).
--   B. pay_osusu_from_vault: resolves the group's open payment period
--      server-side when p_period_id is NULL (vaultService passes NULL).
--   C. finalize_send_payment — webhook-driven finalizer for send→group.
--   D. finalize_savings_deposit — webhook-driven finalizer for send→savings.
--      Savings goals are credited HERE and only here for mobile-money
--      deposits; never at confirm time.
--   E. fail_send_payment_intent — marks send intents failed/expired/cancelled.
--   F. record_monime_payout_result — upgraded: also drives the withdrawal's
--      main status (processing → completed/failed), is idempotent, and never
--      downgrades a completed payout.
--   G. approve_withdrawal_request — now leaves the withdrawal in 'processing'
--      until the payout webhook confirms the disbursement (it previously
--      jumped straight to 'completed' before any money moved).
--   H. fail_monime_checkout / finalize_monime_checkout — repaired latent
--      bugs: an INSERT into audit_logs with non-existent columns
--      (changed_by/new_values), an UPDATE on contribution_payments touching a
--      non-existent updated_at column, and comparisons against enum labels
--      that did not exist before Part 1.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- A. Transaction-PIN wrapper overloads
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.initiate_group_payment(uuid,uuid,uuid,numeric,text,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_group_payment(uuid, uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.initiate_savings_deposit(uuid,numeric,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_savings_deposit(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.pay_osusu_from_vault(uuid,uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.pay_osusu_from_vault(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.record_savings_transaction(uuid,numeric,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.record_savings_transaction(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.deposit_savings_from_vault(uuid,numeric,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.deposit_savings_from_vault(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.link_payment_method(text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.link_payment_method(text, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.initiate_vault_topup_record(numeric,text,uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
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
REVOKE ALL ON FUNCTION public.initiate_group_payment(uuid, uuid, uuid, numeric, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_group_payment(uuid, uuid, uuid, numeric, text, text, text, text) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.initiate_savings_deposit(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_savings_deposit(uuid, numeric, text, text, text) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.pay_osusu_from_vault(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_osusu_from_vault(uuid, uuid, text, text, text) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.record_savings_transaction(uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_savings_transaction(uuid, numeric, text, text, text) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.deposit_savings_from_vault(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deposit_savings_from_vault(uuid, numeric, text, text) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.link_payment_method(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_payment_method(text, text, text) TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(numeric, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_vault_topup_record(numeric, text, uuid, text, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- B. pay_osusu_from_vault base — resolve the open period when none is given
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pay_osusu_from_vault(
  p_group_id uuid,
  p_period_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_vault_id         UUID;
  v_kyc_status       TEXT;
  v_account_status   TEXT;
  v_group            RECORD;
  v_period           RECORD;
  v_is_member        BOOLEAN;
  v_fee_result       JSONB;
  v_contribution_amt NUMERIC(12,2);
  v_fee_amt          NUMERIC(12,2);
  v_total_debit      NUMERIC(12,2);
  v_existing_payment RECORD;
  v_contrib_id       UUID;
  v_reservation_id   UUID;
  v_receipt          TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Not authenticated.'); END IF;

  SELECT kyc_status INTO v_kyc_status FROM public.profiles WHERE id = v_uid;
  IF v_kyc_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('error','KYC verification required to make Osusu contributions.');
  END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Group not found.'); END IF;
  IF v_group.status::TEXT <> 'active' THEN
    RETURN jsonb_build_object('error','This group is not active.');
  END IF;

  SELECT is_active INTO v_is_member FROM public.osusu_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;
  IF NOT FOUND OR NOT v_is_member THEN
    RETURN jsonb_build_object('error','You are not an active member of this group.');
  END IF;

  -- Resolve the open period server-side when the caller does not name one.
  IF p_period_id IS NULL THEN
    SELECT * INTO v_period FROM public.payment_periods
    WHERE group_id = p_group_id
      AND status::TEXT = 'open'
      AND COALESCE(is_locked, false) = false
    ORDER BY due_date ASC
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error','No open payment period found for this group. Contact your group admin.');
    END IF;
  ELSE
    SELECT * INTO v_period FROM public.payment_periods
    WHERE id = p_period_id AND group_id = p_group_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','Payment period not found for this group.'); END IF;
  END IF;

  IF v_period.status::TEXT NOT IN ('open','upcoming') THEN
    RETURN jsonb_build_object('error','This payment period is not open for contributions.');
  END IF;
  IF COALESCE(v_period.is_locked, false) THEN
    RETURN jsonb_build_object('error','This payment period is locked.');
  END IF;

  SELECT * INTO v_existing_payment FROM public.contribution_payments
  WHERE member_id = v_uid AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'contribution_id',v_existing_payment.id,
      'status',v_existing_payment.status::TEXT,
      'idempotent',TRUE
    );
  END IF;

  SELECT * INTO v_existing_payment FROM public.contribution_payments
  WHERE member_id = v_uid AND period_id = v_period.id
    AND status::TEXT NOT IN ('rejected','failed','refunded');
  IF FOUND THEN
    RETURN jsonb_build_object(
      'error','You have already paid for this period.',
      'contribution_id',v_existing_payment.id
    );
  END IF;

  v_contribution_amt := v_group.contribution_amount;
  v_fee_result       := public.calculate_transaction_fee('osusu_contribution', v_contribution_amt);
  v_fee_amt          := (v_fee_result->>'fee')::NUMERIC;
  v_total_debit      := v_contribution_amt + v_fee_amt;

  v_vault_id := public._ensure_vault_account(v_uid);

  SELECT status INTO v_account_status FROM public.vault_accounts WHERE id = v_vault_id;
  IF v_account_status <> 'active' THEN
    RETURN jsonb_build_object('error','Your vault account is not active.');
  END IF;

  PERFORM 1 FROM public.vault_accounts WHERE id = v_vault_id FOR UPDATE;

  IF public._vault_available_balance(v_vault_id) < v_total_debit THEN
    RETURN jsonb_build_object(
      'error','Insufficient vault balance. Add money to your vault or pay with mobile money.',
      'required',v_total_debit,
      'action','topup_required'
    );
  END IF;

  INSERT INTO public.vault_reservations (
    vault_account_id, user_id, amount, currency,
    reservation_type, reference_type,
    status, idempotency_key, expires_at
  ) VALUES (
    v_vault_id, v_uid, v_total_debit, 'NLe',
    'osusu_contribution', 'contribution_payments',
    'active', p_idempotency_key,
    now() + INTERVAL '10 minutes'
  ) RETURNING id INTO v_reservation_id;

  v_receipt := 'RCP-' || to_char(now(),'YYYYMMDD') || '-' ||
               upper(encode(gen_random_bytes(4),'hex'));

  INSERT INTO public.contribution_payments (
    group_id, period_id, member_id,
    amount, currency, status, payment_method,
    receipt_number, idempotency_key, collected_at, approved_at
  ) VALUES (
    p_group_id, v_period.id, v_uid,
    v_contribution_amt, 'NLe', 'approved', 'vault',
    v_receipt, p_idempotency_key, now(), now()
  ) RETURNING id INTO v_contrib_id;

  INSERT INTO public.vault_transactions (
    vault_id, user_id, type, amount, currency,
    reference, description, related_payment_id, idempotency_key, created_by_fn
  ) VALUES (
    v_vault_id, v_uid, 'contribution', v_contribution_amt, 'NLe',
    v_receipt, 'Osusu contribution: ' || v_group.name,
    v_contrib_id, p_idempotency_key, 'pay_osusu_from_vault'
  );

  IF v_fee_amt > 0 THEN
    INSERT INTO public.vault_transactions (
      vault_id, user_id, type, amount, currency,
      reference, description, related_payment_id, idempotency_key, created_by_fn
    ) VALUES (
      v_vault_id, v_uid, 'fee', v_fee_amt, 'NLe',
      v_receipt || '-FEE', 'Platform fee: Osusu contribution',
      v_contrib_id, p_idempotency_key || '-fee', 'pay_osusu_from_vault'
    );
  END IF;

  UPDATE public.vault_reservations
  SET status = 'consumed', consumed_at = now(), reference_id = v_contrib_id
  WHERE id = v_reservation_id;

  PERFORM public.create_audit_log(
    'payment_approved','contribution_payments',v_contrib_id,
    NULL, jsonb_build_object(
      'amount',v_contribution_amt,'fee',v_fee_amt,'total_debit',v_total_debit,
      'group_id',p_group_id,'period_id',v_period.id,'vault_id',v_vault_id,'source','vault'
    )
  );

  RETURN jsonb_build_object(
    'success',TRUE,
    'contribution_id',v_contrib_id,
    'receipt_number',v_receipt,
    'amount',v_contribution_amt,
    'fee',v_fee_amt,
    'total_debit',v_total_debit,
    'status','approved'
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- C. finalize_send_payment — send→group finalizer (webhook authority only)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_send_payment(
  p_monime_payment_code_id text,
  p_verified_amount_minor numeric,
  p_verified_currency text,
  p_order_number text DEFAULT NULL,
  p_webhook_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent   payment_intents%ROWTYPE;
  v_receipt  receipts%ROWTYPE;
  v_receipt_number text;
  v_receipt_key uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error','Unauthorized: service_role required.');
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE provider_reference = p_monime_payment_code_id
    AND target_type = 'group'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','intent_not_found','payment_code', p_monime_payment_code_id);
  END IF;

  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'payment_intent_id', v_intent.id);
  END IF;
  IF v_intent.status NOT IN ('pending','processing') THEN
    RETURN jsonb_build_object('error','intent_not_finalizable','status', v_intent.status);
  END IF;

  -- Amount/currency must match the server-stored intent (SLE minor units).
  IF p_verified_currency IS DISTINCT FROM 'SLE'
     OR p_verified_amount_minor IS NULL
     OR round(v_intent.amount * 100) <> round(p_verified_amount_minor) THEN
    INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (NULL, 'send_payment_failed', 'payment_intents', v_intent.id,
      jsonb_build_object('reason','amount_or_currency_mismatch',
        'expected_minor', round(v_intent.amount * 100),
        'verified_minor', p_verified_amount_minor,
        'verified_currency', p_verified_currency,
        'payment_code', p_monime_payment_code_id));
    RETURN jsonb_build_object('error','amount_or_currency_mismatch');
  END IF;

  -- Provider transaction → completed
  UPDATE mobile_money_transactions
  SET status = 'completed',
      monime_order_number = COALESCE(p_order_number, monime_order_number),
      webhook_payload = COALESCE(p_webhook_payload, webhook_payload),
      status_updated_at = now()
  WHERE monime_payment_code_id = p_monime_payment_code_id
     OR internal_reference = v_intent.idempotency_key::text;

  -- Contribution record created at confirm time → approved
  IF v_intent.transaction_id IS NOT NULL
     AND v_intent.transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE contribution_payments
    SET status = 'approved', approved_at = COALESCE(approved_at, now())
    WHERE id = v_intent.transaction_id::uuid
      AND status::TEXT NOT IN ('approved','refunded');
  END IF;

  -- Double-entry ledger (only once per intent)
  IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE payment_intent_id = v_intent.id) THEN
    INSERT INTO ledger_entries (user_id, payment_intent_id, transaction_id, entry_type, amount, currency, description)
    VALUES
      (v_intent.user_id, v_intent.id, v_intent.transaction_id, 'debit',  v_intent.amount, v_intent.currency, 'Send payment to group'),
      (v_intent.user_id, v_intent.id, v_intent.transaction_id, 'credit', v_intent.amount, v_intent.currency, 'Destination credit for group');
  END IF;

  -- Receipt (idempotent via UNIQUE(idempotency_key) + UNIQUE-per-intent check)
  SELECT * INTO v_receipt FROM receipts WHERE payment_intent_id = v_intent.id LIMIT 1;
  IF NOT FOUND THEN
    v_receipt_key    := COALESCE(v_intent.confirmation_idempotency_key, v_intent.idempotency_key);
    v_receipt_number := 'RCPT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    INSERT INTO receipts (user_id, payment_intent_id, transaction_id, receipt_number, status, amount, currency, masked_account, provider_reference, idempotency_key)
    VALUES (v_intent.user_id, v_intent.id, v_intent.transaction_id, v_receipt_number, 'completed',
            v_intent.amount, v_intent.currency, v_intent.masked_account, p_monime_payment_code_id, v_receipt_key)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_receipt FROM receipts WHERE payment_intent_id = v_intent.id LIMIT 1;
  END IF;

  UPDATE payment_intents
  SET status = 'completed', confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
  WHERE id = v_intent.id;

  INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (v_intent.user_id, 'send_payment_completed', 'payment_intents', v_intent.id,
    jsonb_build_object('payment_code', p_monime_payment_code_id,
                       'order_number', p_order_number,
                       'amount', v_intent.amount,
                       'receipt_number', v_receipt.receipt_number,
                       'source', 'mobile_money_webhook'));

  RETURN jsonb_build_object(
    'success', true,
    'payment_intent_id', v_intent.id,
    'contribution_id', v_intent.transaction_id,
    'receipt_number', v_receipt.receipt_number
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_send_payment(text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_send_payment(text, numeric, text, text, jsonb) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- D. finalize_savings_deposit — send→savings finalizer (credits the goal)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.finalize_savings_deposit(
  p_monime_payment_code_id text,
  p_verified_amount_minor numeric,
  p_verified_currency text,
  p_order_number text DEFAULT NULL,
  p_webhook_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent   payment_intents%ROWTYPE;
  v_goal     savings_goals%ROWTYPE;
  v_txn_id   uuid;
  v_new_amount numeric;
  v_receipt  receipts%ROWTYPE;
  v_receipt_number text;
  v_receipt_key uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error','Unauthorized: service_role required.');
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE provider_reference = p_monime_payment_code_id
    AND target_type = 'savings'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','intent_not_found','payment_code', p_monime_payment_code_id);
  END IF;

  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'payment_intent_id', v_intent.id);
  END IF;
  IF v_intent.status NOT IN ('pending','processing') THEN
    RETURN jsonb_build_object('error','intent_not_finalizable','status', v_intent.status);
  END IF;

  IF p_verified_currency IS DISTINCT FROM 'SLE'
     OR p_verified_amount_minor IS NULL
     OR round(v_intent.amount * 100) <> round(p_verified_amount_minor) THEN
    INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (NULL, 'savings_deposit_failed', 'payment_intents', v_intent.id,
      jsonb_build_object('reason','amount_or_currency_mismatch',
        'expected_minor', round(v_intent.amount * 100),
        'verified_minor', p_verified_amount_minor,
        'verified_currency', p_verified_currency,
        'payment_code', p_monime_payment_code_id));
    RETURN jsonb_build_object('error','amount_or_currency_mismatch');
  END IF;

  -- Target goal must still belong to the paying user.
  SELECT * INTO v_goal FROM savings_goals WHERE id = v_intent.target_id FOR UPDATE;
  IF NOT FOUND OR v_goal.user_id <> v_intent.user_id THEN
    INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (NULL, 'savings_deposit_failed', 'payment_intents', v_intent.id,
      jsonb_build_object('reason','goal_missing_or_owner_mismatch','goal_id', v_intent.target_id));
    RETURN jsonb_build_object('error','goal_missing_or_owner_mismatch');
  END IF;

  -- Credit exactly once: UNIQUE(idempotency_key) on savings_transactions is
  -- the hard barrier against webhook replays.
  INSERT INTO savings_transactions (goal_id, user_id, type, amount, currency, note, created_by_fn, idempotency_key)
  VALUES (v_goal.id, v_intent.user_id, 'deposit'::savings_tx_type, v_intent.amount, v_intent.currency,
          'Mobile money deposit (send flow)', 'finalize_savings_deposit', v_intent.idempotency_key::text)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_txn_id;

  IF v_txn_id IS NOT NULL THEN
    v_new_amount := v_goal.current_amount + v_intent.amount;
    UPDATE savings_goals SET
      current_amount = v_new_amount,
      updated_at     = now(),
      status = CASE WHEN v_new_amount >= target_amount AND status = 'active' THEN 'completed' ELSE status END,
      completed_at = CASE WHEN v_new_amount >= target_amount AND status = 'active' THEN now() ELSE completed_at END
    WHERE id = v_goal.id;
  END IF;

  UPDATE mobile_money_transactions
  SET status = 'completed',
      monime_order_number = COALESCE(p_order_number, monime_order_number),
      webhook_payload = COALESCE(p_webhook_payload, webhook_payload),
      status_updated_at = now()
  WHERE monime_payment_code_id = p_monime_payment_code_id
     OR internal_reference = v_intent.idempotency_key::text;

  IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE payment_intent_id = v_intent.id) THEN
    INSERT INTO ledger_entries (user_id, payment_intent_id, transaction_id, entry_type, amount, currency, description)
    VALUES
      (v_intent.user_id, v_intent.id, v_txn_id::text, 'debit',  v_intent.amount, v_intent.currency, 'Send payment to savings'),
      (v_intent.user_id, v_intent.id, v_txn_id::text, 'credit', v_intent.amount, v_intent.currency, 'Destination credit for savings');
  END IF;

  SELECT * INTO v_receipt FROM receipts WHERE payment_intent_id = v_intent.id LIMIT 1;
  IF NOT FOUND THEN
    v_receipt_key    := COALESCE(v_intent.confirmation_idempotency_key, v_intent.idempotency_key);
    v_receipt_number := 'RCPT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    INSERT INTO receipts (user_id, payment_intent_id, transaction_id, receipt_number, status, amount, currency, masked_account, provider_reference, idempotency_key)
    VALUES (v_intent.user_id, v_intent.id, v_txn_id::text, v_receipt_number, 'completed',
            v_intent.amount, v_intent.currency, v_intent.masked_account, p_monime_payment_code_id, v_receipt_key)
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT * INTO v_receipt FROM receipts WHERE payment_intent_id = v_intent.id LIMIT 1;
  END IF;

  UPDATE payment_intents
  SET status = 'completed',
      transaction_id = COALESCE(transaction_id, v_txn_id::text),
      confirmed_at = COALESCE(confirmed_at, now()),
      updated_at = now()
  WHERE id = v_intent.id;

  INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (v_intent.user_id, 'savings_deposit_completed', 'payment_intents', v_intent.id,
    jsonb_build_object('payment_code', p_monime_payment_code_id,
                       'order_number', p_order_number,
                       'goal_id', v_goal.id,
                       'amount', v_intent.amount,
                       'savings_transaction_id', v_txn_id,
                       'receipt_number', v_receipt.receipt_number,
                       'source', 'mobile_money_webhook'));

  RETURN jsonb_build_object(
    'success', true,
    'payment_intent_id', v_intent.id,
    'goal_id', v_goal.id,
    'savings_transaction_id', v_txn_id,
    'idempotent_credit', v_txn_id IS NULL,
    'receipt_number', v_receipt.receipt_number
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_savings_deposit(text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_savings_deposit(text, numeric, text, text, jsonb) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- E. fail_send_payment_intent — failed / expired / cancelled send intents
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fail_send_payment_intent(
  p_monime_payment_code_id text,
  p_status text DEFAULT 'failed',
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent payment_intents%ROWTYPE;
  v_action text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error','Unauthorized: service_role required.');
  END IF;
  IF p_status NOT IN ('failed','expired','cancelled') THEN
    RETURN jsonb_build_object('error','invalid_status');
  END IF;

  SELECT * INTO v_intent
  FROM payment_intents
  WHERE provider_reference = p_monime_payment_code_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','intent_not_found','payment_code', p_monime_payment_code_id);
  END IF;

  -- Never downgrade a completed payment.
  IF v_intent.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', 'completed');
  END IF;
  IF v_intent.status IN ('failed','expired','cancelled') THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', v_intent.status);
  END IF;

  UPDATE payment_intents
  SET status = p_status, failed_at = now(), updated_at = now()
  WHERE id = v_intent.id;

  UPDATE mobile_money_transactions
  SET status = p_status::mobile_money_status, status_updated_at = now()
  WHERE (monime_payment_code_id = p_monime_payment_code_id
         OR internal_reference = v_intent.idempotency_key::text)
    AND status::TEXT NOT IN ('completed','success');

  v_action := CASE WHEN v_intent.target_type = 'savings' THEN 'savings_deposit_failed' ELSE 'send_payment_failed' END;
  INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (v_intent.user_id, v_action::audit_action, 'payment_intents', v_intent.id,
    jsonb_build_object('status', p_status, 'reason', p_reason,
                       'payment_code', p_monime_payment_code_id,
                       'source', 'mobile_money_webhook'));

  RETURN jsonb_build_object('success', true, 'status', p_status, 'payment_intent_id', v_intent.id);
END;
$$;
REVOKE ALL ON FUNCTION public.fail_send_payment_intent(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_send_payment_intent(text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- F. record_monime_payout_result — drives the withdrawal lifecycle
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_monime_payout_result(
  p_withdrawal_id uuid,
  p_monime_payout_id text,
  p_status text,
  p_failure_code text DEFAULT NULL,
  p_failure_msg text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wr withdrawal_requests%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;
  IF p_status NOT IN ('pending','processing','completed','failed','cancelled') THEN
    RETURN jsonb_build_object('error', 'invalid_status');
  END IF;

  SELECT * INTO v_wr
  FROM public.withdrawal_requests
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal not found');
  END IF;

  -- Idempotency: a completed payout is final. Replays are acknowledged, never re-applied.
  IF v_wr.payout_status = 'completed' OR v_wr.status::TEXT = 'completed' THEN
    INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (NULL, 'payout_duplicate_ignored', 'withdrawal_requests', p_withdrawal_id,
      jsonb_build_object('monime_payout_id', p_monime_payout_id, 'attempted_status', p_status));
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', 'completed');
  END IF;

  UPDATE public.withdrawal_requests
  SET monime_payout_id    = COALESCE(p_monime_payout_id, monime_payout_id),
      payout_status       = p_status,
      payout_initiated_at = COALESCE(payout_initiated_at, now()),
      payout_completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE payout_completed_at END,
      payout_failed_at    = CASE WHEN p_status IN ('failed','cancelled') THEN now() ELSE payout_failed_at END,
      payout_failure_code = CASE WHEN p_status IN ('failed','cancelled') THEN p_failure_code ELSE payout_failure_code END,
      payout_failure_msg  = CASE WHEN p_status IN ('failed','cancelled') THEN left(p_failure_msg, 500) ELSE payout_failure_msg END,
      status              = CASE
                              WHEN p_status = 'completed' THEN 'completed'::withdrawal_status
                              WHEN p_status IN ('failed','cancelled') THEN 'failed'::withdrawal_status
                              ELSE status
                            END,
      completed_at        = CASE WHEN p_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
  WHERE id = p_withdrawal_id;

  INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (NULL, ('payout_' || p_status)::audit_action, 'withdrawal_requests', p_withdrawal_id,
    jsonb_build_object(
      'monime_payout_id', p_monime_payout_id,
      'status',           p_status,
      'failure_code',     p_failure_code
    ));

  RETURN jsonb_build_object('success', TRUE, 'status', p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.record_monime_payout_result(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_monime_payout_result(uuid, text, text, text, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- G. approve_withdrawal_request — 'processing' until the payout is confirmed
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(p_withdrawal_id uuid, p_reviewer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req withdrawal_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Withdrawal request not found'); END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Withdrawal is not pending (current: ' || v_req.status || ')');
  END IF;

  IF v_req.savings_goal_id IS NOT NULL THEN
    IF (SELECT current_amount FROM savings_goals WHERE id = v_req.savings_goal_id) < v_req.amount THEN
      RETURN jsonb_build_object('error', 'Insufficient savings balance at approval time');
    END IF;
    UPDATE savings_goals
    SET current_amount = current_amount - v_req.amount, updated_at = now()
    WHERE id = v_req.savings_goal_id;

    INSERT INTO savings_transactions (goal_id, user_id, type, amount, note)
    VALUES (v_req.savings_goal_id, v_req.user_id, 'withdrawal'::savings_tx_type, v_req.amount,
      'Approved withdrawal to ' || v_req.destination_number);
  END IF;

  IF v_req.vault_id IS NOT NULL THEN
    INSERT INTO vault_transactions (vault_id, user_id, type, amount, currency, description, created_by_fn, created_at)
    VALUES (v_req.vault_id, v_req.user_id, 'debit', v_req.amount, v_req.currency,
      'Approved withdrawal to ' || v_req.destination_number, 'approve_withdrawal_request', now());
  END IF;

  -- Funds are debited/reserved but NOT disbursed yet. The payout webhook
  -- (record_monime_payout_result) is the only path to 'completed'.
  UPDATE withdrawal_requests
  SET status = 'processing', reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = p_withdrawal_id;

  PERFORM create_audit_log('withdrawal_approved', 'withdrawal_requests', p_withdrawal_id, NULL,
    jsonb_build_object('amount', v_req.amount, 'by', p_reviewer_id, 'status', 'processing'));

  RETURN jsonb_build_object(
    'success',              true,
    'amount',               v_req.amount,
    'currency',             v_req.currency,
    'user_id',              v_req.user_id,
    'destination_provider', v_req.destination_provider,
    'destination_number',   v_req.destination_number
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- H. fail_monime_checkout / finalize_monime_checkout — latent bug repair
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fail_monime_checkout(p_monime_session_id text, p_reason text DEFAULT 'expired')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm_txn mobile_money_transactions%ROWTYPE;
  v_new_status text;
BEGIN
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized: service_role required.');
  END IF;

  SELECT * INTO v_mm_txn
  FROM mobile_money_transactions
  WHERE monime_payment_code_id = p_monime_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_mm_txn
    FROM mobile_money_transactions
    WHERE internal_reference = p_monime_session_id
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found: ' || p_monime_session_id);
  END IF;

  -- Never fail a payment that already completed; terminal failures are idempotent.
  IF v_mm_txn.status::TEXT IN ('completed', 'success') THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', v_mm_txn.status);
  END IF;
  IF v_mm_txn.status::TEXT IN ('failed', 'expired', 'cancelled') THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'status', v_mm_txn.status);
  END IF;

  v_new_status := CASE
    WHEN p_reason = 'expired'   THEN 'expired'
    WHEN p_reason = 'cancelled' THEN 'cancelled'
    ELSE 'failed'
  END;

  UPDATE mobile_money_transactions
  SET status            = v_new_status::mobile_money_status,
      status_updated_at = now()
  WHERE id = v_mm_txn.id;

  IF v_mm_txn.payment_id IS NOT NULL THEN
    UPDATE contribution_payments
    SET status = 'failed'
    WHERE id = v_mm_txn.payment_id
      AND status::TEXT NOT IN ('approved', 'refunded');
  END IF;

  INSERT INTO audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (NULL, 'payment_failed', 'mobile_money_transactions', v_mm_txn.id,
    jsonb_build_object(
      'reason',              p_reason,
      'new_status',          v_new_status,
      'monime_payment_code', p_monime_session_id,
      'previous_status',     v_mm_txn.status
    ));

  RETURN jsonb_build_object('success', true, 'status', v_new_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_monime_checkout(p_monime_session_id text, p_webhook_payload jsonb, p_order_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm_txn  mobile_money_transactions%ROWTYPE;
  v_result  JSONB;
BEGIN
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized: service_role required.');
  END IF;

  SELECT * INTO v_mm_txn
  FROM mobile_money_transactions
  WHERE monime_payment_code_id = p_monime_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_mm_txn
    FROM mobile_money_transactions
    WHERE internal_reference = (p_webhook_payload -> 'data' ->> 'reference')
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found for payment code: ' || p_monime_session_id);
  END IF;

  IF v_mm_txn.status::TEXT IN ('completed', 'success') THEN
    IF p_order_number IS NOT NULL THEN
      UPDATE mobile_money_transactions
      SET monime_order_number = p_order_number
      WHERE id = v_mm_txn.id AND monime_order_number IS NULL;
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'contribution_id', v_mm_txn.payment_id);
  END IF;

  SELECT finalize_verified_payment(
    p_mm_txn_id       => v_mm_txn.id,
    p_webhook_payload => p_webhook_payload
  ) INTO v_result;

  IF p_order_number IS NOT NULL THEN
    UPDATE mobile_money_transactions
    SET monime_order_number = p_order_number
    WHERE id = v_mm_txn.id;
  END IF;

  RETURN v_result;
END;
$$;
