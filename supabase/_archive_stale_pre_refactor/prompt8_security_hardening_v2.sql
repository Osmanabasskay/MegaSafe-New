-- ============================================================
-- Mi Osusu Security Hardening v2 (Prompt 8)
-- Fixes critical vulnerabilities found in deep attacker-route audit:
--
-- CRITICAL-1: profiles.role / kyc_status / is_active are writable by
--   any authenticated user via the REST API. An attacker can POST:
--   PATCH /rest/v1/profiles?id=eq.{uid}  {"role":"super_admin"}
--   Fix: trigger that blocks writes to protected columns.
--
-- CRITICAL-2: KYC admin RPCs (approve/reject) and RLS policies check
--   profiles.role = 'super_admin' but the authoritative role table is
--   user_roles. Fix: recreate RPCs to check user_roles.
--
-- CRITICAL-3: audit_logs INSERTs in KYC RPCs use wrong column names
--   (actor_id / new_data) silently failing. Fix: use user_id / new_values.
--
-- HIGH-4: KYC RLS policies on kyc_applications / kyc_documents /
--   kyc_reviews / storage check profiles.role. Fix: use user_roles.
--
-- MEDIUM-5: profiles_update_own policy has no WITH CHECK — no column
--   restriction. The trigger (CRITICAL-1) is the primary fix; the
--   policy WITH CHECK is belt-and-suspenders.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- CRITICAL-1: Trigger to protect immutable profile columns
--   Blocks authenticated users from writing role, kyc_status,
--   is_active, kyc_verified via REST or any non-SECURITY-DEFINER path.
--   SECURITY DEFINER functions (like approve_kyc_application) run as
--   the function owner and bypass this trigger's auth.role() check.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_profile_immutable_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enforce for regular authenticated users.
  -- service_role and postgres (used by SECURITY DEFINER RPCs) bypass.
  IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Block any attempt to change the role column
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Direct updates to profiles.role are not permitted. Role changes must go through admin functions.';
  END IF;

  -- Block any attempt to change kyc_status directly
  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
    RAISE EXCEPTION 'Direct updates to profiles.kyc_status are not permitted. KYC status is managed by admin review only.';
  END IF;

  -- Block any attempt to change is_active (account suspension is admin-only)
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Direct updates to profiles.is_active are not permitted. Account status is admin-controlled.';
  END IF;

  -- Block any attempt to change kyc_verified
  IF NEW.kyc_verified IS DISTINCT FROM OLD.kyc_verified THEN
    RAISE EXCEPTION 'Direct updates to profiles.kyc_verified are not permitted. KYC verification is admin-controlled.';
  END IF;

  -- Block any attempt to change account status (suspended/banned)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Direct updates to profiles.status are not permitted. Account status is admin-controlled.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_immutable ON public.profiles;
CREATE TRIGGER trg_protect_profile_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_immutable_columns();

-- ──────────────────────────────────────────────────────────────
-- MEDIUM-5: Tighten profiles_update_own WITH CHECK
--   Belt-and-suspenders: the trigger is the primary block.
--   This ensures the REST API layer also rejects violations before
--   the trigger even fires (fail earlier, better error message).
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles: own update" ON public.profiles;
CREATE POLICY "profiles: own update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id         = (SELECT auth.uid())
    -- None of the privileged columns may change — trigger is the primary block,
    -- this policy is belt-and-suspenders at the RLS layer.
    AND role       = (SELECT p2.role       FROM public.profiles p2 WHERE p2.id = (SELECT auth.uid()))
    AND kyc_status = (SELECT p2.kyc_status FROM public.profiles p2 WHERE p2.id = (SELECT auth.uid()))
    AND is_active  = (SELECT p2.is_active  FROM public.profiles p2 WHERE p2.id = (SELECT auth.uid()))
    AND kyc_verified = (SELECT p2.kyc_verified FROM public.profiles p2 WHERE p2.id = (SELECT auth.uid()))
    AND status     = (SELECT p2.status     FROM public.profiles p2 WHERE p2.id = (SELECT auth.uid()))
  );

-- ──────────────────────────────────────────────────────────────
-- CRITICAL-2 + CRITICAL-3: Fix approve_kyc_application RPC
--   - Check user_roles (not profiles.role)
--   - Use user_id / new_values in audit_logs (not actor_id / new_data)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_kyc_application(
  p_application_id UUID,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer_id UUID;
  v_app         public.kyc_applications%ROWTYPE;
BEGIN
  v_reviewer_id := auth.uid();
  IF v_reviewer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Admin check — authoritative source: user_roles table
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_reviewer_id AND role = 'super_admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Only super admins can approve KYC applications.');
  END IF;

  -- Load application
  SELECT * INTO v_app FROM public.kyc_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  -- Self-approval guard
  IF v_app.user_id = v_reviewer_id THEN
    RETURN jsonb_build_object('error', 'You cannot approve your own KYC application.');
  END IF;

  -- Idempotency
  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('success', TRUE, 'message', 'Already approved.', 'idempotent', TRUE);
  END IF;

  -- State validation
  IF v_app.status NOT IN ('pending', 'under_review') THEN
    RETURN jsonb_build_object(
      'error', format('Cannot approve an application with status: %s', v_app.status)
    );
  END IF;

  -- Update application status
  UPDATE public.kyc_applications
     SET status      = 'approved',
         reviewed_at = NOW(),
         reviewed_by = v_reviewer_id,
         updated_at  = NOW()
   WHERE id = p_application_id;

  -- Update profile kyc_status = 'approved' (SECURITY DEFINER bypasses trigger)
  UPDATE public.profiles
     SET kyc_status = 'approved',
         updated_at = NOW()
   WHERE id = v_app.user_id;

  -- Create review record
  INSERT INTO public.kyc_reviews (application_id, reviewer_id, action, note)
  VALUES (p_application_id, v_reviewer_id, 'approved', p_note);

  -- Notify user (non-blocking)
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_app.user_id,
      'system_alert',
      'KYC Approved',
      'Your identity has been verified. You now have full access to Mi Osusu.',
      jsonb_build_object('application_id', p_application_id, 'event', 'kyc_approved')
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Audit log — correct columns: user_id / new_values
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (
      v_reviewer_id,
      'kyc_approved'::audit_action,
      'kyc_applications',
      p_application_id,
      jsonb_build_object('applicant_id', v_app.user_id, 'note', p_note)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success',        TRUE,
    'application_id', p_application_id,
    'user_id',        v_app.user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_kyc_application FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.approve_kyc_application TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- CRITICAL-2 + CRITICAL-3: Fix reject_kyc_application RPC
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_kyc_application(
  p_application_id UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviewer_id UUID;
  v_app         public.kyc_applications%ROWTYPE;
BEGIN
  v_reviewer_id := auth.uid();
  IF v_reviewer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  -- Require reason
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'A reason is required when rejecting a KYC application.');
  END IF;

  -- Admin check — authoritative source: user_roles table
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_reviewer_id AND role = 'super_admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Only super admins can reject KYC applications.');
  END IF;

  -- Load application
  SELECT * INTO v_app FROM public.kyc_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  -- Self-rejection guard
  IF v_app.user_id = v_reviewer_id THEN
    RETURN jsonb_build_object('error', 'You cannot reject your own KYC application.');
  END IF;

  -- Cannot reject already-approved
  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('error', 'Cannot reject an already-approved KYC application.');
  END IF;

  -- Idempotency
  IF v_app.status = 'rejected' THEN
    RETURN jsonb_build_object('success', TRUE, 'message', 'Already rejected.', 'idempotent', TRUE);
  END IF;

  -- Update application
  UPDATE public.kyc_applications
     SET status           = 'rejected',
         reviewed_at      = NOW(),
         reviewed_by      = v_reviewer_id,
         rejection_reason = trim(p_reason),
         updated_at       = NOW()
   WHERE id = p_application_id;

  -- Update profile (SECURITY DEFINER bypasses trigger)
  UPDATE public.profiles
     SET kyc_status           = 'rejected',
         kyc_rejection_reason = trim(p_reason),
         updated_at           = NOW()
   WHERE id = v_app.user_id;

  -- Create review record
  INSERT INTO public.kyc_reviews (application_id, reviewer_id, action, note)
  VALUES (p_application_id, v_reviewer_id, 'rejected', p_reason);

  -- Notify user (non-blocking)
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_app.user_id,
      'system_alert',
      'KYC Needs Attention',
      trim(p_reason),
      jsonb_build_object('application_id', p_application_id, 'event', 'kyc_rejected', 'reason', p_reason)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Audit log — correct columns: user_id / new_values
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (
      v_reviewer_id,
      'kyc_rejected'::audit_action,
      'kyc_applications',
      p_application_id,
      jsonb_build_object('applicant_id', v_app.user_id, 'reason', p_reason)
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success',        TRUE,
    'application_id', p_application_id,
    'user_id',        v_app.user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_kyc_application FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reject_kyc_application TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- Fix submit_kyc_package audit_logs columns
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_kyc_package(
  p_submission_id           UUID,
  p_first_name              TEXT,
  p_last_name               TEXT,
  p_phone                   TEXT,
  p_date_of_birth           DATE,
  p_gender                  TEXT    DEFAULT NULL,
  p_address_line1           TEXT    DEFAULT '',
  p_address_line2           TEXT    DEFAULT '',
  p_city                    TEXT    DEFAULT '',
  p_state_province          TEXT    DEFAULT '',
  p_postal_code             TEXT    DEFAULT '',
  p_country_id              UUID    DEFAULT NULL,
  p_national_id_number      TEXT    DEFAULT '',
  p_national_id_type        TEXT    DEFAULT 'national_id',
  p_national_id_front_url   TEXT    DEFAULT NULL,
  p_national_id_back_url    TEXT    DEFAULT NULL,
  p_selfie_url              TEXT    DEFAULT NULL,
  p_guarantor_name          TEXT    DEFAULT '',
  p_guarantor_phone         TEXT    DEFAULT '',
  p_guarantor_email         TEXT    DEFAULT '',
  p_guarantor_address       TEXT    DEFAULT '',
  p_guarantor_relationship  TEXT    DEFAULT '',
  p_guarantor_id_number     TEXT    DEFAULT '',
  p_guarantor_id_type       TEXT    DEFAULT '',
  p_guarantor_doc_url       TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               UUID;
  v_profile           public.profiles%ROWTYPE;
  v_app_id            UUID;
  v_expected_prefix   TEXT;
  v_existing          public.kyc_applications%ROWTYPE;
  v_recent_count      INT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated. Please sign in and try again.');
  END IF;

  -- Rate limit: max 3 submissions in last 10 minutes
  SELECT COUNT(*) INTO v_recent_count
  FROM public.kyc_applications
  WHERE user_id = v_uid
    AND submitted_at > NOW() - INTERVAL '10 minutes';
  IF v_recent_count >= 3 THEN
    RETURN jsonb_build_object('error', 'Too many submission attempts. Please wait a few minutes.');
  END IF;

  -- Load profile
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User profile not found.');
  END IF;

  -- Block if already approved
  IF v_profile.kyc_status = 'approved' THEN
    RETURN jsonb_build_object('error', 'Your identity is already verified. No further submission needed.');
  END IF;

  -- Validate required fields
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

  -- Validate file paths — must start with kyc/{uid}/{submission_id}/
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

  -- Idempotency: return existing if same submission_id already recorded
  SELECT * INTO v_existing FROM public.kyc_applications WHERE user_id = v_uid AND submission_id = p_submission_id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', TRUE, 'application_id', v_existing.id, 'status', v_existing.status, 'idempotent', TRUE);
  END IF;

  -- Create KYC application record
  INSERT INTO public.kyc_applications (
    user_id, submission_id, status, document_type,
    full_name, first_name, last_name,
    date_of_birth, phone_number, gender,
    address, address_line1, address_line2,
    city, state_province, postal_code, country_id,
    national_id_number, national_id_type,
    guarantor_name, guarantor_phone, guarantor_email,
    guarantor_address, guarantor_relationship,
    guarantor_id_number, guarantor_id_type,
    submitted_at
  )
  VALUES (
    v_uid, p_submission_id, 'pending', p_national_id_type,
    trim(p_first_name) || ' ' || trim(p_last_name),
    trim(p_first_name), trim(p_last_name),
    p_date_of_birth, trim(p_phone),
    NULLIF(trim(COALESCE(p_gender, '')), ''),
    trim(p_address_line1),
    trim(p_address_line1), COALESCE(trim(p_address_line2), ''),
    trim(p_city), COALESCE(trim(p_state_province), ''),
    COALESCE(trim(p_postal_code), ''), p_country_id,
    trim(p_national_id_number), p_national_id_type,
    NULLIF(trim(COALESCE(p_guarantor_name, '')), ''),
    NULLIF(trim(COALESCE(p_guarantor_phone, '')), ''),
    NULLIF(trim(COALESCE(p_guarantor_email, '')), ''),
    NULLIF(trim(COALESCE(p_guarantor_address, '')), ''),
    NULLIF(trim(COALESCE(p_guarantor_relationship, '')), ''),
    NULLIF(trim(COALESCE(p_guarantor_id_number, '')), ''),
    NULLIF(COALESCE(p_guarantor_id_type, ''), ''),
    NOW()
  )
  RETURNING id INTO v_app_id;

  -- Record each document
  INSERT INTO public.kyc_documents (application_id, user_id, document_kind, storage_path, mime_type)
  VALUES
    (v_app_id, v_uid, 'id_front',  p_national_id_front_url, 'image/jpeg'),
    (v_app_id, v_uid, 'id_back',   p_national_id_back_url,  'image/jpeg'),
    (v_app_id, v_uid, 'selfie',    p_selfie_url,            'image/jpeg');

  IF p_guarantor_doc_url IS NOT NULL THEN
    INSERT INTO public.kyc_documents (application_id, user_id, document_kind, storage_path, mime_type)
    VALUES (v_app_id, v_uid, 'guarantor_id', p_guarantor_doc_url, 'image/jpeg');
  END IF;

  -- Upsert guarantors table for backward-compatibility
  IF p_guarantor_name IS NOT NULL AND trim(p_guarantor_name) <> '' THEN
    DELETE FROM public.guarantors WHERE member_id = v_uid;
    INSERT INTO public.guarantors (
      member_id, name, phone, email, address,
      relationship, national_id_number, national_id_type, id_document_url
    ) VALUES (
      v_uid,
      trim(p_guarantor_name),
      NULLIF(trim(COALESCE(p_guarantor_phone, '')), ''),
      NULLIF(trim(COALESCE(p_guarantor_email, '')), ''),
      NULLIF(trim(COALESCE(p_guarantor_address, '')), ''),
      NULLIF(trim(COALESCE(p_guarantor_relationship, '')), ''),
      NULLIF(trim(COALESCE(p_guarantor_id_number, '')), ''),
      NULLIF(COALESCE(p_guarantor_id_type, ''), ''),
      p_guarantor_doc_url
    );
  END IF;

  -- Set profile kyc_status = 'pending' (SECURITY DEFINER bypasses trigger)
  UPDATE public.profiles
     SET kyc_status = 'pending',
         first_name = COALESCE(NULLIF(trim(p_first_name), ''), first_name),
         last_name  = COALESCE(NULLIF(trim(p_last_name),  ''), last_name),
         phone      = COALESCE(NULLIF(trim(p_phone),      ''), phone),
         updated_at = NOW()
   WHERE id = v_uid;

  -- Audit log — correct columns: user_id / new_values
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (
      v_uid,
      'kyc_submitted'::audit_action,
      'kyc_applications',
      v_app_id,
      jsonb_build_object(
        'submission_id', p_submission_id,
        'document_type', p_national_id_type,
        'has_guarantor', (p_guarantor_name IS NOT NULL AND trim(COALESCE(p_guarantor_name,'')) <> ''),
        'submitted_at',  NOW()
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', TRUE, 'application_id', v_app_id, 'status', 'pending');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Submission failed: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_kyc_package FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_kyc_package TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- HIGH-4: Fix KYC RLS policies to use user_roles (not profiles.role)
-- ──────────────────────────────────────────────────────────────

-- kyc_applications admin policies
DROP POLICY IF EXISTS "kyc_apps_select_admin"  ON public.kyc_applications;
DROP POLICY IF EXISTS "kyc_apps_update_admin"  ON public.kyc_applications;

CREATE POLICY "kyc_apps_select_admin"
  ON public.kyc_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

CREATE POLICY "kyc_apps_update_admin"
  ON public.kyc_applications FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- kyc_documents admin policy
DROP POLICY IF EXISTS "kyc_docs_select_admin" ON public.kyc_documents;
CREATE POLICY "kyc_docs_select_admin"
  ON public.kyc_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- kyc_reviews admin policy
DROP POLICY IF EXISTS "kyc_reviews_admin_all" ON public.kyc_reviews;
CREATE POLICY "kyc_reviews_admin_all"
  ON public.kyc_reviews FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
  );

-- Storage: KYC admin read — use user_roles
DROP POLICY IF EXISTS "kyc_read_own_or_admin" ON storage.objects;
CREATE POLICY "kyc_read_own_or_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      (storage.foldername(name))[2] = (auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
      )
    )
  );

-- ──────────────────────────────────────────────────────────────
-- Verify: audit_logs table uses user_id / new_values (not actor_id / new_data)
-- This is a documentation check — no SQL change needed, schema already correct.
-- The following DO block will raise if the column names are wrong.
-- ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'audit_logs.user_id column missing — schema mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'new_values'
  ) THEN
    RAISE EXCEPTION 'audit_logs.new_values column missing — schema mismatch';
  END IF;
  RAISE NOTICE 'audit_logs schema verified: user_id + new_values columns present';
END;
$$;
