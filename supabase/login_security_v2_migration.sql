-- ─────────────────────────────────────────────────────────────────────────────
-- login_security_v2_migration.sql  —  MegaSafe 2.1 hardening
--
-- Apply AFTER login_security_tables.sql (which creates the base tables).
-- Safe to re-run: CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS.
--
-- Changes:
--   1. Add `source` column to login_audit_log
--   2. login_increment_ip      — atomic upsert for IP counters
--   3. login_increment_account — atomic upsert for account counters (hard_locked one-way)
--   4. login_reset_account_on_success — reset soft-lock only; never touches hard_locked
--   5. login_increment_device  — atomic upsert for device counters
--   6. Revoke PUBLIC execute; grant only service_role
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Audit log: add source column ──────────────────────────────────────────

ALTER TABLE public.login_audit_log
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'login-security-edge-function';

-- ── 2. Atomic IP attempt increment ───────────────────────────────────────────
--
-- Resets the window when the current window has expired, then increments.
-- Sets blocked_until when attempt_count reaches p_max_attempts.
-- Returns the new count and blocked_until after the upsert.

CREATE OR REPLACE FUNCTION public.login_increment_ip(
  p_ip_hash      TEXT,
  p_now          BIGINT,
  p_window_secs  BIGINT,
  p_max_attempts INT
) RETURNS TABLE (new_count INT, new_blocked_until BIGINT)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_count   INT;
  v_blocked BIGINT;
BEGIN
  INSERT INTO public.login_ip_limits AS t
    (ip_hash, attempt_count, window_start, blocked_until, updated_at)
  VALUES
    (p_ip_hash,
     1,
     p_now,
     CASE WHEN 1 >= p_max_attempts THEN p_now + p_window_secs ELSE NULL END,
     NOW())
  ON CONFLICT (ip_hash) DO UPDATE SET
    attempt_count = CASE
      WHEN (p_now - t.window_start) >= p_window_secs THEN 1
      ELSE t.attempt_count + 1
    END,
    window_start = CASE
      WHEN (p_now - t.window_start) >= p_window_secs THEN p_now
      ELSE t.window_start
    END,
    blocked_until = CASE
      WHEN (p_now - t.window_start) >= p_window_secs
        THEN CASE WHEN 1 >= p_max_attempts THEN p_now + p_window_secs ELSE NULL END
      ELSE
        CASE WHEN t.attempt_count + 1 >= p_max_attempts THEN p_now + p_window_secs ELSE NULL END
    END,
    updated_at = NOW()
  RETURNING attempt_count, blocked_until
  INTO v_count, v_blocked;

  RETURN QUERY SELECT v_count, v_blocked;
END;
$$;

REVOKE ALL ON FUNCTION public.login_increment_ip(TEXT, BIGINT, BIGINT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.login_increment_ip(TEXT, BIGINT, BIGINT, INT) TO service_role;

-- ── 3. Atomic account attempt increment ──────────────────────────────────────
--
-- Manages both the hourly (soft-lock) and 24-hour (hard-lock) windows atomically.
--
-- hard_locked is one-way inside this function:
--   hard_locked = old_value OR (new_24h_count >= p_hard_max)
-- It can only be cleared by an admin-only unlock procedure.
--
-- soft_locked_until is NOT set when the account is already hard_locked.

CREATE OR REPLACE FUNCTION public.login_increment_account(
  p_identifier_hash   TEXT,
  p_now               BIGINT,
  p_soft_window_secs  BIGINT,
  p_hard_window_secs  BIGINT,
  p_soft_max          INT,
  p_hard_max          INT,
  p_soft_lock_secs    BIGINT
) RETURNS TABLE (is_hard_locked BOOLEAN, new_soft_locked_until BIGINT)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_hard_locked BOOLEAN;
  v_soft_locked BIGINT;
BEGIN
  INSERT INTO public.login_account_limits AS t (
    identifier_hash,
    attempts_last_hour, hour_window_start,
    attempts_last_24h,  day_window_start,
    soft_locked_until,
    hard_locked,
    hard_locked_at,
    updated_at
  )
  VALUES (
    p_identifier_hash,
    1, p_now,
    1, p_now,
    CASE WHEN 1 >= p_soft_max THEN p_now + p_soft_lock_secs ELSE NULL END,
    (1 >= p_hard_max),
    CASE WHEN 1 >= p_hard_max THEN NOW() ELSE NULL END,
    NOW()
  )
  ON CONFLICT (identifier_hash) DO UPDATE SET
    -- Hourly window
    attempts_last_hour = CASE
      WHEN (p_now - t.hour_window_start) >= p_soft_window_secs THEN 1
      ELSE t.attempts_last_hour + 1
    END,
    hour_window_start = CASE
      WHEN (p_now - t.hour_window_start) >= p_soft_window_secs THEN p_now
      ELSE t.hour_window_start
    END,
    -- 24-hour window
    attempts_last_24h = CASE
      WHEN (p_now - t.day_window_start) >= p_hard_window_secs THEN 1
      ELSE t.attempts_last_24h + 1
    END,
    day_window_start = CASE
      WHEN (p_now - t.day_window_start) >= p_hard_window_secs THEN p_now
      ELSE t.day_window_start
    END,
    -- hard_locked: one-way latch — OR with whether new count exceeds hard max
    hard_locked = t.hard_locked OR (
      CASE
        WHEN (p_now - t.day_window_start) >= p_hard_window_secs
          THEN (1 >= p_hard_max)
        ELSE (t.attempts_last_24h + 1 >= p_hard_max)
      END
    ),
    hard_locked_at = CASE
      WHEN (NOT t.hard_locked) AND (
        CASE
          WHEN (p_now - t.day_window_start) >= p_hard_window_secs
            THEN (1 >= p_hard_max)
          ELSE (t.attempts_last_24h + 1 >= p_hard_max)
        END
      ) THEN NOW()
      ELSE t.hard_locked_at
    END,
    -- soft_locked_until: skipped when already hard-locked
    soft_locked_until = CASE
      WHEN t.hard_locked
        THEN t.soft_locked_until  -- preserve; hard lock supersedes soft lock
      WHEN (
        CASE
          WHEN (p_now - t.hour_window_start) >= p_soft_window_secs
            THEN (1 >= p_soft_max)
          ELSE (t.attempts_last_hour + 1 >= p_soft_max)
        END
      )
        THEN p_now + p_soft_lock_secs
      ELSE t.soft_locked_until
    END,
    updated_at = NOW()
  RETURNING hard_locked, soft_locked_until
  INTO v_hard_locked, v_soft_locked;

  RETURN QUERY SELECT v_hard_locked, v_soft_locked;
END;
$$;

REVOKE ALL ON FUNCTION public.login_increment_account(TEXT, BIGINT, BIGINT, BIGINT, INT, INT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.login_increment_account(TEXT, BIGINT, BIGINT, BIGINT, INT, INT, BIGINT) TO service_role;

-- ── 4. Account counter reset on successful login ──────────────────────────────
--
-- Resets hourly/daily counters and clears soft_locked_until.
-- hard_locked is intentionally NOT touched — requires admin unlock.

CREATE OR REPLACE FUNCTION public.login_reset_account_on_success(
  p_identifier_hash TEXT,
  p_now             BIGINT
) RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.login_account_limits SET
    attempts_last_hour = 0,
    hour_window_start  = p_now,
    attempts_last_24h  = 0,
    day_window_start   = p_now,
    soft_locked_until  = NULL,
    -- hard_locked deliberately omitted: admin-only unlock
    updated_at         = NOW()
  WHERE identifier_hash = p_identifier_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.login_reset_account_on_success(TEXT, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.login_reset_account_on_success(TEXT, BIGINT) TO service_role;

-- ── 5. Atomic device attempt increment ───────────────────────────────────────
--
-- Same window-reset-and-increment pattern as login_increment_ip.

CREATE OR REPLACE FUNCTION public.login_increment_device(
  p_device_hash  TEXT,
  p_now          BIGINT,
  p_window_secs  BIGINT,
  p_max_attempts INT
) RETURNS TABLE (new_count INT, new_blocked_until BIGINT)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  v_count   INT;
  v_blocked BIGINT;
BEGIN
  INSERT INTO public.login_device_limits AS t
    (device_hash, attempt_count, window_start, blocked_until, updated_at)
  VALUES
    (p_device_hash,
     1,
     p_now,
     CASE WHEN 1 >= p_max_attempts THEN p_now + p_window_secs ELSE NULL END,
     NOW())
  ON CONFLICT (device_hash) DO UPDATE SET
    attempt_count = CASE
      WHEN (p_now - t.window_start) >= p_window_secs THEN 1
      ELSE t.attempt_count + 1
    END,
    window_start = CASE
      WHEN (p_now - t.window_start) >= p_window_secs THEN p_now
      ELSE t.window_start
    END,
    blocked_until = CASE
      WHEN (p_now - t.window_start) >= p_window_secs
        THEN CASE WHEN 1 >= p_max_attempts THEN p_now + p_window_secs ELSE NULL END
      ELSE
        CASE WHEN t.attempt_count + 1 >= p_max_attempts THEN p_now + p_window_secs ELSE NULL END
    END,
    updated_at = NOW()
  RETURNING attempt_count, blocked_until
  INTO v_count, v_blocked;

  RETURN QUERY SELECT v_count, v_blocked;
END;
$$;

REVOKE ALL ON FUNCTION public.login_increment_device(TEXT, BIGINT, BIGINT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.login_increment_device(TEXT, BIGINT, BIGINT, INT) TO service_role;
