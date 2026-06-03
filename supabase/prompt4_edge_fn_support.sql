-- ============================================================
-- Mi Osusu Prompt 4: Edge Function Support
-- New tables and RPCs required by the payment edge functions.
-- Apply after prompt3_schema_fixes.sql.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. webhook_events — deduplication table for provider callbacks
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_events (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider     text        NOT NULL,
  event_id     text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}',
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_uniq UNIQUE (provider, event_id)
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
-- Only Edge Functions running as service_role may write here.
CREATE POLICY "service_role_only" ON webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lookup
  ON webhook_events(provider, event_id);

-- ──────────────────────────────────────────────────────────────
-- 2. finalize_verified_payment
--    Called by payment-webhook edge function (service_role only).
--    Atomically marks mobile_money_transactions completed and
--    sets contribution_payments to approved.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION finalize_verified_payment(
  p_mm_txn_id       uuid,
  p_webhook_payload  jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm  mobile_money_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_mm
  FROM mobile_money_transactions
  WHERE id = p_mm_txn_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Mobile money transaction not found');
  END IF;

  IF v_mm.status::text IN ('completed', 'failed') THEN
    RETURN jsonb_build_object('success', true, 'already_finalized', true, 'status', v_mm.status);
  END IF;

  UPDATE mobile_money_transactions
  SET status            = 'completed',
      webhook_payload   = COALESCE(p_webhook_payload, webhook_payload),
      status_updated_at = now()
  WHERE id = p_mm_txn_id;

  IF v_mm.payment_id IS NOT NULL THEN
    UPDATE contribution_payments
    SET status = 'approved'
    WHERE id = v_mm.payment_id
      AND status NOT IN ('approved', 'refunded');

    PERFORM create_audit_log(
      'payment_finalized_via_webhook',
      'contribution_payments',
      v_mm.payment_id,
      NULL,
      jsonb_build_object(
        'mm_txn_id',         p_mm_txn_id,
        'provider_reference', v_mm.provider_reference
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'contribution_id', v_mm.payment_id);
END;
$$;

REVOKE ALL ON FUNCTION finalize_verified_payment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_verified_payment TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 3. fail_payment_by_reference
--    Called when provider reports failure in webhook.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fail_payment_by_reference(
  p_provider_reference text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm mobile_money_transactions%ROWTYPE;
BEGIN
  UPDATE mobile_money_transactions
  SET status = 'failed', status_updated_at = now()
  WHERE provider_reference = p_provider_reference
    AND status::text NOT IN ('completed', 'failed')
  RETURNING * INTO v_mm;

  IF FOUND AND v_mm.payment_id IS NOT NULL THEN
    UPDATE contribution_payments
    SET status = 'failed'
    WHERE id = v_mm.payment_id
      AND status NOT IN ('approved', 'refunded', 'failed');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION fail_payment_by_reference FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_payment_by_reference TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 4. calculate_and_record_commission — stub; fills commissions table
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_and_record_commission(
  p_payment_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp  contribution_payments%ROWTYPE;
  v_col collectors%ROWTYPE;
  v_amt numeric(15,2);
BEGIN
  SELECT * INTO v_cp FROM contribution_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Find the active collector for this group
  SELECT c.* INTO v_col
  FROM collectors c
  JOIN collector_assignments ca ON ca.collector_id = c.id
  WHERE ca.group_id = v_cp.group_id AND ca.status = 'active' AND c.is_active = true
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_amt := ROUND(v_cp.amount * COALESCE(v_col.commission_rate, 0) / 100, 2);
  IF v_amt <= 0 THEN RETURN; END IF;

  INSERT INTO commissions (collector_id, payment_id, amount, currency, created_at)
  VALUES (v_col.id, p_payment_id, v_amt, v_cp.currency, now())
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION calculate_and_record_commission FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_and_record_commission TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 5. process_withdrawal_request — authenticated user creates request
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION process_withdrawal_request(
  p_savings_goal_id      uuid    DEFAULT NULL,
  p_amount               numeric,
  p_currency             text    DEFAULT 'NLe',
  p_destination_provider text,
  p_destination_number   text,
  p_idempotency_key      text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_vault      vault_accounts%ROWTYPE;
  v_balance    numeric(15,2);
  v_goal       savings_goals%ROWTYPE;
  v_request_id uuid;
  v_ikey       text;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error', 'Amount must be positive'); END IF;
  IF trim(COALESCE(p_destination_number,'')) = '' THEN
    RETURN jsonb_build_object('error', 'Destination number is required');
  END IF;

  -- KYC required
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_caller AND kyc_verified = true) THEN
    RETURN jsonb_build_object('error', 'KYC verification required before withdrawal');
  END IF;

  v_ikey := COALESCE(p_idempotency_key, gen_random_uuid()::text);

  -- Idempotency check
  SELECT id INTO v_request_id
  FROM withdrawal_requests
  WHERE idempotency_key = v_ikey AND user_id = v_caller;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'withdrawal_id', v_request_id, 'idempotent', true);
  END IF;

  IF p_savings_goal_id IS NOT NULL THEN
    SELECT * INTO v_goal FROM savings_goals WHERE id = p_savings_goal_id AND user_id = v_caller;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Savings goal not found'); END IF;
    IF v_goal.status <> 'active' THEN RETURN jsonb_build_object('error', 'Savings goal is not active'); END IF;
    IF v_goal.current_amount < p_amount THEN
      RETURN jsonb_build_object('error', 'Insufficient savings balance');
    END IF;

    INSERT INTO withdrawal_requests (
      user_id, savings_goal_id, amount, currency,
      destination_provider, destination_number, status, idempotency_key, requested_at
    ) VALUES (
      v_caller, p_savings_goal_id, p_amount, p_currency,
      p_destination_provider::mobile_money_provider, p_destination_number, 'pending', v_ikey, now()
    ) RETURNING id INTO v_request_id;

  ELSE
    -- Vault withdrawal
    SELECT va.* INTO v_vault FROM vault_accounts va WHERE va.user_id = v_caller LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'No vault account found'); END IF;

    SELECT COALESCE(SUM(CASE WHEN type::text = 'credit' THEN amount ELSE -amount END), 0)
    INTO v_balance
    FROM vault_transactions WHERE vault_id = v_vault.id;

    IF v_balance < p_amount THEN
      RETURN jsonb_build_object('error', 'Insufficient vault balance');
    END IF;

    INSERT INTO withdrawal_requests (
      user_id, vault_id, amount, currency,
      destination_provider, destination_number, status, idempotency_key, requested_at
    ) VALUES (
      v_caller, v_vault.id, p_amount, p_currency,
      p_destination_provider::mobile_money_provider, p_destination_number, 'pending', v_ikey, now()
    ) RETURNING id INTO v_request_id;
  END IF;

  PERFORM create_audit_log('withdrawal_requested', 'withdrawal_requests', v_request_id, NULL,
    jsonb_build_object('amount', p_amount, 'destination', p_destination_provider));

  RETURN jsonb_build_object('success', true, 'withdrawal_id', v_request_id);
END;
$$;

REVOKE ALL ON FUNCTION process_withdrawal_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_withdrawal_request TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6. approve_withdrawal_request — service_role only (Edge Function)
--    Debits the source, updates status, returns payout details.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_withdrawal_request(
  p_withdrawal_id uuid,
  p_reviewer_id   uuid
) RETURNS jsonb
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

  -- Debit savings goal
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

  -- Debit vault
  IF v_req.vault_id IS NOT NULL THEN
    INSERT INTO vault_transactions (vault_id, user_id, type, amount, currency, description, created_by_fn, created_at)
    VALUES (v_req.vault_id, v_req.user_id, 'debit', v_req.amount, v_req.currency,
      'Approved withdrawal to ' || v_req.destination_number, 'approve_withdrawal_request', now());
  END IF;

  UPDATE withdrawal_requests
  SET status = 'completed', reviewed_by = p_reviewer_id, reviewed_at = now(), completed_at = now()
  WHERE id = p_withdrawal_id;

  PERFORM create_audit_log('withdrawal_approved', 'withdrawal_requests', p_withdrawal_id, NULL,
    jsonb_build_object('amount', v_req.amount, 'by', p_reviewer_id));

  RETURN jsonb_build_object(
    'success',             true,
    'amount',              v_req.amount,
    'currency',            v_req.currency,
    'user_id',             v_req.user_id,
    'destination_provider', v_req.destination_provider,
    'destination_number',  v_req.destination_number
  );
END;
$$;

REVOKE ALL ON FUNCTION approve_withdrawal_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION approve_withdrawal_request TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 7. reject_withdrawal_request — service_role only
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_withdrawal_request(
  p_withdrawal_id uuid,
  p_reviewer_id   uuid,
  p_reason        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE withdrawal_requests
  SET status = 'rejected', reviewed_by = p_reviewer_id, reviewed_at = now(), review_note = p_reason
  WHERE id = p_withdrawal_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal not found or not pending');
  END IF;

  PERFORM create_audit_log('withdrawal_rejected', 'withdrawal_requests', p_withdrawal_id, NULL,
    jsonb_build_object('reason', p_reason, 'by', p_reviewer_id));

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION reject_withdrawal_request FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reject_withdrawal_request TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 8. Storage bucket: payment-proofs
--    Create via Supabase dashboard (Storage > New bucket) with:
--      name = 'payment-proofs', public = false
--    Then run these policies:
-- ──────────────────────────────────────────────────────────────

-- Allow authenticated users to upload to their own folder
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/png','image/jpg','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Only the uploader can insert (path must start with their user ID)
DROP POLICY IF EXISTS "proof_insert_own" ON storage.objects;
CREATE POLICY "proof_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read their own proofs; admins can read all
DROP POLICY IF EXISTS "proof_select" ON storage.objects;
CREATE POLICY "proof_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role IN ('super_admin', 'org_admin')
      )
    )
  );

-- No public DELETE; admins only
DROP POLICY IF EXISTS "proof_delete_admin" ON storage.objects;
CREATE POLICY "proof_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );
