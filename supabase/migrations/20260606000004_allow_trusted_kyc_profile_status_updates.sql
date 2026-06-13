-- Allow trusted KYC backend routines to update profile KYC fields without
-- reopening direct client writes to protected profile columns.
--
-- Root cause: PostgREST calls SECURITY DEFINER RPCs with request role
-- "authenticated", so the immutable-profile trigger could not distinguish a
-- direct client profile update from a vetted KYC RPC profile-status update.

CREATE OR REPLACE FUNCTION public.protect_profile_immutable_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kyc_update_allowed BOOLEAN;
BEGIN
  -- Only service-side roles bypass all immutable-column checks.
  IF current_setting('role', true) IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

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
$$;

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
      jsonb_build_object('reviewer_id', v_reviewer_id, 'note', p_note, 'reviewed_at', NOW())
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', TRUE, 'status', 'approved');
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);
  RETURN jsonb_build_object('error', 'Approval failed: ' || SQLERRM);
END;
$function$;

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

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_reviewer_id AND role = 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Only super admins can reject KYC applications.');
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RETURN jsonb_build_object('error', 'Rejection reason is required.');
  END IF;

  SELECT * INTO v_app FROM public.kyc_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  IF v_app.user_id = v_reviewer_id THEN
    RETURN jsonb_build_object('error', 'You cannot reject your own KYC application.');
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
      jsonb_build_object('reviewer_id', v_reviewer_id, 'reason', p_reason, 'reviewed_at', NOW())
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', TRUE, 'status', 'rejected');
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);
  RETURN jsonb_build_object('error', 'Rejection failed: ' || SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_kyc_ai_validation(
  p_application_id UUID,
  p_decision TEXT,
  p_reason_code TEXT DEFAULT NULL,
  p_flags TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_provider TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_checks JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.kyc_applications%ROWTYPE;
  v_status TEXT;
  v_profile_status TEXT;
  v_user_message TEXT;
  v_check JSONB;
  v_check_type TEXT;
  v_check_status TEXT;
BEGIN
  IF p_decision NOT IN ('passed', 'manual_review', 'retake_required', 'failed', 'error') THEN
    RETURN jsonb_build_object('error', 'Invalid KYC validation decision.');
  END IF;

  SELECT * INTO v_app
  FROM public.kyc_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN jsonb_build_object('success', TRUE, 'status', 'approved', 'idempotent', TRUE);
  END IF;

  v_status := CASE p_decision
    WHEN 'passed' THEN 'under_review'
    WHEN 'retake_required' THEN 'retake_required'
    WHEN 'manual_review' THEN 'manual_review'
    WHEN 'failed' THEN 'manual_review'
    ELSE 'manual_review'
  END;

  v_profile_status := CASE p_decision
    WHEN 'retake_required' THEN 'rejected'
    ELSE 'submitted'
  END;

  v_user_message := CASE p_decision
    WHEN 'retake_required' THEN
      CASE p_reason_code
        WHEN 'selfie_blurry' THEN 'Your selfie is blurry. Please retake it in good lighting.'
        WHEN 'face_not_visible' THEN 'Your face is not clearly visible. Please retake your selfie.'
        WHEN 'id_unreadable' THEN 'Your ID document is unreadable. Please upload a clearer photo.'
        WHEN 'face_mismatch' THEN 'Your selfie did not match your ID photo. Please retake both photos.'
        ELSE 'Please retake your KYC photos and submit again.'
      END
    ELSE NULL
  END;

  UPDATE public.kyc_applications
     SET status = v_status,
         ai_verification_status = p_decision,
         ai_verification_reason_code = p_reason_code,
         suspicious_flags = COALESCE(p_flags, ARRAY[]::TEXT[]),
         manual_review_reason = CASE WHEN v_status IN ('manual_review', 'under_review') THEN p_reason_code ELSE NULL END,
         verification_provider = p_provider,
         verification_request_id = p_request_id,
         verification_completed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_application_id;

  PERFORM set_config('app.kyc_profile_status_update_allowed', 'on', true);
  UPDATE public.profiles
     SET kyc_status = v_profile_status,
         kyc_verified = CASE WHEN v_profile_status = 'submitted' THEN false ELSE kyc_verified END,
         kyc_rejection_reason = v_user_message,
         updated_at = NOW()
   WHERE id = v_app.user_id;
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);

  FOR v_check IN SELECT * FROM jsonb_array_elements(COALESCE(p_checks, '[]'::JSONB))
  LOOP
    v_check_type := v_check->>'check_type';
    v_check_status := v_check->>'status';

    IF v_check_type IN ('ocr_nin', 'selfie_quality', 'face_landmarks', 'face_match', 'decision')
       AND v_check_status IN ('passed', 'failed', 'manual_review', 'retake_required', 'error') THEN
      INSERT INTO public.kyc_verification_checks (
        application_id,
        user_id,
        check_type,
        status,
        reason_code,
        provider,
        score,
        threshold,
        metadata
      )
      VALUES (
        p_application_id,
        v_app.user_id,
        v_check_type,
        v_check_status,
        v_check->>'reason_code',
        p_provider,
        NULLIF(v_check->>'score', '')::NUMERIC,
        NULLIF(v_check->>'threshold', '')::NUMERIC,
        COALESCE(v_check->'metadata', '{}'::JSONB)
      );
    END IF;
  END LOOP;

  PERFORM public.record_kyc_audit_event(
    p_application_id,
    v_app.user_id,
    CASE
      WHEN p_decision = 'passed' THEN 'verification_passed'
      WHEN p_decision = 'retake_required' THEN 'retake_requested'
      WHEN p_decision IN ('manual_review', 'failed') THEN 'manual_review_queued'
      ELSE 'verification_error'
    END,
    CASE WHEN p_decision = 'error' THEN 'failed' ELSE 'info' END,
    p_reason_code,
    jsonb_build_object(
      'decision', p_decision,
      'flags', COALESCE(p_flags, ARRAY[]::TEXT[]),
      'provider', p_provider,
      'request_id', p_request_id
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', v_status,
    'profile_status', v_profile_status,
    'message', v_user_message
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.kyc_profile_status_update_allowed', 'off', true);
  RETURN jsonb_build_object('error', 'Could not finalize KYC validation: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_kyc_ai_validation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_kyc_ai_validation TO service_role;
