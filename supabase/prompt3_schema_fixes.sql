-- ============================================================
-- Mi Osusu Prompt 3: Schema fixes — table/column alignment,
-- disputes system, and missing RPCs.
-- Run in Supabase SQL Editor after backend_services_v1.sql.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. PROFILES: add columns expected by frontend but missing
--    from the live schema (which only has full_name, phone, etc.)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name          TEXT,
  ADD COLUMN IF NOT EXISTS last_name           TEXT,
  ADD COLUMN IF NOT EXISTS email               TEXT,
  ADD COLUMN IF NOT EXISTS role                TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('super_admin','org_admin','collector','member')),
  ADD COLUMN IF NOT EXISTS kyc_status          TEXT NOT NULL DEFAULT 'not_submitted'
    CHECK (kyc_status IN ('not_submitted','pending','submitted','approved','rejected')),
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','banned')),
  ADD COLUMN IF NOT EXISTS national_id_front_url TEXT,
  ADD COLUMN IF NOT EXISTS national_id_back_url  TEXT,
  ADD COLUMN IF NOT EXISTS selfie_url            TEXT,
  ADD COLUMN IF NOT EXISTS country_id            TEXT,
  ADD COLUMN IF NOT EXISTS kyc_rejection_reason  TEXT;

-- Populate first_name/last_name from existing full_name for current rows
UPDATE public.profiles
SET
  first_name = NULLIF(trim(split_part(full_name, ' ', 1)), ''),
  last_name  = NULLIF(trim(substring(full_name FROM position(' ' IN full_name) + 1)), '')
WHERE first_name IS NULL AND full_name IS NOT NULL AND full_name <> '';

-- Sync full_name <-> first_name/last_name on write
CREATE OR REPLACE FUNCTION public.sync_profile_names()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
    NEW.full_name := trim(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_names ON public.profiles;
CREATE TRIGGER trg_sync_profile_names
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_names();

-- ──────────────────────────────────────────────────────────────
-- 2. OSUSU_GROUPS: add columns expected by frontend
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.osusu_groups
  ADD COLUMN IF NOT EXISTS avatar_url              TEXT,
  ADD COLUMN IF NOT EXISTS join_requires_approval  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS custom_rules            TEXT,
  ADD COLUMN IF NOT EXISTS payout_order            TEXT NOT NULL DEFAULT 'sequential'
    CHECK (payout_order IN ('sequential','random','custom','bidding')),
  ADD COLUMN IF NOT EXISTS contribution_number     TEXT;

-- ──────────────────────────────────────────────────────────────
-- 3. COLLECTORS: add display fields needed by frontend
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.collectors
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS photo_url    TEXT;

-- ──────────────────────────────────────────────────────────────
-- 4. COLLECTOR GROUP VIEW: joins collectors + collector_assignments
--    so the frontend can query by group_id and get display fields
-- ──────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.collector_group_view;
CREATE VIEW public.collector_group_view AS
SELECT
  c.id,
  c.user_id                 AS profile_id,
  c.display_name            AS collector_display_name,
  c.photo_url               AS collector_photo_url,
  c.is_active,
  c.created_at,
  ca.group_id,
  ca.status                 AS assignment_status
FROM public.collectors c
JOIN public.collector_assignments ca ON ca.collector_id = c.id;

-- ──────────────────────────────────────────────────────────────
-- 5. SAVINGS GOALS: authoritative ownership column is user_id.
--    owner_id (nullable, legacy) stays but is kept in sync.
-- ──────────────────────────────────────────────────────────────

-- Backfill: rows that have owner_id set but not user_id (should not happen but defensive)
UPDATE public.savings_goals
  SET user_id = owner_id
  WHERE owner_id IS NOT NULL
    AND (user_id IS NULL OR user_id <> owner_id);

-- Keep owner_id in sync so legacy queries still work
CREATE OR REPLACE FUNCTION public.sync_savings_goal_owner()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.owner_id := NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_savings_goal_owner ON public.savings_goals;
CREATE TRIGGER trg_sync_savings_goal_owner
  BEFORE INSERT OR UPDATE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.sync_savings_goal_owner();

-- ──────────────────────────────────────────────────────────────
-- 6. DISPUTES TABLE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.disputes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  group_id          UUID        REFERENCES public.osusu_groups(id)  ON DELETE SET NULL,
  payment_id        UUID        REFERENCES public.contribution_payments(id) ON DELETE SET NULL,
  complainant_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accused_user_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_admin_id UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  category          TEXT        NOT NULL
    CHECK (category IN ('missing_payment','collector_misconduct','incorrect_amount','unauthorized_transaction','other')),
  title             TEXT        NOT NULL CHECK (char_length(trim(title)) >= 5),
  description       TEXT        NOT NULL CHECK (char_length(trim(description)) >= 20),
  status            TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','resolved','escalated','dismissed')),
  priority          TEXT        NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  evidence_url      TEXT,
  resolution_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_disputes_complainant ON public.disputes(complainant_id);
CREATE INDEX IF NOT EXISTS idx_disputes_group       ON public.disputes(group_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status      ON public.disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_org         ON public.disputes(organization_id);

CREATE OR REPLACE FUNCTION public.set_disputes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  IF NEW.status IN ('resolved','dismissed')
     AND OLD.status NOT IN ('resolved','dismissed') THEN
    NEW.resolved_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_disputes_updated_at ON public.disputes;
CREATE TRIGGER trg_disputes_updated_at
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_disputes_updated_at();

-- ──────────────────────────────────────────────────────────────
-- 7. DISPUTES RLS POLICIES
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "disputes_insert_complainant" ON public.disputes;
CREATE POLICY "disputes_insert_complainant" ON public.disputes
  FOR INSERT TO authenticated
  WITH CHECK (complainant_id = auth.uid());

DROP POLICY IF EXISTS "disputes_select_own_or_admin" ON public.disputes;
CREATE POLICY "disputes_select_own_or_admin" ON public.disputes
  FOR SELECT TO authenticated
  USING (
    complainant_id = auth.uid()
    OR accused_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','org_admin')
    )
  );

DROP POLICY IF EXISTS "disputes_update_admin_only" ON public.disputes;
CREATE POLICY "disputes_update_admin_only" ON public.disputes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','org_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','org_admin')
    )
  );

DROP POLICY IF EXISTS "disputes_no_self_resolve" ON public.disputes;
CREATE POLICY "disputes_no_self_resolve" ON public.disputes
  FOR UPDATE TO authenticated
  USING (complainant_id <> auth.uid());

DROP POLICY IF EXISTS "disputes_delete_super_admin" ON public.disputes;
CREATE POLICY "disputes_delete_super_admin" ON public.disputes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 8. MISSING RPCs
-- ──────────────────────────────────────────────────────────────

-- 8a. create_dispute
CREATE OR REPLACE FUNCTION public.create_dispute(
  p_title         TEXT,
  p_description   TEXT,
  p_category      TEXT,
  p_group_id      UUID    DEFAULT NULL,
  p_payment_id    UUID    DEFAULT NULL,
  p_accused_id    UUID    DEFAULT NULL,
  p_priority      TEXT    DEFAULT 'normal',
  p_evidence_url  TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_org_id     UUID;
  v_dispute_id UUID;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF char_length(trim(COALESCE(p_title,''))) < 5 THEN
    RETURN jsonb_build_object('error','Title must be at least 5 characters');
  END IF;
  IF char_length(trim(COALESCE(p_description,''))) < 20 THEN
    RETURN jsonb_build_object('error','Description must be at least 20 characters');
  END IF;
  IF p_category NOT IN ('missing_payment','collector_misconduct','incorrect_amount','unauthorized_transaction','other') THEN
    RETURN jsonb_build_object('error','Invalid dispute category');
  END IF;
  IF COALESCE(p_priority,'normal') NOT IN ('low','normal','high','critical') THEN
    RETURN jsonb_build_object('error','Invalid priority');
  END IF;
  IF p_group_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id FROM public.osusu_groups WHERE id = p_group_id;
  END IF;

  INSERT INTO public.disputes (
    organization_id, group_id, payment_id, complainant_id,
    accused_user_id, category, title, description, status, priority, evidence_url
  ) VALUES (
    v_org_id, p_group_id, p_payment_id, v_caller,
    p_accused_id, p_category, trim(p_title), trim(p_description),
    'open', COALESCE(p_priority,'normal'), p_evidence_url
  ) RETURNING id INTO v_dispute_id;

  PERFORM public.create_audit_log('dispute_created','disputes', v_dispute_id, NULL,
    jsonb_build_object('category',p_category,'group_id',p_group_id,'complainant',v_caller));

  RETURN jsonb_build_object('success',true,'dispute_id',v_dispute_id);
END;
$$;

-- 8b. update_dispute_status (admin only)
CREATE OR REPLACE FUNCTION public.update_dispute_status(
  p_dispute_id      UUID,
  p_status          TEXT,
  p_resolution_note TEXT DEFAULT NULL,
  p_priority        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller   UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_old      TEXT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_caller AND role IN ('super_admin','org_admin'))
    INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error','Admins only'); END IF;
  IF p_status NOT IN ('open','under_review','resolved','escalated','dismissed') THEN
    RETURN jsonb_build_object('error','Invalid status');
  END IF;
  SELECT status INTO v_old FROM public.disputes WHERE id = p_dispute_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Dispute not found'); END IF;

  UPDATE public.disputes SET
    status            = p_status,
    resolution_note   = COALESCE(p_resolution_note, resolution_note),
    priority          = COALESCE(p_priority, priority),
    assigned_admin_id = CASE
      WHEN p_status IN ('under_review','resolved') THEN v_caller
      ELSE assigned_admin_id END
  WHERE id = p_dispute_id;

  PERFORM public.create_audit_log('dispute_status_changed','disputes',p_dispute_id,
    jsonb_build_object('from',v_old), jsonb_build_object('to',p_status,'by',v_caller));

  RETURN jsonb_build_object('success',true,'status',p_status);
END;
$$;

-- 8c. get_my_disputes
CREATE OR REPLACE FUNCTION public.get_my_disputes(
  p_status TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_rows   JSONB;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',d.id,'title',d.title,'description',d.description,
    'category',d.category,'status',d.status,'priority',d.priority,
    'group_id',d.group_id,'group_name',g.name,'payment_id',d.payment_id,
    'resolution_note',d.resolution_note,
    'created_at',d.created_at,'updated_at',d.updated_at,'resolved_at',d.resolved_at
  ) ORDER BY d.created_at DESC),'[]'::jsonb)
  INTO v_rows
  FROM public.disputes d
  LEFT JOIN public.osusu_groups g ON g.id = d.group_id
  WHERE d.complainant_id = v_caller
    AND (p_status IS NULL OR d.status = p_status);
  RETURN jsonb_build_object('success',true,'disputes',v_rows);
END;
$$;

-- 8d. get_admin_disputes
CREATE OR REPLACE FUNCTION public.get_admin_disputes(
  p_status   TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 50,
  p_offset   INT  DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller  UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_rows    JSONB;
  v_count   BIGINT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_caller AND role IN ('super_admin','org_admin'))
    INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error','Admins only'); END IF;

  SELECT COUNT(*) INTO v_count FROM public.disputes d
  WHERE (p_status IS NULL OR d.status = p_status)
    AND (p_category IS NULL OR d.category = p_category);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',d.id,'title',d.title,'category',d.category,'status',d.status,'priority',d.priority,
    'complainant_id',d.complainant_id,'accused_user_id',d.accused_user_id,
    'group_id',d.group_id,'group_name',g.name,'payment_id',d.payment_id,
    'resolution_note',d.resolution_note,'created_at',d.created_at,'resolved_at',d.resolved_at
  ) ORDER BY d.priority DESC, d.created_at ASC),'[]'::jsonb)
  INTO v_rows
  FROM public.disputes d
  LEFT JOIN public.osusu_groups g ON g.id = d.group_id
  WHERE (p_status IS NULL OR d.status = p_status)
    AND (p_category IS NULL OR d.category = p_category)
  LIMIT GREATEST(1,LEAST(200,p_limit))
  OFFSET GREATEST(0,p_offset);

  RETURN jsonb_build_object('success',true,'disputes',v_rows,'total',v_count);
END;
$$;

-- 8e. record_savings_transaction (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.record_savings_transaction(
  p_savings_goal_id UUID,
  p_amount          NUMERIC,
  p_type            TEXT,   -- 'deposit' | 'withdrawal'
  p_note            TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_goal       public.savings_goals%ROWTYPE;
  v_new_amount NUMERIC;
  v_txn_id     UUID;
  v_tx_type    savings_tx_type;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF p_type NOT IN ('deposit','withdrawal') THEN
    RETURN jsonb_build_object('error','Type must be deposit or withdrawal');
  END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error','Amount must be positive'); END IF;

  SELECT * INTO v_goal
  FROM public.savings_goals WHERE id = p_savings_goal_id AND user_id = v_caller;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Savings goal not found or not yours'); END IF;
  IF v_goal.status <> 'active' THEN
    RETURN jsonb_build_object('error','Cannot transact on a non-active goal');
  END IF;
  IF p_type = 'withdrawal' AND v_goal.current_amount < p_amount THEN
    RETURN jsonb_build_object('error','Insufficient balance');
  END IF;

  v_new_amount := CASE p_type
    WHEN 'deposit' THEN v_goal.current_amount + p_amount
    ELSE v_goal.current_amount - p_amount END;

  UPDATE public.savings_goals SET
    current_amount = v_new_amount,
    updated_at     = NOW(),
    status = CASE WHEN v_new_amount >= v_goal.target_amount THEN 'completed' ELSE status END,
    completed_at = CASE WHEN v_new_amount >= v_goal.target_amount AND status = 'active' THEN NOW() ELSE completed_at END
  WHERE id = p_savings_goal_id;

  v_tx_type := p_type::savings_tx_type;
  INSERT INTO public.savings_transactions (goal_id, user_id, type, amount, note)
  VALUES (p_savings_goal_id, v_caller, v_tx_type, p_amount, p_note)
  RETURNING id INTO v_txn_id;

  PERFORM public.create_audit_log('savings_transaction','savings_goals',p_savings_goal_id,
    jsonb_build_object('previous',v_goal.current_amount),
    jsonb_build_object('type',p_type,'amount',p_amount,'new_amount',v_new_amount));

  RETURN jsonb_build_object(
    'success',true,'transaction_id',v_txn_id,'current_amount',v_new_amount);
END;
$$;

-- 8f. initiate_savings_deposit
CREATE OR REPLACE FUNCTION public.initiate_savings_deposit(
  p_goal_id         UUID,
  p_amount          NUMERIC,
  p_method          TEXT,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_goal   public.savings_goals%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error','Amount must be positive'); END IF;

  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id AND user_id = v_caller;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Goal not found or not yours'); END IF;
  IF v_goal.status <> 'active' THEN RETURN jsonb_build_object('error','Goal is not active'); END IF;

  -- Idempotency: check recent duplicate by key in audit_logs
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.audit_logs
      WHERE action = 'savings_deposit_initiated'
        AND new_data->>'idempotency_key' = p_idempotency_key
        AND created_at > NOW() - INTERVAL '24 hours'
    ) THEN
      RETURN jsonb_build_object('success',true,'idempotent',true);
    END IF;
  END IF;

  PERFORM public.create_audit_log('savings_deposit_initiated','savings_goals',p_goal_id,
    NULL, jsonb_build_object(
      'amount',p_amount,'method',p_method,
      'idempotency_key',COALESCE(p_idempotency_key,'none')
    ));

  -- Record immediately for cash/direct; mobile money webhook would call record_savings_transaction
  RETURN public.record_savings_transaction(p_goal_id, p_amount, 'deposit',
    'Deposit via ' || COALESCE(p_method,'unknown'));
END;
$$;

-- 8g. resolve_invite_code
CREATE OR REPLACE FUNCTION public.resolve_invite_code(
  p_invite_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_group  public.osusu_groups%ROWTYPE;
  v_count  BIGINT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF trim(COALESCE(p_invite_code,'')) = '' THEN
    RETURN jsonb_build_object('error','Invite code is required');
  END IF;

  SELECT * INTO v_group FROM public.osusu_groups
  WHERE invite_code = upper(trim(p_invite_code)) AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','Invalid or expired invite code');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.osusu_group_members WHERE group_id = v_group.id AND is_active;

  RETURN jsonb_build_object(
    'success',true,'group_id',v_group.id,'name',v_group.name,
    'description',v_group.description,
    'contribution_amount',v_group.contribution_amount,'frequency',v_group.frequency,
    'member_count',v_count,'max_members',v_group.max_members,
    'is_full', v_count >= v_group.max_members
  );
END;
$$;

-- 8h. assign_collector_validated
CREATE OR REPLACE FUNCTION public.assign_collector_validated(
  p_group_id     UUID,
  p_user_id      UUID,
  p_display_name TEXT DEFAULT NULL,
  p_photo_url    TEXT DEFAULT NULL,
  p_passcode     TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_collector_id UUID;
  v_assignment_id UUID;
  v_passcode_hash TEXT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF NOT public.can_manage_group(p_group_id) THEN
    RETURN jsonb_build_object('error','Not authorised to assign collectors for this group');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.osusu_group_members
    WHERE group_id = p_group_id AND user_id = p_user_id AND is_active
  ) THEN
    RETURN jsonb_build_object('error','User must be an active group member');
  END IF;

  IF p_passcode IS NOT NULL AND trim(p_passcode) <> '' THEN
    v_passcode_hash := crypt(p_passcode, gen_salt('bf'));
  END IF;

  INSERT INTO public.collectors (user_id, display_name, photo_url, passcode_hash, is_active, kyc_verified)
  VALUES (p_user_id, p_display_name, p_photo_url, v_passcode_hash, true, true)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name  = COALESCE(EXCLUDED.display_name,  collectors.display_name),
    photo_url     = COALESCE(EXCLUDED.photo_url,     collectors.photo_url),
    passcode_hash = COALESCE(EXCLUDED.passcode_hash, collectors.passcode_hash),
    is_active     = true,
    updated_at    = NOW()
  RETURNING id INTO v_collector_id;

  -- Retire any existing active assignment for this group
  UPDATE public.collector_assignments
  SET status = 'removed', removed_at = NOW(), removed_by = v_caller
  WHERE group_id = p_group_id AND status = 'active';

  INSERT INTO public.collector_assignments (collector_id, group_id, assigned_by, status)
  VALUES (v_collector_id, p_group_id, v_caller, 'active')
  RETURNING id INTO v_assignment_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT m.user_id, 'system_alert', 'New Collector Assigned',
    COALESCE(p_display_name,'A collector') || ' is now collecting for your group.',
    jsonb_build_object('group_id',p_group_id,'collector_id',v_collector_id)
  FROM public.osusu_group_members m
  WHERE m.group_id = p_group_id AND m.is_active AND m.user_id <> p_user_id;

  PERFORM public.create_audit_log('collector_assigned','collectors',v_collector_id,
    NULL, jsonb_build_object('group_id',p_group_id,'by',v_caller));

  RETURN jsonb_build_object(
    'success',true,
    'collector_id',v_collector_id,
    'assignment_id',v_assignment_id,
    'collector_passcode', p_passcode
  );
END;
$$;

-- 8i. deactivate_collector_atomic
CREATE OR REPLACE FUNCTION public.deactivate_collector_atomic(
  p_group_id             UUID,
  p_collector_profile_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_collector_id UUID;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;
  IF NOT public.can_manage_group(p_group_id) THEN
    RETURN jsonb_build_object('error','Not authorised to manage collectors');
  END IF;

  SELECT c.id INTO v_collector_id
  FROM public.collectors c
  JOIN public.collector_assignments ca ON ca.collector_id = c.id
  WHERE c.user_id = p_collector_profile_id
    AND ca.group_id = p_group_id
    AND ca.status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','No active collector assignment found');
  END IF;

  UPDATE public.collector_assignments
  SET status = 'removed', removed_at = NOW(), removed_by = v_caller
  WHERE collector_id = v_collector_id AND group_id = p_group_id AND status = 'active';

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT m.user_id, 'system_alert', 'Collector Removed',
    'The collector for your group has been removed. Do not make payments until a new collector is assigned.',
    jsonb_build_object('group_id',p_group_id)
  FROM public.osusu_group_members m
  WHERE m.group_id = p_group_id AND m.is_active;

  PERFORM public.create_audit_log('collector_deactivated','collectors',v_collector_id,
    NULL, jsonb_build_object('group_id',p_group_id,'by',v_caller));

  RETURN jsonb_build_object('success',true);
END;
$$;

-- 8j. request_group_deletion
CREATE OR REPLACE FUNCTION public.request_group_deletion(
  p_group_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller      UUID := auth.uid();
  v_group       public.osusu_groups%ROWTYPE;
  v_other_count BIGINT;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error','Not authenticated'); END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Group not found'); END IF;

  IF v_group.created_by <> v_caller THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller AND role = 'super_admin') THEN
      RETURN jsonb_build_object('error','Only the group creator can request deletion');
    END IF;
  END IF;

  SELECT count(*) INTO v_other_count
  FROM public.osusu_group_members
  WHERE group_id = p_group_id AND is_active AND user_id <> v_caller;

  IF v_other_count > 0 THEN
    UPDATE public.osusu_groups SET status = 'pending' WHERE id = p_group_id;
    PERFORM public.create_audit_log('group_deletion_requested','osusu_groups',p_group_id,
      NULL, jsonb_build_object('reason',p_reason,'other_members',v_other_count,'by',v_caller));
    RETURN jsonb_build_object('success',true,'outcome','pending_super_admin','member_count',v_other_count);
  END IF;

  DELETE FROM public.osusu_groups WHERE id = p_group_id;
  PERFORM public.create_audit_log('group_deleted','osusu_groups',p_group_id,
    NULL, jsonb_build_object('reason',p_reason,'by',v_caller));
  RETURN jsonb_build_object('success',true,'outcome','deleted');
END;
$$;

-- 8k. initiate_group_payment (adapter: accepts text method, delegates to record_physical_collection)
CREATE OR REPLACE FUNCTION public.initiate_group_payment(
  p_group_id        UUID,
  p_member_id       UUID,
  p_period_id       UUID,
  p_amount          NUMERIC,
  p_payment_method  TEXT   DEFAULT 'cash',
  p_idempotency_key TEXT   DEFAULT NULL,
  p_notes           TEXT   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_method mobile_money_provider;
BEGIN
  BEGIN
    v_method := p_payment_method::mobile_money_provider;
  EXCEPTION WHEN OTHERS THEN
    v_method := 'cash';
  END;
  RETURN public.record_physical_collection(
    p_group_id, p_member_id, p_period_id, p_amount,
    v_method, p_notes, p_idempotency_key
  );
END;
$$;
