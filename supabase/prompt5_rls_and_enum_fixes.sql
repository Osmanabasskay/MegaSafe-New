-- ================================================================
-- prompt5_rls_and_enum_fixes.sql
-- Two production bugs fixed:
--
-- Bug 1 — "stack depth limit exceeded" on group creation
--   Root cause: can_view_group() is SECURITY INVOKER.
--   osusu_groups SELECT policy → can_view_group() → queries
--   osusu_group_members with RLS → osusu_group_members SELECT policy
--   → can_view_group() → queries osusu_group_members → ∞ loop.
--   Also a second loop: can_view_group() queries osusu_groups, whose
--   SELECT policy also calls can_view_group() → same recursion.
--   Fix: make can_view_group, can_manage_group, is_collector_for_group
--   SECURITY DEFINER so their internal table reads bypass RLS.
--
-- Bug 2 — "column auto_save_frequency is of type contribution_frequency
--           but expression is of type text"
--   Root cause: savings_goals.auto_save_frequency is enum
--   contribution_frequency on the live DB, but create_savings_goal
--   passes the raw TEXT parameter without an explicit cast.
--   Fix: validate then cast p_auto_save_frequency::contribution_frequency.
--   Audit log updated to use savings_goal_created (valid audit_action enum).
-- ================================================================


-- ── Fix 1A: can_view_group → SECURITY DEFINER ────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.osusu_group_members
      WHERE group_id  = p_group_id
        AND user_id   = (SELECT auth.uid())
        AND is_active = TRUE
    )
    OR public.is_collector_for_group(p_group_id)
    OR EXISTS (
      SELECT 1 FROM public.osusu_groups g
      WHERE g.id         = p_group_id
        AND g.created_by = (SELECT auth.uid())
    );
$$;

-- ── Fix 1B: can_manage_group → SECURITY DEFINER ──────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.osusu_groups g
      WHERE g.id         = p_group_id
        AND g.created_by = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.osusu_groups g
      JOIN public.organization_members om ON om.organization_id = g.organization_id
      WHERE g.id         = p_group_id
        AND om.user_id   = (SELECT auth.uid())
        AND om.role      = 'admin'
        AND om.is_active = TRUE
    );
$$;

-- ── Fix 1C: is_collector_for_group → SECURITY DEFINER ────────────────────────
-- Called by can_view_group. collector_assignments/collectors may gain
-- their own RLS policies over time; SECURITY DEFINER prevents any
-- secondary loops from those tables.
CREATE OR REPLACE FUNCTION public.is_collector_for_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collector_assignments ca
    JOIN public.collectors c ON c.id = ca.collector_id
    WHERE ca.group_id = p_group_id
      AND c.user_id   = (SELECT auth.uid())
      AND ca.status   = 'active'
      AND c.is_active = TRUE
  );
$$;


-- ── Fix 2: create_savings_goal — explicit enum cast ──────────────────────────
CREATE OR REPLACE FUNCTION public.create_savings_goal(
  p_owner_id            UUID,
  p_title               TEXT,
  p_description         TEXT    DEFAULT NULL,
  p_category            TEXT    DEFAULT 'other',
  p_target_amount       NUMERIC DEFAULT 0,
  p_target_date         DATE    DEFAULT NULL,
  p_auto_save_enabled   BOOLEAN DEFAULT FALSE,
  p_auto_save_amount    NUMERIC DEFAULT NULL,
  p_auto_save_frequency TEXT    DEFAULT NULL  -- accepts: daily | weekly | biweekly | monthly
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller  UUID := auth.uid();
  v_goal_id UUID;
  v_row     public.savings_goals%ROWTYPE;
  v_freq    contribution_frequency;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF v_caller <> p_owner_id THEN
    RETURN jsonb_build_object('error', 'owner_id must match authenticated user');
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RETURN jsonb_build_object('error', 'Title is required');
  END IF;
  IF p_target_amount IS NULL OR p_target_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Target amount must be greater than zero');
  END IF;

  -- Validate then cast; rejecting bad strings before the INSERT prevents the
  -- "expression is of type text" error and gives a cleaner user message.
  IF coalesce(p_auto_save_enabled, FALSE) AND p_auto_save_frequency IS NOT NULL THEN
    IF p_auto_save_frequency NOT IN ('daily', 'weekly', 'biweekly', 'monthly') THEN
      RETURN jsonb_build_object(
        'error',
        'auto_save_frequency must be one of: daily, weekly, biweekly, monthly'
      );
    END IF;
    v_freq := p_auto_save_frequency::contribution_frequency;
  END IF;

  INSERT INTO public.savings_goals (
    user_id, owner_id, title, description, category,
    target_amount, currency, currency_code, target_date,
    auto_save_enabled, auto_save_amount, auto_save_frequency,
    current_amount, status, is_active
  ) VALUES (
    v_caller, v_caller,
    trim(p_title),
    NULLIF(trim(coalesce(p_description, '')), ''),
    coalesce(p_category, 'other'),
    p_target_amount,
    'NLe', 'NLe',
    p_target_date,
    coalesce(p_auto_save_enabled, FALSE),
    CASE WHEN coalesce(p_auto_save_enabled, FALSE) THEN p_auto_save_amount ELSE NULL END,
    CASE WHEN coalesce(p_auto_save_enabled, FALSE) THEN v_freq ELSE NULL END,
    0, 'active', TRUE
  )
  RETURNING id INTO v_goal_id;

  SELECT * INTO v_row FROM public.savings_goals WHERE id = v_goal_id;

  -- Audit — wrapped so a future enum expansion never blocks goal creation.
  BEGIN
    PERFORM public.create_audit_log(
      'savings_goal_created',
      'savings_goals',
      v_goal_id,
      NULL,
      jsonb_build_object(
        'title',         v_row.title,
        'target_amount', v_row.target_amount,
        'category',      v_row.category
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success',             TRUE,
    'goal_id',             v_goal_id,
    'id',                  v_row.id,
    'owner_id',            v_row.owner_id,
    'title',               v_row.title,
    'description',         v_row.description,
    'category',            v_row.category,
    'goal_emoji',          v_row.goal_emoji,
    'target_amount',       v_row.target_amount,
    'current_amount',      v_row.current_amount,
    'currency_code',       v_row.currency_code,
    'target_date',         v_row.target_date,
    'status',              v_row.status,
    'auto_save_enabled',   v_row.auto_save_enabled,
    'auto_save_amount',    v_row.auto_save_amount,
    'auto_save_frequency', v_row.auto_save_frequency,
    'auto_save_next_date', v_row.auto_save_next_date,
    'created_at',          v_row.created_at,
    'updated_at',          v_row.updated_at
  );
END;
$$;

SELECT 'prompt5_rls_and_enum_fixes applied successfully' AS result;
