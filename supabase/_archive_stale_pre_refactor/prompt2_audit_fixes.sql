-- ============================================================
-- PROMPT 2 — Audit Fixes Migration
-- Mi Osusu Osusu — Production Audit Remediation
-- Apply after backend_services_v1.sql
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- FIX 1: Add expo_push_token column to profiles
--         send-notification Edge Function queries this column;
--         without it all push notifications silently fail.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- ──────────────────────────────────────────────────────────────
-- FIX 2: Create guarantors table
--         phase2_storage.sql creates a policy on this table
--         before the table exists, crashing that migration.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guarantors (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id        UUID          NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  group_id         UUID          REFERENCES  public.osusu_groups(id)         ON DELETE CASCADE,
  name             TEXT          NOT NULL,
  phone            TEXT,
  relationship     TEXT,
  id_document_url  TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.guarantors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guarantors_select_own"
  ON public.guarantors FOR SELECT TO authenticated
  USING (member_id = auth.uid());

CREATE POLICY "guarantors_insert_own"
  ON public.guarantors FOR INSERT TO authenticated
  WITH CHECK (member_id = auth.uid());

CREATE POLICY "guarantors_update_own"
  ON public.guarantors FOR UPDATE TO authenticated
  USING  (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

CREATE POLICY "guarantors_delete_own"
  ON public.guarantors FOR DELETE TO authenticated
  USING (member_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_guarantors_member_id
  ON public.guarantors(member_id);

-- ──────────────────────────────────────────────────────────────
-- FIX 3: consume_admin_rate_limit RPC
--         Called from apps/admin/lib/security.ts but never defined.
--         Without this, the admin panel returns 429 on every action.
-- ──────────────────────────────────────────────────────────────

-- Add ip_address column to rate_limit_log for IP-keyed rate limiting
ALTER TABLE public.rate_limit_log
  ADD COLUMN IF NOT EXISTS ip_address INET;

CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_action_time
  ON public.rate_limit_log(ip_address, action, created_at DESC)
  WHERE ip_address IS NOT NULL;

CREATE OR REPLACE FUNCTION public.consume_admin_rate_limit(p_ip TEXT)
RETURNS BOOLEAN          -- TRUE = allowed, FALSE = blocked
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_ip    INET;
BEGIN
  -- Validate the IP string; return FALSE on bad input
  BEGIN
    v_ip := p_ip::INET;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;

  -- 30 attempts per 60-second window per IP
  SELECT COUNT(*) INTO v_count
    FROM public.rate_limit_log
   WHERE ip_address = v_ip
     AND action     = 'admin_action'
     AND created_at > NOW() - INTERVAL '60 seconds';

  IF v_count >= 30 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.rate_limit_log (ip_address, action)
  VALUES (v_ip, 'admin_action');

  RETURN TRUE;
END;
$$;

-- Only callable by service_role (admin panel uses service-role key)
REVOKE EXECUTE ON FUNCTION public.consume_admin_rate_limit(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_admin_rate_limit(TEXT) TO service_role;

-- ──────────────────────────────────────────────────────────────
-- FIX 4: update_group_logo RPC
--         Already deployed via MCP this session; included here
--         so it lives in the migration history too.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_group_logo(
  p_group_id   UUID,
  p_avatar_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.osusu_groups
  SET    avatar_url = p_avatar_url,
         updated_at = NOW()
  WHERE  id         = p_group_id
    AND  created_by = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found or you are not the creator.');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_group_logo(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_group_logo(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- FIX 5: create_osusu_group RPC
--         Frontend currently does a raw INSERT into osusu_groups.
--         This SECURITY DEFINER RPC handles: validation, group
--         creation, atomic creator self-membership, and audit log.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_osusu_group(
  p_name                TEXT,
  p_description         TEXT    DEFAULT NULL,
  p_frequency           TEXT    DEFAULT 'monthly',
  p_contribution_amount DECIMAL DEFAULT 100,
  p_max_members         INT     DEFAULT 10,
  p_cycle_start_date    DATE    DEFAULT NULL,
  p_total_cycles        INT     DEFAULT NULL,
  p_invite_code         TEXT    DEFAULT NULL,
  p_avatar_url          TEXT    DEFAULT NULL,
  p_join_requires_approval BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_group     public.osusu_groups%ROWTYPE;
  v_invite    TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Input validation
  IF p_contribution_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Contribution amount must be greater than 0.');
  END IF;

  IF p_max_members < 2 THEN
    RETURN jsonb_build_object('error', 'Group must allow at least 2 members.');
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('error', 'Group name is required.');
  END IF;

  IF p_frequency NOT IN ('daily','weekly','biweekly','monthly') THEN
    RETURN jsonb_build_object('error', 'Invalid frequency. Use daily, weekly, biweekly, or monthly.');
  END IF;

  -- Generate server-side invite code if not provided
  v_invite := COALESCE(
    NULLIF(trim(p_invite_code), ''),
    'MSF-' || upper(encode(gen_random_bytes(4), 'hex'))
  );

  -- Create the group
  INSERT INTO public.osusu_groups (
    name, description, created_by, frequency,
    contribution_amount, max_members, cycle_start_date,
    total_cycles, invite_code, avatar_url,
    join_requires_approval, status
  )
  VALUES (
    trim(p_name), p_description, v_caller_id, p_frequency,
    p_contribution_amount, p_max_members, p_cycle_start_date,
    p_total_cycles, v_invite, p_avatar_url,
    p_join_requires_approval, 'active'
  )
  RETURNING * INTO v_group;

  -- Creator self-membership (approved, payout position 1)
  INSERT INTO public.group_memberships (
    group_id, member_id, user_id, status,
    approved_by, approved_at, join_method, payout_position
  )
  VALUES (
    v_group.id, v_caller_id, v_caller_id, 'approved',
    v_caller_id, NOW(), 'creator', 1
  )
  ON CONFLICT (group_id, member_id) DO NOTHING;

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id, 'group_created', 'osusu_groups', v_group.id,
    jsonb_build_object(
      'name',                v_group.name,
      'contribution_amount', v_group.contribution_amount,
      'max_members',         v_group.max_members,
      'frequency',           v_group.frequency
    )
  );

  RETURN jsonb_build_object(
    'success',    true,
    'group_id',   v_group.id,
    'invite_code', v_invite,
    'name',       v_group.name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_osusu_group FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_osusu_group TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- FIX 6: add_member_to_group RPC with capacity enforcement
--         Frontend has no server-side capacity check; groups can
--         be overfilled. This RPC enforces max_members.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_member_to_group(
  p_group_id       UUID,
  p_user_id        UUID,
  p_payout_position INT DEFAULT NULL,
  p_invite_code    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     UUID;
  v_group         public.osusu_groups%ROWTYPE;
  v_current_count INT;
  v_status        TEXT;
  v_membership_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Load group
  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  IF v_group.status NOT IN ('active', 'pending') THEN
    RETURN jsonb_build_object('error', 'Group is not accepting new members.');
  END IF;

  -- Capacity check (approved members only)
  SELECT COUNT(*) INTO v_current_count
    FROM public.group_memberships
   WHERE group_id = p_group_id
     AND status   = 'approved';

  IF v_current_count >= v_group.max_members THEN
    RETURN jsonb_build_object('error', 'Group has reached its maximum member capacity.');
  END IF;

  -- Determine approval status
  IF v_group.created_by = v_caller_id THEN
    -- Creator adding someone else: auto-approved
    v_status := 'approved';
  ELSIF p_invite_code IS NOT NULL AND p_invite_code = v_group.invite_code THEN
    -- Valid invite code: auto-approved if approval not required
    v_status := CASE WHEN v_group.join_requires_approval THEN 'pending' ELSE 'approved' END;
  ELSIF v_caller_id = p_user_id THEN
    -- Self-join
    v_status := CASE WHEN v_group.join_requires_approval THEN 'pending' ELSE 'approved' END;
  ELSE
    RETURN jsonb_build_object('error', 'Only the group creator can add other members directly.');
  END IF;

  -- Check for duplicate
  IF EXISTS (
    SELECT 1 FROM public.group_memberships
    WHERE group_id = p_group_id
      AND COALESCE(member_id, user_id) = COALESCE(p_user_id, v_caller_id)
  ) THEN
    RETURN jsonb_build_object('error', 'User is already a member of this group.');
  END IF;

  -- Insert membership
  INSERT INTO public.group_memberships (
    group_id, member_id, user_id, status,
    approved_by, approved_at, join_method, payout_position
  )
  VALUES (
    p_group_id,
    COALESCE(p_user_id, v_caller_id),
    COALESCE(p_user_id, v_caller_id),
    v_status,
    CASE WHEN v_status = 'approved' THEN v_caller_id ELSE NULL END,
    CASE WHEN v_status = 'approved' THEN NOW()        ELSE NULL END,
    CASE WHEN v_caller_id = v_group.created_by THEN 'invited_by_creator' ELSE 'invite_code' END,
    p_payout_position
  )
  RETURNING id INTO v_membership_id;

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id, 'member_added', 'group_memberships', v_membership_id,
    jsonb_build_object('group_id', p_group_id, 'member', COALESCE(p_user_id, v_caller_id), 'status', v_status)
  );

  RETURN jsonb_build_object(
    'success',       true,
    'membership_id', v_membership_id,
    'status',        v_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_member_to_group FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.add_member_to_group TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- FIX 7: max_members enforcement trigger
--         Belt-and-suspenders: RPC enforces capacity, but this
--         trigger catches any direct INSERT attempt.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_group_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max     INT;
  v_current INT;
BEGIN
  -- Only enforce on approved memberships
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT max_members INTO v_max
    FROM public.osusu_groups
   WHERE id = NEW.group_id;

  SELECT COUNT(*) INTO v_current
    FROM public.group_memberships
   WHERE group_id = NEW.group_id
     AND status   = 'approved'
     AND id       <> NEW.id;  -- exclude current row on UPDATE

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'Group has reached its maximum capacity of % members.', v_max;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_group_capacity ON public.group_memberships;
CREATE TRIGGER trg_enforce_group_capacity
  BEFORE INSERT OR UPDATE OF status ON public.group_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_capacity();

-- ──────────────────────────────────────────────────────────────
-- FIX 8: KYC check in assign_collector_validated
--         A user without approved KYC should not be a collector.
-- ──────────────────────────────────────────────────────────────

-- NOTE: The full assign_collector_validated function is in backend_services_v1.sql.
-- We patch it here by recreating the relevant section. The original function
-- is ~150 lines; we only change the target-user validation block.
-- The FULL function is redeclared below to ensure the KYC check is live.

-- (Read the original to capture all params/logic — redeclare with KYC added)
-- Minimal approach: create a wrapper guard function the trigger can call,
-- then patch the original by adding the KYC check via a replacement.
-- Since we cannot do a partial function edit in SQL, we add a separate
-- KYC enforcement trigger on the collectors table instead:

CREATE OR REPLACE FUNCTION public.enforce_collector_kyc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kyc TEXT;
BEGIN
  SELECT kyc_status INTO v_kyc
    FROM public.profiles
   WHERE id = NEW.profile_id;

  IF v_kyc IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Collector must have approved KYC. Current status: %', COALESCE(v_kyc, 'unknown');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_collector_kyc ON public.collectors;
CREATE TRIGGER trg_enforce_collector_kyc
  BEFORE INSERT OR UPDATE OF profile_id, is_active ON public.collectors
  FOR EACH ROW
  WHEN (NEW.is_active = TRUE)
  EXECUTE FUNCTION public.enforce_collector_kyc();

-- ──────────────────────────────────────────────────────────────
-- FIX 9: Fix groups_read_member_or_creator RLS policy
--         Uses gm.user_id exclusively but data has migrated to
--         member_id. Members who only have member_id cannot see
--         their groups.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "groups_read_member_or_creator" ON public.osusu_groups;

CREATE POLICY "groups_read_member_or_creator"
  ON public.osusu_groups FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_memberships gm
      WHERE gm.group_id = osusu_groups.id
        AND COALESCE(gm.member_id, gm.user_id) = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- FIX 10: Drop contributions_insert_own policy
--          Forces all contribution inserts through RPCs.
--          The initiate_group_payment and record_physical_collection
--          RPCs (SECURITY DEFINER) are the only valid write paths.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "contributions_insert_own" ON public.contributions;

-- ──────────────────────────────────────────────────────────────
-- FIX 11: Fix disputes_manage_own — split FOR ALL into safe policies
--          FOR ALL allowed members to self-resolve disputes by
--          updating status='resolved'. Now: SELECT + INSERT only.
--          Only admins (via service_role) can update dispute status.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "disputes_manage_own" ON public.disputes;

-- Members can view their own disputes
CREATE POLICY "disputes_select_own"
  ON public.disputes FOR SELECT TO authenticated
  USING (raised_by = auth.uid());

-- Members can open (insert) disputes
CREATE POLICY "disputes_insert_own"
  ON public.disputes FOR INSERT TO authenticated
  WITH CHECK (
    raised_by = auth.uid()
    AND status = 'open'
  );

-- Only super_admin (via service_role) can UPDATE dispute status
-- (resolution is done via admin panel with service_role key)
CREATE POLICY "disputes_update_admin_only"
  ON public.disputes FOR UPDATE TO service_role
  USING  (TRUE)
  WITH CHECK (TRUE);

-- ──────────────────────────────────────────────────────────────
-- FIX 12: Add missing performance indexes
-- ──────────────────────────────────────────────────────────────

-- Notifications: most common query is "unread for user"
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications(recipient_id, is_read)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications(recipient_id, created_at DESC);

-- Audit logs: admin panel queries by user + time
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs(action, created_at DESC);

-- Savings transactions: balance calculation queries
CREATE INDEX IF NOT EXISTS idx_savings_transactions_goal_created
  ON public.savings_transactions(savings_goal_id, created_at DESC);

-- Contributions: most common filter is group + status
CREATE INDEX IF NOT EXISTS idx_contributions_group_status
  ON public.contributions(group_id, status);

-- Payments: payer + created_at for history queries
CREATE INDEX IF NOT EXISTS idx_payments_payer_created
  ON public.payments(payer_id, created_at DESC);

-- ──────────────────────────────────────────────────────────────
-- FIX 13: approve_payment and reject_payment RPCs
--          Manual cash approval path for group creators/admins.
--          Transitions: collected -> approved / rejected.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_payment(
  p_contribution_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_contrib   public.contributions%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT * INTO v_contrib
    FROM public.contributions
   WHERE id = p_contribution_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Contribution not found.');
  END IF;

  -- Self-approval guard
  IF v_contrib.member_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'You cannot approve your own payment.');
  END IF;

  -- Only group creator or super_admin may approve
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.osusu_groups
       WHERE id = v_contrib.group_id AND created_by = v_caller_id
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = v_caller_id AND role = 'super_admin'
    )
  ) THEN
    RETURN jsonb_build_object('error', 'Only the group creator or a super admin can approve payments.');
  END IF;

  -- Must be in approvable state
  IF v_contrib.status NOT IN ('collected', 'pending') THEN
    RETURN jsonb_build_object('error', format('Cannot approve a contribution with status: %s', v_contrib.status));
  END IF;

  UPDATE public.contributions
  SET    status     = 'verified',
         updated_at = NOW()
  WHERE  id         = p_contribution_id;

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id, 'payment_approved', 'contributions', p_contribution_id,
    jsonb_build_object(
      'previous_status', v_contrib.status,
      'approved_by',     v_caller_id,
      'member_id',       v_contrib.member_id
    )
  );

  -- Notify member
  INSERT INTO public.notifications (recipient_id, type, title, body, data)
  VALUES (
    v_contrib.member_id,
    'payment_received',
    'Payment Approved',
    'Your contribution has been approved by the group creator.',
    jsonb_build_object('contribution_id', p_contribution_id, 'group_id', v_contrib.group_id)
  );

  RETURN jsonb_build_object(
    'success',          true,
    'contribution_id',  p_contribution_id,
    'new_status',       'verified'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_payment(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_payment(UUID) TO authenticated;

-- ─────────

CREATE OR REPLACE FUNCTION public.reject_payment(
  p_contribution_id UUID,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_contrib   public.contributions%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT * INTO v_contrib
    FROM public.contributions
   WHERE id = p_contribution_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Contribution not found.');
  END IF;

  -- Self-rejection guard
  IF v_contrib.member_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'You cannot reject your own payment.');
  END IF;

  -- Only group creator or super_admin
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.osusu_groups
       WHERE id = v_contrib.group_id AND created_by = v_caller_id
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = v_caller_id AND role = 'super_admin'
    )
  ) THEN
    RETURN jsonb_build_object('error', 'Only the group creator or a super admin can reject payments.');
  END IF;

  IF v_contrib.status NOT IN ('collected', 'pending') THEN
    RETURN jsonb_build_object('error', format('Cannot reject a contribution with status: %s', v_contrib.status));
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'A reason is required to reject a payment.');
  END IF;

  UPDATE public.contributions
  SET    status     = 'disputed',
         updated_at = NOW()
  WHERE  id         = p_contribution_id;

  -- Audit
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id, 'payment_rejected', 'contributions', p_contribution_id,
    jsonb_build_object(
      'previous_status', v_contrib.status,
      'rejected_by',     v_caller_id,
      'reason',          p_reason
    )
  );

  -- Notify member
  INSERT INTO public.notifications (recipient_id, type, title, body, data)
  VALUES (
    v_contrib.member_id,
    'dispute_update',
    'Payment Rejected',
    COALESCE(p_reason, 'Your contribution was rejected. Please contact the group creator.'),
    jsonb_build_object('contribution_id', p_contribution_id, 'group_id', v_contrib.group_id)
  );

  RETURN jsonb_build_object(
    'success',         true,
    'contribution_id', p_contribution_id,
    'new_status',      'disputed',
    'reason',          p_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_payment(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reject_payment(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- FIX 14: get_next_payable_period RPC
--          Returns the next contribution schedule row that is
--          due or overdue and not yet paid for a given member.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_next_payable_period(
  p_group_id  UUID,
  p_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_target_id UUID;
  v_schedule  public.contribution_schedules%ROWTYPE;
  v_group     public.osusu_groups%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Target is the specified member or the caller themselves
  v_target_id := COALESCE(p_member_id, v_caller_id);

  -- Caller must be the member, or a collector for this group, or the creator
  IF v_target_id <> v_caller_id THEN
    IF NOT (
      EXISTS (
        SELECT 1 FROM public.collectors c
         WHERE c.group_id   = p_group_id
           AND c.profile_id = v_caller_id
           AND c.is_active  = TRUE
      )
      OR EXISTS (
        SELECT 1 FROM public.osusu_groups g
         WHERE g.id         = p_group_id
           AND g.created_by = v_caller_id
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles
         WHERE id = v_caller_id AND role = 'super_admin'
      )
    ) THEN
      RETURN jsonb_build_object('error', 'Not authorised to query periods for this member.');
    END IF;
  END IF;

  -- Load group for contribution amount
  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  -- Find the earliest unpaid due/overdue schedule entry
  SELECT * INTO v_schedule
    FROM public.contribution_schedules
   WHERE group_id  = p_group_id
     AND member_id = v_target_id
     AND status    IN ('due', 'overdue')
   ORDER BY from_date ASC
   LIMIT 1;

  IF NOT FOUND THEN
    -- No schedule rows? Fall back to date-based logic
    RETURN jsonb_build_object(
      'found',              false,
      'message',            'No payable period found. Schedule may not have been generated yet.',
      'expected_amount',    v_group.contribution_amount
    );
  END IF;

  RETURN jsonb_build_object(
    'found',              true,
    'schedule_id',        v_schedule.id,
    'period_label',       v_schedule.period_label,
    'from_date',          v_schedule.from_date,
    'to_date',            v_schedule.to_date,
    'cycle_number',       v_schedule.cycle_number,
    'expected_amount',    v_schedule.expected_amount,
    'status',             v_schedule.status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_next_payable_period FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_next_payable_period TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- BONUS: cleanup old rate_limit_log function (uses NOW() - interval)
--        Add cleanup that handles ip-address rows too.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_log()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limit_log
   WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_log() TO service_role;
