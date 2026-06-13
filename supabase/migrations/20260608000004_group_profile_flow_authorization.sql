-- Mi Osusu group profile flow authorization.
-- Provides group-wide ledger read access for group participants and admin-only
-- group activity history for creators/admin-capable managers.

CREATE OR REPLACE FUNCTION public.get_group_ledger(p_group_id UUID)
RETURNS TABLE (
  id UUID,
  member_id UUID,
  member_name TEXT,
  amount NUMERIC,
  payment_method TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  transaction_reference TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_view_group(p_group_id) THEN
    RAISE EXCEPTION 'Not authorized to view this group ledger.';
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.member_id,
    COALESCE(NULLIF(trim(concat(p.first_name, ' ', p.last_name)), ''), p.email, p.phone, 'Group member') AS member_name,
    cp.amount,
    cp.payment_method::TEXT,
    cp.status::TEXT,
    cp.created_at,
    COALESCE(cp.receipt_number, cp.id::TEXT) AS transaction_reference
  FROM public.contribution_payments cp
  LEFT JOIN public.osusu_group_members gm
    ON gm.id = cp.member_id
  LEFT JOIN public.profiles p
    ON p.id = COALESCE(gm.user_id, cp.member_id)
  WHERE cp.group_id = p_group_id
  ORDER BY cp.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_ledger(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_group_activity_history(p_group_id UUID)
RETURNS TABLE (
  id UUID,
  action_title TEXT,
  description TEXT,
  actor_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_group(p_group_id) THEN
    RAISE EXCEPTION 'Not authorized to view group activity.';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    initcap(replace(al.action, '_', ' ')) AS action_title,
    CASE
      WHEN al.action ILIKE '%payment%' THEN 'Payment activity was recorded for this group.'
      WHEN al.action ILIKE '%member%' THEN 'Membership activity was recorded for this group.'
      WHEN al.action ILIKE '%invite%' THEN 'Invite activity was recorded for this group.'
      WHEN al.action ILIKE '%setting%' THEN 'Group settings were updated.'
      ELSE 'Group activity was recorded.'
    END AS description,
    COALESCE(NULLIF(trim(concat(p.first_name, ' ', p.last_name)), ''), p.email, p.phone, 'Mi Osusu admin') AS actor_name,
    al.created_at
  FROM public.audit_logs al
  LEFT JOIN public.profiles p
    ON p.id = al.user_id
  WHERE
    al.table_name IN ('osusu_groups', 'osusu_group_members', 'group_memberships', 'contribution_payments', 'payments', 'collectors')
    AND (
      al.record_id = p_group_id
      OR al.new_values->>'group_id' = p_group_id::TEXT
      OR al.old_values->>'group_id' = p_group_id::TEXT
    )
  ORDER BY al.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_activity_history(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_activity_history(UUID) TO authenticated;
