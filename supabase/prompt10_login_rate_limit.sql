-- ─────────────────────────────────────────────────────────────────────────────
-- prompt10: Login-specific rate limiting
--
-- Extends consume_admin_rate_limit to accept a p_action parameter so that
-- login attempts and admin mutations share the same RPC but separate budgets:
--
--   admin_action : 30 requests / 60 s  (unchanged — mutations in /api/admin/action)
--   admin_login  : 10 requests / 900 s (new     — login attempts in /api/login)
--
-- The p_action parameter has a default of 'admin_action' so all existing
-- callers (lib/security.ts) continue to work without modification.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_admin_rate_limit(
  p_ip     TEXT,
  p_action TEXT DEFAULT 'admin_action'
)
RETURNS BOOLEAN          -- TRUE = allowed, FALSE = blocked
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count          INT;
  v_ip             INET;
  v_window_seconds INT;
  v_max_count      INT;
BEGIN
  -- Validate the IP string; return FALSE on bad input to fail closed.
  BEGIN
    v_ip := p_ip::INET;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;

  -- Per-action window and budget. Defaults to the admin_action policy so
  -- unknown/future actions get the stricter budget, not an open door.
  CASE p_action
    WHEN 'admin_login'  THEN v_window_seconds := 900;  v_max_count := 10;
    WHEN 'admin_action' THEN v_window_seconds := 60;   v_max_count := 30;
    ELSE                     v_window_seconds := 60;   v_max_count := 30;
  END CASE;

  SELECT COUNT(*) INTO v_count
    FROM public.rate_limit_log
   WHERE ip_address = v_ip
     AND action     = p_action
     AND created_at > NOW() - (v_window_seconds || ' seconds')::INTERVAL;

  IF v_count >= v_max_count THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.rate_limit_log (ip_address, action)
  VALUES (v_ip, p_action);

  RETURN TRUE;
END;
$$;

-- Revoke the old single-arg signature and grant the new two-arg one.
-- Using DROP + re-GRANT because ALTER FUNCTION RENAME is not available here
-- and the old overload must not remain callable with no action argument
-- (the DEFAULT handles backward compat at the application level).
REVOKE EXECUTE ON FUNCTION public.consume_admin_rate_limit(TEXT)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_admin_rate_limit(TEXT, TEXT)  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_admin_rate_limit(TEXT, TEXT)  TO service_role;
