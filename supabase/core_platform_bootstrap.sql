-- Mi Osusu core platform bootstrap
-- Run this file in the Supabase SQL Editor for the project referenced in `.env`.
-- It creates the minimum public schema required by the mobile app's live group,
-- savings, payments, disputes, and notifications flows.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('super_admin', 'group_creator', 'collector', 'member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'group_status') THEN
    CREATE TYPE group_status AS ENUM ('active', 'paused', 'completed', 'disbanded', 'pending');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contribution_status') THEN
    CREATE TYPE contribution_status AS ENUM ('pending', 'collected', 'verified', 'disputed', 'refunded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM ('orange_money', 'afrimoney', 'qmoney', 'bank_transfer', 'card', 'cash_collected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'reversed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM ('collection_reminder', 'payment_received', 'group_invite', 'join_approved', 'dispute_update', 'payout_scheduled', 'system_alert');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_status') THEN
    CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'escalated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_type') THEN
    CREATE TYPE dispute_type AS ENUM ('missing_payment', 'collector_misconduct', 'incorrect_amount', 'unauthorized_transaction', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'savings_goal_status') THEN
    CREATE TYPE savings_goal_status AS ENUM ('active', 'completed', 'withdrawn', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'currency_code') THEN
    CREATE TYPE currency_code AS ENUM ('NLe', 'USD', 'GBP', 'EUR', 'NGN', 'GHS', 'XOF', 'GMD');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT UNIQUE,
  avatar_url TEXT,
  role user_role DEFAULT 'member',
  preferred_currency currency_code DEFAULT 'NLe',
  notification_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.osusu_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  contribution_amount DECIMAL(12, 2) NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  max_members INT NOT NULL CHECK (max_members >= 2),
  cycle_start_date DATE NOT NULL,
  total_cycles INT NOT NULL,
  payout_order TEXT NOT NULL CHECK (payout_order IN ('sequential', 'random')),
  is_public BOOLEAN DEFAULT TRUE,
  join_requires_approval BOOLEAN DEFAULT TRUE,
  custom_rules TEXT,
  status group_status DEFAULT 'active',
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES public.osusu_groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  payout_position INT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  join_method TEXT,
  invited_by UUID REFERENCES public.profiles(id),
  member_secret_code TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id),
  UNIQUE (group_id, member_id)
);

-- Compatibility repair for databases created from older Mi Osusu bootstraps.
-- Earlier scripts named the membership profile column `user_id`; the app now
-- uses `member_id` consistently across memberships, contributions, and KYC.
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
UPDATE public.group_memberships SET member_id = user_id WHERE member_id IS NULL AND user_id IS NOT NULL;
ALTER TABLE public.group_memberships ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS join_method TEXT;
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS member_secret_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_memberships_group_member
  ON public.group_memberships(group_id, member_id)
  WHERE member_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'group_memberships_group_id_member_id_key'
      AND conrelid = 'public.group_memberships'::regclass
  ) THEN
    ALTER TABLE public.group_memberships
      ADD CONSTRAINT group_memberships_group_id_member_id_key UNIQUE (group_id, member_id);
  END IF;
END
$$;

ALTER TABLE public.osusu_groups ADD COLUMN IF NOT EXISTS contribution_number TEXT UNIQUE;
ALTER TABLE public.osusu_groups ADD COLUMN IF NOT EXISTS deletion_requested_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.osusu_groups ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE public.osusu_groups DROP CONSTRAINT IF EXISTS osusu_groups_payout_order_check;
ALTER TABLE public.osusu_groups ADD CONSTRAINT osusu_groups_payout_order_check
  CHECK (payout_order IN ('sequential', 'random', 'bidding', 'custom'));

CREATE TABLE IF NOT EXISTS public.contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES public.osusu_groups(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES public.profiles(id) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency_code currency_code NOT NULL DEFAULT 'NLe',
  cycle_number INT NOT NULL,
  contribution_period TEXT NOT NULL,
  due_date DATE,
  collected_by UUID,
  collection_method payment_method NOT NULL,
  status contribution_status DEFAULT 'pending',
  payment_id UUID,
  receipt_number TEXT UNIQUE DEFAULT 'RCP-' || to_char(NOW(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::TEXT, 1, 6),
  receipt_url TEXT,
  verified_by UUID REFERENCES public.profiles(id),
  verified_at TIMESTAMPTZ,
  verification_note TEXT,
  collection_latitude DECIMAL(10, 8),
  collection_longitude DECIMAL(11, 8),
  collection_address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN ('car', 'house', 'rent', 'school_fees', 'business', 'travel', 'emergency', 'other')),
  goal_emoji TEXT DEFAULT '🎯',
  target_amount DECIMAL(12, 2) NOT NULL,
  current_amount DECIMAL(12, 2) DEFAULT 0,
  currency_code currency_code NOT NULL DEFAULT 'NLe',
  target_date DATE,
  status savings_goal_status DEFAULT 'active',
  auto_save_enabled BOOLEAN DEFAULT FALSE,
  auto_save_amount DECIMAL(12, 2),
  auto_save_frequency TEXT CHECK (auto_save_frequency IN ('daily', 'weekly', 'monthly')),
  auto_save_next_date DATE,
  completed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payer_id UUID REFERENCES public.profiles(id) NOT NULL,
  recipient_group_id UUID REFERENCES public.osusu_groups(id),
  amount DECIMAL(12, 2) NOT NULL,
  currency_code currency_code NOT NULL DEFAULT 'NLe',
  payment_method payment_method NOT NULL,
  provider TEXT NOT NULL,
  provider_reference TEXT,
  provider_response JSONB,
  status payment_status DEFAULT 'pending',
  contribution_id UUID REFERENCES public.contributions(id),
  savings_goal_id UUID REFERENCES public.savings_goals(id),
  webhook_received_at TIMESTAMPTZ,
  webhook_payload JSONB,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  reversal_reference TEXT,
  ip_address INET,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.savings_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  savings_goal_id UUID REFERENCES public.savings_goals(id) ON DELETE CASCADE NOT NULL,
  payment_id UUID REFERENCES public.payments(id),
  amount DECIMAL(12, 2) NOT NULL,
  transaction_type TEXT CHECK (transaction_type IN ('deposit', 'withdrawal')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raised_by UUID REFERENCES public.profiles(id) NOT NULL,
  group_id UUID REFERENCES public.osusu_groups(id),
  contribution_id UUID REFERENCES public.contributions(id),
  payment_id UUID REFERENCES public.payments(id),
  dispute_type dispute_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_urls TEXT[],
  status dispute_status DEFAULT 'open',
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  response_due_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  body TEXT,
  data JSONB,
  action_path TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE public.notifications ALTER COLUMN message DROP NOT NULL;

-- Deletion support: keep financial/audit rows valid when a user deletes a
-- group or savings goal that has related payments, contributions, or disputes.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_recipient_group_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_recipient_group_id_fkey
  FOREIGN KEY (recipient_group_id) REFERENCES public.osusu_groups(id) ON DELETE SET NULL;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_contribution_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_contribution_id_fkey
  FOREIGN KEY (contribution_id) REFERENCES public.contributions(id) ON DELETE SET NULL;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_savings_goal_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_savings_goal_id_fkey
  FOREIGN KEY (savings_goal_id) REFERENCES public.savings_goals(id) ON DELETE SET NULL;
ALTER TABLE public.contributions DROP CONSTRAINT IF EXISTS contributions_payment_id_fkey;
ALTER TABLE public.contributions
  ADD CONSTRAINT contributions_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
ALTER TABLE public.savings_transactions DROP CONSTRAINT IF EXISTS savings_transactions_payment_id_fkey;
ALTER TABLE public.savings_transactions
  ADD CONSTRAINT savings_transactions_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
ALTER TABLE public.disputes DROP CONSTRAINT IF EXISTS disputes_group_id_fkey;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.osusu_groups(id) ON DELETE SET NULL;
ALTER TABLE public.disputes DROP CONSTRAINT IF EXISTS disputes_contribution_id_fkey;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_contribution_id_fkey
  FOREIGN KEY (contribution_id) REFERENCES public.contributions(id) ON DELETE SET NULL;
ALTER TABLE public.disputes DROP CONSTRAINT IF EXISTS disputes_payment_id_fkey;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.collectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES public.osusu_groups(id) ON DELETE CASCADE NOT NULL,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  added_by UUID REFERENCES public.profiles(id),
  collector_type TEXT NOT NULL DEFAULT 'member_collector',
  membership_id UUID REFERENCES public.group_memberships(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, profile_id)
);

ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS collector_display_name TEXT;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS collector_photo_url TEXT;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS collector_passcode TEXT;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE public.collectors ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.collectors DROP CONSTRAINT IF EXISTS collectors_passcode_format;
ALTER TABLE public.collectors
  ADD CONSTRAINT collectors_passcode_format
  CHECK (collector_passcode IS NULL OR collector_passcode ~ '^[0-9]{6}$');

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.osusu_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups_delete_creator" ON public.osusu_groups;
DROP POLICY IF EXISTS "groups_delete_creator_empty_or_super_admin" ON public.osusu_groups;
DROP POLICY IF EXISTS "groups_update_super_admin" ON public.osusu_groups;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own') THEN
    CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated
      USING (id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_upsert_own') THEN
    CREATE POLICY "profiles_upsert_own" ON public.profiles FOR INSERT TO authenticated
      WITH CHECK (id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own') THEN
    CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
      USING (id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'osusu_groups' AND policyname = 'groups_read_member_or_creator') THEN
    CREATE POLICY "groups_read_member_or_creator" ON public.osusu_groups FOR SELECT TO authenticated
      USING (
        created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.group_memberships gm
          WHERE gm.group_id = osusu_groups.id AND gm.user_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'osusu_groups' AND policyname = 'groups_insert_creator') THEN
    CREATE POLICY "groups_insert_creator" ON public.osusu_groups FOR INSERT TO authenticated
      WITH CHECK (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'osusu_groups' AND policyname = 'groups_update_creator') THEN
    CREATE POLICY "groups_update_creator" ON public.osusu_groups FOR UPDATE TO authenticated
      USING (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'osusu_groups' AND policyname = 'groups_update_super_admin') THEN
    CREATE POLICY "groups_update_super_admin" ON public.osusu_groups FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.role = 'super_admin'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'osusu_groups' AND policyname = 'groups_delete_creator_empty_or_super_admin') THEN
    CREATE POLICY "groups_delete_creator_empty_or_super_admin" ON public.osusu_groups FOR DELETE TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.role = 'super_admin'
        )
        OR (
          created_by = auth.uid()
          AND NOT EXISTS (
            SELECT 1 FROM public.group_memberships gm
            WHERE gm.group_id = osusu_groups.id
              AND COALESCE(gm.member_id, gm.user_id) <> auth.uid()
          )
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_memberships' AND policyname = 'group_memberships_read_own_or_group_creator') THEN
    CREATE POLICY "group_memberships_read_own_or_group_creator" ON public.group_memberships FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR member_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = group_memberships.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_memberships' AND policyname = 'group_memberships_insert_creator') THEN
    CREATE POLICY "group_memberships_insert_creator" ON public.group_memberships FOR INSERT TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        OR member_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = group_memberships.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contributions' AND policyname = 'contributions_read_member_or_group_creator') THEN
    CREATE POLICY "contributions_read_member_or_group_creator" ON public.contributions FOR SELECT TO authenticated
      USING (
        member_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = contributions.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contributions' AND policyname = 'contributions_insert_own') THEN
    CREATE POLICY "contributions_insert_own" ON public.contributions FOR INSERT TO authenticated
      WITH CHECK (member_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contributions' AND policyname = 'contributions_insert_group_collector') THEN
    CREATE POLICY "contributions_insert_group_collector" ON public.contributions FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = contributions.group_id AND g.created_by = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.collectors c
          WHERE c.group_id = contributions.group_id
            AND c.profile_id = auth.uid()
            AND c.is_active = TRUE
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contributions' AND policyname = 'contributions_update_own_or_group_creator') THEN
    CREATE POLICY "contributions_update_own_or_group_creator" ON public.contributions FOR UPDATE TO authenticated
      USING (
        member_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = contributions.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'savings_goals' AND policyname = 'savings_goals_manage_own') THEN
    CREATE POLICY "savings_goals_manage_own" ON public.savings_goals FOR ALL TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payments' AND policyname = 'payments_manage_own') THEN
    CREATE POLICY "payments_manage_own" ON public.payments FOR ALL TO authenticated
      USING (payer_id = auth.uid())
      WITH CHECK (payer_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'savings_transactions' AND policyname = 'savings_transactions_read_own') THEN
    CREATE POLICY "savings_transactions_read_own" ON public.savings_transactions FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.savings_goals sg
          WHERE sg.id = savings_transactions.savings_goal_id AND sg.owner_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'savings_transactions' AND policyname = 'savings_transactions_insert_own') THEN
    CREATE POLICY "savings_transactions_insert_own" ON public.savings_transactions FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.savings_goals sg
          WHERE sg.id = savings_transactions.savings_goal_id AND sg.owner_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'disputes' AND policyname = 'disputes_manage_own') THEN
    CREATE POLICY "disputes_manage_own" ON public.disputes FOR ALL TO authenticated
      USING (raised_by = auth.uid())
      WITH CHECK (raised_by = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_manage_own') THEN
    CREATE POLICY "notifications_manage_own" ON public.notifications FOR ALL TO authenticated
      USING (recipient_id = auth.uid())
      WITH CHECK (recipient_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'collectors' AND policyname = 'collectors_read_group_participants') THEN
    CREATE POLICY "collectors_read_group_participants" ON public.collectors FOR SELECT TO authenticated
      USING (
        profile_id = auth.uid()
        OR added_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = collectors.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'collectors' AND policyname = 'collectors_insert_group_creator') THEN
    CREATE POLICY "collectors_insert_group_creator" ON public.collectors FOR INSERT TO authenticated
      WITH CHECK (
        added_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = collectors.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'collectors' AND policyname = 'collectors_update_group_creator') THEN
    CREATE POLICY "collectors_update_group_creator" ON public.collectors FOR UPDATE TO authenticated
      USING (
        added_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = collectors.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'audit_logs_insert_own') THEN
    CREATE POLICY "audit_logs_insert_own" ON public.audit_logs FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.generate_contribution_number() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contribution_number IS NULL OR NEW.contribution_number = '' THEN
    NEW.contribution_number := 'OSU-' || to_char(NOW(), 'YYYYMMDD') || '-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_contribution_number ON public.osusu_groups;
CREATE TRIGGER trg_generate_contribution_number BEFORE INSERT ON public.osusu_groups
  FOR EACH ROW EXECUTE FUNCTION public.generate_contribution_number();

CREATE OR REPLACE FUNCTION public.generate_member_secret_code() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.member_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.member_id := NEW.user_id;
  END IF;
  IF NEW.user_id IS NULL AND NEW.member_id IS NOT NULL THEN
    NEW.user_id := NEW.member_id;
  END IF;
  IF NEW.member_secret_code IS NULL OR NEW.member_secret_code = '' THEN
    NEW.member_secret_code := lpad(floor(random() * 1000000)::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_member_secret_code ON public.group_memberships;
CREATE TRIGGER trg_generate_member_secret_code BEFORE INSERT OR UPDATE ON public.group_memberships
  FOR EACH ROW EXECUTE FUNCTION public.generate_member_secret_code();

CREATE INDEX IF NOT EXISTS idx_osusu_groups_created_by ON public.osusu_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_group_memberships_user_id ON public.group_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_group_memberships_member_id ON public.group_memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_group_id ON public.contributions(group_id);
CREATE INDEX IF NOT EXISTS idx_contributions_member_id ON public.contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer_id ON public.payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_savings_goals_owner_id ON public.savings_goals(owner_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON public.disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON public.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_collectors_group_id ON public.collectors(group_id);
CREATE INDEX IF NOT EXISTS idx_collectors_profile_id ON public.collectors(profile_id);
