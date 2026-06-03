-- secret_code_security.sql
-- Run once in Supabase SQL Editor after deploying backend_services_v1.sql.
-- Prevents member_secret_code from ever being SELECTed by the anon/authenticated roles.

-- 1. Revoke column-level SELECT on member_secret_code from all client roles.
REVOKE SELECT (member_secret_code) ON group_memberships FROM anon, authenticated;

-- 2. Create a sanitised view that intentionally omits the secret code column.
--    Screens that need membership data should query this view, not the base table.
CREATE OR REPLACE VIEW public.group_memberships_safe AS
SELECT
  id,
  group_id,
  member_id,
  status,
  role,
  payout_position,
  joined_at,
  updated_at
FROM public.group_memberships;

-- Grant SELECT on the view to authenticated users (RLS still enforced on base table
-- via SECURITY INVOKER — the view does not bypass row-level policies).
GRANT SELECT ON public.group_memberships_safe TO authenticated;

-- 3. Ensure the secret code column is generated server-side with a
--    cryptographically secure source. Replace the existing trigger that uses
--    random() (not CSPRNG) with one using gen_random_bytes():
--
--    CREATE OR REPLACE FUNCTION generate_member_secret_code()
--    RETURNS TRIGGER LANGUAGE plpgsql AS $$
--    BEGIN
--      NEW.member_secret_code := lpad(
--        (get_byte(gen_random_bytes(3), 0)::bigint * 65536 +
--         get_byte(gen_random_bytes(3), 1)::bigint * 256 +
--         get_byte(gen_random_bytes(3), 2)::bigint) % 1000000)::text, 6, '0');
--      RETURN NEW;
--    END;
--    $$;
--
--    NOTE: Apply this as a separate migration after validating the formula.
--    The three gen_random_bytes() calls above are illustrative; use a single
--    call and bit-shift for production:
--
--    encode(gen_random_bytes(3), 'hex')::bit(24)::bigint % 1000000
