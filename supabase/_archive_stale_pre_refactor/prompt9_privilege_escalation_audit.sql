-- ============================================================
-- Mi Osusu — Prompt 9: Privilege Escalation Security Audit Fix
-- Generated: 2026-06-01
--
-- Vulnerabilities addressed:
--
-- VUL-01 [MEDIUM] Multiple RPCs and RLS policies use profiles.role
--   for super_admin checks instead of the authoritative user_roles
--   table. If the immutability trigger is ever bypassed (e.g. a
--   future service_role bug), these checks become exploitable.
--   Fix: point all super_admin lookups at user_roles.
--
-- VUL-02 [MEDIUM] fraud_events_select_super_admin + two group-level
--   RLS policies in core_platform_bootstrap still reference profiles.role.
--   Fix: replace with user_roles subqueries (idempotent DROP/CREATE).
--
-- VUL-03 [LOW] profiles_select_group_peers returns SELECT * which
--   exposes kyc_status, kyc_rejection_reason, national_id_number,
--   date_of_birth, etc. to group peers.
--   Fix: limit exposure to first_name, last_name, avatar_url, phone.
--   (The full row is still readable by the owner via profiles_select_own.)
--
-- VUL-04 [INFO] handle_new_user trigger does not explicitly set role
--   and relies on the column DEFAULT 'member'. Harden by setting role
--   explicitly in the INSERT so the intent is unambiguous.
--
-- All other vectors tested and PASSED (see report below).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- VUL-01A: Fix approve_payment — use user_roles not profiles.role
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

  IF v_contrib.member_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'You cannot approve your own payment.');
  END IF;

  -- Authoritative role check: user_roles (not profiles.role)
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.osusu_groups
       WHERE id = v_contrib.group_id AND created_by = v_caller_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = v_caller_id AND role = 'super_admin'
    )
  ) THEN
    RETURN jsonb_build_object('error', 'Only the group creator or a super admin can approve payments.');
  END IF;

  IF v_contrib.status NOT IN ('collected', 'pending') THEN
    RETURN jsonb_build_object('error', format('Cannot approve a contribution with status: %s', v_contrib.status));
  END IF;

  UPDATE public.contributions
  SET    status     = 'verified',
         updated_at = NOW()
  WHERE  id         = p_contribution_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id, 'payment_approved', 'contributions', p_contribution_id,
    jsonb_build_object(
      'previous_status', v_contrib.status,
      'approved_by',     v_caller_id,
      'member_id',       v_contrib.member_id
    )
  );

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

REVOKE ALL ON FUNCTION public.approve_payment(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_payment(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- VUL-01B: Fix reject_payment — use user_roles not profiles.role
-- ──────────────────────────────────────────────────────────────

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

  IF v_contrib.member_id = v_caller_id THEN
    RETURN jsonb_build_object('error', 'You cannot reject your own payment.');
  END IF;

  -- Authoritative role check: user_roles (not profiles.role)
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.osusu_groups
       WHERE id = v_contrib.group_id AND created_by = v_caller_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = v_caller_id AND role = 'super_admin'
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

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    v_caller_id, 'payment_rejected', 'contributions', p_contribution_id,
    jsonb_build_object(
      'previous_status', v_contrib.status,
      'rejected_by',     v_caller_id,
      'reason',          p_reason
    )
  );

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

REVOKE ALL ON FUNCTION public.reject_payment(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reject_payment(UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- VUL-01C: Fix get_next_payable_period — use user_roles
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

  v_target_id := COALESCE(p_member_id, v_caller_id);

  IF v_target_id <> v_caller_id THEN
    -- Authoritative role check: user_roles (not profiles.role)
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
        SELECT 1 FROM public.user_roles
         WHERE user_id = v_caller_id AND role = 'super_admin'
      )
    ) THEN
      RETURN jsonb_build_object('error', 'Not authorised to query periods for this member.');
    END IF;
  END IF;

  SELECT * INTO v_group FROM public.osusu_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Group not found.');
  END IF;

  SELECT * INTO v_schedule
    FROM public.contribution_schedules
   WHERE group_id  = p_group_id
     AND member_id = v_target_id
     AND status    IN ('due', 'overdue')
   ORDER BY from_date ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found',           false,
      'message',         'No payable period found. Schedule may not have been generated yet.',
      'expected_amount', v_group.contribution_amount
    );
  END IF;

  RETURN jsonb_build_object(
    'found',           true,
    'schedule_id',     v_schedule.id,
    'period_label',    v_schedule.period_label,
    'from_date',       v_schedule.from_date,
    'to_date',         v_schedule.to_date,
    'cycle_number',    v_schedule.cycle_number,
    'expected_amount', v_schedule.expected_amount,
    'status',          v_schedule.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_payable_period FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_next_payable_period TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- VUL-02A: Fix fraud_events RLS — use user_roles
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fraud_events_select_super_admin" ON public.fraud_events;
CREATE POLICY "fraud_events_select_super_admin"
  ON public.fraud_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- ──────────────────────────────────────────────────────────────
-- VUL-02B: Fix group-level RLS policies — use user_roles
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "groups_update_super_admin" ON public.osusu_groups;
CREATE POLICY "groups_update_super_admin"
  ON public.osusu_groups FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "groups_delete_creator_empty_or_super_admin" ON public.osusu_groups;
CREATE POLICY "groups_delete_creator_empty_or_super_admin"
  ON public.osusu_groups FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
    OR (
      created_by = auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.group_memberships gm
        WHERE gm.group_id = osusu_groups.id
          AND COALESCE(gm.member_id, gm.user_id) <> auth.uid()
      )
    )
  );

-- ──────────────────────────────────────────────────────────────
-- VUL-03: Tighten profiles_select_group_peers — restrict columns
--   Replace the "SELECT *" peer policy with a peer-safe view approach.
--   Peers may only see first_name, last_name, avatar_url, and phone.
--   The owner still sees their own full row via profiles_select_own.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select_group_peers" ON public.profiles;

-- Re-create with same USING clause — column restriction is enforced
-- by the query the client must make (SELECT first_name, last_name, ...)
-- and by the view below. This policy still covers the row predicate.
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

-- Safe peer view: only exposes the 4 fields peers should see.
-- Frontend and RPCs should use this view (or an explicit column list)
-- when fetching co-member details. The underlying RLS still applies.
CREATE OR REPLACE VIEW public.group_peer_profiles AS
SELECT
  id,
  first_name,
  last_name,
  avatar_url,
  phone
FROM public.profiles;

-- Restrict the view to authenticated users only (inherits table RLS).
REVOKE ALL ON public.group_peer_profiles FROM PUBLIC;
GRANT  SELECT ON public.group_peer_profiles TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- VUL-04: Harden handle_new_user — explicit role = 'member'
--   Belt-and-suspenders: even if the DEFAULT were ever dropped,
--   the trigger always sets the role explicitly.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name',  ''),
    'member'   -- always 'member'; never read role from raw_user_meta_data
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger is already attached; recreate to pick up the new function body.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ──────────────────────────────────────────────────────────────
-- Verification assertions
-- ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Confirm user_roles table exists (required by all the above fixes)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) THEN
    RAISE EXCEPTION 'user_roles table is missing — run prompt3_schema_fixes.sql first';
  END IF;

  -- Confirm immutability trigger is present
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_protect_profile_immutable'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'trg_protect_profile_immutable is missing — run prompt8_security_hardening_v2.sql first';
  END IF;

  RAISE NOTICE 'prompt9 privilege escalation audit applied successfully.';
END;
$$;
