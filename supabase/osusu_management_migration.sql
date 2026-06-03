-- Osusu Management System Enhancements
-- Applied to live DB on 2026-05-10

-- 1. contribution_number on osusu_groups (unique, auto-generated)
ALTER TABLE public.osusu_groups ADD COLUMN IF NOT EXISTS contribution_number TEXT UNIQUE;
ALTER TABLE public.osusu_groups ADD COLUMN IF NOT EXISTS deletion_requested_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.osusu_groups ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

-- 2. member_secret_code on group_memberships (auto-generated 6-digit)
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
UPDATE public.group_memberships SET member_id = user_id WHERE member_id IS NULL AND user_id IS NOT NULL;
ALTER TABLE public.group_memberships ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS join_method TEXT;
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.group_memberships ADD COLUMN IF NOT EXISTS member_secret_code TEXT;

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

-- 3. Expand payout_order CHECK to include 'custom'
ALTER TABLE public.osusu_groups DROP CONSTRAINT IF EXISTS osusu_groups_payout_order_check;
ALTER TABLE public.osusu_groups ADD CONSTRAINT osusu_groups_payout_order_check
  CHECK (payout_order IN ('sequential', 'random', 'bidding', 'custom'));

-- 4. Prevent duplicate contributions (same member, same period, same group)
CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_no_duplicate
  ON public.contributions (group_id, member_id, contribution_period);

-- 5. App-compatible notification payload columns
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE public.notifications ALTER COLUMN message DROP NOT NULL;

-- 6. Make hard deletes safe for creator-owned groups and owner-owned savings goals
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

-- 7. Collector and audit tables used by contributor assignment/collection flows
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

ALTER TABLE public.collectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 5. Auto-generate contribution_number trigger
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

-- 6. Auto-generate member_secret_code trigger
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

-- 8. Policies required by the current mobile app contract
DROP POLICY IF EXISTS "groups_delete_creator" ON public.osusu_groups;
DROP POLICY IF EXISTS "groups_delete_creator_empty_or_super_admin" ON public.osusu_groups;
DROP POLICY IF EXISTS "groups_update_super_admin" ON public.osusu_groups;

DO $$
BEGIN
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

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_memberships' AND policyname = 'group_memberships_read_by_member_id_or_creator') THEN
    CREATE POLICY "group_memberships_read_by_member_id_or_creator" ON public.group_memberships FOR SELECT TO authenticated
      USING (
        member_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = group_memberships.group_id AND g.created_by = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_memberships' AND policyname = 'group_memberships_insert_by_member_id_or_creator') THEN
    CREATE POLICY "group_memberships_insert_by_member_id_or_creator" ON public.group_memberships FOR INSERT TO authenticated
      WITH CHECK (
        member_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.osusu_groups g
          WHERE g.id = group_memberships.group_id AND g.created_by = auth.uid()
        )
      );
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

CREATE INDEX IF NOT EXISTS idx_group_memberships_member_id ON public.group_memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_collectors_group_id ON public.collectors(group_id);
CREATE INDEX IF NOT EXISTS idx_collectors_profile_id ON public.collectors(profile_id);
