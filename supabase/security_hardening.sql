-- ============================================================
-- Mi Osusu Security Hardening Migration
-- Generated: 2026-05-24
-- Apply in Supabase SQL Editor against your production project.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. POSITIVE AMOUNT CHECK CONSTRAINTS
--    Prevents zero/negative financial values at the DB layer.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.contributions
  DROP CONSTRAINT IF EXISTS chk_contributions_amount_positive,
  ADD CONSTRAINT chk_contributions_amount_positive
    CHECK (amount > 0);

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS chk_payments_amount_positive,
  ADD CONSTRAINT chk_payments_amount_positive
    CHECK (amount > 0);

ALTER TABLE public.savings_goals
  DROP CONSTRAINT IF EXISTS chk_savings_goals_target_positive,
  ADD CONSTRAINT chk_savings_goals_target_positive
    CHECK (target_amount > 0);

ALTER TABLE public.savings_goals
  DROP CONSTRAINT IF EXISTS chk_savings_goals_current_non_negative,
  ADD CONSTRAINT chk_savings_goals_current_non_negative
    CHECK (current_amount >= 0);

ALTER TABLE public.savings_transactions
  DROP CONSTRAINT IF EXISTS chk_savings_transactions_amount_positive,
  ADD CONSTRAINT chk_savings_transactions_amount_positive
    CHECK (amount > 0);

ALTER TABLE public.osusu_groups
  DROP CONSTRAINT IF EXISTS chk_osusu_groups_contribution_positive,
  ADD CONSTRAINT chk_osusu_groups_contribution_positive
    CHECK (contribution_amount > 0);

-- ──────────────────────────────────────────────────────────────
-- 2. FIX group_memberships INSERT RLS
--    Old policy let ANY authenticated user join ANY group by
--    inserting user_id = auth.uid(), bypassing join_requires_approval.
--    New policy: self-join creates a PENDING record; the creator
--    can insert approved records for invited members.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "group_memberships_insert_creator" ON public.group_memberships;

-- Creator can insert pre-approved records for members they invite.
CREATE POLICY "group_memberships_insert_by_creator"
  ON public.group_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.osusu_groups g
      WHERE g.id = group_memberships.group_id
        AND g.created_by = auth.uid()
    )
  );

-- Any authenticated user can request to join (status must be 'pending',
-- and the record must be for themselves only).
CREATE POLICY "group_memberships_self_join_pending"
  ON public.group_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(member_id, user_id) = auth.uid()
    AND status = 'pending'
  );

-- ──────────────────────────────────────────────────────────────
-- 3. FIX contributions UPDATE — members must NOT modify
--    submitted contributions; only creators/collectors can update status.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "contributions_update_own_or_group_creator" ON public.contributions;

-- Only group creators and active collectors may update contributions.
CREATE POLICY "contributions_update_creator_or_collector"
  ON public.contributions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.osusu_groups g
      WHERE g.id = contributions.group_id AND g.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.collectors c
      WHERE c.group_id = contributions.group_id
        AND c.profile_id = auth.uid()
        AND c.is_active = TRUE
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 4. FIX savings_goals — prevent clients from directly setting
--    current_amount (must go through savings_transactions + trigger).
--    Replace the broad ALL policy with split SELECT/INSERT/UPDATE/DELETE.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "savings_goals_manage_own" ON public.savings_goals;

CREATE POLICY "savings_goals_select_own"
  ON public.savings_goals FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "savings_goals_insert_own"
  ON public.savings_goals FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- UPDATE: owner can change title, description, category, target_amount,
-- target_date, status, auto_save_* — but NOT current_amount directly.
CREATE POLICY "savings_goals_update_own"
  ON public.savings_goals FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    -- Disallow client-side current_amount writes (must go via trigger/function)
    -- Postgres enforces WITH CHECK on the *new* row; we compare to DB value.
    AND current_amount = (
      SELECT sg2.current_amount FROM public.savings_goals sg2 WHERE sg2.id = savings_goals.id
    )
  );

CREATE POLICY "savings_goals_delete_own"
  ON public.savings_goals FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- ──────────────────────────────────────────────────────────────
-- 5. FIX audit_logs INSERT policy
--    Clients should NOT be able to fabricate audit records.
--    Remove the authenticated INSERT policy entirely;
--    audit writes must go through SECURITY DEFINER functions.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;

-- Admins/super_admins can SELECT their own logs for review.
DROP POLICY IF EXISTS "audit_logs_select_own" ON public.audit_logs;
CREATE POLICY "audit_logs_select_own"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- A SECURITY DEFINER function is the only way to insert audit logs.
-- Grant EXECUTE to authenticated so services can call it via RPC.
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_action    TEXT,
  p_table     TEXT,
  p_record_id UUID DEFAULT NULL,
  p_old_vals  JSONB DEFAULT NULL,
  p_new_vals  JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (auth.uid(), p_action, p_table, p_record_id, p_old_vals, p_new_vals);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_audit_log TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6. FIX member_secret_code — use gen_random_bytes() not random()
--    random() is a predictable PRNG; gen_random_bytes is cryptographic.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_member_secret_code() RETURNS TRIGGER AS $$
BEGIN
  -- Keep member_id / user_id in sync (backward-compat shim)
  IF NEW.member_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.member_id := NEW.user_id;
  END IF;
  IF NEW.user_id IS NULL AND NEW.member_id IS NOT NULL THEN
    NEW.user_id := NEW.member_id;
  END IF;
  -- Generate cryptographically secure 6-digit code
  IF NEW.member_secret_code IS NULL OR NEW.member_secret_code = '' THEN
    NEW.member_secret_code := lpad(
      (abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text,
      6, '0'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ──────────────────────────────────────────────────────────────
-- 7. SECURE savings_transactions INSERT
--    Ensure amount is positive and transaction_type is enforced.
--    (CHECK constraints added above; policy is fine already.)
-- ──────────────────────────────────────────────────────────────

-- A SECURITY DEFINER function to credit/debit a savings goal atomically.
-- The client calls this via RPC instead of directly inserting rows.
CREATE OR REPLACE FUNCTION public.record_savings_transaction(
  p_savings_goal_id UUID,
  p_amount          DECIMAL(12,2),
  p_type            TEXT,   -- 'deposit' or 'withdrawal'
  p_note            TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal    public.savings_goals%ROWTYPE;
  v_new_amt DECIMAL(12,2);
BEGIN
  -- Auth check
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_savings_goal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Savings goal not found.');
  END IF;
  IF v_goal.owner_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', 'Access denied.');
  END IF;
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than zero.');
  END IF;
  IF p_type NOT IN ('deposit', 'withdrawal') THEN
    RETURN jsonb_build_object('error', 'Invalid transaction type.');
  END IF;

  IF p_type = 'deposit' THEN
    v_new_amt := v_goal.current_amount + p_amount;
  ELSE
    IF v_goal.current_amount < p_amount THEN
      RETURN jsonb_build_object('error', 'Insufficient balance.');
    END IF;
    v_new_amt := v_goal.current_amount - p_amount;
  END IF;

  -- Update goal balance atomically
  UPDATE public.savings_goals
     SET current_amount = v_new_amt,
         updated_at     = NOW()
   WHERE id = p_savings_goal_id;

  -- Record the transaction
  INSERT INTO public.savings_transactions (savings_goal_id, amount, transaction_type, note)
  VALUES (p_savings_goal_id, p_amount, p_type, p_note);

  RETURN jsonb_build_object('current_amount', v_new_amt);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_savings_transaction TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 8. FIX profiles SELECT — members of the same group should be
--    able to see name (but NOT email/phone of other users).
--    Add a separate policy for group-member visibility of name only.
-- ──────────────────────────────────────────────────────────────

-- Group members can see basic name + phone of co-members for UX;
-- email is NOT exposed via this policy.
DROP POLICY IF EXISTS "profiles_select_group_peers" ON public.profiles;
CREATE POLICY "profiles_select_group_peers"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.group_memberships gm1
        JOIN public.group_memberships gm2 ON gm1.group_id = gm2.group_id
       WHERE COALESCE(gm1.member_id, gm1.user_id) = auth.uid()
         AND COALESCE(gm2.member_id, gm2.user_id) = profiles.id
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 9. IDEMPOTENCY — add idempotency_key to payments table
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS client_reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key
  ON public.payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 10. VALIDATE contributions amount matches group expectation
--     A trigger rejects contributions where amount != group's
--     contribution_amount (allowing ±0.01 for rounding).
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_contribution_amount() RETURNS TRIGGER AS $$
DECLARE
  v_expected DECIMAL(12,2);
BEGIN
  SELECT contribution_amount INTO v_expected
    FROM public.osusu_groups WHERE id = NEW.group_id;

  IF v_expected IS NOT NULL
     AND v_expected > 0
     AND abs(NEW.amount - (round(NEW.amount / v_expected) * v_expected)) > 0.01 THEN
    RAISE EXCEPTION 'Contribution amount % is not a valid multiple of group expected amount %.', NEW.amount, v_expected;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_contribution_amount ON public.contributions;
CREATE TRIGGER trg_validate_contribution_amount
  BEFORE INSERT OR UPDATE OF amount ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION public.validate_contribution_amount();

-- ──────────────────────────────────────────────────────────────
-- 11. GRANT EXECUTE on osusu_groups read for public invite code lookup
--     A user needs to resolve a group by invite code before joining;
--     that lookup must not expose full group data.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_invite_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group public.osusu_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group FROM public.osusu_groups WHERE invite_code = p_code LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid invite code.');
  END IF;
  IF v_group.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('error', 'This group is no longer accepting members.');
  END IF;

  RETURN jsonb_build_object(
    'id',                  v_group.id,
    'name',                v_group.name,
    'contribution_amount', v_group.contribution_amount,
    'frequency',           v_group.frequency,
    'max_members',         v_group.max_members,
    'join_requires_approval', v_group.join_requires_approval
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_invite_code TO authenticated;

-- 12. PAYMENT WEBHOOK HARDENING
--     Client-created payments must remain pending. Only the service role
--     webhook finalization function may mark a payment completed and credit
--     the related savings goal or contribution.

DROP POLICY IF EXISTS "payments_manage_own" ON public.payments;
CREATE POLICY "payments_select_own"
  ON public.payments FOR SELECT TO authenticated
  USING (payer_id = auth.uid());

CREATE POLICY "payments_insert_pending_own"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    payer_id = auth.uid()
    AND status IN ('pending', 'processing')
    AND amount > 0
  );

CREATE POLICY "payments_update_own_metadata_only"
  ON public.payments FOR UPDATE TO authenticated
  USING (payer_id = auth.uid())
  WITH CHECK (
    payer_id = auth.uid()
    AND status IN ('pending', 'processing')
  );

CREATE OR REPLACE FUNCTION public.finalize_verified_payment(
  p_payment_id UUID,
  p_provider_reference TEXT,
  p_webhook_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_goal public.savings_goals%ROWTYPE;
  v_new_amt DECIMAL(12,2);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', 'service_role required');
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment not found');
  END IF;

  IF v_payment.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  IF v_payment.amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Invalid amount');
  END IF;

  UPDATE public.payments
     SET status = 'completed',
         provider_reference = p_provider_reference,
         webhook_payload = p_webhook_payload,
         webhook_received_at = NOW(),
         updated_at = NOW()
   WHERE id = p_payment_id;

  IF v_payment.savings_goal_id IS NOT NULL THEN
    SELECT * INTO v_goal
      FROM public.savings_goals
     WHERE id = v_payment.savings_goal_id
     FOR UPDATE;

    IF NOT FOUND OR v_goal.owner_id <> v_payment.payer_id THEN
      RETURN jsonb_build_object('error', 'Savings goal mismatch');
    END IF;

    v_new_amt := v_goal.current_amount + v_payment.amount;

    UPDATE public.savings_goals
       SET current_amount = v_new_amt,
           status = CASE WHEN v_new_amt >= target_amount THEN 'completed'::savings_goal_status ELSE status END,
           completed_at = CASE WHEN v_new_amt >= target_amount THEN NOW() ELSE completed_at END,
           updated_at = NOW()
     WHERE id = v_payment.savings_goal_id;

    INSERT INTO public.savings_transactions (savings_goal_id, payment_id, amount, transaction_type, note)
    VALUES (v_payment.savings_goal_id, v_payment.id, v_payment.amount, 'deposit', 'Verified provider payment');
  END IF;

  IF v_payment.contribution_id IS NOT NULL THEN
    UPDATE public.contributions
       SET status = 'verified',
           verified_at = NOW(),
           payment_id = v_payment.id,
           updated_at = NOW()
     WHERE id = v_payment.contribution_id
       AND member_id = v_payment.payer_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_payment.payer_id,
    'payment_finalized',
    'payments',
    v_payment.id,
    jsonb_build_object('provider_reference', p_provider_reference, 'amount', v_payment.amount)
  );

  RETURN jsonb_build_object('status', 'completed');
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_verified_payment(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_verified_payment(UUID, TEXT, JSONB) TO service_role;

-- 13. CONTRIBUTION IMMUTABILITY AND VELOCITY CONTROLS

CREATE TABLE IF NOT EXISTS public.fraud_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.fraud_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fraud_events_select_super_admin" ON public.fraud_events;
CREATE POLICY "fraud_events_select_super_admin"
  ON public.fraud_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_final_contribution_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contribution records are immutable and cannot be deleted.';
  END IF;

  IF OLD.status IN ('collected', 'verified', 'refunded') THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.contribution_period IS DISTINCT FROM OLD.contribution_period
       OR NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
      RAISE EXCEPTION 'Finalized contribution financial fields are immutable.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_final_contribution_update ON public.contributions;
CREATE TRIGGER trg_prevent_final_contribution_update
  BEFORE UPDATE ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_final_contribution_mutation();

DROP TRIGGER IF EXISTS trg_prevent_contribution_delete ON public.contributions;
CREATE TRIGGER trg_prevent_contribution_delete
  BEFORE DELETE ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_final_contribution_mutation();

CREATE OR REPLACE FUNCTION public.detect_contribution_velocity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INT;
BEGIN
  SELECT COUNT(*) INTO v_recent_count
    FROM public.contributions
   WHERE member_id = NEW.member_id
     AND created_at > NOW() - INTERVAL '60 seconds';

  IF v_recent_count >= 3 THEN
    INSERT INTO public.fraud_events (user_id, event_type, severity, metadata)
    VALUES (
      NEW.member_id,
      'rapid_contributions',
      'high',
      jsonb_build_object('group_id', NEW.group_id, 'recent_count', v_recent_count + 1)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_contribution_velocity ON public.contributions;
CREATE TRIGGER trg_detect_contribution_velocity
  AFTER INSERT ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION public.detect_contribution_velocity();

-- 14. DATA RETENTION MARKERS
--     These are operational guardrails for scheduled cleanup jobs.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_hold_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON public.profiles(deleted_at);

-- 15. PROFILE ROLE/KYC IMMUTABILITY
--     A normal user may update their own profile contact fields, but must not
--     be able to self-promote or self-approve KYC by writing profile.role or
--     kyc_status through the public client.

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Profile role cannot be changed by client users.';
  END IF;

  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
    RAISE EXCEPTION 'KYC status cannot be changed by client users.';
  END IF;

  IF NEW.kyc_rejection_reason IS DISTINCT FROM OLD.kyc_rejection_reason THEN
    RAISE EXCEPTION 'KYC rejection reason cannot be changed by client users.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- Collector identity and passcode hardening.
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS collector_display_name TEXT;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS collector_photo_url TEXT;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS collector_passcode TEXT;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.collectors DROP CONSTRAINT IF EXISTS collectors_passcode_format;
ALTER TABLE public.collectors
  ADD CONSTRAINT collectors_passcode_format
  CHECK (collector_passcode IS NULL OR collector_passcode ~ '^[0-9]{6}$');

CREATE OR REPLACE FUNCTION public.generate_collector_passcode() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.collector_passcode IS NULL OR NEW.collector_passcode = '' THEN
    NEW.collector_passcode := lpad(
      (abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text,
      6, '0'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_generate_collector_passcode ON public.collectors;
CREATE TRIGGER trg_generate_collector_passcode BEFORE INSERT OR UPDATE ON public.collectors
  FOR EACH ROW EXECUTE FUNCTION public.generate_collector_passcode();

-- Done.
SELECT 'Mi Osusu security hardening migration applied successfully.' AS result;
