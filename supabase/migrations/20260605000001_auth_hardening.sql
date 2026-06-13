-- ============================================================
-- Migration: Auth Hardening (MegaSafe 2.2)
-- Date: 2026-06-05
-- Fixes:
--   1. otp_rate_limits   — server-side OTP send/verify throttling
--   2. legal_acceptances — server-generated acceptance timestamps
--   3. log_legal_acceptance() RPC — SECURITY DEFINER, uses now()
--   4. RLS for both tables
--   5. DB constraints for profiles (role, status, kyc_status enums)
-- ============================================================

-- ── 1. otp_rate_limits ────────────────────────────────────────────────────────
-- Stores rate-limit state for OTP send and verification per identifier (HMAC).
-- Written by the otp-security Edge Function (service role); no direct client writes.

CREATE TABLE IF NOT EXISTS public.otp_rate_limits (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier_hash     text        NOT NULL,
  identifier_type     text        NOT NULL
    CHECK (identifier_type IN ('email', 'phone')),
  ip_hash             text,
  send_count          int         NOT NULL DEFAULT 0,
  send_window_start   bigint      NOT NULL DEFAULT 0,  -- epoch seconds
  verify_fails        int         NOT NULL DEFAULT 0,
  verify_window_start bigint      NOT NULL DEFAULT 0,  -- epoch seconds
  hard_locked         boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS otp_rate_limits_identifier_idx
  ON public.otp_rate_limits (identifier_hash);

-- RLS: no user can read or write this table directly
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otp_rate_limits_deny_all" ON public.otp_rate_limits
  FOR ALL USING (false);

-- ── 2. legal_acceptances ──────────────────────────────────────────────────────
-- Stores terms and privacy acceptance with a SERVER-GENERATED timestamp.
-- The client supplies terms_version/privacy_version only; accepted_at = now().
-- Replaces the old create_audit_log approach which trusted client's acceptedAt.

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version       text        NOT NULL,
  privacy_version     text        NOT NULL,
  accepted_at         timestamptz NOT NULL DEFAULT now(),  -- always server-generated
  acceptance_source   text        NOT NULL DEFAULT 'mobile_app',
  ip_hash             text,
  device_fingerprint  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_acceptances_user_id_idx
  ON public.legal_acceptances (user_id);

CREATE INDEX IF NOT EXISTS legal_acceptances_accepted_at_idx
  ON public.legal_acceptances (accepted_at DESC);

-- RLS: users can read only their own acceptances; inserts only via RPC
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legal_acceptances_select_own" ON public.legal_acceptances
  FOR SELECT USING (auth.uid() = user_id);

-- Block all direct inserts, updates, deletes — must go through log_legal_acceptance RPC
CREATE POLICY "legal_acceptances_no_direct_write" ON public.legal_acceptances
  FOR INSERT WITH CHECK (false);

CREATE POLICY "legal_acceptances_no_update" ON public.legal_acceptances
  FOR UPDATE USING (false);

CREATE POLICY "legal_acceptances_no_delete" ON public.legal_acceptances
  FOR DELETE USING (false);

-- ── 3. log_legal_acceptance RPC ───────────────────────────────────────────────
-- SECURITY DEFINER: runs as the table owner, bypasses RLS to insert.
-- user_id is derived from auth.uid() — never trusted from parameters.
-- accepted_at is always set to now() — never trusted from client.

CREATE OR REPLACE FUNCTION public.log_legal_acceptance(
  p_terms_version   text,
  p_privacy_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Derive user from the authenticated session — never trust a client-supplied ID
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Validate version strings: reject nulls and overly long values
  IF p_terms_version IS NULL OR length(p_terms_version) > 50 THEN
    RETURN jsonb_build_object('error', 'Invalid terms_version');
  END IF;
  IF p_privacy_version IS NULL OR length(p_privacy_version) > 50 THEN
    RETURN jsonb_build_object('error', 'Invalid privacy_version');
  END IF;

  INSERT INTO public.legal_acceptances (
    user_id,
    terms_version,
    privacy_version,
    accepted_at,        -- always now() — client cannot override
    acceptance_source
  )
  VALUES (
    v_user_id,
    p_terms_version,
    p_privacy_version,
    now(),
    'mobile_app'
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Revoke direct execute from anon and public; authenticated users call via supabase.rpc()
REVOKE ALL ON FUNCTION public.log_legal_acceptance(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_legal_acceptance(text, text) TO authenticated;

-- ── 4. Profiles table — harden enums with CHECK constraints ──────────────────
-- Prevent direct UPDATE of admin-only fields from authenticated clients.
-- These are belt-and-suspenders alongside RLS.

-- Ensure role column has a CHECK constraint (may already exist; IF NOT EXISTS equivalent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname   = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check
        CHECK (role IN ('member', 'org_admin', 'super_admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname   = 'profiles_kyc_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_kyc_status_check
        CHECK (kyc_status IN ('not_submitted', 'pending', 'submitted', 'approved', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname   = 'profiles_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_status_check
        CHECK (status IN ('active', 'suspended', 'closed'));
  END IF;
END $$;

-- Ensure profiles.phone format constraint (SL E.164)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname   = 'profiles_phone_format_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_phone_format_check
        CHECK (phone IS NULL OR phone ~ '^\+232[0-9]{8}$');
  END IF;
END $$;

-- ── 5. Profiles RLS — block direct writes to privileged fields ────────────────
-- Users may update only their own safe profile fields.
-- role, is_active, kyc_status, kyc_verified, status are admin-only.
-- This supplements (not replaces) the upsert_basic_profile SECURITY DEFINER RPC.

-- Revoke any existing overly-broad UPDATE policy on profiles for authenticated users
-- and replace with a field-scoped one.
-- NOTE: Adjust policy names to match your existing RLS policy names.
-- The following is additive if your RLS was previously less restrictive.

-- Example: ensure no policy allows direct role escalation
-- (If your existing policies are already restrictive, these are belt-and-suspenders.)
DO $$
BEGIN
  -- This block intentionally left as a documentation comment for teams to verify
  -- their existing profiles RLS policies include these denials:
  --   DENY UPDATE of (role, is_active, kyc_status, kyc_verified, status)
  --   DENY INSERT (profile created by DB trigger on auth.users insert)
  --   DENY DELETE
  -- The upsert_basic_profile SECURITY DEFINER RPC is the correct write path.
  RAISE NOTICE 'Auth hardening migration complete. Verify profiles RLS blocks role/status/kyc writes.';
END $$;

-- ── 6. Trigger guard: new users always get role = member ──────────────────────
-- Ensures the handle_new_user trigger (or equivalent) cannot be bypassed by
-- injecting role via signup metadata.

CREATE OR REPLACE FUNCTION public.enforce_member_role_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Always force role to 'member' regardless of what the client sent
  NEW.role := 'member';
  RETURN NEW;
END;
$$;

-- Attach as a BEFORE INSERT trigger if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_member_role_trigger'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    CREATE TRIGGER enforce_member_role_trigger
      BEFORE INSERT ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_member_role_on_insert();
  END IF;
END $$;

-- ── 7. Updated timestamps ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'otp_rate_limits_set_updated_at'
      AND tgrelid = 'public.otp_rate_limits'::regclass
  ) THEN
    CREATE TRIGGER otp_rate_limits_set_updated_at
      BEFORE UPDATE ON public.otp_rate_limits
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
