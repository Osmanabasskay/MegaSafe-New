-- ============================================================
-- Mi Osusu Backend Services Migration v1
-- All business logic, financial calculations, and sensitive
-- operations live here as SECURITY DEFINER functions.
-- Run in Supabase SQL Editor after security_hardening.sql.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. SCHEMA ADDITIONS
-- ──────────────────────────────────────────────────────────────

-- Add from_date / to_date to contributions for overlap checking
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS from_date DATE,
  ADD COLUMN IF NOT EXISTS to_date   DATE;

-- Add status / kyc_status / suspension fields to profiles if missing
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'banned')),
  ADD COLUMN IF NOT EXISTS kyc_status   TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (kyc_status IN ('not_submitted', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT;

-- Idempotency on contributions
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_idempotency
  ON public.contributions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Overlap exclusion index: no two non-refunded contributions for the same
-- member in the same group may have overlapping [from_date, to_date] ranges.
CREATE INDEX IF NOT EXISTS idx_contributions_period_range
  ON public.contributions USING GIST (group_id, member_id, daterange(from_date, to_date, '[]'))
  WHERE from_date IS NOT NULL AND to_date IS NOT NULL
    AND status NOT IN ('refunded');

-- rate_limit_log: tracks per-user sensitive action attempts
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        REFERENCES public.profiles(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_time
  ON public.rate_limit_log(user_id, action, created_at DESC);

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

-- webhook_events: idempotent webhook processing
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider     TEXT        NOT NULL,
  event_id     TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- commission_records: audit trail of every commission calculation
CREATE TABLE IF NOT EXISTS public.commission_records (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      UUID           REFERENCES public.payments(id) ON DELETE SET NULL,
  contribution_id UUID           REFERENCES public.contributions(id) ON DELETE SET NULL,
  gross_amount    DECIMAL(12, 2) NOT NULL,
  commission_rate DECIMAL(6, 4)  NOT NULL,
  commission_amt  DECIMAL(12, 2) NOT NULL,
  net_amount      DECIMAL(12, 2) NOT NULL,
  calculated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

ALTER TABLE public.commission_records ENABLE ROW LEVEL SECURITY;

-- contribution_schedules: server-generated payment schedules
CREATE TABLE IF NOT EXISTS public.contribution_schedules (
  id                  UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id            UUID    REFERENCES public.osusu_groups(id) ON DELETE CASCADE NOT NULL,
  member_id           UUID    REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  cycle_number        INT     NOT NULL,
  period_label        TEXT    NOT NULL,
  from_date           DATE    NOT NULL,
  to_date             DATE    NOT NULL,
  expected_amount     DECIMAL(12, 2) NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'due', 'paid', 'overdue', 'skipped')),
  contribution_id     UUID    REFERENCES public.contributions(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, member_id, cycle_number)
);

ALTER TABLE public.contribution_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_select_member_or_creator"
  ON public.contribution_schedules FOR SELECT TO authenticated
  USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.osusu_groups g
       WHERE g.id = contribution_schedules.group_id AND g.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.collectors c
       WHERE c.group_id = contribution_schedules.group_id
         AND c.profile_id = auth.uid()
         AND c.is_active = TRUE
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 2. UTILITY: RATE LIMITER
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_action      TEXT,
  p_max_attempts INT,
  p_window_secs  INT
)
RETURNS BOOLEAN          -- TRUE = allowed, FALSE = blocked
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_uid   UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.rate_limit_log
   WHERE user_id   = v_uid
     AND action    = p_action
     AND created_at > NOW() - (p_window_secs || ' seconds')::INTERVAL;

  IF v_count >= p_max_attempts THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.rate_limit_log (user_id, action)
  VALUES (v_uid, p_action);

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 3. AUTH AND ROLE SERVICE
--    get_my_role() — always reads from DB, never trusts JWT payload.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Profile not found.');
  END IF;
  RETURN jsonb_build_object(
    'role',       v_profile.role,
    'kyc_status', v_profile.kyc_status,
    'status',     v_profile.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 4. RECORD PHYSICAL COLLECTION (Collector Service)
--    Replaces ~200 lines of client-side groupService logic.
--    Single atomic transaction: validates, deduplicates, inserts,
--    audits, and notifies.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_physical_collection(
  p_group_id            UUID,
  p_member_id           UUID,
  p_amount              DECIMAL(12, 2),
  p_period              TEXT,
  p_from_date           DATE          DEFAULT NULL,
  p_to_date             DATE          DEFAULT NULL,
  p_method              TEXT          DEFAULT 'cash_collected',
  p_member_secret_code  TEXT          DEFAULT NULL,
  p_collector_passcode  TEXT          DEFAULT NULL,
  p_idempotency_key     UUID          DEFAULT NULL,
  p_notes               TEXT          DEFAULT NULL,
  p_cycle_number        INT           DEFAULT 1,
  p_payment_date        DATE          DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID;
  v_collector   public.collectors%ROWTYPE;
  v_membership  public.group_memberships%ROWTYPE;
  v_group       public.osusu_groups%ROWTYPE;
  v_existing    public.contributions%ROWTYPE;
  v_new_contrib public.contributions%ROWTYPE;
  v_receipt     TEXT;
  v_is_creator  BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Rate limit: max 15 collection attempts per minute
  IF NOT public.check_rate_limit('record_collection', 15, 60) THEN
    RETURN jsonb_build_object('error', 'Too many collection attempts. Please wait and try again.');
  END IF;

  -- Validate method enum
  IF p_method NOT IN ('cash_collected', 'orange_money', 'afrimoney', 'qmoney', 'bank_transfer', 'card') THEN
    RETURN jsonb_build_object('error', 'Invalid collection method.');
  END IF;

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be greater than zero.');
  END IF;

  -- Load and lock group
  SELECT * INTO v_group
    FROM public.osusu_groups
   WHERE id = p_group_id
   FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  IF v_group.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'This group is not currently accepting contributions.');
  END IF;

  -- Check caller is creator or active collector
  IF v_group.created_by = v_caller_id THEN
    v_is_creator := TRUE;
  ELSE
    SELECT * INTO v_collector
      FROM public.collectors
     WHERE group_id  = p_group_id
       AND profile_id = v_caller_id
       AND is_active  = TRUE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'You are not an active collector for this group.');
    END IF;
  END IF;

  -- Validate collector passcode (skip for group creator)
  IF NOT v_is_creator AND p_collector_passcode IS NOT NULL THEN
    IF v_collector.collector_passcode IS DISTINCT FROM p_collector_passcode THEN
      INSERT INTO public.fraud_events (user_id, event_type, severity, metadata)
      VALUES (v_caller_id, 'invalid_collector_passcode', 'medium',
              jsonb_build_object('group_id', p_group_id, 'collector_id', v_caller_id));
      RETURN jsonb_build_object('error', 'Invalid collector authorization code.');
    END IF;
  END IF;

  -- Load and lock member membership
  SELECT * INTO v_membership
    FROM public.group_memberships
   WHERE group_id  = p_group_id
     AND COALESCE(member_id, user_id) = p_member_id
     AND status    = 'approved'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Member not found in this group or not yet approved.');
  END IF;

  -- Validate member secret code
  IF p_member_secret_code IS NOT NULL THEN
    IF v_membership.member_secret_code IS DISTINCT FROM p_member_secret_code THEN
      INSERT INTO public.fraud_events (user_id, event_type, severity, metadata)
      VALUES (v_caller_id, 'invalid_member_secret_code', 'medium',
              jsonb_build_object('group_id', p_group_id, 'target_member', p_member_id));
      RETURN jsonb_build_object('error', 'Invalid member secret code. Please verify with the member and try again.');
    END IF;
  END IF;

  -- Validate amount matches group contribution amount (allow ±0.01 for rounding)
  IF v_group.contribution_amount IS NOT NULL AND v_group.contribution_amount > 0 THEN
    IF ABS(p_amount - v_group.contribution_amount) > 0.01 THEN
      RETURN jsonb_build_object(
        'error',
        format('Amount must be NLe %.2s (the group contribution amount).', v_group.contribution_amount)
      );
    END IF;
  END IF;

  -- Validate payment date: must be within 7 days of server date (guards against device clock manipulation)
  IF p_payment_date IS NOT NULL THEN
    IF p_payment_date > CURRENT_DATE THEN
      RETURN jsonb_build_object('error', 'Payment date cannot be in the future.');
    END IF;
    IF (CURRENT_DATE - p_payment_date) > 7 THEN
      RETURN jsonb_build_object('error', 'Payment date is too far in the past. Collections must be recorded within 7 days.');
    END IF;
  END IF;

  -- Idempotency: return existing if already recorded for this period
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.contributions
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success',         TRUE,
        'contribution_id', v_existing.id,
        'receipt_number',  v_existing.receipt_number,
        'idempotent',      TRUE
      );
    END IF;
  END IF;

  -- Check for exact period duplicate
  SELECT * INTO v_existing
    FROM public.contributions
   WHERE group_id           = p_group_id
     AND member_id          = p_member_id
     AND contribution_period = p_period
     AND status NOT IN ('refunded');

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'A contribution for this member and period already exists.');
  END IF;

  -- Check for overlapping date range (atomic, inside the transaction)
  IF p_from_date IS NOT NULL AND p_to_date IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.contributions c
       WHERE c.group_id  = p_group_id
         AND c.member_id = p_member_id
         AND c.status    NOT IN ('refunded')
         AND c.from_date IS NOT NULL
         AND c.to_date   IS NOT NULL
         AND daterange(c.from_date, c.to_date, '[]') && daterange(p_from_date, p_to_date, '[]')
    ) THEN
      RETURN jsonb_build_object('error',
        'A contribution for this member overlaps with the selected date range. Start from the next unpaid period.');
    END IF;
  END IF;

  -- Generate receipt number server-side (DB-owned, not device-owned)
  v_receipt := 'RCP-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
               upper(encode(gen_random_bytes(5), 'hex'));

  -- Insert contribution atomically
  INSERT INTO public.contributions (
    group_id, member_id, amount, currency_code, cycle_number,
    contribution_period, from_date, to_date,
    due_date, collected_by, collection_method, status,
    receipt_number, notes, idempotency_key
  )
  VALUES (
    p_group_id, p_member_id, p_amount, 'NLe', p_cycle_number,
    p_period, p_from_date, p_to_date,
    CURRENT_DATE,
    CASE WHEN v_is_creator THEN v_caller_id ELSE v_collector.id END,
    p_method::payment_method,
    'collected',
    v_receipt, p_notes, p_idempotency_key
  )
  RETURNING * INTO v_new_contrib;

  -- Notify member (non-blocking: failure here does not roll back the contribution)
  BEGIN
    INSERT INTO public.notifications (recipient_id, type, title, body, data)
    VALUES (
      p_member_id,
      'payment_received',
      'Contribution Recorded',
      format('Your contribution of NLe %.2s for %s has been collected. Receipt: %s',
             p_amount, p_period, v_receipt),
      jsonb_build_object(
        'group_id',        p_group_id,
        'contribution_id', v_new_contrib.id,
        'receipt_number',  v_receipt,
        'amount',          p_amount,
        'period',          p_period
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Notification failure does not abort the collection
    NULL;
  END;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id,
    'collector_contribution_recorded',
    'contributions',
    v_new_contrib.id,
    jsonb_build_object(
      'group_id',   p_group_id,
      'member_id',  p_member_id,
      'amount',     p_amount,
      'period',     p_period,
      'from_date',  p_from_date,
      'to_date',    p_to_date,
      'receipt',    v_receipt,
      'method',     p_method,
      'is_creator', v_is_creator
    )
  );

  RETURN jsonb_build_object(
    'success',         TRUE,
    'contribution_id', v_new_contrib.id,
    'receipt_number',  v_receipt,
    'amount',          p_amount,
    'period',          p_period,
    'from_date',       p_from_date,
    'to_date',         p_to_date,
    'collected_at',    v_new_contrib.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_physical_collection TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 5. ASSIGN COLLECTOR (validated, atomic, with notification)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_collector_validated(
  p_group_id     UUID,
  p_user_id      UUID,
  p_display_name TEXT    DEFAULT NULL,
  p_photo_url    TEXT    DEFAULT NULL,
  p_passcode     TEXT    DEFAULT NULL   -- NULL = auto-generate server-side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID;
  v_group       public.osusu_groups%ROWTYPE;
  v_target      public.profiles%ROWTYPE;
  v_membership  public.group_memberships%ROWTYPE;
  v_collector   public.collectors%ROWTYPE;
  v_secret_code TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Only group creator may assign collectors
  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  IF v_group.created_by <> v_caller_id THEN
    -- Also allow super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller_id AND role = 'super_admin') THEN
      RETURN jsonb_build_object('error', 'Only the group creator can assign collectors.');
    END IF;
  END IF;

  -- Validate target user exists
  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Target user not found.');
  END IF;

  -- Validate custom passcode format if provided
  IF p_passcode IS NOT NULL AND p_passcode !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('error', 'Collector passcode must be exactly 6 digits.');
  END IF;

  -- Upsert membership (trigger auto-generates member_secret_code)
  INSERT INTO public.group_memberships (
    group_id, member_id, user_id, status, approved_by, approved_at, join_method, invited_by
  )
  VALUES (
    p_group_id, p_user_id, p_user_id, 'approved',
    v_caller_id, NOW(), 'invited_by_creator', v_caller_id
  )
  ON CONFLICT (group_id, member_id) DO UPDATE
    SET status      = 'approved',
        approved_by = v_caller_id,
        approved_at = NOW()
  RETURNING * INTO v_membership;

  -- If ON CONFLICT path: re-read since RETURNING only gives new row on INSERT
  IF v_membership IS NULL THEN
    SELECT * INTO v_membership
      FROM public.group_memberships
     WHERE group_id = p_group_id AND COALESCE(member_id, user_id) = p_user_id;
  END IF;

  v_secret_code := v_membership.member_secret_code;

  -- Upsert collector (trigger auto-generates passcode if NULL)
  INSERT INTO public.collectors (
    group_id, profile_id, added_by, collector_type, membership_id,
    is_active, collector_display_name, collector_photo_url,
    collector_passcode, deactivated_at, deactivated_by
  )
  VALUES (
    p_group_id, p_user_id, v_caller_id, 'member_collector', v_membership.id,
    TRUE, p_display_name, p_photo_url, p_passcode, NULL, NULL
  )
  ON CONFLICT (group_id, profile_id) DO UPDATE
    SET is_active              = TRUE,
        collector_display_name = COALESCE(EXCLUDED.collector_display_name, collectors.collector_display_name),
        collector_photo_url    = COALESCE(EXCLUDED.collector_photo_url,    collectors.collector_photo_url),
        collector_passcode     = COALESCE(EXCLUDED.collector_passcode,     collectors.collector_passcode),
        deactivated_at         = NULL,
        deactivated_by         = NULL,
        updated_at             = NOW()
  RETURNING * INTO v_collector;

  -- Notify all group members about the new collector (inside same transaction)
  INSERT INTO public.notifications (recipient_id, type, title, body, data)
  SELECT
    COALESCE(gm.member_id, gm.user_id),
    'system_alert',
    'New Collector Assigned',
    CASE
      WHEN COALESCE(gm.member_id, gm.user_id) = p_user_id
        THEN format('You have been assigned as collector. Your passcode is: %s', v_collector.collector_passcode)
      ELSE format('A collector has been assigned to your group: %s. Only pay to this verified collector.',
                  COALESCE(v_collector.collector_display_name, v_target.first_name || ' ' || v_target.last_name))
    END,
    jsonb_build_object(
      'group_id',            p_group_id,
      'event',               'collector_assigned',
      'collector_user_id',   p_user_id,
      'collector_name',      COALESCE(v_collector.collector_display_name, ''),
      'collector_photo_url', COALESCE(v_collector.collector_photo_url, '')
    )
  FROM public.group_memberships gm
  WHERE gm.group_id = p_group_id AND gm.status = 'approved';

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (v_caller_id, 'collector_assigned', 'collectors', v_collector.id,
          jsonb_build_object('group_id', p_group_id, 'assigned_user', p_user_id));

  RETURN jsonb_build_object(
    'success',            TRUE,
    'collector_id',       v_collector.id,
    'member_secret_code', v_secret_code,
    'collector_passcode', v_collector.collector_passcode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_collector_validated TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6. DEACTIVATE COLLECTOR (atomic deactivation + member alerts)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.deactivate_collector_atomic(
  p_group_id            UUID,
  p_collector_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID;
  v_group       public.osusu_groups%ROWTYPE;
  v_collector   public.collectors%ROWTYPE;
  v_old_name    TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  IF v_group.created_by <> v_caller_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller_id AND role = 'super_admin') THEN
      RETURN jsonb_build_object('error', 'Only the group creator can deactivate collectors.');
    END IF;
  END IF;

  SELECT * INTO v_collector
    FROM public.collectors
   WHERE group_id   = p_group_id
     AND profile_id = p_collector_profile_id
     AND is_active  = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'No active collector found with this profile for this group.');
  END IF;

  v_old_name := COALESCE(v_collector.collector_display_name, 'the previous collector');

  -- Deactivate
  UPDATE public.collectors
     SET is_active       = FALSE,
         deactivated_at  = NOW(),
         deactivated_by  = v_caller_id,
         updated_at      = NOW()
   WHERE id = v_collector.id;

  -- Alert all members inside the same transaction
  INSERT INTO public.notifications (recipient_id, type, title, body, data)
  SELECT
    COALESCE(gm.member_id, gm.user_id),
    'system_alert',
    'Collector Removed',
    format('%s is NO LONGER authorized to collect payments. Do not give money to this person. Wait for a new collector.', v_old_name),
    jsonb_build_object(
      'group_id',                   p_group_id,
      'event',                      'collector_removed',
      'removed_collector_name',     v_old_name,
      'removed_collector_user_id',  p_collector_profile_id
    )
  FROM public.group_memberships gm
  WHERE gm.group_id = p_group_id AND gm.status = 'approved';

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (v_caller_id, 'collector_deactivated', 'collectors', v_collector.id,
          jsonb_build_object('group_id', p_group_id, 'removed_profile', p_collector_profile_id));

  RETURN jsonb_build_object('success', TRUE, 'removed_collector', v_old_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_collector_atomic TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 7. INITIATE GROUP PAYMENT
--    Creates contribution + payment atomically, validates everything
--    server-side. Frontend just calls this and awaits result.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.initiate_group_payment(
  p_group_id           UUID,
  p_amount             DECIMAL(12, 2),
  p_method             TEXT,
  p_provider           TEXT,
  p_cycle_number       INT,
  p_period             TEXT,
  p_from_date          DATE    DEFAULT NULL,
  p_to_date            DATE    DEFAULT NULL,
  p_due_date           DATE    DEFAULT NULL,
  p_idempotency_key    UUID    DEFAULT NULL,
  p_notes              TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payer_id    UUID;
  v_group       public.osusu_groups%ROWTYPE;
  v_membership  public.group_memberships%ROWTYPE;
  v_existing_c  public.contributions%ROWTYPE;
  v_existing_p  public.payments%ROWTYPE;
  v_contrib     public.contributions%ROWTYPE;
  v_payment     public.payments%ROWTYPE;
  v_receipt     TEXT;
BEGIN
  v_payer_id := auth.uid();
  IF v_payer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Rate limit: max 5 payment initiations per 5 minutes
  IF NOT public.check_rate_limit('initiate_payment', 5, 300) THEN
    RETURN jsonb_build_object('error', 'Too many payment attempts. Please wait before trying again.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Payment amount must be greater than zero.');
  END IF;

  -- Load group
  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  IF v_group.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'This group is not accepting payments.');
  END IF;

  -- Validate caller is approved member
  SELECT * INTO v_membership
    FROM public.group_memberships
   WHERE group_id = p_group_id
     AND COALESCE(member_id, user_id) = v_payer_id
     AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'You are not an approved member of this group.');
  END IF;

  -- Validate amount matches group's expected contribution
  IF v_group.contribution_amount IS NOT NULL AND v_group.contribution_amount > 0 THEN
    IF ABS(p_amount - v_group.contribution_amount) > 0.01 THEN
      RETURN jsonb_build_object(
        'error',
        format('Payment amount must be NLe %.2s (the group contribution amount).', v_group.contribution_amount)
      );
    END IF;
  END IF;

  -- Idempotency on payment
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_p FROM public.payments WHERE idempotency_key = p_idempotency_key::TEXT;
    IF FOUND THEN
      SELECT * INTO v_existing_c FROM public.contributions WHERE payment_id = v_existing_p.id;
      RETURN jsonb_build_object(
        'success',         TRUE,
        'payment_id',      v_existing_p.id,
        'contribution_id', v_existing_c.id,
        'status',          v_existing_p.status,
        'idempotent',      TRUE
      );
    END IF;
  END IF;

  -- Prevent duplicate contribution for same period
  SELECT * INTO v_existing_c
    FROM public.contributions
   WHERE group_id            = p_group_id
     AND member_id           = v_payer_id
     AND contribution_period = p_period
     AND status NOT IN ('refunded');

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'A contribution for this period has already been recorded.');
  END IF;

  -- Prevent overlapping date range
  IF p_from_date IS NOT NULL AND p_to_date IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.contributions c
       WHERE c.group_id  = p_group_id
         AND c.member_id = v_payer_id
         AND c.status    NOT IN ('refunded')
         AND c.from_date IS NOT NULL
         AND c.to_date   IS NOT NULL
         AND daterange(c.from_date, c.to_date, '[]') && daterange(p_from_date, p_to_date, '[]')
    ) THEN
      RETURN jsonb_build_object('error',
        'A contribution already covers part of this date range. Please select the next unpaid period.');
    END IF;
  END IF;

  -- Generate receipt server-side
  v_receipt := 'RCP-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
               upper(encode(gen_random_bytes(5), 'hex'));

  -- Insert contribution
  INSERT INTO public.contributions (
    group_id, member_id, amount, currency_code, cycle_number,
    contribution_period, from_date, to_date, due_date,
    collection_method, status, receipt_number, notes,
    idempotency_key
  )
  VALUES (
    p_group_id, v_payer_id, p_amount, 'NLe', p_cycle_number,
    p_period, p_from_date, p_to_date, COALESCE(p_due_date, CURRENT_DATE),
    p_method::payment_method, 'pending', v_receipt, p_notes,
    p_idempotency_key
  )
  RETURNING * INTO v_contrib;

  -- Insert payment (payer_id enforced = auth.uid() here; RLS double-checks)
  INSERT INTO public.payments (
    payer_id, recipient_group_id, amount, currency_code,
    payment_method, provider, status, contribution_id,
    idempotency_key
  )
  VALUES (
    v_payer_id, p_group_id, p_amount, 'NLe',
    p_method::payment_method, p_provider, 'pending', v_contrib.id,
    p_idempotency_key::TEXT
  )
  RETURNING * INTO v_payment;

  -- Link payment back to contribution
  UPDATE public.contributions SET payment_id = v_payment.id WHERE id = v_contrib.id;

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (v_payer_id, 'payment_initiated', 'payments', v_payment.id,
          jsonb_build_object(
            'group_id', p_group_id, 'amount', p_amount,
            'period', p_period, 'method', p_method
          ));

  RETURN jsonb_build_object(
    'success',         TRUE,
    'payment_id',      v_payment.id,
    'contribution_id', v_contrib.id,
    'receipt_number',  v_receipt,
    'status',          'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_group_payment TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 8. INITIATE SAVINGS DEPOSIT
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.initiate_savings_deposit(
  p_goal_id         UUID,
  p_amount          DECIMAL(12, 2),
  p_method          TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_goal    public.savings_goals%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_existing public.payments%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  IF NOT public.check_rate_limit('savings_deposit', 5, 300) THEN
    RETURN jsonb_build_object('error', 'Too many deposit attempts. Please wait before trying again.');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Deposit amount must be greater than zero.');
  END IF;

  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND owner_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Savings goal not found.');
  END IF;

  IF v_goal.status NOT IN ('active') THEN
    RETURN jsonb_build_object('error', 'This savings goal is not active.');
  END IF;

  -- Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.payments WHERE idempotency_key = p_idempotency_key::TEXT;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', TRUE, 'payment_id', v_existing.id,
        'status', v_existing.status, 'idempotent', TRUE
      );
    END IF;
  END IF;

  INSERT INTO public.payments (
    payer_id, savings_goal_id, amount, currency_code,
    payment_method, provider, status, idempotency_key
  )
  VALUES (
    v_uid, p_goal_id, p_amount, 'NLe',
    p_method::payment_method, 'pending_gateway', 'pending',
    p_idempotency_key::TEXT
  )
  RETURNING * INTO v_payment;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (v_uid, 'savings_deposit_initiated', 'payments', v_payment.id,
          jsonb_build_object('goal_id', p_goal_id, 'amount', p_amount));

  RETURN jsonb_build_object(
    'success', TRUE, 'payment_id', v_payment.id, 'status', 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_savings_deposit TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 9. GET GROUP SUMMARY (server-side aggregation)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_group_summary(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID;
  v_group      public.osusu_groups%ROWTYPE;
  v_total_coll DECIMAL(12, 2);
  v_member_cnt INT;
  v_paid_cnt   INT;
  v_outstanding DECIMAL(12, 2);
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  -- Access check: must be creator, approved member, or active collector
  IF v_group.created_by <> v_uid THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_memberships
       WHERE group_id = p_group_id AND COALESCE(member_id, user_id) = v_uid AND status = 'approved'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.collectors
       WHERE group_id = p_group_id AND profile_id = v_uid AND is_active = TRUE
    ) THEN
      RETURN jsonb_build_object('error', 'Access denied.');
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_coll
    FROM public.contributions
   WHERE group_id = p_group_id AND status IN ('collected', 'verified');

  SELECT COUNT(*) INTO v_member_cnt
    FROM public.group_memberships
   WHERE group_id = p_group_id AND status = 'approved';

  SELECT COUNT(DISTINCT member_id) INTO v_paid_cnt
    FROM public.contributions
   WHERE group_id = p_group_id AND status IN ('collected', 'verified');

  v_outstanding := (v_member_cnt * v_group.contribution_amount) - v_total_coll;

  RETURN jsonb_build_object(
    'group_id',            p_group_id,
    'name',                v_group.name,
    'status',              v_group.status,
    'contribution_amount', v_group.contribution_amount,
    'frequency',           v_group.frequency,
    'total_collected',     v_total_coll,
    'outstanding_balance', GREATEST(v_outstanding, 0),
    'member_count',        v_member_cnt,
    'paid_member_count',   v_paid_cnt,
    'total_cycles',        v_group.total_cycles,
    'cycle_start_date',    v_group.cycle_start_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_summary TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 10. GET MEMBER CONTRIBUTION STATUS
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_member_contribution_status(
  p_group_id  UUID,
  p_member_id UUID DEFAULT NULL   -- NULL = calling user
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_target_id    UUID;
  v_group        public.osusu_groups%ROWTYPE;
  v_total_paid   DECIMAL(12, 2);
  v_last_period  TEXT;
  v_last_to_date DATE;
  v_next_due     DATE;
  v_cycle_count  INT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  v_target_id := COALESCE(p_member_id, v_uid);

  -- Non-self requests require creator or active collector access
  IF v_target_id <> v_uid THEN
    SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
    IF v_group.created_by <> v_uid AND NOT EXISTS (
      SELECT 1 FROM public.collectors
       WHERE group_id = p_group_id AND profile_id = v_uid AND is_active = TRUE
    ) THEN
      RETURN jsonb_build_object('error', 'Access denied.');
    END IF;
  ELSE
    SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Group not found.'); END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.contributions
   WHERE group_id = p_group_id AND member_id = v_target_id
     AND status IN ('collected', 'verified');

  SELECT contribution_period, to_date INTO v_last_period, v_last_to_date
    FROM public.contributions
   WHERE group_id = p_group_id AND member_id = v_target_id
     AND status IN ('collected', 'verified')
   ORDER BY COALESCE(to_date, due_date) DESC NULLS LAST
   LIMIT 1;

  SELECT COUNT(*) INTO v_cycle_count
    FROM public.contributions
   WHERE group_id = p_group_id AND member_id = v_target_id
     AND status IN ('collected', 'verified');

  -- Next due date: day after last paid to_date, or cycle_start_date if never paid
  IF v_last_to_date IS NOT NULL THEN
    v_next_due := v_last_to_date + INTERVAL '1 day';
  ELSE
    v_next_due := v_group.cycle_start_date;
  END IF;

  RETURN jsonb_build_object(
    'group_id',                p_group_id,
    'member_id',               v_target_id,
    'total_paid',              v_total_paid,
    'outstanding_balance',     GREATEST((v_group.contribution_amount * v_group.total_cycles) - v_total_paid, 0),
    'paid_cycles',             v_cycle_count,
    'total_cycles',            v_group.total_cycles,
    'last_contribution_period', v_last_period,
    'last_paid_to_date',       v_last_to_date,
    'next_due_date',           v_next_due,
    'expected_amount',         v_group.contribution_amount,
    'is_fully_paid',           v_cycle_count >= v_group.total_cycles
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_member_contribution_status TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 11. GET HOME SUMMARY
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_home_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           UUID;
  v_savings_total DECIMAL(12, 2);
  v_groups_data   JSONB;
  v_notif_count   INT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  SELECT COALESCE(SUM(current_amount), 0) INTO v_savings_total
    FROM public.savings_goals
   WHERE owner_id = v_uid AND status = 'active';

  SELECT COUNT(*) INTO v_notif_count
    FROM public.notifications
   WHERE recipient_id = v_uid AND is_read = FALSE;

  SELECT jsonb_agg(
    jsonb_build_object(
      'group_id',            g.id,
      'name',                g.name,
      'status',              g.status,
      'contribution_amount', g.contribution_amount,
      'frequency',           g.frequency,
      'role',                CASE WHEN g.created_by = v_uid THEN 'creator' ELSE 'member' END,
      'total_collected',     COALESCE(sub.total_coll, 0),
      'member_count',        COALESCE(sub.member_cnt, 0)
    )
  ) INTO v_groups_data
  FROM public.osusu_groups g
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('collected','verified')), 0) AS total_coll,
      (SELECT COUNT(*) FROM public.group_memberships gm2
        WHERE gm2.group_id = g.id AND gm2.status = 'approved') AS member_cnt
    FROM public.contributions c
    WHERE c.group_id = g.id
  ) sub ON TRUE
  WHERE g.status IN ('active', 'paused')
    AND (
      g.created_by = v_uid
      OR EXISTS (
        SELECT 1 FROM public.group_memberships gm
         WHERE gm.group_id = g.id
           AND COALESCE(gm.member_id, gm.user_id) = v_uid
           AND gm.status = 'approved'
      )
    );

  RETURN jsonb_build_object(
    'savings_total',        v_savings_total,
    'unread_notifications', v_notif_count,
    'groups',               COALESCE(v_groups_data, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_home_summary TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 12. GET VAULT BALANCE
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_vault_balance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_total        DECIMAL(12, 2);
  v_completed    DECIMAL(12, 2);
  v_active       DECIMAL(12, 2);
  v_goals_data   JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  SELECT
    COALESCE(SUM(current_amount), 0),
    COALESCE(SUM(current_amount) FILTER (WHERE status = 'completed'), 0),
    COALESCE(SUM(current_amount) FILTER (WHERE status = 'active'), 0)
  INTO v_total, v_completed, v_active
  FROM public.savings_goals
  WHERE owner_id = v_uid;

  SELECT jsonb_agg(jsonb_build_object(
    'id',             id,
    'title',          title,
    'category',       category,
    'current_amount', current_amount,
    'target_amount',  target_amount,
    'status',         status,
    'progress_pct',   CASE WHEN target_amount > 0
                        THEN ROUND((current_amount / target_amount) * 100, 1)
                        ELSE 0 END
  ) ORDER BY created_at DESC) INTO v_goals_data
  FROM public.savings_goals
  WHERE owner_id = v_uid;

  RETURN jsonb_build_object(
    'total_balance',     v_total,
    'active_balance',    v_active,
    'completed_balance', v_completed,
    'goals',             COALESCE(v_goals_data, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_vault_balance TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 13. GET ADMIN REPORT (creator/super_admin only)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_group_admin_report(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID;
  v_group    public.osusu_groups%ROWTYPE;
  v_result   JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Group not found.'); END IF;

  IF v_group.created_by <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'super_admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Only group creator or super admin can access this report.');
  END IF;

  SELECT jsonb_build_object(
    'group_id',          p_group_id,
    'group_name',        v_group.name,
    'total_collected',   COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('collected','verified')), 0),
    'total_pending',     COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'pending'), 0),
    'total_refunded',    COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'refunded'), 0),
    'contribution_count', COUNT(c.id),
    'unique_payers',     COUNT(DISTINCT c.member_id) FILTER (WHERE c.status IN ('collected','verified')),
    'member_breakdown', (
      SELECT jsonb_agg(mb ORDER BY mb->>'total_paid' DESC)
      FROM (
        SELECT jsonb_build_object(
          'member_id',   gm.member_id,
          'total_paid',  COALESCE(SUM(mc.amount) FILTER (WHERE mc.status IN ('collected','verified')), 0),
          'cycle_count', COUNT(mc.id) FILTER (WHERE mc.status IN ('collected','verified'))
        ) AS mb
        FROM public.group_memberships gm
        LEFT JOIN public.contributions mc
          ON mc.group_id = p_group_id AND mc.member_id = COALESCE(gm.member_id, gm.user_id)
        WHERE gm.group_id = p_group_id AND gm.status = 'approved'
        GROUP BY gm.member_id
      ) sub
    ),
    'generated_at',      NOW()
  ) INTO v_result
  FROM public.contributions c
  WHERE c.group_id = p_group_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_admin_report TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 14. GET COLLECTOR PERFORMANCE REPORT
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_collector_report(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID;
  v_group  public.osusu_groups%ROWTYPE;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Group not found.'); END IF;

  -- Must be creator, super_admin, or active collector of this group
  IF v_group.created_by <> v_uid
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'super_admin')
     AND NOT EXISTS (SELECT 1 FROM public.collectors WHERE group_id = p_group_id AND profile_id = v_uid AND is_active = TRUE)
  THEN
    RETURN jsonb_build_object('error', 'Access denied.');
  END IF;

  SELECT jsonb_agg(row ORDER BY row->>'total_collected' DESC) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'collector_profile_id', c.profile_id,
      'display_name',         c.collector_display_name,
      'is_active',            c.is_active,
      'total_collected',      COALESCE(SUM(cn.amount) FILTER (WHERE cn.status IN ('collected','verified')), 0),
      'collection_count',     COUNT(cn.id) FILTER (WHERE cn.status IN ('collected','verified')),
      'last_collection_date', MAX(cn.created_at) FILTER (WHERE cn.status IN ('collected','verified'))
    ) AS row
    FROM public.collectors c
    LEFT JOIN public.contributions cn
      ON cn.group_id = p_group_id AND cn.collected_by = c.id
    WHERE c.group_id = p_group_id
    GROUP BY c.profile_id, c.collector_display_name, c.is_active
  ) sub;

  RETURN jsonb_build_object(
    'group_id',    p_group_id,
    'collectors',  COALESCE(v_result, '[]'::JSONB),
    'generated_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_collector_report TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 15. CALCULATE COMMISSION (server-side only)
--     Rate is stored in app config, never sent from frontend.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

INSERT INTO public.app_config (key, value)
VALUES ('platform_commission_rate', '0.015')  -- 1.5%
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- Only service_role and super_admin can modify config
CREATE POLICY "app_config_read_super_admin"
  ON public.app_config FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

CREATE OR REPLACE FUNCTION public.calculate_and_record_commission(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment     public.payments%ROWTYPE;
  v_rate        DECIMAL(6, 4);
  v_commission  DECIMAL(12, 2);
  v_net         DECIMAL(12, 2);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', 'Restricted to service_role.');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Payment not found.'); END IF;

  SELECT (value::TEXT)::DECIMAL(6,4) INTO v_rate
    FROM public.app_config WHERE key = 'platform_commission_rate';

  v_rate       := COALESCE(v_rate, 0.015);
  v_commission := ROUND(v_payment.amount * v_rate, 2);
  v_net        := v_payment.amount - v_commission;

  INSERT INTO public.commission_records
    (payment_id, gross_amount, commission_rate, commission_amt, net_amount)
  VALUES
    (p_payment_id, v_payment.amount, v_rate, v_commission, v_net);

  RETURN jsonb_build_object(
    'gross',      v_payment.amount,
    'commission', v_commission,
    'net',        v_net,
    'rate',       v_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_and_record_commission FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_and_record_commission TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 16. GENERATE CONTRIBUTION SCHEDULE (server-side)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_contribution_schedule(
  p_group_id  UUID,
  p_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID;
  v_target_id UUID;
  v_group     public.osusu_groups%ROWTYPE;
  v_cycle     INT;
  v_from      DATE;
  v_to        DATE;
  v_label     TEXT;
  v_schedule  JSONB := '[]'::JSONB;
  v_item      JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  v_target_id := COALESCE(p_member_id, v_uid);

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Group not found.'); END IF;

  -- Access check
  IF v_target_id <> v_uid THEN
    IF v_group.created_by <> v_uid AND NOT EXISTS (
      SELECT 1 FROM public.collectors WHERE group_id = p_group_id AND profile_id = v_uid AND is_active = TRUE
    ) THEN
      RETURN jsonb_build_object('error', 'Access denied.');
    END IF;
  END IF;

  v_from := v_group.cycle_start_date;

  FOR v_cycle IN 1..v_group.total_cycles LOOP
    CASE v_group.frequency
      WHEN 'daily'    THEN v_to := v_from;                        v_label := to_char(v_from, 'YYYY-MM-DD');
      WHEN 'weekly'   THEN v_to := v_from + INTERVAL '6 days';    v_label := to_char(v_from, 'YYYY-"W"IW');
      WHEN 'biweekly' THEN v_to := v_from + INTERVAL '13 days';   v_label := to_char(v_from, 'YYYY-MM-DD') || '/2w';
      WHEN 'monthly'  THEN v_to := (v_from + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
                           v_label := to_char(v_from, 'YYYY-MM');
      ELSE                 v_to := v_from; v_label := to_char(v_from, 'YYYY-MM-DD');
    END CASE;

    -- Upsert into contribution_schedules
    INSERT INTO public.contribution_schedules
      (group_id, member_id, cycle_number, period_label, from_date, to_date, expected_amount)
    VALUES
      (p_group_id, v_target_id, v_cycle, v_label, v_from, v_to, v_group.contribution_amount)
    ON CONFLICT (group_id, member_id, cycle_number) DO UPDATE
      SET period_label    = EXCLUDED.period_label,
          from_date       = EXCLUDED.from_date,
          to_date         = EXCLUDED.to_date,
          expected_amount = EXCLUDED.expected_amount;

    -- Check if paid
    v_item := jsonb_build_object(
      'cycle_number',     v_cycle,
      'period_label',     v_label,
      'from_date',        v_from,
      'to_date',          v_to,
      'expected_amount',  v_group.contribution_amount,
      'is_paid',          EXISTS (
        SELECT 1 FROM public.contributions c
         WHERE c.group_id = p_group_id AND c.member_id = v_target_id
           AND c.status IN ('collected','verified')
           AND (c.contribution_period = v_label OR
                (c.from_date <= v_to AND c.to_date >= v_from))
      ),
      'is_overdue',       v_to < CURRENT_DATE AND NOT EXISTS (
        SELECT 1 FROM public.contributions c
         WHERE c.group_id = p_group_id AND c.member_id = v_target_id
           AND c.status IN ('collected','verified')
           AND (c.contribution_period = v_label OR
                (c.from_date <= v_to AND c.to_date >= v_from))
      )
    );

    v_schedule := v_schedule || v_item;

    -- Advance to next period
    CASE v_group.frequency
      WHEN 'daily'    THEN v_from := v_from + INTERVAL '1 day';
      WHEN 'weekly'   THEN v_from := v_from + INTERVAL '7 days';
      WHEN 'biweekly' THEN v_from := v_from + INTERVAL '14 days';
      WHEN 'monthly'  THEN v_from := (v_from + INTERVAL '1 month')::DATE;
      ELSE                 v_from := v_from + INTERVAL '1 day';
    END CASE;
  END LOOP;

  RETURN jsonb_build_object(
    'group_id',  p_group_id,
    'member_id', v_target_id,
    'frequency', v_group.frequency,
    'schedule',  v_schedule
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_contribution_schedule TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 17. VALIDATE MEMBER ELIGIBILITY
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_member_eligibility(
  p_group_id  UUID,
  p_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID;
  v_target_id  UUID;
  v_membership public.group_memberships%ROWTYPE;
  v_profile    public.profiles%ROWTYPE;
  v_group      public.osusu_groups%ROWTYPE;
  v_paid_amt   DECIMAL(12, 2);
  v_outstanding DECIMAL(12, 2);
  v_cycle_cnt  INT;
BEGIN
  v_uid       := auth.uid();
  v_target_id := COALESCE(p_member_id, v_uid);

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_target_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible', FALSE, 'reason', 'Profile not found.'); END IF;

  IF v_profile.status = 'suspended' THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'Account is suspended.');
  END IF;
  IF v_profile.status = 'banned' THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'Account is banned.');
  END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible', FALSE, 'reason', 'Group not found.'); END IF;

  IF v_group.status <> 'active' THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'Group is not active.');
  END IF;

  SELECT * INTO v_membership
    FROM public.group_memberships
   WHERE group_id = p_group_id
     AND COALESCE(member_id, user_id) = v_target_id
     AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'Not an approved member of this group.');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid_amt
    FROM public.contributions
   WHERE group_id = p_group_id AND member_id = v_target_id
     AND status IN ('collected', 'verified');

  SELECT COUNT(*) INTO v_cycle_cnt
    FROM public.contributions
   WHERE group_id = p_group_id AND member_id = v_target_id
     AND status IN ('collected', 'verified');

  IF v_cycle_cnt >= v_group.total_cycles THEN
    RETURN jsonb_build_object(
      'eligible',    FALSE,
      'reason',      'All contribution cycles have been paid.',
      'is_complete', TRUE
    );
  END IF;

  v_outstanding := (v_group.contribution_amount * v_group.total_cycles) - v_paid_amt;

  RETURN jsonb_build_object(
    'eligible',           TRUE,
    'member_id',          v_target_id,
    'paid_amount',        v_paid_amt,
    'outstanding_amount', GREATEST(v_outstanding, 0),
    'paid_cycles',        v_cycle_cnt,
    'remaining_cycles',   v_group.total_cycles - v_cycle_cnt,
    'expected_amount',    v_group.contribution_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_member_eligibility TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 18. REQUEST GROUP DELETION (server-side, replaces client logic)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_deletion_requests (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id     UUID        REFERENCES public.osusu_groups(id) ON DELETE CASCADE NOT NULL,
  requested_by UUID        REFERENCES public.profiles(id) NOT NULL,
  reason       TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  UUID        REFERENCES public.profiles(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.group_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_requests_select"
  ON public.group_deletion_requests FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE OR REPLACE FUNCTION public.request_group_deletion(
  p_group_id UUID,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID;
  v_group       public.osusu_groups%ROWTYPE;
  v_has_members BOOLEAN;
  v_req_id      UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Group not found.'); END IF;

  IF v_group.created_by <> v_uid THEN
    RETURN jsonb_build_object('error', 'Only the group creator can delete this group.');
  END IF;

  -- Check if group has other active members
  SELECT EXISTS (
    SELECT 1 FROM public.group_memberships
     WHERE group_id = p_group_id
       AND COALESCE(member_id, user_id) <> v_uid
       AND status = 'approved'
  ) INTO v_has_members;

  IF v_has_members THEN
    -- Requires super_admin review
    INSERT INTO public.group_deletion_requests (group_id, requested_by, reason)
    VALUES (p_group_id, v_uid, p_reason)
    RETURNING id INTO v_req_id;

    UPDATE public.osusu_groups
       SET status = 'pending', updated_at = NOW()
     WHERE id = p_group_id;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (v_uid, 'group_deletion_requested', 'osusu_groups', p_group_id,
            jsonb_build_object('reason', p_reason, 'request_id', v_req_id));

    RETURN jsonb_build_object(
      'outcome',    'pending_super_admin',
      'request_id', v_req_id,
      'message',    'Deletion request submitted. A super admin will review and action it.'
    );
  ELSE
    -- No other members — delete immediately
    DELETE FROM public.osusu_groups WHERE id = p_group_id;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (v_uid, 'group_deleted', 'osusu_groups', p_group_id,
            jsonb_build_object('reason', p_reason));

    RETURN jsonb_build_object('outcome', 'deleted');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_group_deletion TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 19. AUTO-DISABLE COMPLETED/EXPIRED MEMBERS (scheduled job hook)
--     Call this function from a pg_cron job or Edge Function cron.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_disable_completed_members()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', 'Restricted to service_role.');
  END IF;

  -- Mark as 'removed' any membership where all cycles are paid
  WITH fully_paid AS (
    SELECT gm.id AS membership_id,
           gm.group_id,
           COALESCE(gm.member_id, gm.user_id) AS member_id,
           g.total_cycles
    FROM public.group_memberships gm
    JOIN public.osusu_groups g ON g.id = gm.group_id
    WHERE gm.status = 'approved'
  ),
  paid_counts AS (
    SELECT fp.membership_id, COUNT(c.id) AS paid
    FROM fully_paid fp
    LEFT JOIN public.contributions c
      ON c.group_id = fp.group_id AND c.member_id = fp.member_id
         AND c.status IN ('collected', 'verified')
    GROUP BY fp.membership_id, fp.total_cycles
    HAVING COUNT(c.id) >= fp.total_cycles
  )
  UPDATE public.group_memberships
     SET status = 'removed'
   WHERE id IN (SELECT membership_id FROM paid_counts);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('disabled_count', v_count, 'run_at', NOW());
END;
$$;

REVOKE ALL ON FUNCTION public.auto_disable_completed_members FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_disable_completed_members TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 20. OUTSTANDING BALANCES REPORT (all members of a group)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_outstanding_balances(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID;
  v_group  public.osusu_groups%ROWTYPE;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Not authenticated.'); END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Group not found.'); END IF;

  IF v_group.created_by <> v_uid
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND role = 'super_admin')
     AND NOT EXISTS (SELECT 1 FROM public.collectors WHERE group_id = p_group_id AND profile_id = v_uid AND is_active = TRUE)
  THEN
    RETURN jsonb_build_object('error', 'Access denied.');
  END IF;

  SELECT jsonb_agg(row ORDER BY (row->>'outstanding')::DECIMAL DESC) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'member_id',   COALESCE(gm.member_id, gm.user_id),
      'paid',        COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('collected','verified')), 0),
      'outstanding', GREATEST(
        v_group.contribution_amount * v_group.total_cycles -
        COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('collected','verified')), 0),
        0
      ),
      'cycles_paid', COUNT(c.id) FILTER (WHERE c.status IN ('collected','verified')),
      'is_complete', COUNT(c.id) FILTER (WHERE c.status IN ('collected','verified')) >= v_group.total_cycles
    ) AS row
    FROM public.group_memberships gm
    LEFT JOIN public.contributions c
      ON c.group_id = p_group_id AND c.member_id = COALESCE(gm.member_id, gm.user_id)
    WHERE gm.group_id = p_group_id AND gm.status = 'approved'
    GROUP BY gm.member_id, gm.user_id
  ) sub;

  RETURN jsonb_build_object(
    'group_id',     p_group_id,
    'members',      COALESCE(v_result, '[]'::JSONB),
    'generated_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_outstanding_balances TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 21. FIX: Admin audit_logs INSERT must use service_role client
--     (The admin panel uses server-side Supabase client with anon key;
--      it must use service_role key for audit_logs INSERT.)
-- ──────────────────────────────────────────────────────────────

-- Allow service_role to insert directly (used by admin panel server actions)
CREATE POLICY "audit_logs_insert_service_role"
  ON public.audit_logs FOR INSERT
  TO service_role
  WITH CHECK (TRUE);

-- ──────────────────────────────────────────────────────────────
-- 22. CLEANUP OLD RATE LIMIT LOGS (prevent table bloat)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limit_log WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limit_log FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_log TO service_role;

SELECT 'Mi Osusu backend_services_v1 migration applied.' AS result;
