-- =====================================================================
-- PROMPT 6: Monime Payment Code API Fix
-- Mi Osusu — Migrates from non-existent Checkout Sessions API to the
-- real Monime Payment Codes API (POST /v1/payment-codes).
--
-- Safe to run multiple times (idempotent).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Extend vault_topups with Payment Code fields
-- ─────────────────────────────────────────────────────────────────────

-- The real Monime payment reference is a Payment Code ID (pmc-xxxx).
-- Keep monime_session_id column for backward compat (old records).
ALTER TABLE public.vault_topups
  ADD COLUMN IF NOT EXISTS monime_payment_code_id TEXT,
  ADD COLUMN IF NOT EXISTS monime_order_number     TEXT,
  ADD COLUMN IF NOT EXISTS ussd_code               TEXT,
  ADD COLUMN IF NOT EXISTS phone_number            TEXT;

-- Backfill: migrate any old monime_session_id into monime_payment_code_id
UPDATE public.vault_topups
SET monime_payment_code_id = monime_session_id
WHERE monime_session_id IS NOT NULL
  AND monime_payment_code_id IS NULL;

-- Unique constraint on payment code ID
CREATE UNIQUE INDEX IF NOT EXISTS vault_topups_payment_code_id_uidx
  ON public.vault_topups (monime_payment_code_id)
  WHERE monime_payment_code_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vault_topups_payment_code_id_idx
  ON public.vault_topups (monime_payment_code_id)
  WHERE monime_payment_code_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Update mobile_money_transactions with Payment Code fields
--    (for Osusu contribution payments via Monime)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.mobile_money_transactions
  ADD COLUMN IF NOT EXISTS monime_payment_code_id TEXT,
  ADD COLUMN IF NOT EXISTS monime_order_number     TEXT,
  ADD COLUMN IF NOT EXISTS ussd_code               TEXT;

-- Backfill
UPDATE public.mobile_money_transactions
SET monime_payment_code_id = monime_session_id
WHERE monime_session_id IS NOT NULL
  AND monime_payment_code_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mmt_monime_payment_code
  ON public.mobile_money_transactions (monime_payment_code_id)
  WHERE monime_payment_code_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Add withdrawal_requests Monime payout tracking columns
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'withdrawal_requests') THEN
    ALTER TABLE public.withdrawal_requests
      ADD COLUMN IF NOT EXISTS monime_payout_id   TEXT,
      ADD COLUMN IF NOT EXISTS payout_status       TEXT,
      ADD COLUMN IF NOT EXISTS payout_initiated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS payout_completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS payout_failed_at    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS payout_failure_code TEXT,
      ADD COLUMN IF NOT EXISTS payout_failure_msg  TEXT;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. provider_kyc_checks table (new)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_kyc_checks (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_id        TEXT        NOT NULL,                  -- m17, m18
  provider_type      TEXT        NOT NULL,                  -- momo, bank, wallet
  provider_name      TEXT,                                  -- Orange Money, AfriMoney
  account_id         TEXT        NOT NULL,                  -- MSISDN or account number
  account_name       TEXT,                                  -- name returned by provider
  account_holder_name TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','verified','failed','not_found')),
  raw_response       JSONB,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_kyc_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_kyc_checks: own read" ON public.provider_kyc_checks;
CREATE POLICY "provider_kyc_checks: own read"
  ON public.provider_kyc_checks FOR SELECT
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "provider_kyc_checks: no frontend insert" ON public.provider_kyc_checks;
CREATE POLICY "provider_kyc_checks: no frontend insert"
  ON public.provider_kyc_checks FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "provider_kyc_checks: no frontend update" ON public.provider_kyc_checks;
CREATE POLICY "provider_kyc_checks: no frontend update"
  ON public.provider_kyc_checks FOR UPDATE
  USING (false);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Update finalize_vault_topup to use monime_payment_code_id
--    and also store order number + mark idempotent on re-call
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_vault_topup(
  p_monime_session_id TEXT,      -- now accepts payment code ID (pmc-xxx)
  p_webhook_payload   JSONB DEFAULT NULL,
  p_order_number      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup  public.vault_topups%ROWTYPE;
  v_tx_ref TEXT;
BEGIN
  -- Lookup by payment code ID (new column) or legacy session ID column
  SELECT * INTO v_topup
  FROM public.vault_topups
  WHERE (monime_payment_code_id = p_monime_session_id
      OR monime_session_id      = p_monime_session_id)
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Vault topup not found for payment code: ' || p_monime_session_id);
  END IF;

  -- Idempotent: already completed
  IF v_topup.status = 'completed' THEN
    -- Backfill order number if not yet stored
    IF p_order_number IS NOT NULL AND v_topup.monime_order_number IS NULL THEN
      UPDATE public.vault_topups
      SET monime_order_number = p_order_number
      WHERE id = v_topup.id;
    END IF;
    RETURN jsonb_build_object('topup_id', v_topup.id, 'idempotent', TRUE, 'status', 'completed');
  END IF;

  IF v_topup.status NOT IN ('pending','processing') THEN
    RETURN jsonb_build_object(
      'error',    'Topup in terminal state: ' || v_topup.status,
      'topup_id', v_topup.id
    );
  END IF;

  v_tx_ref := 'TOPUP-' || to_char(now(), 'YYYYMMDD') || '-' ||
              upper(encode(gen_random_bytes(4), 'hex'));

  -- Credit vault ledger
  INSERT INTO public.vault_transactions (
    vault_id, user_id, type, amount, currency,
    reference, description, idempotency_key, created_by_fn
  ) VALUES (
    v_topup.vault_account_id, v_topup.user_id,
    'topup', v_topup.amount, v_topup.currency,
    v_tx_ref,
    COALESCE(v_topup.description, 'Vault top-up completed'),
    v_topup.idempotency_key,
    'finalize_vault_topup'
  );

  -- Mark topup completed
  UPDATE public.vault_topups
  SET status              = 'completed',
      completed_at        = now(),
      monime_order_number = COALESCE(p_order_number, monime_order_number)
  WHERE id = v_topup.id;

  PERFORM public.create_audit_log(
    'vault_tx_created', 'vault_topups', v_topup.id,
    NULL, jsonb_build_object(
      'amount',       v_topup.amount,
      'user_id',      v_topup.user_id,
      'payment_code', p_monime_session_id,
      'order_number', p_order_number,
      'action',       'topup_completed'
    )
  );

  RETURN jsonb_build_object(
    'topup_id',      v_topup.id,
    'vault_id',      v_topup.vault_account_id,
    'amount',        v_topup.amount,
    'status',        'completed',
    'reference',     v_tx_ref,
    'order_number',  p_order_number,
    'idempotent',    FALSE
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Update fail_vault_topup to search both columns
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_vault_topup(
  p_monime_session_id TEXT,
  p_reason            TEXT DEFAULT 'failed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_topup public.vault_topups%ROWTYPE;
BEGIN
  SELECT * INTO v_topup
  FROM public.vault_topups
  WHERE (monime_payment_code_id = p_monime_session_id
      OR monime_session_id      = p_monime_session_id)
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Topup not found for payment code: ' || p_monime_session_id);
  END IF;

  IF v_topup.status IN ('completed','failed','expired','cancelled') THEN
    RETURN jsonb_build_object('topup_id', v_topup.id, 'idempotent', TRUE, 'status', v_topup.status);
  END IF;

  UPDATE public.vault_topups
  SET status    = CASE p_reason
                    WHEN 'expired'   THEN 'expired'
                    WHEN 'cancelled' THEN 'cancelled'
                    ELSE 'failed'
                  END,
      failed_at = now()
  WHERE id = v_topup.id;

  PERFORM public.create_audit_log(
    'vault_tx_created', 'vault_topups', v_topup.id,
    NULL, jsonb_build_object('reason', p_reason, 'user_id', v_topup.user_id, 'action', 'topup_failed')
  );

  RETURN jsonb_build_object(
    'topup_id',   v_topup.id,
    'status',     p_reason,
    'idempotent', FALSE
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Update get_vault_summary to return both count and amount for pending topups
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vault_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_vault_id         UUID;
  v_posted_credits   NUMERIC(12,2) := 0;
  v_posted_debits    NUMERIC(12,2) := 0;
  v_posted_bal       NUMERIC(12,2) := 0;
  v_reserved         NUMERIC(12,2) := 0;
  v_available        NUMERIC(12,2) := 0;
  v_pending_count    INT           := 0;
  v_pending_amount   NUMERIC(12,2) := 0;
  v_tx_history       JSONB         := '[]';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  v_vault_id := public._ensure_vault_account(v_uid);

  SELECT
    COALESCE(SUM(amount) FILTER (
      WHERE type IN ('deposit','topup','payout','refund','escrow_release','contribution')
    ), 0),
    COALESCE(SUM(amount) FILTER (
      WHERE type IN ('withdrawal','savings_deposit','mobile_transfer','commission','fee','escrow_lock')
    ), 0)
  INTO v_posted_credits, v_posted_debits
  FROM public.vault_transactions
  WHERE vault_id = v_vault_id;

  v_posted_bal := v_posted_credits - v_posted_debits;

  SELECT COALESCE(SUM(amount), 0) INTO v_reserved
  FROM public.vault_reservations
  WHERE vault_account_id = v_vault_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  v_available := GREATEST(0, v_posted_bal - v_reserved);

  SELECT COUNT(*), COALESCE(SUM(amount), 0)
  INTO v_pending_count, v_pending_amount
  FROM public.vault_topups
  WHERE user_id = v_uid AND status IN ('pending','processing');

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',          vt.id,
      'type',        vt.type::TEXT,
      'amount',      vt.amount,
      'currency',    vt.currency,
      'reference',   vt.reference,
      'description', vt.description,
      'created_at',  vt.created_at
    ) ORDER BY vt.created_at DESC
  ), '[]'::JSONB)
  INTO v_tx_history
  FROM (
    SELECT * FROM public.vault_transactions
    WHERE vault_id = v_vault_id
    ORDER BY created_at DESC
    LIMIT 20
  ) vt;

  RETURN jsonb_build_object(
    'vault_id',           v_vault_id,
    'currency',           'NLe',
    'posted_balance',     v_posted_bal,
    'reserved_balance',   v_reserved,
    'available_balance',  v_available,
    'pending_topup_count', v_pending_count,
    'pending_topup_amount', v_pending_amount,
    'transactions',       v_tx_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vault_summary() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Update finalize_monime_checkout to search by payment code ID
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_monime_checkout(
  p_monime_session_id TEXT,   -- now accepts payment code ID (pmc-xxx)
  p_webhook_payload   JSONB,
  p_order_number      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm_txn  mobile_money_transactions%ROWTYPE;
  v_result  JSONB;
BEGIN
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized: service role required.');
  END IF;

  -- Look up by monime_payment_code_id (new) then monime_session_id (legacy) then reference
  SELECT * INTO v_mm_txn
  FROM mobile_money_transactions
  WHERE monime_payment_code_id = p_monime_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_mm_txn
    FROM mobile_money_transactions
    WHERE monime_session_id = p_monime_session_id
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    SELECT * INTO v_mm_txn
    FROM mobile_money_transactions
    WHERE internal_reference = (p_webhook_payload -> 'data' ->> 'reference')
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found for payment code: ' || p_monime_session_id);
  END IF;

  IF v_mm_txn.status = 'completed' THEN
    -- Backfill order number
    IF p_order_number IS NOT NULL THEN
      UPDATE mobile_money_transactions
      SET monime_order_number = p_order_number
      WHERE id = v_mm_txn.id AND monime_order_number IS NULL;
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  SELECT finalize_verified_payment(
    p_mm_txn_id       => v_mm_txn.id,
    p_webhook_payload => p_webhook_payload
  ) INTO v_result;

  -- Store order number after finalization
  IF p_order_number IS NOT NULL THEN
    UPDATE mobile_money_transactions
    SET monime_order_number = p_order_number
    WHERE id = v_mm_txn.id;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_monime_checkout(TEXT, JSONB, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Update fail_monime_checkout to search by payment code ID
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fail_monime_checkout(
  p_monime_session_id TEXT,
  p_reason            TEXT DEFAULT 'expired'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm_txn mobile_money_transactions%ROWTYPE;
BEGIN
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized: service role required.');
  END IF;

  SELECT * INTO v_mm_txn
  FROM mobile_money_transactions
  WHERE monime_payment_code_id = p_monime_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_mm_txn
    FROM mobile_money_transactions
    WHERE monime_session_id = p_monime_session_id
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found for payment code: ' || p_monime_session_id);
  END IF;

  IF v_mm_txn.status IN ('completed', 'failed') THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  UPDATE mobile_money_transactions
  SET status            = 'failed',
      status_updated_at = now()
  WHERE id = v_mm_txn.id;

  IF v_mm_txn.payment_id IS NOT NULL THEN
    UPDATE contribution_payments
    SET status     = 'failed',
        updated_at = now()
    WHERE id = v_mm_txn.payment_id
      AND status NOT IN ('approved', 'verified');
  END IF;

  INSERT INTO audit_logs (table_name, record_id, action, changed_by, new_values)
  VALUES (
    'mobile_money_transactions', v_mm_txn.id, 'payment_failed',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object(
      'reason',              p_reason,
      'monime_payment_code', p_monime_session_id,
      'previous_status',     v_mm_txn.status
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fail_monime_checkout(TEXT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 10. record_monime_payout_result — called after Monime confirms payout
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_monime_payout_result(
  p_withdrawal_id  UUID,
  p_monime_payout_id TEXT,
  p_status         TEXT,   -- 'completed' | 'failed'
  p_failure_code   TEXT DEFAULT NULL,
  p_failure_msg    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wr RECORD;
BEGIN
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT * INTO v_wr
  FROM public.withdrawal_requests
  WHERE id = p_withdrawal_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal not found');
  END IF;

  UPDATE public.withdrawal_requests
  SET monime_payout_id   = p_monime_payout_id,
      payout_status      = p_status,
      payout_completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
      payout_failed_at    = CASE WHEN p_status = 'failed'    THEN now() ELSE NULL END,
      payout_failure_code = p_failure_code,
      payout_failure_msg  = p_failure_msg,
      updated_at          = now()
  WHERE id = p_withdrawal_id;

  PERFORM public.create_audit_log(
    'payout_' || p_status, 'withdrawal_requests', p_withdrawal_id,
    NULL, jsonb_build_object(
      'monime_payout_id', p_monime_payout_id,
      'status',           p_status,
      'failure_code',     p_failure_code
    )
  );

  RETURN jsonb_build_object('success', TRUE, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_monime_payout_result(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 11. Verification queries (run to confirm)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'vault_topups'
--   AND column_name IN ('monime_payment_code_id','ussd_code','monime_order_number');
-- SELECT routine_name FROM information_schema.routines
--   WHERE routine_name IN ('finalize_vault_topup','fail_vault_topup',
--     'finalize_monime_checkout','fail_monime_checkout','record_monime_payout_result');
