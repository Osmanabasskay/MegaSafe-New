-- Send-flow hardening: server-owned payment intents, ledger entries, receipts.
-- All financial writes are performed by Supabase Edge Functions with service_role.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.linked_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('orange_money','afrimoney')),
  phone_number TEXT NOT NULL,
  masked_number TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  otp_code_hash TEXT,
  otp_sent_at TIMESTAMPTZ,
  otp_attempts INT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lpm_user_provider_phone_unique UNIQUE (user_id, provider, phone_number)
);

ALTER TABLE public.linked_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lpm_select_own ON public.linked_payment_methods;
CREATE POLICY lpm_select_own ON public.linked_payment_methods
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS lpm_no_direct_write ON public.linked_payment_methods;
CREATE POLICY lpm_no_direct_write ON public.linked_payment_methods
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_lpm_user_provider_active
  ON public.linked_payment_methods(user_id, provider, is_active, is_verified);

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('group', 'savings')),
  target_id UUID NOT NULL,
  target_name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NLe',
  method TEXT NOT NULL CHECK (method IN ('orange_money', 'afrimoney')),
  payment_method_id UUID REFERENCES public.linked_payment_methods(id) ON DELETE RESTRICT,
  masked_account TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
  reference TEXT NOT NULL UNIQUE,
  idempotency_key UUID NOT NULL UNIQUE,
  confirmation_idempotency_key UUID UNIQUE,
  transaction_id TEXT,
  provider_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_intents_select_own ON public.payment_intents;
CREATE POLICY payment_intents_select_own ON public.payment_intents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS payment_intents_no_client_write ON public.payment_intents;
CREATE POLICY payment_intents_no_client_write ON public.payment_intents
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user_created
  ON public.payment_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status_expires
  ON public.payment_intents(status, expires_at);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_intent_id UUID NOT NULL REFERENCES public.payment_intents(id) ON DELETE RESTRICT,
  transaction_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NLe',
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_entries_select_own ON public.ledger_entries;
CREATE POLICY ledger_entries_select_own ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS ledger_entries_no_client_write ON public.ledger_entries;
CREATE POLICY ledger_entries_no_client_write ON public.ledger_entries
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_intent
  ON public.ledger_entries(payment_intent_id);

CREATE TABLE IF NOT EXISTS public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_intent_id UUID NOT NULL REFERENCES public.payment_intents(id) ON DELETE RESTRICT,
  transaction_id TEXT,
  receipt_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'cancelled')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NLe',
  masked_account TEXT NOT NULL,
  provider_reference TEXT,
  idempotency_key UUID NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipts_select_own ON public.receipts;
CREATE POLICY receipts_select_own ON public.receipts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS receipts_no_client_write ON public.receipts;
CREATE POLICY receipts_no_client_write ON public.receipts
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_receipts_user_issued
  ON public.receipts(user_id, issued_at DESC);

CREATE OR REPLACE FUNCTION public.touch_payment_intents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_intents_updated_at ON public.payment_intents;
CREATE TRIGGER trg_payment_intents_updated_at
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_payment_intents_updated_at();

-- Helpful verification query after deployment:
-- SELECT table_name, row_security
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('payment_intents', 'ledger_entries', 'receipts');
