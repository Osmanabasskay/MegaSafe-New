-- Phase 10 RLS Audit Template for MegaSafe
-- Run each section with role-specific JWT/session context.

-- 1) Profiles isolation
select id, email, role
from profiles
limit 20;

-- 2) Group membership leakage test
select group_id, member_id, role_in_group
from group_memberships
limit 50;

-- 3) Collector scope test
select id, group_id, member_id, amount, status
from contributions
limit 50;

-- 4) Dispute visibility
select id, group_id, raised_by, status
from disputes
limit 50;

-- 5) Audit log append-only verification
select id, user_id, action, table_name, created_at
from audit_logs
order by created_at desc
limit 50;
