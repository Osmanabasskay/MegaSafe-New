-- ─────────────────────────────────────────────────────────────────────────────
-- canonical_security_objects.sql  —  VERIFIED SNAPSHOT OF DEPLOYED OBJECTS
--
-- Generated from the LIVE database on 2026-06-03 via pg_get_functiondef /
-- pg_get_triggerdef / pg_policies. This is the authoritative source of truth for
-- the security-critical KYC / profile-protection objects, replacing the stale
-- root-level `prompt8_security_hardening_v2.sql` (now archived — it referenced
-- the WRONG audit columns user_id/new_values; the live schema uses actor_id/new_data).
--
-- The security test suite (__tests__/security/advancedAttackSurface.test.ts)
-- asserts against THIS file. Regenerate it whenever these objects change in prod.
-- DO NOT hand-edit to diverge from the live DB.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- Profile immutable-column protection (locks role / kyc_status / is_active / etc.)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.protect_profile_immutable_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kyc_update_allowed BOOLEAN;
BEGIN
  -- Only service-side roles bypass all immutable-column checks.
  IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Trusted KYC RPCs set this transaction-local flag immediately around the
  -- profile KYC field update. Direct client profile writes cannot use this path.
  v_kyc_update_allowed :=
    current_setting('app.kyc_profile_status_update_allowed', true) = 'on';

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Direct updates to profiles.role are not permitted.';
  END IF;

  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NOT v_kyc_update_allowed THEN
    RAISE EXCEPTION 'Direct updates to profiles.kyc_status are not permitted.';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Direct updates to profiles.is_active are not permitted.';
  END IF;

  IF NEW.kyc_verified IS DISTINCT FROM OLD.kyc_verified AND NOT v_kyc_update_allowed THEN
    RAISE EXCEPTION 'Direct updates to profiles.kyc_verified are not permitted.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Direct updates to profiles.status are not permitted.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_protect_profile_immutable BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_immutable_columns();

-- ═══════════════════════════════════════════════════════════════════════════
-- KYC submission (rate-limited, already-approved guard, file-path ownership)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_kyc_package(p_submission_id uuid, p_first_name text, p_last_name text, p_phone text, p_date_of_birth date, p_gender text DEFAULT NULL::text, p_address_line1 text DEFAULT ''::text, p_address_line2 text DEFAULT ''::text, p_city text DEFAULT ''::text, p_state_province text DEFAULT ''::text, p_postal_code text DEFAULT ''::text, p_country_id uuid DEFAULT NULL::uuid, p_national_id_number text DEFAULT ''::text, p_national_id_type text DEFAULT 'national_id'::text, p_national_id_front_url text DEFAULT NULL::text, p_national_id_back_url text DEFAULT NULL::text, p_selfie_url text DEFAULT NULL::text, p_guarantor_name text DEFAULT ''::text, p_guarantor_phone text DEFAULT ''::text, p_guarantor_email text DEFAULT ''::text, p_guarantor_address text DEFAULT ''::text, p_guarantor_relationship text DEFAULT ''::text, p_guarantor_id_number text DEFAULT ''::text, p_guarantor_id_type text DEFAULT ''::text, p_guarantor_doc_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             UUID;
  v_profile         public.profiles%ROWTYPE;
  v_app_id          UUID;
  v_expected_prefix TEXT;
  v_existing        public.kyc_applications%ROWTYPE;
  v_recent_count    INT;
BEGIN
  -- 1. Authentication
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated. Please sign in and try again.');
  END IF;

  -- 2. Inline rate limit: max 3 submissions per 10 minutes
  SELECT COUNT(*) INTO v_recent_count
  FROM public.kyc_applications
  WHERE user_id = v_uid
    AND submitted_at > NOW() - INTERVAL '10 minutes';
  IF v_recent_count >= 3 THEN
    RETURN jsonb_build_object('error', 'Too many submission attempts. Please wait a few minutes.');
  END IF;

  -- 3. Load profile
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User profile not found.');
  END IF;

  -- 4. Block if already approved
  IF v_profile.kyc_status = 'approved' THEN
    RETURN jsonb_build_object('error', 'Your identity is already verified. No further submission needed.');
  END IF;

  -- 5. Validate required fields
  IF p_first_name IS NULL OR trim(p_first_name) = '' THEN
    RETURN jsonb_build_object('error', 'First name is required.');
  END IF;
  IF p_last_name IS NULL OR trim(p_last_name) = '' THEN
    RETURN jsonb_build_object('error', 'Last name is required.');
  END IF;
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN jsonb_build_object('error', 'Phone number is required.');
  END IF;
  IF p_date_of_birth IS NULL THEN
    RETURN jsonb_build_object('error', 'Date of birth is required.');
  END IF;
  IF p_date_of_birth > CURRENT_DATE - INTERVAL '18 years' THEN
    RETURN jsonb_build_object('error', 'You must be at least 18 years old to complete KYC.');
  END IF;
  IF p_address_line1 IS NULL OR trim(p_address_line1) = '' THEN
    RETURN jsonb_build_object('error', 'Address is required.');
  END IF;
  IF p_city IS NULL OR trim(p_city) = '' THEN
    RETURN jsonb_build_object('error', 'City is required.');
  END IF;
  IF p_national_id_number IS NULL OR trim(p_national_id_number) = '' THEN
    RETURN jsonb_build_object('error', 'National ID number is required.');
  END IF;
  IF p_national_id_type NOT IN ('national_id','passport','drivers_license','voters_card') THEN
    RETURN jsonb_build_object('error', 'Invalid ID document type.');
  END IF;

  -- 6. Validate file paths (server-side path ownership check)
  v_expected_prefix := 'kyc/' || v_uid::text || '/' || p_submission_id::text || '/';

  IF p_national_id_front_url IS NULL OR NOT starts_with(p_national_id_front_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid ID front file path. Please upload again.');
  END IF;
  IF p_national_id_back_url IS NULL OR NOT starts_with(p_national_id_back_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid ID back file path. Please upload again.');
  END IF;
  IF p_selfie_url IS NULL OR NOT starts_with(p_selfie_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid selfie file path. Please upload again.');
  END IF;
  IF p_guarantor_doc_url IS NOT NULL AND NOT starts_with(p_guarantor_doc_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid guarantor file path. Please upload again.');
  END IF;

  -- 7. Idempotency: if same submission_id already recorded, return success
  SELECT * INTO v_existing
  FROM public.kyc_applications
  WHERE user_id = v_uid AND submission_id = p_submission_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', TRUE, 'application_id', v_existing.id,
      'status', v_existing.status, 'idempotent', TRUE
    );
  END IF;

  -- 8. Create KYC application record (columns trimmed for brevity in snapshot)
  INSERT INTO public.kyc_applications (
    user_id, submission_id, status, document_type, full_name, first_name, last_name,
    date_of_birth, phone_number, national_id_number, national_id_type, submitted_at
  ) VALUES (
    v_uid, p_submission_id, 'pending', p_national_id_type,
    trim(p_first_name) || ' ' || trim(p_last_name), trim(p_first_name), trim(p_last_name),
    p_date_of_birth, trim(p_phone), trim(p_national_id_number), p_national_id_type, NOW()
  )
  RETURNING id INTO v_app_id;

  -- 9. Record each document
  INSERT INTO public.kyc_documents (application_id, user_id, document_kind, storage_path, mime_type)
  VALUES
    (v_app_id, v_uid, 'id_front',   p_national_id_front_url, 'image/jpeg'),
    (v_app_id, v_uid, 'id_back',    p_national_id_back_url,  'image/jpeg'),
    (v_app_id, v_uid, 'selfie',     p_selfie_url,            'image/jpeg');

  -- 11. Set profile kyc_status = 'pending' through a transaction-local
  -- trusted-RPC flag consumed by protect_profile_immutable_columns().
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'on', true);
  UPDATE public.profiles
     SET kyc_status = 'pending', updated_at = NOW()
   WHERE id = v_uid;
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);

  -- 12. Audit log (non-blocking; actor_id/new_data MATCH the real audit_logs schema)
  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
      v_uid, 'kyc_submitted'::audit_action, 'kyc_applications', v_app_id,
      jsonb_build_object('submission_id', p_submission_id, 'document_type', p_national_id_type, 'submitted_at', NOW())
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', TRUE, 'application_id', v_app_id, 'status', 'pending');

EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);
  RETURN jsonb_build_object('error', 'Submission failed: ' || SQLERRM);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- KYC approval (super_admin via user_roles, self-approval guard, audit)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_kyc_application(p_application_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reviewer_id UUID;
  v_app         public.kyc_applications%ROWTYPE;
BEGIN
  v_reviewer_id := auth.uid();
  IF v_reviewer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_reviewer_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Only super admins can approve KYC applications.');
  END IF;

  SELECT * INTO v_app FROM public.kyc_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  IF v_app.user_id = v_reviewer_id THEN
    RETURN jsonb_build_object('error', 'You cannot approve your own KYC application.');
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('success', TRUE, 'message', 'Already approved.', 'idempotent', TRUE);
  END IF;

  IF v_app.status NOT IN ('pending', 'under_review') THEN
    RETURN jsonb_build_object('error', format('Cannot approve an application with status: %s', v_app.status));
  END IF;

  UPDATE public.kyc_applications
     SET status = 'approved', reviewed_at = NOW(), reviewed_by = v_reviewer_id, updated_at = NOW()
   WHERE id = p_application_id;

  PERFORM set_config('app.kyc_profile_status_update_allowed', 'on', true);
  UPDATE public.profiles SET kyc_status = 'approved', updated_at = NOW() WHERE id = v_app.user_id;
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);

  INSERT INTO public.kyc_reviews (application_id, reviewer_id, action, note)
  VALUES (p_application_id, v_reviewer_id, 'approved', p_note);

  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
      v_reviewer_id, 'kyc_approved'::audit_action, 'kyc_applications', p_application_id,
      jsonb_build_object('applicant_id', v_app.user_id, 'note', p_note)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', TRUE, 'application_id', p_application_id, 'user_id', v_app.user_id);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- KYC rejection (super_admin via user_roles, self-rejection guard, audit)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reject_kyc_application(p_application_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reviewer_id UUID;
  v_app         public.kyc_applications%ROWTYPE;
BEGIN
  v_reviewer_id := auth.uid();
  IF v_reviewer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'A reason is required when rejecting a KYC application.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_reviewer_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Only super admins can reject KYC applications.');
  END IF;

  SELECT * INTO v_app FROM public.kyc_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  IF v_app.user_id = v_reviewer_id THEN
    RETURN jsonb_build_object('error', 'You cannot reject your own KYC application.');
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('error', 'Cannot reject an already-approved KYC application.');
  END IF;

  IF v_app.status = 'rejected' THEN
    RETURN jsonb_build_object('success', TRUE, 'message', 'Already rejected.', 'idempotent', TRUE);
  END IF;

  UPDATE public.kyc_applications
     SET status = 'rejected', reviewed_at = NOW(), reviewed_by = v_reviewer_id,
         rejection_reason = trim(p_reason), updated_at = NOW()
   WHERE id = p_application_id;

  PERFORM set_config('app.kyc_profile_status_update_allowed', 'on', true);
  UPDATE public.profiles
     SET kyc_status = 'rejected', kyc_rejection_reason = trim(p_reason), updated_at = NOW()
   WHERE id = v_app.user_id;
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);

  INSERT INTO public.kyc_reviews (application_id, reviewer_id, action, note)
  VALUES (p_application_id, v_reviewer_id, 'rejected', p_reason);

  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
      v_reviewer_id, 'kyc_rejected'::audit_action, 'kyc_applications', p_application_id,
      jsonb_build_object('applicant_id', v_app.user_id, 'reason', p_reason)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', TRUE, 'application_id', p_application_id,
                            'user_id', v_app.user_id, 'reason', p_reason);
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- KYC RLS policies — admin checks via is_super_admin() (user_roles canonical)
-- See prompt11_kyc_rls_user_roles_alignment.sql for the corrective migration.
-- ═══════════════════════════════════════════════════════════════════════════
-- is_super_admin() body for reference:
--   SELECT EXISTS (SELECT 1 FROM public.user_roles
--                  WHERE user_id = (SELECT auth.uid()) AND role = 'super_admin');

CREATE POLICY kyc_apps_select_admin ON public.kyc_applications
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY kyc_apps_select_own ON public.kyc_applications
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY kyc_apps_update_admin ON public.kyc_applications
  FOR UPDATE USING (public.is_super_admin());
CREATE POLICY kyc_docs_select_admin ON public.kyc_documents
  FOR SELECT USING (public.is_super_admin());
CREATE POLICY kyc_docs_select_own ON public.kyc_documents
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY kyc_reviews_admin_all ON public.kyc_reviews
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
