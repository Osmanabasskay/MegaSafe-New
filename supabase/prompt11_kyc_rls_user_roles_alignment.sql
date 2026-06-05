-- ─────────────────────────────────────────────────────────────────────────────
-- prompt11_kyc_rls_user_roles_alignment.sql
--
-- FIX: KYC RLS admin policies authorized off `profiles.role = 'super_admin'`,
-- but `profiles.role` is a LOCKED/IMMUTABLE column (trg_protect_profile_immutable)
-- and is NOT the canonical role source. The canonical source is `user_roles`,
-- exposed via the STABLE SECURITY DEFINER helper `public.is_super_admin()`.
--
-- Verified on the live DB (2026-06-03): the single super_admin in `user_roles`
-- did NOT match `profiles.role`, so these 4 policies denied that admin direct
-- table access (the admin web app reads via service-role, which masked it, but
-- the RLS boundary itself was inconsistent and fragile).
--
-- This migration aligns the 4 KYC admin policies to `is_super_admin()` so the
-- whole app has a single authorization source. Behaviour for normal users
-- (own-row access) is unchanged. Fully reversible (see ROLLBACK at bottom).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- kyc_applications --------------------------------------------------------------
DROP POLICY IF EXISTS kyc_apps_select_admin ON public.kyc_applications;
CREATE POLICY kyc_apps_select_admin ON public.kyc_applications
  FOR SELECT USING (public.is_super_admin());

DROP POLICY IF EXISTS kyc_apps_update_admin ON public.kyc_applications;
CREATE POLICY kyc_apps_update_admin ON public.kyc_applications
  FOR UPDATE USING (public.is_super_admin());

-- kyc_documents -----------------------------------------------------------------
DROP POLICY IF EXISTS kyc_docs_select_admin ON public.kyc_documents;
CREATE POLICY kyc_docs_select_admin ON public.kyc_documents
  FOR SELECT USING (public.is_super_admin());

-- kyc_reviews -------------------------------------------------------------------
DROP POLICY IF EXISTS kyc_reviews_admin_all ON public.kyc_reviews;
CREATE POLICY kyc_reviews_admin_all ON public.kyc_reviews
  FOR ALL USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

COMMIT;

-- ROLLBACK (manual): recreate the prior profiles.role-based policies, e.g.
--   CREATE POLICY kyc_apps_select_admin ON public.kyc_applications FOR SELECT
--     USING (EXISTS (SELECT 1 FROM public.profiles p
--                    WHERE p.id = auth.uid() AND p.role = 'super_admin'));
-- (repeat for the other three)
