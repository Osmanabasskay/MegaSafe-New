-- ============================================================
-- Prompt 7 — KYC Complete Backend (v2 — schema-corrected)
-- Creates: kyc_applications, kyc_documents, kyc_reviews tables
--          submit_kyc_package, approve_kyc_application,
--          reject_kyc_application, get_kyc_status RPCs
--          Updates kyc-documents storage bucket (add PDF)
--          Replaces flat storage RLS with kyc/{uid}/{sub}/ path
-- Corrections vs v1:
--   - Drop old submit_kyc_package (24-text-arg, no submission_id)
--   - audit_logs: actor_id (not user_id), new_data (not new_values)
--   - audit_action enum: add kyc_submitted / kyc_approved / kyc_rejected
--   - notifications: user_id (not recipient_id)
--   - Rate limiting: inline count on kyc_applications (no check_rate_limit fn)
-- Apply after prompt5_rls_and_enum_fixes.sql
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 0. Extend audit_action enum with KYC values
-- ──────────────────────────────────────────────────────────────

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'kyc_submitted';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'kyc_approved';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'kyc_rejected';

-- ──────────────────────────────────────────────────────────────
-- 1. KYC APPLICATIONS TABLE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kyc_applications (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submission_id          UUID        NOT NULL,        -- matches 3rd path segment in storage
  status                 TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  document_type          TEXT        NOT NULL DEFAULT 'national_id'
    CHECK (document_type IN ('national_id', 'passport', 'drivers_license', 'voters_card')),
  full_name              TEXT        NOT NULL,
  first_name             TEXT,
  last_name              TEXT,
  date_of_birth          DATE        NOT NULL,
  phone_number           TEXT        NOT NULL,
  gender                 TEXT,
  address                TEXT        NOT NULL,
  address_line1          TEXT,
  address_line2          TEXT,
  city                   TEXT,
  state_province         TEXT,
  postal_code            TEXT,
  country_id             UUID,
  national_id_number     TEXT,
  national_id_type       TEXT,
  -- Guarantor fields
  guarantor_name         TEXT,
  guarantor_phone        TEXT,
  guarantor_email        TEXT,
  guarantor_address      TEXT,
  guarantor_relationship TEXT,
  guarantor_id_number    TEXT,
  guarantor_id_type      TEXT,
  -- Review fields
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at            TIMESTAMPTZ,
  reviewed_by            UUID        REFERENCES public.profiles(id),
  rejection_reason       TEXT,
  -- Timestamps
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One active submission per user per submission_id
  UNIQUE (user_id, submission_id)
);

ALTER TABLE public.kyc_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kyc_apps_select_own"
  ON public.kyc_applications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "kyc_apps_select_admin"
  ON public.kyc_applications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

CREATE POLICY "kyc_apps_update_admin"
  ON public.kyc_applications FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- NOTE: No INSERT policy for regular users. All inserts go through
-- the submit_kyc_package SECURITY DEFINER RPC which bypasses RLS.

CREATE INDEX IF NOT EXISTS idx_kyc_applications_user_id
  ON public.kyc_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_applications_status
  ON public.kyc_applications(status);
CREATE INDEX IF NOT EXISTS idx_kyc_applications_submission_id
  ON public.kyc_applications(submission_id);

-- ──────────────────────────────────────────────────────────────
-- 2. KYC DOCUMENTS TABLE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id  UUID NOT NULL REFERENCES public.kyc_applications(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_kind   TEXT NOT NULL
    CHECK (document_kind IN ('id_front', 'id_back', 'selfie', 'guarantor_id')),
  bucket_name     TEXT NOT NULL DEFAULT 'kyc-documents',
  storage_path    TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size       INT,
  checksum        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kyc_docs_select_own"
  ON public.kyc_documents FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "kyc_docs_select_admin"
  ON public.kyc_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_kyc_documents_application_id
  ON public.kyc_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id
  ON public.kyc_documents(user_id);

-- ──────────────────────────────────────────────────────────────
-- 3. KYC REVIEWS TABLE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kyc_reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id  UUID NOT NULL REFERENCES public.kyc_applications(id) ON DELETE CASCADE,
  reviewer_id     UUID NOT NULL REFERENCES public.profiles(id),
  action          TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'requested_info')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.kyc_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kyc_reviews_select_own"
  ON public.kyc_reviews FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.kyc_applications ka
      WHERE ka.id = kyc_reviews.application_id
        AND ka.user_id = auth.uid()
    )
  );

CREATE POLICY "kyc_reviews_admin_all"
  ON public.kyc_reviews FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_kyc_reviews_application_id
  ON public.kyc_reviews(application_id);

-- ──────────────────────────────────────────────────────────────
-- 4. STORAGE BUCKET: add PDF, private, 5 MB limit
-- ──────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  FALSE,
  5242880,   -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public             = FALSE,
  file_size_limit    = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[];

-- Drop ALL old KYC storage policies (from setup_storage.sql and phase2_storage.sql)
DROP POLICY IF EXISTS "kyc_upload_own_folder"                ON storage.objects;
DROP POLICY IF EXISTS "kyc_update_own_folder"                ON storage.objects;
DROP POLICY IF EXISTS "kyc_read_own_folder"                  ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own KYC docs"  ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own KYC docs"    ON storage.objects;
DROP POLICY IF EXISTS "kyc_upload_own_folder_v2"             ON storage.objects;
DROP POLICY IF EXISTS "kyc_read_own_folder_v2"               ON storage.objects;
DROP POLICY IF EXISTS "kyc_upload_own_path"                  ON storage.objects;
DROP POLICY IF EXISTS "kyc_read_own_or_admin"                ON storage.objects;

-- New storage path: kyc/{user_id}/{submission_id}/{filename}
-- storage.foldername(name) returns 1-indexed array of path segments.
-- For 'kyc/abc123/sub456/id_front.jpg':
--   [1] = 'kyc', [2] = 'abc123' (must = auth.uid()), [3] = 'sub456'

CREATE POLICY "kyc_upload_own_path"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] = 'kyc'
    AND (storage.foldername(name))[2] = (auth.uid())::text
  );

-- Users read their own files; admins read all KYC files
CREATE POLICY "kyc_read_own_or_admin"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      (storage.foldername(name))[2] = (auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'super_admin'
      )
    )
  );

-- No DELETE policy for regular users (files cannot be deleted after submission)

-- ──────────────────────────────────────────────────────────────
-- 5. Drop old submit_kyc_package (24-text-arg version, no submission_id)
--    The new version adds p_submission_id as first parameter.
-- ──────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.submit_kyc_package(
  text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text
);

-- ──────────────────────────────────────────────────────────────
-- 6. submit_kyc_package RPC
--    All file uploads happen BEFORE this is called.
--    This RPC validates paths, creates DB records, sets kyc_status.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_kyc_package(
  p_submission_id           UUID,
  -- Personal details
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
  -- Storage paths — validated to belong to current user's submission
  p_national_id_front_url   TEXT    DEFAULT NULL,
  p_national_id_back_url    TEXT    DEFAULT NULL,
  p_selfie_url              TEXT    DEFAULT NULL,
  -- Guarantor (optional)
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
  -- 1. Authentication
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated. Please sign in and try again.');
  END IF;

  -- 2. Inline rate limit: max 3 submissions in last 10 minutes
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

  -- 6. Validate file paths — must start with kyc/{uid}/{submission_id}/
  v_expected_prefix := 'kyc/' || v_uid::text || '/' || p_submission_id::text || '/';

  IF p_national_id_front_url IS NULL
     OR NOT starts_with(p_national_id_front_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid ID front file path. Please upload again.');
  END IF;
  IF p_national_id_back_url IS NULL
     OR NOT starts_with(p_national_id_back_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid ID back file path. Please upload again.');
  END IF;
  IF p_selfie_url IS NULL
     OR NOT starts_with(p_selfie_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid selfie file path. Please upload again.');
  END IF;
  IF p_guarantor_doc_url IS NOT NULL
     AND NOT starts_with(p_guarantor_doc_url, v_expected_prefix) THEN
    RETURN jsonb_build_object('error', 'Invalid guarantor file path. Please upload again.');
  END IF;

  -- 7. Idempotency: return existing if same submission_id already recorded
  SELECT * INTO v_existing
    FROM public.kyc_applications
   WHERE user_id = v_uid
     AND submission_id = p_submission_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success',        TRUE,
      'application_id', v_existing.id,
      'status',         v_existing.status,
      'idempotent',     TRUE
    );
  END IF;

  -- 8. Create KYC application record
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

  -- 9. Record each document
  INSERT INTO public.kyc_documents
    (application_id, user_id, document_kind, storage_path, mime_type)
  VALUES
    (v_app_id, v_uid, 'id_front',   p_national_id_front_url, 'image/jpeg'),
    (v_app_id, v_uid, 'id_back',    p_national_id_back_url,  'image/jpeg'),
    (v_app_id, v_uid, 'selfie',     p_selfie_url,            'image/jpeg');

  IF p_guarantor_doc_url IS NOT NULL THEN
    INSERT INTO public.kyc_documents
      (application_id, user_id, document_kind, storage_path, mime_type)
    VALUES (v_app_id, v_uid, 'guarantor_id', p_guarantor_doc_url, 'image/jpeg');
  END IF;

  -- 10. Upsert guarantors table for backward-compatibility
  --     (guarantors table has: member_id, name, phone, email, address,
  --      relationship, national_id_number, national_id_type, id_document_url)
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

  -- 11. Set profile kyc_status = 'pending'
  --     NEVER set 'approved' here — that only happens in approve_kyc_application.
  UPDATE public.profiles
     SET kyc_status = 'pending',
         first_name = COALESCE(NULLIF(trim(p_first_name), ''), first_name),
         last_name  = COALESCE(NULLIF(trim(p_last_name),  ''), last_name),
         phone      = COALESCE(NULLIF(trim(p_phone),      ''), phone),
         updated_at = NOW()
   WHERE id = v_uid;

  -- 12. Audit log (use actor_id/new_data — matches actual audit_logs schema)
  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
      v_uid,
      'kyc_submitted'::audit_action,
      'kyc_applications',
      v_app_id,
      jsonb_build_object(
        'submission_id',  p_submission_id,
        'document_type',  p_national_id_type,
        'has_guarantor',  (p_guarantor_name IS NOT NULL AND trim(COALESCE(p_guarantor_name,'')) <> ''),
        'submitted_at',   NOW()
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success',        TRUE,
    'application_id', v_app_id,
    'status',         'pending'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Submission failed: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_kyc_package FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_kyc_package TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 7. approve_kyc_application RPC (admin only)
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

  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_reviewer_id AND role = 'super_admin'
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

  -- Update profile kyc_status = 'approved'
  UPDATE public.profiles
     SET kyc_status = 'approved',
         updated_at = NOW()
   WHERE id = v_app.user_id;

  -- Create review record
  INSERT INTO public.kyc_reviews (application_id, reviewer_id, action, note)
  VALUES (p_application_id, v_reviewer_id, 'approved', p_note);

  -- Notify user (non-blocking — uses user_id column)
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

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
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
-- 8. reject_kyc_application RPC (admin only)
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

  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_reviewer_id AND role = 'super_admin'
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

  -- Update profile
  UPDATE public.profiles
     SET kyc_status           = 'rejected',
         kyc_rejection_reason = trim(p_reason),
         updated_at           = NOW()
   WHERE id = v_app.user_id;

  -- Create review record
  INSERT INTO public.kyc_reviews (application_id, reviewer_id, action, note)
  VALUES (p_application_id, v_reviewer_id, 'rejected', p_reason);

  -- Notify user (non-blocking — uses user_id column)
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

  -- Audit log
  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
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
    'user_id',        v_app.user_id,
    'reason',         p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_kyc_application FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reject_kyc_application TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 9. get_kyc_status RPC (safe status fetch for frontend polling)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_kyc_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID;
  v_app  public.kyc_applications%ROWTYPE;
  v_prof public.profiles%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated.');
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Profile not found.');
  END IF;

  -- Most recent application
  SELECT * INTO v_app
    FROM public.kyc_applications
   WHERE user_id = v_uid
   ORDER BY submitted_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'kyc_status',       v_prof.kyc_status,
    'rejection_reason', v_prof.kyc_rejection_reason,
    'has_application',  FOUND,
    'application_id',   CASE WHEN FOUND THEN v_app.id           ELSE NULL END,
    'app_status',       CASE WHEN FOUND THEN v_app.status       ELSE NULL END,
    'submitted_at',     CASE WHEN FOUND THEN v_app.submitted_at ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_kyc_status FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_kyc_status TO authenticated;

SELECT 'prompt7_kyc_complete (v2 schema-corrected) migration applied successfully.' AS result;
