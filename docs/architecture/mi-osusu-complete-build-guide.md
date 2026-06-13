Mi Osusu — Complete Technical Blueprint & Vibe Coding Guide
Digital Osusu Platform for Sierra Leone & Global Users
Version 1.0 | Expert Developer Specification

📋 TABLE OF CONTENTS
1. App Overview & Vision
2. Tech Stack
3. Architecture Overview
4. Database Schema (Supabase)
5. Roles & Permissions
6. All Screens & Features
7. Security Architecture
8. Payment Integration
9. Offline/Online Strategy
10. Supabase Setup Guide
11. Phase-by-Phase Build Plan (with Prompts)
12. Realistic Timeline
13. AI Coding Assistant Master Prompt


1. APP OVERVIEW & VISION

App Name: Mi Osusu  
Tagline: "Save Together, Grow Together"  
Primary Color: Orange `#F97316`  
Secondary Color: Blue `#1D4ED8`  
Currency: NLe (New Leone) — dynamically switches by country login  
Platforms: Mobile (iOS + Android via React Native / Expo) + Web dashboard  
Offline Capability: Full offline-first with sync queue  

Core Modules:
- Osusu Group Management
- Digital Collection (Collector Workflow)
- Mobile Money Payments (Self-service)
- Personal Savings Targets
- Ledger & Transparency Engine
- PDF Receipts & Reports
- Dispute Resolution System
- Super Admin Dashboard
- Group Creator Dashboard
- Multi-currency & Multi-country





2. TECH STACK

Frontend (Mobile App)
| Layer | Technology | Reason |
| Framework | React Native (Expo SDK 51+) | Cross-platform iOS & Android |
| Navigation | Expo Router (file-based) | Clean routing |
| State Management | Zustand + React Query | Server/client state split |
| UI Components | NativeWind (Tailwind for RN) + custom | Orange/Blue design system |
| Forms | React Hook Form + Zod | Type-safe validation |
| Offline Storage | MMKV + WatermelonDB | Fast encrypted local DB |
| PDF Generation | react-native-html-to-pdf | Receipts |
| Push Notifications | Expo Notifications + Firebase FCM | Real-time alerts |
| Biometrics | Expo Local Authentication | Fingerprint/Face ID login |
| Charts | Victory Native | Analytics |
| Camera | Expo Camera | ID verification, receipts |
| Maps | React Native Maps | Member address tracking |

### Frontend (Web Admin Dashboard)
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | Tailwind CSS + Shadcn/UI |
| Charts | Recharts |
| PDF | React-PDF |
| Auth | Supabase Auth SSR |

### Backend
| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend-as-a-Service | Supabase | Database, Auth, Storage, Realtime, Edge Functions |
| Database | PostgreSQL (via Supabase) | Relational, ACID-compliant |
| Auth | Supabase Auth + MFA | JWT + Row Level Security |
| Realtime | Supabase Realtime (websockets) | Live ledger updates |
| Edge Functions | Supabase Edge Functions (Deno) | Payment webhooks, business logic |
| Storage | Supabase Storage | Profile photos, KYC docs |
| Queue/Jobs | pg_cron + Supabase Edge Functions | Scheduled reminders |
| Email | Resend (via Edge Function) | Transactional emails |
| SMS | Africa's Talking or Twilio | Sierra Leone SMS delivery |

### Payment Integration
| Provider | Use Case |
|---------|---------|
| Monemi API | Primary — Sierra Leone mobile money aggregator |
| Orange Money API | Direct Sierra Leone integration |
| AfriMoney API | Direct Sierra Leone integration |
| QMoney API | Direct Sierra Leone integration |
| Flutterwave | International fallback + bank transfers |
| Stripe | Card payments for diaspora users |

### Security
| Layer | Tool |
|-------|------|
| Row Level Security | Supabase RLS (mandatory on all tables) |
| API Rate Limiting | Supabase + Upstash Redis |
| Input Validation | Zod schemas on both client and server |
| Secrets Management | Supabase Vault |
| Audit Logging | Custom audit_logs table + triggers |
| Encryption at Rest | Supabase default (AES-256) |
| Encryption in Transit | TLS 1.3 |
| 2FA | TOTP via Supabase Auth MFA |
| KYC | Manual doc upload + admin approval |
| Anti-fraud | Transaction velocity checks via Edge Function triggers |

### DevOps
| Tool | Purpose |
|------|---------|
| GitHub | Source control |
| GitHub Actions | CI/CD |
| EAS Build | Expo app builds |
| Sentry | Error tracking |
| PostHog | Analytics |
| Doppler | Environment variable management |


3. ARCHITECTURE OVERVIEW

┌─────────────────────────────────────────────────────┐
│                  CLIENT APPS                        │
│  ┌──────────────────┐    ┌────────────────────────┐ │
│  │  Mobile App      │    │  Web Admin Dashboard   │ │
│  │  (Expo/RN)       │    │  (Next.js)             │ │
│  └────────┬─────────┘    └──────────┬─────────────┘ │
└───────────┼──────────────────────────┼───────────────┘
            │  HTTPS/WSS               │
┌───────────┼──────────────────────────┼───────────────┐
│           │     SUPABASE             │               │
│  ┌────────▼──────────────────────────▼─────────────┐ │
│  │              API Gateway (PostgREST)             │ │
│  ├─────────────────────────────────────────────────┤ │
│  │  Auth (JWT+MFA) │ RLS │ Realtime │ Storage      │ │
│  ├─────────────────────────────────────────────────┤ │
│  │           PostgreSQL Database                   │ │
│  ├─────────────────────────────────────────────────┤ │
│  │         Edge Functions (Deno)                   │ │
│  └─────────────────────────────────────────────────┘ │
└───────────────────────────┬───────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────┐
│               EXTERNAL SERVICES                        │
│  Monemi │ Orange Money │ AfriMoney │ QMoney            │
│  Flutterwave │ Stripe │ Firebase FCM │ Resend │ AT    │
└────────────────────────────────────────────────────────┘

4. DATABASE SCHEMA (Supabase / PostgreSQL)

> Copy each block into the Supabase SQL Editor and run in order.

4.1 Extensions & Setup
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Set timezone
SET timezone = 'UTC';
```

4.2 ENUMS
```sql
CREATE TYPE user_role AS ENUM ('super_admin', 'group_creator', 'collector', 'member');
CREATE TYPE kyc_status AS ENUM ('pending', 'submitted', 'approved', 'rejected');
CREATE TYPE group_status AS ENUM ('active', 'paused', 'completed', 'disbanded');
CREATE TYPE membership_status AS ENUM ('pending', 'approved', 'rejected', 'suspended', 'left');
CREATE TYPE collector_type AS ENUM ('staff', 'member_collector');
CREATE TYPE contribution_status AS ENUM ('pending', 'collected', 'verified', 'disputed', 'refunded');
CREATE TYPE payment_method AS ENUM ('orange_money', 'afrimoney', 'qmoney', 'bank_transfer', 'card', 'cash_collected');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'reversed');
CREATE TYPE notification_type AS ENUM ('collection_reminder', 'payment_received', 'group_invite', 'join_approved', 'dispute_update', 'payout_scheduled', 'system_alert');
CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'escalated');
CREATE TYPE dispute_type AS ENUM ('missing_payment', 'collector_misconduct', 'incorrect_amount', 'unauthorized_transaction', 'other');
CREATE TYPE savings_goal_status AS ENUM ('active', 'completed', 'withdrawn', 'cancelled');
CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'payment', 'collection', 'dispute', 'approval');
CREATE TYPE currency_code AS ENUM ('NLe', 'USD', 'GBP', 'EUR', 'NGN', 'GHS', 'XOF', 'GMD');
CREATE TYPE payout_status AS ENUM ('scheduled', 'processing', 'paid', 'failed');
```

### 4.3 COUNTRIES & CURRENCIES
```sql
CREATE TABLE countries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code CHAR(2) UNIQUE NOT NULL,         -- ISO 3166-1 alpha-2
  phone_prefix TEXT NOT NULL,
  currency_code currency_code NOT NULL,
  currency_symbol TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

Seed key countries
INSERT INTO countries (name, code, phone_prefix, currency_code, currency_symbol) VALUES
  ('Sierra Leone', 'SL', '+232', 'NLe', 'NLe'),
  ('United States', 'US', '+1', 'USD', '$'),
  ('United Kingdom', 'GB', '+44', 'GBP', '£'),
  ('Nigeria', 'NG', '+234', 'NGN', '₦'),
  ('Ghana', 'GH', '+233', 'GHS', 'GH₵'),
  ('Gambia', 'GM', '+220', 'GMD', 'D');
```

4.4 USERS (extends Supabase auth.users)
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  date_of_birth DATE NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  
  -- Address
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state_province TEXT,
  postal_code TEXT,
  country_id UUID REFERENCES countries(id) NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Identity
  national_id_number TEXT,
  national_id_type TEXT CHECK (national_id_type IN ('national_id', 'passport', 'drivers_license', 'voters_card')),
  national_id_front_url TEXT,
  national_id_back_url TEXT,
  selfie_url TEXT,
  
  -- KYC
  kyc_status kyc_status DEFAULT 'pending',
  kyc_reviewed_by UUID REFERENCES profiles(id),
  kyc_reviewed_at TIMESTAMPTZ,
  kyc_rejection_reason TEXT,
  
  -- Role
  role user_role DEFAULT 'member',
  
  -- Settings
  preferred_currency currency_code DEFAULT 'NLe',
  preferred_language TEXT DEFAULT 'en',
  notification_enabled BOOLEAN DEFAULT TRUE,
  sms_enabled BOOLEAN DEFAULT TRUE,
  push_token TEXT,
  
  -- Security
  is_active BOOLEAN DEFAULT TRUE,
  is_verified BOOLEAN DEFAULT FALSE,
  two_fa_enabled BOOLEAN DEFAULT FALSE,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.5 GUARANTORS
```sql
CREATE TABLE guarantors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  guarantor_name TEXT NOT NULL,
  guarantor_phone TEXT NOT NULL,
  guarantor_email TEXT,
  guarantor_address TEXT NOT NULL,
  relationship TEXT NOT NULL,              -- e.g., 'colleague', 'relative', 'friend'
  national_id_number TEXT NOT NULL,
  national_id_type TEXT NOT NULL,
  id_document_url TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.6 OSUSU GROUPS
```sql
CREATE TABLE osusu_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  
  -- Creator
  created_by UUID REFERENCES profiles(id) NOT NULL,
  
  -- Financial config
  contribution_amount DECIMAL(12, 2) NOT NULL,
  currency_code currency_code DEFAULT 'NLe',
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  
  -- Group config
  max_members INT NOT NULL DEFAULT 20,
  current_member_count INT DEFAULT 0,
  total_cycles INT,                        -- how many rounds to run
  current_cycle INT DEFAULT 1,
  cycle_start_date DATE NOT NULL,
  
  -- Status
  status group_status DEFAULT 'active',
  is_public BOOLEAN DEFAULT TRUE,          -- discoverable in search
  join_requires_approval BOOLEAN DEFAULT TRUE,
  
  -- Rules stored as JSON
  rules JSONB DEFAULT '{}',
  
  -- Payout order type
  payout_order TEXT DEFAULT 'sequential' CHECK (payout_order IN ('sequential', 'random', 'bidding')),
  
  -- Security
  invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.7 GROUP MEMBERSHIPS
```sql
CREATE TABLE group_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES osusu_groups(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  
  -- Status
  status membership_status DEFAULT 'pending',
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Position in payout order
  payout_position INT,
  
  -- Join context
  join_method TEXT CHECK (join_method IN ('search', 'invite_code', 'invited_by_creator', 'phone_link')),
  invited_by UUID REFERENCES profiles(id),
  join_message TEXT,
  
  -- Guarantor confirmed for this group
  guarantor_id UUID REFERENCES guarantors(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(group_id, member_id)
);
```

### 4.8 COLLECTORS
```sql
CREATE TABLE collectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES osusu_groups(id) ON DELETE CASCADE NOT NULL,
  profile_id UUID REFERENCES profiles(id) NOT NULL,   -- the collector's user profile
  added_by UUID REFERENCES profiles(id) NOT NULL,     -- must be group creator
  collector_type collector_type NOT NULL,
  
  -- If member_collector, link to their membership
  membership_id UUID REFERENCES group_memberships(id),
  
  -- Security limits
  daily_collection_limit DECIMAL(12, 2),
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Performance tracking
  total_collected DECIMAL(12, 2) DEFAULT 0,
  total_verified DECIMAL(12, 2) DEFAULT 0,
  
  assigned_zones TEXT[],                  -- geographic zone(s) assigned to collector
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(group_id, profile_id)
);
```

### 4.9 CONTRIBUTIONS (THE LEDGER)
```sql
CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES osusu_groups(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES profiles(id) NOT NULL,        -- who contributed
  
  -- Amount
  amount DECIMAL(12, 2) NOT NULL,
  currency_code currency_code NOT NULL,
  
  -- Cycle info
  cycle_number INT NOT NULL,
  contribution_period TEXT NOT NULL,                       -- e.g., '2025-W01', '2025-01'
  due_date DATE,
  
  -- Collection method
  collected_by UUID REFERENCES collectors(id),            -- null if self-paid
  collection_method payment_method NOT NULL,
  
  -- Status
  status contribution_status DEFAULT 'pending',
  
  -- Payment ref (links to payments table)
  payment_id UUID,                                         -- FK added after payments table created
  
  -- Receipt
  receipt_number TEXT UNIQUE DEFAULT 'RCP-' || to_char(NOW(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::TEXT, 1, 6),
  receipt_url TEXT,
  
  -- Verification
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  verification_note TEXT,
  
  -- Geolocation of collection
  collection_latitude DECIMAL(10, 8),
  collection_longitude DECIMAL(11, 8),
  collection_address TEXT,
  
  -- Notes
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create receipt_number sequence for production
CREATE SEQUENCE receipt_seq START 1000;
```

### 4.10 PAYMENTS (FINANCIAL TRANSACTIONS)
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who
  payer_id UUID REFERENCES profiles(id) NOT NULL,
  recipient_group_id UUID REFERENCES osusu_groups(id),
  
  -- What
  amount DECIMAL(12, 2) NOT NULL,
  currency_code currency_code NOT NULL,
  payment_method payment_method NOT NULL,
  
  -- Provider details
  provider TEXT NOT NULL,                  -- 'orange_money', 'afrimoney', 'monemi', 'stripe', etc.
  provider_reference TEXT,                 -- provider's transaction ID
  provider_response JSONB,                 -- full provider response stored securely
  
  -- Status
  status payment_status DEFAULT 'pending',
  
  -- Links
  contribution_id UUID REFERENCES contributions(id),
  savings_goal_id UUID,                    -- FK added after savings table
  
  -- Webhook
  webhook_received_at TIMESTAMPTZ,
  webhook_payload JSONB,
  
  -- Reversal
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  reversal_reference TEXT,
  
  -- IP + device for fraud detection
  ip_address INET,
  device_fingerprint TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK back to contributions
ALTER TABLE contributions ADD CONSTRAINT contributions_payment_id_fkey 
  FOREIGN KEY (payment_id) REFERENCES payments(id);
```

### 4.11 PAYOUTS
```sql
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID REFERENCES osusu_groups(id) NOT NULL,
  recipient_id UUID REFERENCES profiles(id) NOT NULL,
  
  cycle_number INT NOT NULL,
  
  amount DECIMAL(12, 2) NOT NULL,
  currency_code currency_code NOT NULL,
  
  status payout_status DEFAULT 'scheduled',
  
  -- Payment details
  payment_method payment_method,
  provider_reference TEXT,
  
  scheduled_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  
  -- Approvals (creator must confirm)
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.12 SAVINGS GOALS
```sql
CREATE TABLE savings_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  
  title TEXT NOT NULL,                    -- 'Buy a car', 'School Fees', etc.
  description TEXT,
  category TEXT CHECK (category IN ('car', 'house', 'rent', 'school_fees', 'business', 'travel', 'emergency', 'other')),
  goal_emoji TEXT DEFAULT '🎯',
  
  target_amount DECIMAL(12, 2) NOT NULL,
  current_amount DECIMAL(12, 2) DEFAULT 0,
  currency_code currency_code NOT NULL,
  
  target_date DATE,
  
  status savings_goal_status DEFAULT 'active',
  
  -- Auto-save config
  auto_save_enabled BOOLEAN DEFAULT FALSE,
  auto_save_amount DECIMAL(12, 2),
  auto_save_frequency TEXT CHECK (auto_save_frequency IN ('daily', 'weekly', 'monthly')),
  auto_save_next_date DATE,
  
  completed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments ADD CONSTRAINT payments_savings_goal_id_fkey 
  FOREIGN KEY (savings_goal_id) REFERENCES savings_goals(id);
```

### 4.13 SAVINGS TRANSACTIONS
```sql
CREATE TABLE savings_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  savings_goal_id UUID REFERENCES savings_goals(id) ON DELETE CASCADE NOT NULL,
  payment_id UUID REFERENCES payments(id),
  amount DECIMAL(12, 2) NOT NULL,
  transaction_type TEXT CHECK (transaction_type IN ('deposit', 'withdrawal')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.14 DISPUTES
```sql
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Raised by
  raised_by UUID REFERENCES profiles(id) NOT NULL,
  
  -- Context
  group_id UUID REFERENCES osusu_groups(id),
  contribution_id UUID REFERENCES contributions(id),
  payment_id UUID REFERENCES payments(id),
  collector_id UUID REFERENCES collectors(id),
  
  dispute_type dispute_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_urls TEXT[],                   -- uploaded photos, screenshots
  
  status dispute_status DEFAULT 'open',
  
  -- Resolution
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  resolution_type TEXT CHECK (resolution_type IN ('refund_issued', 'no_action', 'collector_warned', 'collector_suspended', 'escalated_to_admin')),
  
  -- SLA tracking
  response_due_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '48 hours',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dispute_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispute_id UUID REFERENCES disputes(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id) NOT NULL,
  message TEXT NOT NULL,
  attachment_urls TEXT[],
  is_internal BOOLEAN DEFAULT FALSE,      -- internal admin notes
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.15 NOTIFICATIONS
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  sent_via TEXT[] DEFAULT '{}',           -- ['push', 'sms', 'email']
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.16 AUDIT LOGS
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  action audit_action NOT NULL,
  table_name TEXT,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Never allow updates or deletes on audit_logs
CREATE RULE no_update_audit_logs AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_logs AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
```

### 4.17 COLLECTOR DAILY SUMMARIES (Anti-fraud)
```sql
CREATE TABLE collector_daily_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collector_id UUID REFERENCES collectors(id) NOT NULL,
  group_id UUID REFERENCES osusu_groups(id) NOT NULL,
  summary_date DATE NOT NULL DEFAULT CURRENT_DATE,
  collections_count INT DEFAULT 0,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  verified_amount DECIMAL(12, 2) DEFAULT 0,
  unverified_amount DECIMAL(12, 2) DEFAULT 0,
  flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collector_id, summary_date)
);
```

### 4.18 LEDGER VIEW (Transparency Engine)
```sql
CREATE OR REPLACE VIEW group_ledger AS
SELECT 
  c.id,
  c.group_id,
  og.name AS group_name,
  c.member_id,
  p.first_name || ' ' || p.last_name AS member_name,
  c.amount,
  c.currency_code,
  c.cycle_number,
  c.contribution_period,
  c.due_date,
  c.status,
  c.collection_method,
  col_p.first_name || ' ' || col_p.last_name AS collected_by_name,
  c.receipt_number,
  c.created_at AS paid_at
FROM contributions c
JOIN osusu_groups og ON og.id = c.group_id
JOIN profiles p ON p.id = c.member_id
LEFT JOIN collectors col ON col.id = c.collected_by
LEFT JOIN profiles col_p ON col_p.id = col.profile_id
ORDER BY c.created_at DESC;
```

### 4.19 INDEXES (Performance)
```sql
-- Contributions
CREATE INDEX idx_contributions_group_id ON contributions(group_id);
CREATE INDEX idx_contributions_member_id ON contributions(member_id);
CREATE INDEX idx_contributions_status ON contributions(status);
CREATE INDEX idx_contributions_period ON contributions(contribution_period);

-- Group memberships
CREATE INDEX idx_memberships_group_id ON group_memberships(group_id);
CREATE INDEX idx_memberships_member_id ON group_memberships(member_id);
CREATE INDEX idx_memberships_status ON group_memberships(status);

-- Payments
CREATE INDEX idx_payments_payer_id ON payments(payer_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider_reference ON payments(provider_reference);

-- Notifications
CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_id, is_read) WHERE is_read = FALSE;

-- Audit logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

### 4.20 ROW LEVEL SECURITY (RLS)
```sql
-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE osusu_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE collectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Super admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- GROUP POLICIES
CREATE POLICY "Public groups are viewable by all" ON osusu_groups
  FOR SELECT USING (is_public = TRUE OR created_by = auth.uid());

CREATE POLICY "Only creator can update group" ON osusu_groups
  FOR UPDATE USING (created_by = auth.uid());

-- CONTRIBUTIONS POLICIES
CREATE POLICY "Members see own group contributions (ledger)" ON contributions
  FOR SELECT USING (
    member_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_memberships gm
      WHERE gm.group_id = contributions.group_id
      AND gm.member_id = auth.uid()
      AND gm.status = 'approved'
    ) OR
    EXISTS (SELECT 1 FROM osusu_groups og WHERE og.id = contributions.group_id AND og.created_by = auth.uid())
  );

-- NOTIFICATIONS POLICIES
CREATE POLICY "Users see own notifications" ON notifications
  FOR SELECT USING (recipient_id = auth.uid());

CREATE POLICY "Users update own notifications" ON notifications
  FOR UPDATE USING (recipient_id = auth.uid());

-- SAVINGS GOALS POLICIES
CREATE POLICY "Users manage own savings goals" ON savings_goals
  FOR ALL USING (owner_id = auth.uid());

-- PAYMENTS POLICIES
CREATE POLICY "Users see own payments" ON payments
  FOR SELECT USING (payer_id = auth.uid());

-- DISPUTES POLICIES
CREATE POLICY "Users see disputes they raised" ON disputes
  FOR SELECT USING (
    raised_by = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'group_creator'))
  );
```

### 4.21 DATABASE TRIGGERS (Business Logic Enforcement)
```sql
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON osusu_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_memberships_updated_at BEFORE UPDATE ON group_memberships FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_contributions_updated_at BEFORE UPDATE ON contributions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Update member count on group membership changes
CREATE OR REPLACE FUNCTION sync_member_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE osusu_groups 
  SET current_member_count = (
    SELECT COUNT(*) FROM group_memberships 
    WHERE group_id = COALESCE(NEW.group_id, OLD.group_id) 
    AND status = 'approved'
  )
  WHERE id = COALESCE(NEW.group_id, OLD.group_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_member_count 
AFTER INSERT OR UPDATE OR DELETE ON group_memberships 
FOR EACH ROW EXECUTE FUNCTION sync_member_count();

-- Update savings goal current_amount when payment arrives
CREATE OR REPLACE FUNCTION sync_savings_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.savings_goal_id IS NOT NULL AND NEW.status = 'completed' THEN
    UPDATE savings_goals 
    SET current_amount = current_amount + NEW.amount
    WHERE id = NEW.savings_goal_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_savings AFTER INSERT OR UPDATE ON payments 
FOR EACH ROW EXECUTE FUNCTION sync_savings_amount();

-- ANTI-FRAUD: Flag collector if daily limit exceeded
CREATE OR REPLACE FUNCTION check_collector_daily_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_collector RECORD;
  v_daily_total DECIMAL;
BEGIN
  -- Only for collector-initiated contributions
  IF NEW.collected_by IS NULL THEN RETURN NEW; END IF;
  
  SELECT * INTO v_collector FROM collectors WHERE id = NEW.collected_by;
  
  SELECT COALESCE(SUM(amount), 0) INTO v_daily_total 
  FROM contributions 
  WHERE collected_by = NEW.collected_by 
  AND DATE(created_at) = CURRENT_DATE;
  
  v_daily_total := v_daily_total + NEW.amount;
  
  IF v_collector.daily_collection_limit IS NOT NULL AND v_daily_total > v_collector.daily_collection_limit THEN
    RAISE EXCEPTION 'Daily collection limit exceeded for this collector';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_collector_limit 
BEFORE INSERT ON contributions 
FOR EACH ROW EXECUTE FUNCTION check_collector_daily_limit();

-- Audit trigger
CREATE OR REPLACE FUNCTION log_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs(user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    auth.uid(),
    TG_OP::audit_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) ELSE NULL END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_contributions AFTER INSERT OR UPDATE ON contributions FOR EACH ROW EXECUTE FUNCTION log_audit();
CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION log_audit();
CREATE TRIGGER trg_audit_collectors AFTER INSERT OR UPDATE OR DELETE ON collectors FOR EACH ROW EXECUTE FUNCTION log_audit();
```

---

## 5. ROLES & PERMISSIONS

| Action | Super Admin | Group Creator | Collector | Member |
|--------|------------|---------------|-----------|--------|
| View all users | ✅ | ❌ | ❌ | ❌ |
| Approve KYC | ✅ | ❌ | ❌ | ❌ |
| Create group | ✅ | ✅ | ❌ | ❌ |
| Edit own group | ✅ | ✅ (own) | ❌ | ❌ |
| Add members | ✅ | ✅ (own) | ❌ | ❌ |
| Approve join requests | ✅ | ✅ (own) | ❌ | ❌ |
| Add/remove collectors | ✅ | ✅ (own) | ❌ | ❌ |
| Record collection | ✅ | ✅ | ✅ (assigned) | ❌ |
| View group ledger | ✅ | ✅ | ✅ (own group) | ✅ (own group) |
| Pay via mobile money | ✅ | ✅ | ✅ | ✅ |
| View own contributions | ✅ | ✅ | ✅ | ✅ |
| Manage savings goals | ✅ | ✅ | ✅ | ✅ |
| Raise disputes | ✅ | ✅ | ✅ | ✅ |
| Resolve disputes | ✅ | ✅ (own group) | ❌ | ❌ |
| Approve payouts | ✅ | ✅ (own group) | ❌ | ❌ |
| View audit logs | ✅ | ❌ | ❌ | ❌ |
| Ban users | ✅ | ❌ | ❌ | ❌ |
| Platform-wide reports | ✅ | ❌ | ❌ | ❌ |

---

## 6. ALL SCREENS & FEATURES

### AUTH FLOW
- **Splash Screen** — Animated Mi Osusu logo
- **Onboarding (3 slides)** — What is Mi Osusu, How it works, Get started
- **Register Screen** — Name, Phone, Email, DOB, Password, Country picker
- **OTP Verification** — 6-digit code via SMS
- **KYC Screen** — National ID upload (front/back), Selfie, Address
- **Guarantor Setup Screen** — Add guarantor details + ID
- **Login Screen** — Phone/email + password
- **Forgot Password** — OTP-based reset
- **Biometric Login** — Enable fingerprint/face ID after first login
- **2FA Setup** — TOTP or SMS-based

### MEMBER HOME
- **Home Dashboard** — Active groups summary, next due date, savings snapshot, quick actions
- **Group Discovery** — Search public groups, filter by amount/frequency, request to join
- **My Groups Tab** — List of joined groups with status badges
- **Group Detail Screen** — Group info, members list, upcoming collection dates, rules
- **Live Ledger Screen** — All contributions (who, when, amount, method), filter by period/member
- **My Contributions Tab** — Personal payment history, receipt download, status
- **Pay Now Screen** — Select payment method (Orange/Afri/QMoney/Card/Bank), confirm amount
- **Payment Processing Screen** — Real-time status + animation
- **Payment Success/Fail Screen** — Receipt preview, download PDF, share
- **Profile Screen** — Personal info, KYC status, guarantor, security settings
- **Notification Center** — All push notifications, mark read
- **Savings Goals Tab** — List goals with progress rings
- **Create Savings Goal Screen** — Title, category, target amount, target date, auto-save config
- **Savings Goal Detail** — Progress bar, transaction history, deposit/withdraw
- **Settings Screen** — Language, currency, notifications, biometric, 2FA, help

COLLECTOR WORKFLOW
- **Collector Home** — Assigned members list for today, daily collection summary
- **Member Collection Screen** — Member info + address + map pin, amount to collect, record payment
- **Cash Collection Confirm Screen** — Enter amount, take photo of receipt if cash, geotagged
- **Collection History** — Past collections with verification status
- **Daily Summary Screen** — Total collected, pending verification, map of visits

### GROUP CREATOR DASHBOARD
- **My Groups List** — All created groups, quick stats
- **Create Group Screen** — Name, description, amount, frequency, max members, payout order, rules
- **Group Management Screen** — Members list, pending requests, collector assignments
- **Approve/Reject Member Screen** — View profile, guarantor info, accept or reject
- **Add Collector Screen** — Search registered users or members, set type, set daily limit
- **Group Ledger Screen** — Full contribution view, filter, export CSV/PDF
- **Contribution Verification Screen** — Review unverified collector entries, approve/flag
- **Payout Schedule Screen** — Who gets paid next, approve payout
- **Group Reports Screen** — Cycle summary, defaulters list, collection rate
- **Dispute Management Screen** — Open disputes in group, message thread, resolve
- **Group Settings Screen** — Edit group, pause, disband, invite link

### SUPER ADMIN DASHBOARD (Web)
- **Overview Dashboard** — Total users, total groups, total volume, active disputes
- **User Management** — View all users, KYC review queue, approve/reject/ban
- **KYC Review Screen** — ID document viewer, selfie, approve/reject with reason
- **Group Management** — All groups, flag/suspend suspicious groups
- **Contribution Monitor** — Platform-wide contribution feed, anomaly flags
- **Collector Monitor** — Per-collector performance, daily limit alerts, suspension
- **Dispute Centre** — All open disputes, assign reviewers, resolve, escalate
- **Payment Monitor** — Failed payments, reversals, suspicious transactions
- **Reports & Analytics** — Revenue, user growth, collection rates, country breakdown
- **Audit Log Viewer** — Full immutable audit trail
- **Platform Settings** — Currency configs, payment provider keys (masked), SMS templates
- **Notification Broadcast** — Send platform-wide notifications

### SHARED SCREENS
- **Receipt Screen** — PDF receipt with Mi Osusu branding, QR code, amount, parties, timestamp
- **Dispute Raise Screen** — Select type, describe, upload evidence photos
- **Dispute Thread Screen** — Chat-like messages with admin/creator/member
- **Help & FAQ Screen**
- **Terms & Privacy Screen**

---

## 7. SECURITY ARCHITECTURE

### 7.1 Authentication Security
```
- Supabase Auth with JWT (15-min access token, 7-day refresh)
- MFA: TOTP (Google Authenticator) or SMS OTP
- Biometric login via device secure enclave (Expo LocalAuthentication)
- Account lockout after 5 failed attempts (15-min lockout)
- Session invalidated on password change
- Device fingerprinting to detect new device logins (trigger notification)
```

### 7.2 API Security
```
- All endpoints protected by Supabase RLS (zero trust)
- Rate limiting: 100 requests/min per user (Redis-based)
- Input validation with Zod on Edge Functions
- SQL injection impossible via PostgREST parameterized queries
- CORS whitelist to app bundle IDs only
- API keys stored in Supabase Vault (never in client code)
```

### 7.3 Collector Anti-Fraud Controls
```
- Daily collection limit enforced at DB trigger level (cannot be bypassed at API level)
- Geolocation recorded on every collection (must be within member's registered address ±500m)
- Photo of collection required for cash transactions
- All collections remain 'unverified' until group creator/admin confirms
- Collector cannot initiate payouts — only group creator can
- Collector cannot see other collectors' collections
- Collector account auto-suspended if 3 disputes raised against them in 30 days
- Real-time alerts to group creator when collector approaches daily limit
- Collector cannot change/delete a recorded contribution — immutable once submitted
- Two-factor confirmation required for collections above a configurable threshold
```

### 7.4 Payment Security
```
- All payment webhooks verified by provider signature
- Idempotency keys on all payment requests (prevent double-charging)
- Pending payment expires after 10 minutes
- Amount on payment request must match group contribution amount ±0 (no manipulation)
- Payments only credited to group pool — never to individual collector wallet
- Payout requires both group creator approval + admin approval above threshold
- Reversal only possible by super admin with documented reason in audit log
```

### 7.5 Data Privacy
```
- National ID documents stored in Supabase private bucket (not public URLs)
- Signed URLs with 1-hour expiry for document access
- Phone numbers hashed in search indexes
- PII encrypted at rest using pgcrypto for sensitive fields
- User can request data deletion (right to erasure) — soft delete with 90-day hold
```

---

## 8. PAYMENT INTEGRATION

### Strategy
Use **Monemi** as the primary aggregator for Sierra Leone (Orange, Afri, QMoney under one API). Use **Flutterwave** for international users and bank transfers. Use **Stripe** for card payments from diaspora.

### Payment Flow
```
1. User selects "Pay Now" in app
2. App calls Edge Function: /functions/v1/initiate-payment
3. Edge Function validates: user is active member, amount is correct, no duplicate for this period
4. Edge Function calls Monemi/Flutterwave API to create payment intent
5. User completes payment on their phone (USSD/app/card)
6. Provider sends webhook to: /functions/v1/payment-webhook
7. Edge Function verifies webhook signature
8. Updates payment status → updates contribution status → sends push notification
9. PDF receipt generated and stored in Supabase Storage
10. Ledger updated in real time via Supabase Realtime
```

### Edge Function: initiate-payment (skeleton)
```typescript
// /supabase/functions/initiate-payment/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // 1. Authenticate user
  const authHeader = req.headers.get('Authorization')
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader?.replace('Bearer ', '') ?? ''
  )
  if (authError || !user) return new Response('Unauthorized', { status: 401 })
  
  const body = await req.json()
  const { group_id, payment_method, amount, phone_number } = body
  
  // 2. Validate inputs with Zod
  // ... validation ...
  
  // 3. Verify membership + amount match group config
  const { data: membership } = await supabase
    .from('group_memberships')
    .select('*, osusu_groups(*)')
    .eq('group_id', group_id)
    .eq('member_id', user.id)
    .eq('status', 'approved')
    .single()
  
  if (!membership) return new Response('Not a member', { status: 403 })
  
  // 4. Check no duplicate payment for this period
  // ... idempotency check ...
  
  // 5. Create pending payment record
  // 6. Call Monemi/Flutterwave API
  // 7. Return payment intent to client
})
```

---

## 9. OFFLINE/ONLINE STRATEGY

### WatermelonDB Local Schema mirrors critical tables:
- `contributions` (pending sync)
- `notifications` (cached)
- `group_memberships` (cached for offline view)
- `savings_goals` (full offline CRUD)

### Sync Logic:
```
Online:  All writes go directly to Supabase
Offline: Writes queue in WatermelonDB with 'pending_sync' flag
         Background sync runs every 30 seconds when connectivity restores
         Conflict resolution: server wins for financial data, client wins for preferences
```

### Collector Offline Mode:
- Collector can record cash collections offline
- Collection stored locally with timestamp and GPS
- On reconnect, syncs to server → triggers verification workflow
- Clear UI indicator: "Offline mode — collections will sync when connected"

---

## 10. SUPABASE PROJECT SETUP (Step by Step)

```bash
# 1. Create Supabase project at supabase.com
# 2. Install Supabase CLI
npm install -g supabase

# 3. Init local project
supabase init
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# 4. Run migrations in order
supabase db push

# 5. Set secrets in Supabase Vault (never in .env for prod)
supabase secrets set MONEMI_API_KEY=xxx
supabase secrets set FLUTTERWAVE_SECRET=xxx
supabase secrets set RESEND_API_KEY=xxx
supabase secrets set AFRICASTALKING_KEY=xxx

# 6. Deploy Edge Functions
supabase functions deploy initiate-payment
supabase functions deploy payment-webhook
supabase functions deploy send-notification
supabase functions deploy generate-receipt
```

---

## 11. PHASE-BY-PHASE BUILD PLAN

### ⚠️ CRITICAL RULES FOR EVERY PHASE:
- Every phase runs a security audit before moving to next
- RLS must be enabled and tested before any data is exposed
- All Edge Functions must have input validation (Zod)
- No hardcoded secrets — ever
- Every financial operation must have a corresponding audit log entry
- Run `supabase db lint` after every schema change

---




PHASE 1 — Foundation (Weeks 1–2)
Goal: Project scaffolding, auth, database, basic navigation

**Prompt for Claude Code:**
```
Build the Mi Osusu React Native Expo project with the following:

1. Initialize Expo project: `npx create-expo-app mi-osusu --template blank-typescript`
2. Install dependencies:
   - expo-router, nativewind, zustand, @tanstack/react-query
   - @supabase/supabase-js, react-native-mmkv
   - react-hook-form, zod, @hookform/resolvers
   - expo-local-authentication, expo-notifications
   - @react-native-async-storage/async-storage

3. Set up folder structure:
   /app (expo-router screens)
   /components (shared UI)
   /lib (supabase client, utils)
   /stores (zustand stores)
   /hooks (custom hooks)
   /types (TypeScript types)
   /constants (colors, fonts)

4. Configure NativeWind with orange (#F97316) as primary and blue (#1D4ED8) as secondary.

5. Create Supabase client in /lib/supabase.ts with:
   - Session persistence via MMKV
   - Auto token refresh
   - Typed client using Database types generated from schema

6. Build Auth screens:
   - Splash screen with animated Mi Osusu logo
   - 3-slide onboarding
   - Register screen with: first_name, last_name, phone, email, date_of_birth, password, country picker
   - OTP verification screen (6-digit, 60-second resend timer)
   - Login screen with biometric option after first login
   - Forgot password flow with OTP reset

7. Security requirements:
   - Passwords: min 8 chars, 1 uppercase, 1 number, 1 special char (enforce with Zod)
   - OTP expires in 5 minutes (enforced server-side in Edge Function)
   - Account lockout after 5 failed login attempts (track in profiles.failed_login_attempts)
   - Store session in MMKV encrypted storage, never AsyncStorage
   - On logout, clear all local storage

8. Create auth Zustand store with: user, session, isLoading, login, logout, refreshSession

9. Create protected route wrapper that redirects unauthenticated users to /auth/login

SECURITY AUDIT CHECKLIST FOR THIS PHASE:
- [ ] No API keys in client code
- [ ] Supabase URL and anon key in .env (not committed to git)
- [ ] .gitignore includes .env
- [ ] OTP is single-use and expires
- [ ] Password never logged or stored in plain text
- [ ] Session refresh works correctly
- [ ] Biometric auth only wraps session check, not password bypass
```

---

### PHASE 2 — KYC & Profile (Week 3)
**Prompt for Claude Code:**
```
Build the KYC and Profile setup flow for Mi Osusu:

1. KYC Screen flow (after registration):
   - Step 1: Upload National ID front photo (camera or gallery)
   - Step 2: Upload National ID back photo
   - Step 3: Take live selfie (camera only, no gallery — use Expo Camera)
   - Step 4: Address form (address_line1, city, country — pre-filled from registration)
   - Step 5: National ID type selector + ID number
   - Progress indicator (5 steps)
   - Store all documents in Supabase Storage bucket 'kyc-documents' (PRIVATE bucket)
   - Update profiles.kyc_status to 'submitted' on completion

2. Guarantor Screen:
   - Full guarantor form: name, phone, email, address, relationship, ID type, ID number
   - Upload guarantor ID document
   - Save to guarantors table

3. KYC Pending Screen:
   - Show status: pending/submitted/approved/rejected
   - If rejected: show rejection reason + Re-submit button
   - If approved: show green badge + allow full app access

4. Profile Edit Screen:
   - Edit personal info (not phone/email without re-verification)
   - Change profile photo
   - View KYC status
   - View guarantor info

5. Supabase Storage setup:
   - Create 'kyc-documents' bucket: private, no public access
   - Create 'avatars' bucket: public with size limit 2MB
   - RLS policy: users can only upload to their own folder (path: {user_id}/*)
   - Generate signed URLs (1-hour expiry) for KYC document access

SECURITY REQUIREMENTS:
- Selfie must be captured live (disable gallery picker for selfie step)
- KYC documents are never publicly accessible — only via signed URLs
- Only super_admin role can view KYC documents (enforced by RLS)
- Validate file type (only jpg/png/pdf) and size (max 5MB) before upload
- Show upload progress indicator
```

---

### PHASE 3 — Osusu Group Core (Weeks 4–5)
**Prompt for Claude Code:**
```
Build the complete Osusu Group Management system for Mi Osusu:

1. Create Group Screen:
   - Form fields: name, description, avatar upload, contribution_amount (NLe), 
     frequency (daily/weekly/biweekly/monthly), max_members, cycle_start_date, 
     total_cycles, payout_order (sequential/random), is_public toggle, join_requires_approval toggle
   - Custom rules text field
   - Validation: amount must be > 0, max_members 2-100, start date >= today
   - On submit: create group, set created_by to current user, generate invite_code
   - Redirect to Group Management screen

2. Group Discovery Screen:
   - Search bar to find public groups by name
   - Filter: by frequency, amount range, country
   - Group card shows: name, members count, amount, frequency, status badge
   - "Request to Join" button → opens join request modal
   - Join request modal: enter join_message, confirm guarantor is set up
   - Also allow join by invite code (text input)

3. Group Management Screen (for creator):
   - Tabs: Members | Collectors | Requests | Settings
   - Members tab: list approved members with payout position, contribution status badges
   - Requests tab: pending join requests with member profile preview, approve/reject buttons
   - View member profile before approving: KYC status, guarantor info, address
   - Collectors tab: list collectors, add/remove, set daily limit, enable/disable

4. Add Collector Screen:
   - Search registered users by phone or name
   - Toggle: 'Staff Collector' or 'Member Collector'
   - If member collector: must already be an approved member
   - Set daily_collection_limit (required)
   - Set assigned_zones (optional text tags)
   - Warning: "Collector can record cash collections on behalf of members. All collections require your verification."

5. Group Detail Screen (for members):
   - Group info header
   - My next due date countdown
   - Quick Pay button
   - Live Ledger tab (see Phase 4)
   - Members tab (names only, no personal data)
   - My contribution history tab

BUSINESS LOGIC TO ENFORCE:
- Creator cannot add themselves as collector
- Max 5 collectors per group
- Collector must have approved KYC before being added
- Member cannot join 2 groups with same contribution period if total would exceed 
  a configurable affordability limit (warn, not block)
- Group status auto-set to 'completed' when all cycles done (pg_cron job)
```

---

### PHASE 4 — Ledger & Contributions (Week 6)
**Prompt for Claude Code:**
```
Build the Ledger and Contribution system for Mi Osusu:

1. Live Ledger Screen:
   - Show all contributions for the group using group_ledger VIEW
   - Columns: Member Name, Amount, Period, Method, Collector (if collected), Status badge, Date
   - Filter: by period, by member, by status (paid/pending/disputed)
   - Real-time updates via Supabase Realtime subscription on contributions table
   - Color coding: green=verified, yellow=collected (unverified), red=pending, orange=disputed
   - Export button: export as PDF (group creator/admin only)

2. My Contributions Screen:
   - Personal contribution history
   - Filter by group, by period
   - Each item: amount, date, method, status, receipt download button
   - Upcoming due dates section

3. Contribution Status Logic:
   - 'pending': due date has arrived but not paid
   - 'collected': collector recorded it (cash) — awaiting verification
   - 'verified': payment confirmed by creator or payment webhook received
   - 'disputed': dispute raised on this contribution

4. Self-Pay Flow (digital payment):
   - User taps "Pay Now" for their group contribution
   - Select payment method: Orange Money / AfriMoney / QMoney / Bank Transfer / Card
   - Enter phone number (pre-filled) and confirm amount (pre-filled, cannot change)
   - Call Edge Function /initiate-payment
   - Show payment processing screen with animated spinner
   - Supabase Realtime listens for payment status update
   - On success: show receipt screen, update ledger instantly
   - On failure: show error with retry option

5. PDF Receipt Generation:
   - Triggered by Edge Function /generate-receipt after payment verified
   - Receipt contains: Mi Osusu logo, receipt number, date/time, payer name, 
     group name, amount, payment method, collector name (if applicable), QR code 
     (linking to receipt verification page), "Paid" stamp
   - Store in Supabase Storage 'receipts' bucket
   - Send download link via push notification + SMS

6. Collector Collection Recording:
   - Collector opens their home screen, sees list of assigned members for today
   - Tap member → Collection Screen
   - Screen shows: member name, address, map pin, amount due, last paid date
   - Select method: Cash or record Mobile Money (if member paid them directly)
   - If cash: enter amount, take photo of any physical receipt, geotagged automatically
   - Submit → creates contribution with status='collected', collected_by=collector.id
   - Real-time notification to group creator: "[Member] paid NLe X collected by [Collector]"
   - Real-time notification to member: "Your contribution of NLe X has been collected by [Collector]"

CRITICAL SECURITY:
- Payment amount is set by group config — client cannot override it
- Collector cannot mark a contribution as 'verified' (only creator/admin can)
- Contribution records are immutable once created — no UPDATE allowed for amount/member/group
- Duplicate prevention: check if contribution exists for this member/group/period before inserting
```

---

### PHASE 5 — Notifications & Receipts (Week 7)
**Prompt for Claude Code:**
```
Build the Notification System and PDF Receipt generation for Mi Osusu:

1. Push Notification Setup:
   - Configure Expo Notifications + Firebase FCM
   - On app launch: request permission, get push token, save to profiles.push_token
   - Handle foreground and background notifications
   - Notification types and their triggers:
     * collection_reminder: sent 1 day before due date (pg_cron job daily)
     * payment_received: instant when contribution status changes to 'verified'
     * group_invite: when approved to join a group
     * join_approved: when join request is approved
     * dispute_update: when dispute status changes
     * payout_scheduled: 3 days before payout
     * system_alert: from super admin

2. SMS Notifications (Africa's Talking):
   - Send SMS for critical events (payment received, collection recorded)
   - Template: "Mi Osusu: Your contribution of NLe {amount} to {group_name} has been recorded. Receipt: {receipt_number}"
   - Sierra Leone phone numbers use +232 prefix

3. Notification Center Screen:
   - List all notifications, grouped by date
   - Unread badge on tab icon
   - Tap notification → navigate to relevant screen
   - Mark all as read button
   - Real-time badge updates via Supabase Realtime

4. PDF Receipt Edge Function (/generate-receipt):
   - Accept: contribution_id
   - Verify caller is authorized (member, creator, or admin)
   - Fetch contribution + payment + member + group data
   - Generate HTML receipt with:
     * Mi Osusu logo (base64 embedded)
     * Orange/Blue brand colors
     * Receipt number: RCP-YYYYMMDD-XXXXXX
     * QR code with URL to verify receipt
     * All transaction details
   - Convert HTML to PDF using puppeteer (run in Edge Function)
   - Upload to Supabase Storage 'receipts/{group_id}/{contribution_id}.pdf'
   - Return signed URL
   - Send URL via push notification and SMS

5. Scheduled Jobs (pg_cron):
   - Daily 8am: send collection_reminder to members with pending contributions due tomorrow
   - Daily midnight: update collector_daily_summaries for previous day
   - Weekly: auto-calculate next payout member in sequence
```

---

### PHASE 6 — Savings Goals (Week 8)
**Prompt for Claude Code:**
```
Build the Personal Savings Goals module for Mi Osusu:

1. Savings Home Screen:
   - Grid of goal cards with:
     * Emoji + title
     * Progress ring (current/target amount)
     * Percentage complete
     * Days remaining to target date
     * Status badge
   - "New Goal" floating action button
   - Total saved across all goals (summary card at top)

2. Create Savings Goal Screen:
   - Title (text)
   - Category picker: car 🚗, house 🏠, rent 🏘, school fees 🎓, business 💼, travel ✈️, emergency 🆘, other 🎯
   - Target amount (NLe)
   - Target date picker
   - Auto-save toggle:
     * Amount per period
     * Frequency: daily/weekly/monthly
     * This schedules automatic mobile money deductions
   - Save → create savings_goals record

3. Goal Detail Screen:
   - Large progress ring with amount
   - "Add Money" button → payment flow (same as contribution pay flow)
   - "Withdraw" button (with confirmation: "Are you sure? This will stop your progress")
   - Transaction history list
   - Edit target amount/date
   - Delete goal (only if current_amount = 0)

4. Add Money to Goal Flow:
   - Select payment method
   - Enter amount (can be any amount up to target remaining)
   - Call /initiate-payment with savings_goal_id
   - On success: update goal progress, show receipt

5. Auto-save Job (pg_cron):
   - Run daily at configurable time
   - Find all goals with auto_save_enabled=true and auto_save_next_date=today
   - Initiate payment via stored payment method
   - Update auto_save_next_date to next interval
   - Send "Auto-save processed" notification

SECURITY:
- Withdrawals from savings go ONLY to the registered phone number's mobile money
- No withdrawal to third-party numbers
- Withdrawal requires OTP confirmation
- Savings funds never touch group pool funds (separate accounting)
```

---

### PHASE 7 — Disputes & Support (Week 9)
**Prompt for Claude Code:**
```
Build the Dispute Resolution System for Mi Osusu:

1. Raise Dispute Screen:
   - Accessible from: contribution history item, collector profile, payment history
   - Dispute type selector:
     * Missing payment (I paid but not recorded)
     * Incorrect amount (wrong amount recorded)
     * Collector misconduct (unprofessional behavior)
     * Unauthorized transaction (I didn't authorize this)
     * Other
   - Title text field
   - Description (min 50 chars)
   - Evidence upload: up to 5 photos/screenshots
   - Preview summary before submit
   - Submit → create dispute, send notification to group creator + admin

2. My Disputes Screen:
   - List of disputes raised by user
   - Status badges: Open (red), Under Review (orange), Resolved (green)
   - Tap → Dispute Thread Screen

3. Dispute Thread Screen:
   - Chat-like interface
   - Messages from: reporter, group creator, admin (labeled with role)
   - Input field to send new message
   - Attachment button for additional evidence
   - Status bar at top (changes as status updates)
   - Resolution summary card when resolved

4. Group Creator Dispute Management:
   - Tab in Group Management Screen
   - List of disputes in their group
   - Can: send messages, mark as resolved, escalate to admin
   - Resolution types: refund issued, no action, warn collector, suspend collector

5. Super Admin Dispute Center (Web Dashboard):
   - All disputes platform-wide
   - Filter by: status, type, group, date
   - Assign to admin reviewer
   - Full message thread
   - Actions: resolve, escalate, issue refund, suspend collector, ban user

6. Anti-Collector-Fraud in Dispute Flow:
   - If dispute_type = 'collector_misconduct' or 'unauthorized_transaction':
     * Auto-pause collector's ability to record new collections pending review
     * Notify group creator immediately
     * If 3rd dispute against same collector in 30 days: auto-suspend collector
   - All dispute actions logged in audit_logs
   - Collector is NOT notified of dispute details (only that a review is in progress)
     to prevent evidence tampering

SLA:
- All disputes get auto-response notification within 24 hours
- Resolution target: 5 business days
- pg_cron job escalates unresolved disputes at 5 days to super admin
```

---

### PHASE 8 — Group Creator Dashboard & Reports (Week 10)
**Prompt for Claude Code:**
```
Build the Group Creator dashboard and reporting system:

1. Creator Home Dashboard:
   - All my groups summary cards (total members, total collected this cycle, next payout)
   - Alert banners: pending approvals, unverified collections, open disputes
   - Quick actions: View Ledger, Manage Members, Add Collector

2. Group Reports Screen:
   - Date range picker
   - Cards: Total Collected, Collection Rate %, Defaulters Count, Average payment time
   - Chart: collection trend by week/month (Victory Native bar chart)
   - Defaulters list: members who haven't paid this period (with "Send Reminder" button)
   - Export report as PDF button

3. Contribution Verification Screen:
   - List of contributions with status='collected' (awaiting verification)
   - Each item: member name, amount, collector name, timestamp, geolocation, photo evidence
   - Approve or Dispute buttons
   - Batch approve button (approve all visible)
   - On approve: status changes to 'verified', member gets "Payment Verified" notification

4. Payout Management Screen:
   - Current cycle progress (e.g., "Cycle 3 of 12")
   - Who has paid, who hasn't (full ledger per this cycle)
   - Current payout recipient (based on payout_order)
   - "Initiate Payout" button → confirmation screen
   - Payout confirmation: recipient name, amount (sum of all verified contributions this cycle), method
   - On confirm: creates payout record (status=processing), calls Edge Function /initiate-payout
   - Payout requires: all cycle contributions collected or creator override with reason

5. Edge Function /initiate-payout:
   - Verify caller is group creator
   - Verify all business rules (cycle complete, no open disputes on this payout)
   - If amount > threshold (configurable, e.g., NLe 5000): require super admin co-approval
   - Call payment provider to transfer to recipient's registered number
   - Update payout status, send notifications to all members (transparency)

6. Member Reminder System:
   - "Send Reminder" on defaulter sends SMS + push: "Dear [Name], your NLe X contribution to [Group] is overdue. Please pay now."
   - Group creator can add a note to the reminder
   - Reminder is logged (can't harass members — max 2 reminders per period, enforced)
```

---

### PHASE 9 — Super Admin Web Dashboard (Weeks 11–12)
**Prompt for Claude Code:**
```
Build the Super Admin Web Dashboard using Next.js 15:

Create a Next.js app in /apps/admin with:

1. Setup:
   - Tailwind CSS + Shadcn/UI components
   - Supabase Auth SSR (@supabase/ssr)
   - Role check: only super_admin can access (middleware)
   - Recharts for analytics

2. Overview Dashboard /admin:
   - KPI cards: Total Users, Active Groups, Total Volume (NLe), Open Disputes
   - User growth chart (line chart, last 30 days)
   - Collection volume chart (bar chart, by day)
   - Recent activity feed (audit_logs latest 20)
   - Country breakdown pie chart

3. User Management /admin/users:
   - Searchable, filterable data table
   - Columns: Name, Phone, Country, KYC Status, Role, Created, Status
   - Click row → User Detail page
   - User Detail: full profile, KYC documents (signed URL viewer), guarantor info, 
     group memberships, payment history, audit log for this user
   - Actions: Approve KYC, Reject KYC (with reason), Suspend, Ban, Change Role

4. KYC Queue /admin/kyc:
   - Queue of users with kyc_status='submitted'
   - Show: ID front, ID back, selfie side by side
   - Approve / Reject buttons with rejection reason picker
   - Auto-update kyc_status + send notification to user

5. Group Monitor /admin/groups:
   - All groups table with: name, creator, members, volume, status, disputes
   - Suspicious flags (auto-calculated): groups with >50% dispute rate, sudden large payouts
   - Actions: Pause group, Force disband, View ledger

6. Collector Monitor /admin/collectors:
   - All collectors platform-wide
   - Metrics: daily collections, verification rate, dispute count
   - Red flag: collectors with >NLe X unverified for >24h
   - Suspend/Reinstate collector

7. Platform Reports /admin/reports:
   - Date range selector
   - Export: all data as CSV or PDF
   - Reports: Revenue by country, User retention, Group success rate, Payment provider breakdown

8. Audit Log Viewer /admin/audit:
   - Immutable log viewer (read-only table)
   - Filter by: user, action, table, date range
   - Cannot be deleted or modified (even by super admin)

SECURITY FOR ADMIN DASHBOARD:
- SSR auth check on every page via middleware
- Admin actions logged to audit_logs with admin's user_id
- No admin can act on their own account (self-action prevention)
- All KYC document access via signed URLs (never stored in session)
- Rate limit admin API: 500 requests/min
- IP allowlist for admin dashboard (configurable in Supabase)
```

---

### PHASE 10 — Testing, Security Hardening & Launch (Weeks 13–14)
**Prompt for Claude Code:**
```
Security Hardening and Pre-Launch Checklist for Mi Osusu:

1. Run full RLS audit:
   - Test every table as: anonymous user, member, collector, creator, admin
   - Verify no data leakage between groups
   - Verify collector cannot see other groups' data
   - Script: create test users for each role, run queries, assert expected results

2. Edge Function security review:
   - Verify all functions check auth before processing
   - Verify all inputs are validated with Zod
   - Verify no function uses service role key for user-facing operations
   - Verify webhook signatures are verified before processing

3. Payment integration testing:
   - Test full payment flow in sandbox mode
   - Test webhook processing with test events
   - Test idempotency (send same webhook twice → only one contribution created)
   - Test payment failure → contribution stays 'pending'
   - Test reversal flow

4. Anti-fraud tests:
   - Verify collector daily limit trigger fires correctly
   - Verify collector geolocation is captured on every collection
   - Verify contribution is immutable after creation (attempt update → verify blocked)
   - Verify duplicate contribution prevention (same member, group, period)

5. Performance:
   - Add database indexes for all foreign keys and filter columns (already scripted above)
   - Enable Supabase connection pooling (PgBouncer)
   - Set up Sentry error tracking in both apps
   - Set up PostHog analytics

6. Offline sync testing:
   - Turn off network on device, record collector collection → reconnect → verify sync
   - Verify UI shows "Offline mode" indicator clearly

7. EAS Build setup:
   - Configure app.json with bundle IDs, app name "Mi Osusu", orange splash screen
   - Build preview APK for testing: `eas build --profile preview --platform android`
   - Set up OTA updates with `eas update`

8. Legal pages:
   - Terms of Service screen
   - Privacy Policy screen
   - These must be accepted during onboarding (logged in audit_logs)

9. Penetration testing checklist:
   - SQL injection: attempt via all text inputs
   - Horizontal privilege escalation: attempt to access another user's data
   - Collector impersonation: attempt to record collection for group not assigned to
   - Payment amount manipulation: attempt to change amount in transit
   - JWT forgery: attempt with invalid/expired tokens

10. App Store prep:
    - Generate privacy manifest (iOS)
    - App icons (orange background, white safe/shield icon)
    - Screenshots for both platforms
    - App description emphasizing security and transparency
```

---


## 13. MASTER PROMPT FOR AI CODING ASSISTANT

> Use this as your system prompt or first message whenever you start a new Claude Code session on Mi Osusu.

```
You are the lead developer of Mi Osusu, a secure digital Osusu (rotating savings contribution) 
platform for Sierra Leone and global users. 

TECH STACK:
- Mobile: React Native (Expo SDK 51+), Expo Router, NativeWind, Zustand, React Query, WatermelonDB
- Backend: Supabase (PostgreSQL, Auth, Realtime, Edge Functions, Storage)
- Web Admin: Next.js 15 App Router, Tailwind CSS, Shadcn/UI
- Payments: Monemi API (primary), Flutterwave (international), Stripe (cards)

DESIGN SYSTEM:
- Primary Color: Orange #F97316
- Secondary Color: Blue #1D4ED8
- Currency: NLe (Sierra Leone New Leone) — switches by country
- Font: Use system fonts for performance

SECURITY IS THE #1 PRIORITY — for every feature you build:
1. Enable RLS on every new table
2. Validate all inputs with Zod (client + Edge Function)
3. Never expose service role key to client
4. Log all financial actions to audit_logs
5. Check for and prevent: SQL injection, privilege escalation, duplicate payments, 
   unauthorized data access, payment amount manipulation
6. Flag any security issue before writing the code and fix it proactively
7. Alert me if any code would create a silent bug, race condition, or security loophole
8. All collector actions are limited, geofenced, daily-limited, and immutable once submitted
9. No PII in logs or error messages

DATABASE: Supabase with the schema defined in the Mi Osusu blueprint (profiles, osusu_groups, 
group_memberships, collectors, contributions, payments, payouts, savings_goals, disputes, 
notifications, audit_logs, guarantors, countries tables — all with RLS)

ROLES: super_admin, group_creator, collector, member — enforced by RLS and business logic

OFFLINE: WatermelonDB for local storage, sync queue for offline collector recordings

CURRENT PHASE: [STATE WHICH PHASE YOU ARE ON]
CURRENT TASK: [STATE WHAT YOU ARE BUILDING]

Always write TypeScript with strict types. Always handle errors gracefully. 
Always show loading and error states in UI. Never leave a TODO without implementing it.
Test your own code for the security checklist before presenting it.




14. STITCH AI SCREEN WIREFRAME PROMPTS

Use these prompts in Stitch AI (or Figma AI) to generate wireframes before handing to Claude Code:

Screen: Mi Osusu Home Dashboard
Orange and blue mobile app. Show: greeting with user name, 3 group cards 
(showing group name, amount NLe, next due date, % collected), savings goal progress 
ring, quick action buttons (Pay Now, Ledger, Goals, Disputes). Clean card-based layout.

Screen: Live Group Ledger
Mobile table view. Columns: Member photo+name, Amount (NLe), Date, Method icon 
(phone/cash), Status badge (green=verified, yellow=collected, red=pending). 
Filter tabs at top. Real-time update indicator. Export PDF button top right.

Screen: Collector Home
Mobile list of members to collect from today. Each item: member photo, name, 
address, amount due (NLe), distance (0.3km), status dot. Map view toggle top right.
Orange FAB: Record Collection. Daily summary bar at bottom.

Screen: Create Osusu Group
Multi-step form. Step 1: Group name, description, photo upload. Step 2: Amount (NLe), 
frequency selector (pills), max members. Step 3: Payout order, start date, rules. 
Orange progress bar at top.

Screen: Savings Goal Detail
Large circular progress ring center (orange fill). Amount below: "NLe 1,200 of NLe 5,000".
Goal emoji + title. Target date with countdown. "Add Money" orange button. 
"Withdraw" blue outline button. Transaction list below.

Screen: Dispute Thread
Chat-like interface. Messages from: You (right, blue), Group Creator (left, orange), 
Admin (left, gray). Status bar at top: "Under Review". Resolution card at bottom if resolved.
Text input + attachment icon.
```

---

## 15. ENVIRONMENT VARIABLES TEMPLATE

```bash
# .env.local (NEVER commit to git)
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJxxxxx

# Edge Functions (set via supabase secrets set, not .env)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
MONEMI_API_KEY=xxxxx
MONEMI_BASE_URL=https://api.monemi.com/v1
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-xxxxx
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_API_KEY=xxxxx
RESEND_API_KEY=re_xxxxx
FIREBASE_SERVER_KEY=xxxxx

