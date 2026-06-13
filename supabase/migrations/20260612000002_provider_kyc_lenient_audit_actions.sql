-- Audit actions for the provider-KYC gate's new enforcement postures
-- (see supabase/functions/_shared/providerKyc.ts):
--   provider_kyc_unavailable_allowed — lenient mode allowed a top-up because
--     Monime's KYC check could not be completed (the exact error is captured in
--     audit_logs.new_data.error).
--   provider_kyc_skipped — the KYC pre-check is disabled (PROVIDER_KYC_ENFORCEMENT=off).
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_unavailable_allowed';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'provider_kyc_skipped';
