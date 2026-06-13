-- =============================================================================
-- MegaSafe Production Hardening — Disputes Authorization + Payment Methods
-- Migration: 20260606000001
--
-- Changes:
--   1. Add missing columns to disputes (priority, accused_user_id)
--   2. Add 'dismissed' value to dispute_status enum
--   3. Replace FOR ALL disputes_manage_own with SELECT-only member policy
--   4. Create create_dispute RPC         — member-callable, rate-limited, audited
--   5. Create update_dispute_status RPC  — admin-only, state machine, audited
--   6. Create get_my_disputes RPC        — member sees own disputes only
--   7. Create get_admin_disputes RPC     — admin sees all disputes
--   8. Create linked_payment_methods table with RLS
--   9. Create link_payment_method RPC    — derives user_id from auth.uid()
--  10. Create verify_payment_method RPC  — activates only after OTP confirmed
--  11. Create get_my_payment_methods RPC
--  12. Create unlink_payment_method RPC
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend dispute_status enum with 'dismissed'
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.dispute_status'::regtype
      AND enumlabel = 'dismissed'
  ) THEN
    ALTER TYPE public.dispute_status ADD VALUE 'dismissed';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Create dispute_priority enum
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_priority' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.dispute_priority AS ENUM ('low', 'normal', 'high', 'critical');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add missing columns to disputes table
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS accused_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority        public.dispute_priority NOT NULL DEFAULT 'normal';

-- Ensure updated_at column exists (some bootstrap versions may omit it)
ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION public.set_disputes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_disputes_updated_at ON public.disputes;
CREATE TRIGGER trg_disputes_updated_at
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_disputes_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Harden disputes RLS
--    Replace the permissive FOR ALL policy with SELECT-only for members.
--    All mutations go through SECURITY DEFINER RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the dangerously permissive policy (FOR ALL allows members to UPDATE status)
DROP POLICY IF EXISTS "disputes_manage_own" ON public.disputes;

-- Members may only read their own disputes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'disputes'
      AND policyname = 'disputes_select_own'
  ) THEN
    CREATE POLICY disputes_select_own ON public.disputes
      FOR SELECT TO authenticated
      USING (raised_by = auth.uid());
  END IF;
END $$;

-- Admins may read all disputes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'disputes'
      AND policyname = 'disputes_select_admin'
  ) THEN
    CREATE POLICY disputes_select_admin ON public.disputes
      FOR SELECT TO authenticated
      USING (public.is_super_admin());
  END IF;
END $$;

-- Explicitly block direct INSERT/UPDATE/DELETE for all authenticated users.
-- Mutations only succeed via SECURITY DEFINER RPCs.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'disputes'
      AND policyname = 'disputes_no_direct_insert'
  ) THEN
    CREATE POLICY disputes_no_direct_insert ON public.disputes
      FOR INSERT TO authenticated
      WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'disputes'
      AND policyname = 'disputes_no_direct_update'
  ) THEN
    CREATE POLICY disputes_no_direct_update ON public.disputes
      FOR UPDATE TO authenticated
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'disputes'
      AND policyname = 'disputes_no_direct_delete'
  ) THEN
    CREATE POLICY disputes_no_direct_delete ON public.disputes
      FOR DELETE TO authenticated
      USING (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. create_dispute RPC
--    Security: caller is always the complainant (raised_by = auth.uid()).
--    Rate limit: max 5 disputes per user per 24 hours.
--    State: always created as 'open'.
--    Audit: logged on create.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_dispute(
  p_title          TEXT,
  p_description    TEXT,
  p_category       TEXT,
  p_group_id       UUID    DEFAULT NULL,
  p_payment_id     UUID    DEFAULT NULL,
  p_accused_id     UUID    DEFAULT NULL,
  p_priority       TEXT    DEFAULT 'normal',
  p_evidence_url   TEXT    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          UUID;
  v_dispute_id   UUID;
  v_recent_count INT;
BEGIN
  -- Auth
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Input validation
  IF length(trim(p_title)) < 5 THEN
    RETURN jsonb_build_object('error', 'Dispute title must be at least 5 characters.');
  END IF;
  IF length(trim(p_description)) < 20 THEN
    RETURN jsonb_build_object('error', 'Dispute description must be at least 20 characters.');
  END IF;
  IF p_category NOT IN ('missing_payment','collector_misconduct','incorrect_amount','unauthorized_transaction','other') THEN
    RETURN jsonb_build_object('error', 'Invalid dispute category.');
  END IF;
  IF p_priority NOT IN ('low','normal','high','critical') THEN
    RETURN jsonb_build_object('error', 'Invalid priority value.');
  END IF;
  -- Users cannot file a dispute against themselves
  IF p_accused_id IS NOT NULL AND p_accused_id = v_uid THEN
    RETURN jsonb_build_object('error', 'You cannot raise a dispute against yourself.');
  END IF;

  -- Rate limit: max 5 disputes per user per 24 hours
  SELECT COUNT(*) INTO v_recent_count
  FROM public.disputes
  WHERE raised_by = v_uid
    AND created_at > NOW() - INTERVAL '24 hours';

  IF v_recent_count >= 5 THEN
    RETURN jsonb_build_object('error', 'Too many dispute submissions. Please wait before submitting again.');
  END IF;

  -- Insert (status always starts as 'open', set server-side)
  INSERT INTO public.disputes (
    raised_by, dispute_type, title, description,
    group_id, payment_id, accused_user_id, priority,
    status, evidence_urls, created_at, updated_at
  ) VALUES (
    v_uid,
    p_category::public.dispute_type,
    trim(p_title),
    trim(p_description),
    p_group_id,
    p_payment_id,
    p_accused_id,
    p_priority::public.dispute_priority,
    'open',
    CASE WHEN p_evidence_url IS NOT NULL THEN ARRAY[p_evidence_url] ELSE NULL END,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_dispute_id;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid,
    'create_dispute',
    'disputes',
    v_dispute_id,
    jsonb_build_object(
      'title',    trim(p_title),
      'category', p_category,
      'priority', p_priority,
      'status',   'open'
    )
  );

  RETURN jsonb_build_object('success', true, 'dispute_id', v_dispute_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Failed to create dispute. Please try again.');
END;
$$;

REVOKE ALL ON FUNCTION public.create_dispute FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_dispute TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. update_dispute_status RPC — ADMIN ONLY
--    Enforces allowed transitions and requires resolution_note for 'resolved'.
--    State machine:
--      open          → under_review | escalated | dismissed
--      under_review  → resolved | escalated | dismissed
--      escalated     → under_review | resolved | dismissed
--      resolved      → (terminal — no further transitions)
--      dismissed     → (terminal — no further transitions)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_dispute_status(
  p_dispute_id      UUID,
  p_status          TEXT,
  p_resolution_note TEXT DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          UUID;
  v_current      public.dispute_status;
  v_new_status   public.dispute_status;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Admin-only: must be super_admin or org_admin
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid
      AND role IN ('super_admin', 'org_admin')
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied. Only support staff may update dispute status.');
  END IF;

  -- Validate new status value
  IF p_status NOT IN ('open','under_review','resolved','escalated','dismissed') THEN
    RETURN jsonb_build_object('error', 'Invalid dispute status.');
  END IF;

  -- Fetch current state
  SELECT status INTO v_current
  FROM public.disputes
  WHERE id = p_dispute_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Dispute not found.');
  END IF;

  v_new_status := p_status::public.dispute_status;

  -- Terminal state guard
  IF v_current IN ('resolved', 'dismissed') THEN
    RETURN jsonb_build_object('error', 'Dispute is already in a terminal state and cannot be updated.');
  END IF;

  -- Enforce allowed transitions
  IF NOT (
    (v_current = 'open'         AND v_new_status IN ('under_review','escalated','dismissed')) OR
    (v_current = 'under_review' AND v_new_status IN ('resolved','escalated','dismissed'))     OR
    (v_current = 'escalated'    AND v_new_status IN ('under_review','resolved','dismissed'))
  ) THEN
    RETURN jsonb_build_object(
      'error',
      format('Invalid transition: %s → %s is not allowed.', v_current::text, v_new_status::text)
    );
  END IF;

  -- Resolution note required when resolving or dismissing
  IF v_new_status IN ('resolved','dismissed') AND (p_resolution_note IS NULL OR trim(p_resolution_note) = '') THEN
    RETURN jsonb_build_object('error', 'A resolution note is required when resolving or dismissing a dispute.');
  END IF;

  -- Apply the update
  UPDATE public.disputes SET
    status           = v_new_status,
    resolution_notes = COALESCE(trim(p_resolution_note), resolution_notes),
    resolved_by      = CASE WHEN v_new_status IN ('resolved','dismissed') THEN v_uid ELSE resolved_by END,
    resolved_at      = CASE WHEN v_new_status IN ('resolved','dismissed') THEN NOW() ELSE resolved_at END,
    updated_at       = NOW()
  WHERE id = p_dispute_id;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid,
    'update_dispute_status',
    'disputes',
    p_dispute_id,
    jsonb_build_object(
      'old_status',       v_current::text,
      'new_status',       v_new_status::text,
      'resolution_note',  p_resolution_note
    )
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Failed to update dispute status.');
END;
$$;

REVOKE ALL ON FUNCTION public.update_dispute_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_dispute_status TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. get_my_disputes RPC — members see only their own disputes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_disputes(
  p_status TEXT DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  RETURN jsonb_build_object(
    'disputes',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',               d.id,
            'complainant_id',   d.raised_by,
            'accused_user_id',  d.accused_user_id,
            'group_id',         d.group_id,
            'group_name',       g.name,
            'payment_id',       d.payment_id,
            'category',         d.dispute_type,
            'title',            d.title,
            'description',      d.description,
            'status',           d.status,
            'priority',         d.priority,
            'resolution_note',  d.resolution_notes,
            'created_at',       d.created_at,
            'updated_at',       d.updated_at,
            'resolved_at',      d.resolved_at
          )
          ORDER BY d.created_at DESC
        )
        FROM public.disputes d
        LEFT JOIN public.osusu_groups g ON g.id = d.group_id
        WHERE d.raised_by = v_uid
          AND (p_status IS NULL OR d.status = p_status::public.dispute_status)
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_disputes FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_disputes TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. get_admin_disputes RPC — admin-only, paginated
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_admin_disputes(
  p_status   TEXT    DEFAULT NULL,
  p_category TEXT    DEFAULT NULL,
  p_limit    INTEGER DEFAULT 50,
  p_offset   INTEGER DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID;
  v_total INT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_uid AND role IN ('super_admin','org_admin')
  ) THEN
    RETURN jsonb_build_object('error', 'Permission denied.');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.disputes d
  WHERE (p_status   IS NULL OR d.status       = p_status::public.dispute_status)
    AND (p_category IS NULL OR d.dispute_type = p_category::public.dispute_type);

  RETURN jsonb_build_object(
    'total', v_total,
    'disputes',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',               d.id,
            'complainant_id',   d.raised_by,
            'accused_user_id',  d.accused_user_id,
            'group_id',         d.group_id,
            'group_name',       g.name,
            'payment_id',       d.payment_id,
            'category',         d.dispute_type,
            'title',            d.title,
            'description',      d.description,
            'status',           d.status,
            'priority',         d.priority,
            'resolution_note',  d.resolution_notes,
            'created_at',       d.created_at,
            'updated_at',       d.updated_at,
            'resolved_at',      d.resolved_at
          )
          ORDER BY
            CASE d.priority
              WHEN 'critical' THEN 1 WHEN 'high' THEN 2
              WHEN 'normal'   THEN 3 WHEN 'low'  THEN 4 ELSE 5
            END,
            d.created_at DESC
        )
        FROM public.disputes d
        LEFT JOIN public.osusu_groups g ON g.id = d.group_id
        WHERE (p_status   IS NULL OR d.status       = p_status::public.dispute_status)
          AND (p_category IS NULL OR d.dispute_type = p_category::public.dispute_type)
        LIMIT LEAST(p_limit, 200)
        OFFSET GREATEST(p_offset, 0)
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_disputes FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_disputes TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. linked_payment_methods table
--    Only Orange Money and AfriMoney are supported via Monime digital flow.
--    QMoney is excluded (manual collection only, not a Monime provider).
--    Methods remain is_active=false until OTP verification is complete.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.linked_payment_methods (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider     TEXT         NOT NULL,
  phone_number TEXT         NOT NULL,
  masked_number TEXT        NOT NULL,
  is_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN      NOT NULL DEFAULT FALSE,
  otp_code_hash TEXT,
  otp_sent_at  TIMESTAMPTZ,
  otp_attempts INT          NOT NULL DEFAULT 0,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT lpm_provider_check
    CHECK (provider IN ('orange_money','afrimoney')),

  CONSTRAINT lpm_phone_format_check
    CHECK (phone_number ~ '^\+232[0-9]{8}$'),

  CONSTRAINT lpm_user_provider_phone_unique
    UNIQUE (user_id, provider, phone_number)
);

ALTER TABLE public.linked_payment_methods ENABLE ROW LEVEL SECURITY;

-- Members may read their own methods (for display of masked numbers only)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'linked_payment_methods'
      AND policyname = 'lpm_select_own'
  ) THEN
    CREATE POLICY lpm_select_own ON public.linked_payment_methods
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- All mutations via SECURITY DEFINER RPCs only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'linked_payment_methods'
      AND policyname = 'lpm_no_direct_write'
  ) THEN
    CREATE POLICY lpm_no_direct_write ON public.linked_payment_methods
      FOR ALL TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. link_payment_method RPC
--     user_id always derived from auth.uid() — never accepted from client.
--     Creates an UNVERIFIED, INACTIVE record pending OTP confirmation.
--     Normalises the phone number to Sierra Leone E.164 format.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.link_payment_method(
  p_provider     TEXT,
  p_phone_number TEXT
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          UUID;
  v_normalized   TEXT;
  v_masked       TEXT;
  v_method_id    UUID;
  v_existing_id  UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Provider validation
  IF p_provider NOT IN ('orange_money','afrimoney') THEN
    RETURN jsonb_build_object('error', 'Unsupported provider. QMoney is manual-only and cannot be linked digitally.');
  END IF;

  -- Normalize Sierra Leone phone: strip spaces/dashes, ensure +232XXXXXXXX
  v_normalized := regexp_replace(trim(p_phone_number), '[\s\-\(\)]', '', 'g');
  -- Handle local formats: 076… → +23276…, 0076… → +23276…, +232… → +232…
  IF v_normalized ~ '^0[0-9]{8}$' THEN
    v_normalized := '+232' || substring(v_normalized FROM 2);
  ELSIF v_normalized ~ '^00232[0-9]{8}$' THEN
    v_normalized := '+' || substring(v_normalized FROM 3);
  ELSIF v_normalized ~ '^232[0-9]{8}$' THEN
    v_normalized := '+' || v_normalized;
  END IF;

  -- Validate normalized format: +232XXXXXXXX (12 chars total, 8 digits after +232)
  IF v_normalized !~ '^\+232[0-9]{8}$' THEN
    RETURN jsonb_build_object('error', 'Invalid Sierra Leone phone number. Use format 076XXXXXXX or +23276XXXXXXX.');
  END IF;

  -- Mask for client display: +232 76 *** **56 style
  v_masked := '+232 ' ||
              substring(v_normalized FROM 5 FOR 2) || ' *** **' ||
              right(v_normalized, 2);

  -- Check for duplicate (same user, same provider, same number)
  SELECT id INTO v_existing_id
  FROM public.linked_payment_methods
  WHERE user_id = v_uid
    AND provider = p_provider
    AND phone_number = v_normalized;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This number is already linked for this provider.');
  END IF;

  -- Rate limit: max 3 link attempts per user per hour
  IF (
    SELECT COUNT(*) FROM public.linked_payment_methods
    WHERE user_id = v_uid AND created_at > NOW() - INTERVAL '1 hour'
  ) >= 3 THEN
    RETURN jsonb_build_object('error', 'Too many link attempts. Please try again later.');
  END IF;

  -- Insert UNVERIFIED + INACTIVE record
  INSERT INTO public.linked_payment_methods (
    user_id, provider, phone_number, masked_number,
    is_verified, is_active, created_at, updated_at
  ) VALUES (
    v_uid, p_provider, v_normalized, v_masked,
    FALSE, FALSE, NOW(), NOW()
  )
  RETURNING id INTO v_method_id;

  -- Audit log
  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid, 'link_payment_method', 'linked_payment_methods', v_method_id,
    jsonb_build_object('provider', p_provider, 'masked', v_masked, 'verified', false)
  );

  RETURN jsonb_build_object(
    'success',        true,
    'method_id',      v_method_id,
    'masked_number',  v_masked,
    'is_verified',    false,
    'is_active',      false,
    'message',        'Number linked. A verification code will be sent to activate it.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Failed to link payment method. Please try again.');
END;
$$;

REVOKE ALL ON FUNCTION public.link_payment_method FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_payment_method TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. verify_payment_method RPC
--     Accepts OTP code from user, compares against stored hash,
--     activates the method only on success.
--     Max 3 attempts before the method is locked.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_payment_method(
  p_method_id UUID,
  p_otp_code  TEXT
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID;
  v_method  public.linked_payment_methods%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT * INTO v_method
  FROM public.linked_payment_methods
  WHERE id = p_method_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment method not found.');
  END IF;

  -- Ownership check: method must belong to this user
  IF v_method.user_id <> v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied.');
  END IF;

  IF v_method.is_verified THEN
    RETURN jsonb_build_object('error', 'This method is already verified.');
  END IF;

  -- OTP expiry check (OTP valid for 10 minutes)
  IF v_method.otp_sent_at IS NULL OR v_method.otp_sent_at < NOW() - INTERVAL '10 minutes' THEN
    RETURN jsonb_build_object('error', 'Verification code has expired. Please request a new one.');
  END IF;

  -- Max attempts guard
  IF v_method.otp_attempts >= 3 THEN
    RETURN jsonb_build_object('error', 'Too many failed attempts. Please request a new verification code.');
  END IF;

  -- Validate OTP against stored hash (SHA-256)
  IF v_method.otp_code_hash IS NULL OR
     encode(sha256(p_otp_code::bytea), 'hex') <> v_method.otp_code_hash THEN
    -- Increment attempt counter
    UPDATE public.linked_payment_methods
    SET otp_attempts = otp_attempts + 1, updated_at = NOW()
    WHERE id = p_method_id;

    RETURN jsonb_build_object('error', 'Invalid verification code.');
  END IF;

  -- OTP correct — activate the method
  UPDATE public.linked_payment_methods SET
    is_verified  = TRUE,
    is_active    = TRUE,
    verified_at  = NOW(),
    otp_code_hash = NULL,
    otp_attempts  = 0,
    updated_at    = NOW()
  WHERE id = p_method_id;

  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid, 'verify_payment_method', 'linked_payment_methods', p_method_id,
    jsonb_build_object('verified_at', NOW(), 'is_active', true)
  );

  RETURN jsonb_build_object('success', true, 'is_active', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Verification failed. Please try again.');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_payment_method FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_payment_method TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. get_my_payment_methods RPC
--     Returns only masked numbers — never raw phone number in response.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_payment_methods()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  RETURN jsonb_build_object(
    'methods',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',            m.id,
            'provider',      m.provider,
            'masked_number', m.masked_number,
            'is_verified',   m.is_verified,
            'is_active',     m.is_active,
            'verified_at',   m.verified_at,
            'created_at',    m.created_at
            -- NOTE: phone_number intentionally excluded from response
          )
          ORDER BY m.created_at DESC
        )
        FROM public.linked_payment_methods m
        WHERE m.user_id = v_uid
      ),
      '[]'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_payment_methods FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_payment_methods TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. unlink_payment_method RPC
--     Users can only unlink their own methods.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unlink_payment_method(
  p_method_id UUID
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID;
  v_owner  UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  SELECT user_id INTO v_owner
  FROM public.linked_payment_methods
  WHERE id = p_method_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Payment method not found.');
  END IF;

  -- Ownership enforcement: users cannot unlink other users' methods
  IF v_owner <> v_uid THEN
    RETURN jsonb_build_object('error', 'Permission denied.');
  END IF;

  DELETE FROM public.linked_payment_methods WHERE id = p_method_id;

  INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
  VALUES (
    v_uid, 'unlink_payment_method', 'linked_payment_methods', p_method_id,
    jsonb_build_object('unlinked_at', NOW())
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'Failed to unlink payment method.');
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_payment_method FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlink_payment_method TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_disputes_raised_by_status
  ON public.disputes (raised_by, status);

CREATE INDEX IF NOT EXISTS idx_disputes_created_at
  ON public.disputes (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lpm_user_provider
  ON public.linked_payment_methods (user_id, provider);

COMMIT;
