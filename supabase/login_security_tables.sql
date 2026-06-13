-- ─────────────────────────────────────────────────────────────────────────────
-- login_security_tables.sql
--
-- Tables required by the login-security edge function and Section I audit rules.
-- Apply in Supabase SQL Editor.
--
-- Tables:
--   login_ip_limits      — IP-level rate limit counters
--   login_account_limits — Per-account (identifier_hash) rate limit and lock state
--   login_device_limits  — Per-device-fingerprint rate limit counters
--   login_audit_log      — Immutable append-only audit trail for every login event
--   account_locks        — Hard-lock records that require admin release
-- ─────────────────────────────────────────────────────────────────────────────

-- ── IP rate limit ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_ip_limits (
  ip_hash        TEXT        PRIMARY KEY,            -- SHA-256-derived; never raw IP
  attempt_count  INT         NOT NULL DEFAULT 0,
  window_start   BIGINT      NOT NULL DEFAULT 0,     -- Unix epoch seconds
  blocked_until  BIGINT,                             -- Unix epoch seconds; NULL = not blocked
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-purge rows older than 24 hours (cron or pg_cron job — manual purge on free plan)
CREATE INDEX IF NOT EXISTS idx_login_ip_limits_window
  ON public.login_ip_limits (window_start);

-- ── Per-account rate limit ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_account_limits (
  identifier_hash    TEXT        PRIMARY KEY,        -- SHA-256 of normalised identifier
  attempts_last_hour INT         NOT NULL DEFAULT 0,
  hour_window_start  BIGINT      NOT NULL DEFAULT 0, -- Unix epoch seconds
  attempts_last_24h  INT         NOT NULL DEFAULT 0,
  day_window_start   BIGINT      NOT NULL DEFAULT 0,
  soft_locked_until  BIGINT,                         -- NULL = not soft-locked
  hard_locked        BOOLEAN     NOT NULL DEFAULT FALSE,
  hard_locked_at     TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Per-device rate limit ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_device_limits (
  device_hash    TEXT        PRIMARY KEY,
  attempt_count  INT         NOT NULL DEFAULT 0,
  window_start   BIGINT      NOT NULL DEFAULT 0,
  blocked_until  BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Immutable login audit log (Section I) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.login_audit_log (
  id                 BIGSERIAL   PRIMARY KEY,
  user_id            UUID,                           -- NULL for failed logins (user unknown)
  identifier_hash    TEXT        NOT NULL,
  identifier_type    TEXT        NOT NULL CHECK (identifier_type IN ('email', 'phone')),
  success            BOOLEAN     NOT NULL,
  ip_hash            TEXT,
  device_fingerprint TEXT,
  failure_reason     TEXT,                           -- short code; never raw error string
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent any row update/delete — this table is append-only
CREATE OR REPLACE RULE login_audit_no_update AS
  ON UPDATE TO public.login_audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE login_audit_no_delete AS
  ON DELETE TO public.login_audit_log DO INSTEAD NOTHING;

CREATE INDEX IF NOT EXISTS idx_login_audit_user    ON public.login_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_ts      ON public.login_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_idhash  ON public.login_audit_log (identifier_hash);

-- ── Hard-lock registry (admin release required) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.account_locks (
  id             BIGSERIAL   PRIMARY KEY,
  user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  identifier_hash TEXT       NOT NULL,
  lock_type      TEXT        NOT NULL CHECK (lock_type IN ('soft', 'hard')),
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until   TIMESTAMPTZ,                        -- NULL = indefinite (hard lock)
  released_at    TIMESTAMPTZ,
  released_by    TEXT                                -- 'time' | admin UUID string
);

CREATE INDEX IF NOT EXISTS idx_account_locks_user  ON public.account_locks (user_id);
CREATE INDEX IF NOT EXISTS idx_account_locks_idhash ON public.account_locks (identifier_hash);

-- ── RLS: service_role only (edge functions call with service key) ─────────────

ALTER TABLE public.login_ip_limits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_account_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_device_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_locks        ENABLE ROW LEVEL SECURITY;

-- No client/anon access — all operations go through the edge function (service_role)
-- Admins access login_audit_log via admin panel using service_role client only.

-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT ALL ON public.login_ip_limits      TO service_role;
GRANT ALL ON public.login_account_limits TO service_role;
GRANT ALL ON public.login_device_limits  TO service_role;
GRANT ALL ON public.login_audit_log      TO service_role;
GRANT ALL ON public.account_locks        TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.login_audit_log_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.account_locks_id_seq   TO service_role;
