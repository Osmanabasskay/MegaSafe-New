-- ─────────────────────────────────────────────────────────────────────────────
-- Mi Osusu: Monime Payment Integration
--
-- Apply via: Supabase Dashboard → SQL Editor  (run as the project owner)
--  OR:       supabase db push  (if using the CLI with a linked project)
--
-- This script is idempotent — safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. payment_webhook_events ─────────────────────────────────────────────────
--
-- Dedicated deduplication table for Monime checkout-session webhook events.
-- UNIQUE(provider, session_id, event_type) prevents double-processing when
-- Monime retries delivery.

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider        text        NOT NULL DEFAULT 'monime',
  event_type      text        NOT NULL,           -- 'checkout_session.completed', etc.
  session_id      text        NOT NULL,           -- Monime cs_xxxx
  reference       text,                           -- our idempotency key
  payload         jsonb       NOT NULL,
  signature_valid boolean     NOT NULL DEFAULT true,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, session_id, event_type)
);

COMMENT ON TABLE payment_webhook_events IS
  'Deduplicates Monime checkout-session webhook events. '
  'UNIQUE on (provider, session_id, event_type).';

COMMENT ON COLUMN payment_webhook_events.event_type IS
  'One of: checkout_session.completed, checkout_session.expired, checkout_session.cancelled';
COMMENT ON COLUMN payment_webhook_events.session_id IS
  'Monime checkout session ID (cs_xxxx).';
COMMENT ON COLUMN payment_webhook_events.reference IS
  'Our idempotency key, echoed back by Monime in the session reference field.';

-- RLS: only the service role may read or write this table
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_pwe" ON payment_webhook_events;
CREATE POLICY "service_role_only_pwe"
  ON payment_webhook_events FOR ALL
  USING  (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for fast lookups by event_type (useful for admin dashboards)
CREATE INDEX IF NOT EXISTS idx_pwe_event_type
  ON payment_webhook_events (event_type);

-- ── 2. Extend mobile_money_transactions ────────────────────────────────────────
--
-- When a payment is initiated through Monime, we store the checkout session ID
-- so the mobile-money-webhook can look up the transaction without scanning
-- all provider_reference values.

ALTER TABLE mobile_money_transactions
  ADD COLUMN IF NOT EXISTS monime_session_id text;

COMMENT ON COLUMN mobile_money_transactions.monime_session_id IS
  'Monime checkout session ID (cs_xxxx). '
  'Set during payment initiation; used by mobile-money-webhook for lookup.';

CREATE INDEX IF NOT EXISTS idx_mmt_monime_session
  ON mobile_money_transactions (monime_session_id)
  WHERE monime_session_id IS NOT NULL;

-- ── 3. finalize_monime_checkout RPC ─────────────────────────────────────────
--
-- Wraps finalize_verified_payment for Monime's checkout_session.completed event.
-- Called by the mobile-money-webhook edge function (service role).
-- Returns: { success, contribution_id, receipt_number, error }

CREATE OR REPLACE FUNCTION finalize_monime_checkout(
  p_monime_session_id text,
  p_webhook_payload   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm_txn      mobile_money_transactions%ROWTYPE;
  v_result      jsonb;
BEGIN
  -- Only callable by service role
  IF current_setting('role') != 'service_role' AND auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized: service role required.');
  END IF;

  -- Look up by Monime session ID
  SELECT * INTO v_mm_txn
  FROM mobile_money_transactions
  WHERE monime_session_id = p_monime_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    -- Fallback: look up by internal_reference (idempotency key echoed as session reference)
    SELECT * INTO v_mm_txn
    FROM mobile_money_transactions
    WHERE internal_reference = (p_webhook_payload -> 'data' ->> 'reference')
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found for session: ' || p_monime_session_id);
  END IF;

  -- Already finalized — idempotent return
  IF v_mm_txn.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  -- Delegate to the existing finalize_verified_payment RPC
  SELECT finalize_verified_payment(
    p_mm_txn_id       => v_mm_txn.id,
    p_webhook_payload => p_webhook_payload
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION finalize_monime_checkout IS
  'Called by mobile-money-webhook on checkout_session.completed. '
  'Looks up mobile_money_transactions by monime_session_id (or reference fallback) '
  'and delegates to finalize_verified_payment.';

-- ── 4. fail_monime_checkout RPC ──────────────────────────────────────────────
--
-- Marks a Monime checkout session as failed (expired or cancelled).
-- Called by mobile-money-webhook on checkout_session.expired / cancelled.

CREATE OR REPLACE FUNCTION fail_monime_checkout(
  p_monime_session_id text,
  p_reason            text DEFAULT 'expired'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mm_txn  mobile_money_transactions%ROWTYPE;
BEGIN
  -- Only callable by service role
  IF current_setting('role') != 'service_role' AND auth.role() != 'service_role' THEN
    RETURN jsonb_build_object('error', 'Unauthorized: service role required.');
  END IF;

  SELECT * INTO v_mm_txn
  FROM mobile_money_transactions
  WHERE monime_session_id = p_monime_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transaction not found for session: ' || p_monime_session_id);
  END IF;

  IF v_mm_txn.status IN ('completed', 'failed') THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  -- Mark the mobile_money_transaction as failed
  UPDATE mobile_money_transactions
  SET    status            = 'failed',
         status_updated_at = now()
  WHERE  id = v_mm_txn.id;

  -- Cascade to the linked contribution_payment if one exists
  IF v_mm_txn.payment_id IS NOT NULL THEN
    UPDATE contribution_payments
    SET    status     = 'failed',
           updated_at = now()
    WHERE  id = v_mm_txn.payment_id
      AND  status NOT IN ('approved', 'verified');
  END IF;

  -- Audit log
  INSERT INTO audit_logs (table_name, record_id, action, changed_by, new_values)
  VALUES (
    'mobile_money_transactions',
    v_mm_txn.id,
    'payment_failed',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object(
      'reason',             p_reason,
      'monime_session_id',  p_monime_session_id,
      'previous_status',    v_mm_txn.status
    )
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION fail_monime_checkout IS
  'Called by mobile-money-webhook on checkout_session.expired or cancelled. '
  'Marks the mobile_money_transaction and linked contribution_payment as failed.';

-- ── 5. Grant execute to service role ─────────────────────────────────────────
GRANT EXECUTE ON FUNCTION finalize_monime_checkout TO service_role;
GRANT EXECUTE ON FUNCTION fail_monime_checkout TO service_role;

-- ── 6. Verification query (run to confirm) ────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'payment_webhook_events';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'mobile_money_transactions' AND column_name = 'monime_session_id';
-- SELECT routine_name FROM information_schema.routines WHERE routine_name IN ('finalize_monime_checkout', 'fail_monime_checkout');
