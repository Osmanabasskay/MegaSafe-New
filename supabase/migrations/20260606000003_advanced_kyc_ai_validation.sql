-- Advanced AI-assisted KYC validation.
--
-- This migration keeps final KYC decisions on the backend:
--   - mobile clients upload documents and call submit_kyc_package;
--   - the validate-kyc-identity Edge Function performs OCR, selfie quality,
--     landmark visibility, and face-match checks with server-side secrets;
--   - this schema stores internal results and audit events without exposing
--     provider confidence scores to regular users.

ALTER TABLE public.kyc_applications
  DROP CONSTRAINT IF EXISTS kyc_applications_status_check;

ALTER TABLE public.kyc_applications
  ADD CONSTRAINT kyc_applications_status_check
  CHECK (status IN (
    'pending',
    'verification_processing',
    'under_review',
    'manual_review',
    'retake_required',
    'approved',
    'rejected'
  ));

ALTER TABLE public.kyc_applications
  ADD COLUMN IF NOT EXISTS ai_verification_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (ai_verification_status IN (
      'not_started',
      'processing',
      'passed',
      'retake_required',
      'manual_review',
      'failed',
      'error'
    )),
  ADD COLUMN IF NOT EXISTS ai_verification_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS suspicious_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS verification_provider TEXT,
  ADD COLUMN IF NOT EXISTS verification_request_id TEXT,
  ADD COLUMN IF NOT EXISTS verification_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS secure_storage_policy TEXT NOT NULL DEFAULT 'private_bucket_signed_url_admin_only',
  ADD COLUMN IF NOT EXISTS retention_policy TEXT NOT NULL DEFAULT 'retain_until_kyc_retention_job_purges';

CREATE INDEX IF NOT EXISTS idx_kyc_applications_ai_status
  ON public.kyc_applications(ai_verification_status);

CREATE INDEX IF NOT EXISTS idx_kyc_applications_manual_review
  ON public.kyc_applications(status)
  WHERE status IN ('manual_review', 'under_review', 'pending', 'verification_processing');

CREATE TABLE IF NOT EXISTS public.kyc_verification_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID NOT NULL REFERENCES public.kyc_applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK (check_type IN (
    'ocr_nin',
    'selfie_quality',
    'face_landmarks',
    'face_match',
    'decision'
  )),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'manual_review', 'retake_required', 'error')),
  reason_code TEXT,
  provider TEXT,
  score NUMERIC(8, 5),
  threshold NUMERIC(8, 5),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.kyc_verification_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_checks_admin_select" ON public.kyc_verification_checks;
CREATE POLICY "kyc_checks_admin_select"
  ON public.kyc_verification_checks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_kyc_checks_application_id
  ON public.kyc_verification_checks(application_id);

CREATE INDEX IF NOT EXISTS idx_kyc_checks_user_id_created
  ON public.kyc_verification_checks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id UUID REFERENCES public.kyc_applications(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'submission_started',
    'documents_uploaded',
    'ocr_started',
    'ocr_completed',
    'nin_match_passed',
    'nin_match_failed',
    'selfie_quality_started',
    'selfie_quality_passed',
    'selfie_quality_failed',
    'face_match_started',
    'face_match_passed',
    'face_match_failed',
    'suspicious_submission',
    'retake_requested',
    'manual_review_queued',
    'manual_review_decision',
    'verification_passed',
    'verification_error'
  )),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'warning', 'info')),
  reason_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.kyc_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc_audit_admin_select" ON public.kyc_audit_logs;
CREATE POLICY "kyc_audit_admin_select"
  ON public.kyc_audit_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_kyc_audit_application_created
  ON public.kyc_audit_logs(application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kyc_audit_user_created
  ON public.kyc_audit_logs(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_kyc_audit_event(
  p_application_id UUID,
  p_user_id UUID,
  p_event_type TEXT,
  p_status TEXT DEFAULT 'info',
  p_reason_code TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_actor_user_id UUID DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.kyc_audit_logs (
    application_id,
    user_id,
    actor_user_id,
    event_type,
    status,
    reason_code,
    metadata,
    ip_address,
    user_agent
  )
  VALUES (
    p_application_id,
    p_user_id,
    p_actor_user_id,
    p_event_type,
    p_status,
    p_reason_code,
    COALESCE(p_metadata, '{}'::JSONB),
    p_ip_address,
    p_user_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_kyc_audit_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_kyc_audit_event TO service_role;

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
    WHEN 'retake_required' THEN 'Please retake your selfie in a bright place with your full face inside the guide.'
    ELSE NULL
  END;

  UPDATE public.kyc_applications
     SET status = v_status,
         ai_verification_status = CASE p_decision WHEN 'failed' THEN 'manual_review' ELSE p_decision END,
         ai_verification_reason_code = p_reason_code,
         suspicious_flags = COALESCE(p_flags, ARRAY[]::TEXT[]),
         manual_review_reason = CASE
           WHEN v_status = 'manual_review' THEN p_reason_code
           ELSE NULL
         END,
         verification_provider = p_provider,
         verification_request_id = p_request_id,
         verification_completed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_application_id;

  UPDATE public.profiles
     SET kyc_status = v_profile_status,
         kyc_verified = CASE WHEN v_profile_status = 'submitted' THEN false ELSE kyc_verified END,
         kyc_rejection_reason = v_user_message,
         updated_at = NOW()
   WHERE id = v_app.user_id;

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
    CASE WHEN p_decision = 'passed' THEN 'success' ELSE 'warning' END,
    p_reason_code,
    jsonb_build_object(
      'flags', COALESCE(p_flags, ARRAY[]::TEXT[]),
      'provider', p_provider,
      'request_id', p_request_id
    )
  );

  IF array_length(COALESCE(p_flags, ARRAY[]::TEXT[]), 1) IS NOT NULL THEN
    PERFORM public.record_kyc_audit_event(
      p_application_id,
      v_app.user_id,
      'suspicious_submission',
      'warning',
      p_reason_code,
      jsonb_build_object('flags', p_flags)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'application_id', p_application_id,
    'decision', p_decision,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_kyc_ai_validation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_kyc_ai_validation TO service_role;

-- Existing submit_kyc_package writes the submission. Add AI lifecycle fields
-- and compliance audit events without changing the public signature.
CREATE OR REPLACE FUNCTION public.mark_kyc_ai_processing(
  p_application_id UUID,
  p_provider TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.kyc_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app
  FROM public.kyc_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'KYC application not found.');
  END IF;

  UPDATE public.kyc_applications
     SET status = 'verification_processing',
         ai_verification_status = 'processing',
         verification_provider = p_provider,
         verification_request_id = p_request_id,
         verification_started_at = NOW(),
         updated_at = NOW()
   WHERE id = p_application_id;

  PERFORM public.record_kyc_audit_event(
    p_application_id,
    v_app.user_id,
    'submission_started',
    'info',
    NULL,
    jsonb_build_object('provider', p_provider, 'request_id', p_request_id)
  );

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_kyc_ai_processing FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_kyc_ai_processing TO service_role;
