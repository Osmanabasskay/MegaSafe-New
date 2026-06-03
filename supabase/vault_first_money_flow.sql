-- =====================================================================
-- VAULT-FIRST MONEY FLOW MIGRATION
-- Mi Osusu — Phases 2-9
-- Every financial operation must debit/credit the Vault ledger.
-- No frontend calculates balances, fees, or payment results.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-A: Extend existing vault_tx_type enum
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'topup' AND enumtypid = 'vault_tx_type'::regtype) THEN
    ALTER TYPE vault_tx_type ADD VALUE 'topup';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'savings_deposit' AND enumtypid = 'vault_tx_type'::regtype) THEN
    ALTER TYPE vault_tx_type ADD VALUE 'savings_deposit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'mobile_transfer' AND enumtypid = 'vault_tx_type'::regtype) THEN
    ALTER TYPE vault_tx_type ADD VALUE 'mobile_transfer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'fee' AND enumtypid = 'vault_tx_type'::regtype) THEN
    ALTER TYPE vault_tx_type ADD VALUE 'fee';
  END IF;
END $$;

-- Add 'vault' to mobile_money_provider so contribution_payments can record vault-sourced payments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vault' AND enumtypid = 'mobile_money_provider'::regtype) THEN
    ALTER TYPE mobile_money_provider ADD VALUE 'vault';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-B: Extend vault_accounts with status
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.vault_accounts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'closed'));

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-C: Add idempotency_key to vault_transactions
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.vault_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS vault_tx_idempotency_uidx
  ON public.vault_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-D: Add idempotency_key to savings_transactions
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.savings_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS savings_tx_idempotency_uidx
  ON public.savings_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-E: vault_topups — tracks Monime top-up sessions
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_topups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vault_account_id  UUID NOT NULL REFERENCES public.vault_accounts(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  fee_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  currency          TEXT NOT NULL DEFAULT 'NLe',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','completed','failed','expired','cancelled')),
  provider          TEXT NOT NULL DEFAULT 'monime',
  provider_method   TEXT,
  monime_session_id TEXT,
  idempotency_key   TEXT NOT NULL,
  description       TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  CONSTRAINT vault_topups_session_id_unique UNIQUE (monime_session_id),
  CONSTRAINT vault_topups_user_idempotency_unique UNIQUE (user_id, idempotency_key)
);

ALTER TABLE public.vault_topups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_topups: own read" ON public.vault_topups;
CREATE POLICY "vault_topups: own read"
  ON public.vault_topups FOR SELECT
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "vault_topups: no frontend insert" ON public.vault_topups;
CREATE POLICY "vault_topups: no frontend insert"
  ON public.vault_topups FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "vault_topups: no frontend update" ON public.vault_topups;
CREATE POLICY "vault_topups: no frontend update"
  ON public.vault_topups FOR UPDATE
  USING (false);

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-F: vault_reservations — locks available balance
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_reservations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_account_id  UUID NOT NULL REFERENCES public.vault_accounts(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency          TEXT NOT NULL DEFAULT 'NLe',
  reservation_type  TEXT NOT NULL,
  reference_type    TEXT,
  reference_id      UUID,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','released','consumed','expired')),
  idempotency_key   TEXT NOT NULL,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at       TIMESTAMPTZ,
  consumed_at       TIMESTAMPTZ,
  CONSTRAINT vault_reservations_user_idempotency UNIQUE (user_id, idempotency_key)
);

ALTER TABLE public.vault_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_reservations: own read" ON public.vault_reservations;
CREATE POLICY "vault_reservations: own read"
  ON public.vault_reservations FOR SELECT
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "vault_reservations: no frontend insert" ON public.vault_reservations;
CREATE POLICY "vault_reservations: no frontend insert"
  ON public.vault_reservations FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "vault_reservations: no frontend update" ON public.vault_reservations;
CREATE POLICY "vault_reservations: no frontend update"
  ON public.vault_reservations FOR UPDATE
  USING (false);

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 2-G: commission_rules — configurable fee rates (super_admin manages)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commission_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name        TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  rate_type        TEXT NOT NULL CHECK (rate_type IN ('percentage','fixed')),
  rate_value       NUMERIC(8,4) NOT NULL CHECK (rate_value >= 0),
  platform_share   NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (platform_share BETWEEN 0 AND 1),
  master_share     NUMERIC(5,4) NOT NULL DEFAULT 0.0 CHECK (master_share BETWEEN 0 AND 1),
  min_amount       NUMERIC(12,2),
  max_amount       NUMERIC(12,2),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commission_rules_name_unique UNIQUE (rule_name)
);

ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commission_rules: read" ON public.commission_rules;
CREATE POLICY "commission_rules: read"
  ON public.commission_rules FOR SELECT
  TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "commission_rules: super_admin write" ON public.commission_rules;
CREATE POLICY "commission_rules: super_admin write"
  ON public.commission_rules FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Seed default rules (no-op on conflict)
INSERT INTO public.commission_rules (rule_name, transaction_type, rate_type, rate_value, platform_share, master_share)
VALUES
  ('topup_fee',             'vault_topup',        'percentage', 0.0,  1.0, 0.0),
  ('osusu_contribution_fee','osusu_contribution',  'percentage', 2.0,  0.6, 0.4),
  ('savings_deposit_fee',   'savings_deposit',     'percentage', 0.0,  1.0, 0.0),
  ('mobile_transfer_fee',   'mobile_transfer',     'percentage', 1.5,  1.0, 0.0),
  ('withdrawal_fee',        'withdrawal',          'percentage', 1.0,  1.0, 0.0)
ON CONFLICT (rule_name) DO NOTHING;

-- =====================================================================
-- PHASE 3: RPCs — all financial logic lives here
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Internal: ensure vault account exists for user
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ensure_vault_account(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_vault_id UUID;
BEGIN
  SELECT id INTO v_vault_id FROM public.vault_accounts WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.vault_accounts (user_id, currency, status)
    VALUES (p_user_id, 'NLe', 'active')
    RETURNING id INTO v_vault_id;
  END IF;
  RETURN v_vault_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Internal: compute available balance (posted - reserved)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._vault_available_balance(p_vault_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted   NUMERIC(12,2);
  v_reserved NUMERIC(12,2);
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (
      WHERE type IN ('deposit','topup','payout','refund','escrow_release','contribution')
    ), 0)
    -
    COALESCE(SUM(amount) FILTER (
      WHERE type IN ('withdrawal','savings_deposit','mobile_transfer','commission','fee','escrow_lock')
    ), 0)
  INTO v_posted
  FROM public.vault_transactions
  WHERE vault_id = p_vault_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_reserved
  FROM public.vault_reservations
  WHERE vault_account_id = p_vault_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN GREATEST(0, v_posted - v_reserved);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- calculate_transaction_fee — backend-only fee calculator
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_transaction_fee(
  p_transaction_type TEXT,
  p_amount           NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule     public.commission_rules%ROWTYPE;
  v_fee      NUMERIC(12,2) := 0;
BEGIN
  SELECT * INTO v_rule
  FROM public.commission_rules
  WHERE transaction_type = p_transaction_type AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('fee', 0, 'total', p_amount,
      'platform_share', 0, 'master_share', 0);
  END IF;

  IF v_rule.rate_type = 'percentage' THEN
    v_fee := ROUND(p_amount * v_rule.rate_value / 100.0, 2);
  ELSE
    v_fee := v_rule.rate_value;
  END IF;

  IF v_rule.min_amount IS NOT NULL AND v_fee < v_rule.min_amount THEN
    v_fee := v_rule.min_amount;
  END IF;
  IF v_rule.max_amount IS NOT NULL AND v_fee > v_rule.max_amount THEN
    v_fee := v_rule.max_amount;
  END IF;

  RETURN jsonb_build_object(
    'fee',            v_fee,
    'total',          p_amount + v_fee,
    'platform_share', ROUND(v_fee * v_rule.platform_share, 2),
    'master_share',   ROUND(v_fee * v_rule.master_share, 2),
    'rate_type',      v_rule.rate_type,
    'rate_value',     v_rule.rate_value
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_transaction_fee(TEXT, NUMERIC) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- get_vault_summary — the single balance endpoint the frontend calls
-- Replaces get_vault_balance() for the vault card.
-- Returns posted, reserved, available balance + recent transactions.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_vault_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_vault_id       UUID;
  v_posted_credits NUMERIC(12,2) := 0;
  v_posted_debits  NUMERIC(12,2) := 0;
  v_posted_bal     NUMERIC(12,2) := 0;
  v_reserved       NUMERIC(12,2) := 0;
  v_available      NUMERIC(12,2) := 0;
  v_pending_topups NUMERIC(12,2) := 0;
  v_tx_history     JSONB := '[]';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Auto-create vault if needed
  v_vault_id := public._ensure_vault_account(v_uid);

  -- Posted balance from ledger
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

  -- Active reservations
  SELECT COALESCE(SUM(amount), 0) INTO v_reserved
  FROM public.vault_reservations
  WHERE vault_account_id = v_vault_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  v_available := GREATEST(0, v_posted_bal - v_reserved);

  -- Pending top-up amounts (for display)
  SELECT COALESCE(SUM(amount), 0) INTO v_pending_topups
  FROM public.vault_topups
  WHERE user_id = v_uid AND status IN ('pending','processing');

  -- Last 20 transactions
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
    'vault_id',         v_vault_id,
    'currency',         'NLe',
    'posted_balance',   v_posted_bal,
    'reserved_balance', v_reserved,
    'available_balance', v_available,
    'pending_topups',   v_pending_topups,
    'transactions',     v_tx_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vault_summary() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- initiate_vault_topup_record — called by Edge Function before Monime
-- ─────────────────────────────────────────────────────────────────────
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
  v_kyc_status     TEXT;
  v_account_status TEXT;
  v_existing       RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than zero.');
  END IF;

  -- KYC gate
  SELECT kyc_status INTO v_kyc_status FROM public.profiles WHERE id = v_uid;
  IF v_kyc_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('error', 'KYC verification required before adding money to your vault.');
  END IF;

  -- Rate limit: max 10 pending topups per hour
  IF (
    SELECT COUNT(*) FROM public.vault_topups
    WHERE user_id = v_uid
      AND created_at > now() - INTERVAL '1 hour'
      AND status NOT IN ('failed','cancelled','expired')
  ) >= 10 THEN
    RETURN jsonb_build_object('error', 'Too many top-up requests. Please wait before trying again.');
  END IF;

  -- Get/create vault account
  v_vault_id := public._ensure_vault_account(v_uid);

  SELECT status INTO v_account_status FROM public.vault_accounts WHERE id = v_vault_id;
  IF v_account_status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Your vault account is not active. Contact support.');
  END IF;

  -- Idempotency: return existing record for same key
  SELECT * INTO v_existing FROM public.vault_topups
  WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'topup_id',   v_existing.id,
      'vault_id',   v_existing.vault_account_id,
      'amount',     v_existing.amount,
      'status',     v_existing.status,
      'idempotent', TRUE
    );
  END IF;

  -- Create pending topup record
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
    'vault_tx_created', 'vault_topups', v_topup_id,
    NULL, jsonb_build_object('amount', p_amount, 'user_id', v_uid, 'action', 'topup_initiated')
  );

  RETURN jsonb_build_object(
    'topup_id',   v_topup_id,
    'vault_id',   v_vault_id,
    'amount',     p_amount,
    'status',     'pending',
    'idempotent', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- finalize_vault_topup — called by webhook when Monime confirms payment
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_vault_topup(
  p_monime_session_id TEXT,
  p_webhook_payload   JSONB DEFAULT NULL
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
  SELECT * INTO v_topup
  FROM public.vault_topups
  WHERE monime_session_id = p_monime_session_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Vault topup not found for session: ' || p_monime_session_id);
  END IF;

  -- Idempotent
  IF v_topup.status = 'completed' THEN
    RETURN jsonb_build_object('topup_id', v_topup.id, 'idempotent', TRUE, 'status', 'completed');
  END IF;

  IF v_topup.status NOT IN ('pending','processing') THEN
    RETURN jsonb_build_object(
      'error',    'Topup in terminal state: ' || v_topup.status,
      'topup_id', v_topup.id
    );
  END IF;

  -- Generate transaction reference
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
  SET status       = 'completed',
      completed_at = now()
  WHERE id = v_topup.id;

  PERFORM public.create_audit_log(
    'vault_tx_created', 'vault_topups', v_topup.id,
    NULL, jsonb_build_object(
      'amount',     v_topup.amount,
      'user_id',    v_topup.user_id,
      'session_id', p_monime_session_id,
      'action',     'topup_completed'
    )
  );

  RETURN jsonb_build_object(
    'topup_id',   v_topup.id,
    'vault_id',   v_topup.vault_account_id,
    'amount',     v_topup.amount,
    'status',     'completed',
    'reference',  v_tx_ref,
    'idempotent', FALSE
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- fail_vault_topup — called by webhook on expired/cancelled
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
  WHERE monime_session_id = p_monime_session_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Topup not found for session: ' || p_monime_session_id);
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
-- pay_osusu_from_vault — debits vault to pay Osusu contribution
-- All amounts server-calculated. No amount accepted from frontend.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pay_osusu_from_vault(
  p_group_id        UUID,
  p_period_id       UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
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
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- KYC gate
  SELECT kyc_status INTO v_kyc_status FROM public.profiles WHERE id = v_uid;
  IF v_kyc_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('error', 'KYC verification required to make Osusu contributions.');
  END IF;

  -- Load group
  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;
  IF v_group.status::TEXT <> 'active' THEN
    RETURN jsonb_build_object('error', 'This group is not active.');
  END IF;

  -- Membership check (osusu_group_members uses is_active boolean)
  SELECT is_active INTO v_is_member
  FROM public.osusu_group_members
  WHERE group_id = p_group_id AND user_id = v_uid;

  IF NOT FOUND OR NOT v_is_member THEN
    RETURN jsonb_build_object('error', 'You are not an active member of this group.');
  END IF;

  -- Load payment period
  SELECT * INTO v_period
  FROM public.payment_periods
  WHERE id = p_period_id AND group_id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment period not found for this group.');
  END IF;
  IF v_period.status::TEXT NOT IN ('open','upcoming') THEN
    RETURN jsonb_build_object('error', 'This payment period is not open for contributions.');
  END IF;
  IF v_period.is_locked THEN
    RETURN jsonb_build_object('error', 'This payment period is locked.');
  END IF;

  -- Idempotency check first
  SELECT * INTO v_existing_payment FROM public.contribution_payments
  WHERE member_id = v_uid AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'contribution_id', v_existing_payment.id,
      'status',          v_existing_payment.status::TEXT,
      'idempotent',      TRUE
    );
  END IF;

  -- Duplicate period payment check
  SELECT * INTO v_existing_payment FROM public.contribution_payments
  WHERE member_id = v_uid
    AND period_id  = p_period_id
    AND status::TEXT NOT IN ('rejected','failed','refunded');
  IF FOUND THEN
    RETURN jsonb_build_object(
      'error',           'You have already paid for this period.',
      'contribution_id', v_existing_payment.id
    );
  END IF;

  -- Server-calculate all amounts
  v_contribution_amt := v_group.contribution_amount;
  v_fee_result       := public.calculate_transaction_fee('osusu_contribution', v_contribution_amt);
  v_fee_amt          := (v_fee_result->>'fee')::NUMERIC;
  v_total_debit      := v_contribution_amt + v_fee_amt;

  -- Get/create vault account
  v_vault_id := public._ensure_vault_account(v_uid);

  SELECT status INTO v_account_status FROM public.vault_accounts WHERE id = v_vault_id;
  IF v_account_status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Your vault account is not active.');
  END IF;

  -- Acquire row-level lock on vault to prevent race conditions
  PERFORM 1 FROM public.vault_accounts WHERE id = v_vault_id FOR UPDATE;

  -- Available balance check
  IF public._vault_available_balance(v_vault_id) < v_total_debit THEN
    RETURN jsonb_build_object(
      'error',    'Insufficient vault balance. Please add money to your vault first.',
      'required', v_total_debit,
      'action',   'topup_required'
    );
  END IF;

  -- Create reservation to lock funds during this operation
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

  -- Generate receipt number
  v_receipt := 'RCP-' || to_char(now(), 'YYYYMMDD') || '-' ||
               upper(encode(gen_random_bytes(4), 'hex'));

  -- Create contribution_payments record (approved immediately — vault already verified)
  INSERT INTO public.contribution_payments (
    group_id, period_id, member_id,
    amount, currency, status, payment_method,
    receipt_number, idempotency_key, collected_at, approved_at
  ) VALUES (
    p_group_id, p_period_id, v_uid,
    v_contribution_amt, 'NLe', 'approved', 'vault',
    v_receipt, p_idempotency_key, now(), now()
  ) RETURNING id INTO v_contrib_id;

  -- Post vault debit — contribution principal
  INSERT INTO public.vault_transactions (
    vault_id, user_id, type, amount, currency,
    reference, description, related_payment_id,
    idempotency_key, created_by_fn
  ) VALUES (
    v_vault_id, v_uid, 'contribution', v_contribution_amt, 'NLe',
    v_receipt,
    'Osusu contribution: ' || v_group.name,
    v_contrib_id, p_idempotency_key,
    'pay_osusu_from_vault'
  );

  -- Post vault debit — fee (if applicable)
  IF v_fee_amt > 0 THEN
    INSERT INTO public.vault_transactions (
      vault_id, user_id, type, amount, currency,
      reference, description, related_payment_id,
      idempotency_key, created_by_fn
    ) VALUES (
      v_vault_id, v_uid, 'fee', v_fee_amt, 'NLe',
      v_receipt || '-FEE',
      'Platform fee: Osusu contribution',
      v_contrib_id,
      p_idempotency_key || '-fee',
      'pay_osusu_from_vault'
    );
  END IF;

  -- Consume reservation
  UPDATE public.vault_reservations
  SET status      = 'consumed',
      consumed_at = now(),
      reference_id = v_contrib_id
  WHERE id = v_reservation_id;

  -- Audit log
  PERFORM public.create_audit_log(
    'payment_approved', 'contribution_payments', v_contrib_id,
    NULL, jsonb_build_object(
      'amount',      v_contribution_amt,
      'fee',         v_fee_amt,
      'total_debit', v_total_debit,
      'group_id',    p_group_id,
      'period_id',   p_period_id,
      'vault_id',    v_vault_id,
      'source',      'vault'
    )
  );

  RETURN jsonb_build_object(
    'success',         TRUE,
    'contribution_id', v_contrib_id,
    'receipt_number',  v_receipt,
    'amount',          v_contribution_amt,
    'fee',             v_fee_amt,
    'total_debit',     v_total_debit,
    'status',          'approved'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_osusu_from_vault(UUID, UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- deposit_savings_from_vault — debits vault, credits savings goal
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deposit_savings_from_vault(
  p_savings_goal_id UUID,
  p_amount          NUMERIC,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_vault_id        UUID;
  v_kyc_status      TEXT;
  v_account_status  TEXT;
  v_goal            RECORD;
  v_fee_result      JSONB;
  v_fee_amt         NUMERIC(12,2);
  v_total_debit     NUMERIC(12,2);
  v_reservation_id  UUID;
  v_tx_ref          TEXT;
  v_new_balance     NUMERIC(12,2);
  v_new_status      TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Deposit amount must be greater than zero.');
  END IF;

  -- KYC gate
  SELECT kyc_status INTO v_kyc_status FROM public.profiles WHERE id = v_uid;
  IF v_kyc_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('error', 'KYC verification required to deposit to savings.');
  END IF;

  -- Load savings goal — user_id must match caller
  SELECT * INTO v_goal
  FROM public.savings_goals
  WHERE id = p_savings_goal_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Savings goal not found or does not belong to you.');
  END IF;
  IF v_goal.status NOT IN ('active') THEN
    RETURN jsonb_build_object('error', 'This savings goal is not active.');
  END IF;

  -- Idempotency check
  IF EXISTS (
    SELECT 1 FROM public.savings_transactions
    WHERE user_id = v_uid AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN jsonb_build_object(
      'success',         TRUE,
      'savings_goal_id', p_savings_goal_id,
      'amount',          p_amount,
      'idempotent',      TRUE
    );
  END IF;

  -- Fee calculation
  v_fee_result  := public.calculate_transaction_fee('savings_deposit', p_amount);
  v_fee_amt     := (v_fee_result->>'fee')::NUMERIC;
  v_total_debit := p_amount + v_fee_amt;

  -- Get/create vault account
  v_vault_id := public._ensure_vault_account(v_uid);

  SELECT status INTO v_account_status FROM public.vault_accounts WHERE id = v_vault_id;
  IF v_account_status <> 'active' THEN
    RETURN jsonb_build_object('error', 'Your vault account is not active.');
  END IF;

  -- Acquire row lock to prevent race conditions
  PERFORM 1 FROM public.vault_accounts WHERE id = v_vault_id FOR UPDATE;

  -- Balance check
  IF public._vault_available_balance(v_vault_id) < v_total_debit THEN
    RETURN jsonb_build_object(
      'error',   'Insufficient vault balance. Please add money to your vault first.',
      'required', v_total_debit,
      'action',  'topup_required'
    );
  END IF;

  -- Reservation
  INSERT INTO public.vault_reservations (
    vault_account_id, user_id, amount, currency,
    reservation_type, reference_type, reference_id,
    status, idempotency_key, expires_at
  ) VALUES (
    v_vault_id, v_uid, v_total_debit, 'NLe',
    'savings_deposit', 'savings_goals', p_savings_goal_id,
    'active', p_idempotency_key,
    now() + INTERVAL '5 minutes'
  ) RETURNING id INTO v_reservation_id;

  -- Transaction reference
  v_tx_ref := 'SAV-' || to_char(now(), 'YYYYMMDD') || '-' ||
              upper(encode(gen_random_bytes(4), 'hex'));

  -- Debit vault — savings principal
  INSERT INTO public.vault_transactions (
    vault_id, user_id, type, amount, currency,
    reference, description, idempotency_key, created_by_fn
  ) VALUES (
    v_vault_id, v_uid, 'savings_deposit', p_amount, 'NLe',
    v_tx_ref,
    'Savings deposit: ' || v_goal.title,
    p_idempotency_key,
    'deposit_savings_from_vault'
  );

  -- Debit vault — fee if applicable
  IF v_fee_amt > 0 THEN
    INSERT INTO public.vault_transactions (
      vault_id, user_id, type, amount, currency,
      reference, description, idempotency_key, created_by_fn
    ) VALUES (
      v_vault_id, v_uid, 'fee', v_fee_amt, 'NLe',
      v_tx_ref || '-FEE',
      'Platform fee: Savings deposit',
      p_idempotency_key || '-fee',
      'deposit_savings_from_vault'
    );
  END IF;

  -- Credit savings goal
  UPDATE public.savings_goals
  SET current_amount = current_amount + p_amount,
      updated_at     = now()
  WHERE id = p_savings_goal_id;

  -- Check completion
  SELECT current_amount INTO v_new_balance
  FROM public.savings_goals WHERE id = p_savings_goal_id;

  v_new_status := CASE WHEN v_new_balance >= v_goal.target_amount THEN 'completed' ELSE 'active' END;

  IF v_new_status = 'completed' THEN
    UPDATE public.savings_goals
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = p_savings_goal_id;
  END IF;

  -- Record savings transaction (savings_transactions uses goal_id, not savings_goal_id)
  INSERT INTO public.savings_transactions (
    goal_id, user_id, type, amount, currency,
    reference, note, idempotency_key, created_by_fn
  ) VALUES (
    p_savings_goal_id, v_uid, 'deposit', p_amount, 'NLe',
    v_tx_ref,
    'Vault deposit to savings goal',
    p_idempotency_key,
    'deposit_savings_from_vault'
  );

  -- Consume reservation
  UPDATE public.vault_reservations
  SET status      = 'consumed',
      consumed_at = now(),
      reference_id = p_savings_goal_id
  WHERE id = v_reservation_id;

  -- Audit
  PERFORM public.create_audit_log(
    'savings_tx_created', 'savings_goals', p_savings_goal_id,
    NULL, jsonb_build_object(
      'amount',         p_amount,
      'fee',            v_fee_amt,
      'new_balance',    v_new_balance,
      'goal_completed', v_new_status = 'completed',
      'vault_id',       v_vault_id,
      'source',         'vault'
    )
  );

  RETURN jsonb_build_object(
    'success',         TRUE,
    'savings_goal_id', p_savings_goal_id,
    'amount',          p_amount,
    'fee',             v_fee_amt,
    'total_debit',     v_total_debit,
    'new_balance',     v_new_balance,
    'goal_status',     v_new_status,
    'reference',       v_tx_ref
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.deposit_savings_from_vault(UUID, NUMERIC, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- verify_vault_topup_status — safe read-only status check
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_vault_topup_status(
  p_topup_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_topup RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT id, user_id, amount, currency, status, monime_session_id,
         created_at, completed_at, failed_at
  INTO v_topup
  FROM public.vault_topups
  WHERE id = p_topup_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Topup not found.');
  END IF;

  RETURN jsonb_build_object(
    'topup_id',          v_topup.id,
    'amount',            v_topup.amount,
    'currency',          v_topup.currency,
    'status',            v_topup.status,
    'monime_session_id', v_topup.monime_session_id,
    'created_at',        v_topup.created_at,
    'completed_at',      v_topup.completed_at,
    'failed_at',         v_topup.failed_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_vault_topup_status(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- PHASE 9: Expire stale reservations (run via pg_cron or on-demand)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_vault_reservations()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INT;
BEGIN
  UPDATE public.vault_reservations
  SET status      = 'expired',
      released_at = now()
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Indexes for performance
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS vault_topups_user_status_idx
  ON public.vault_topups (user_id, status);

CREATE INDEX IF NOT EXISTS vault_topups_session_id_idx
  ON public.vault_topups (monime_session_id)
  WHERE monime_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vault_reservations_account_status_idx
  ON public.vault_reservations (vault_account_id, status);

CREATE INDEX IF NOT EXISTS vault_tx_vault_type_idx
  ON public.vault_transactions (vault_id, type);
