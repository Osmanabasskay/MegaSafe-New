-- ============================================================================
-- Super Admin Risk Dashboard — backend test suite (Phase 17)
--
-- Run as a single statement. The block performs inserts + assertions, then
-- RAISES a sentinel exception so the implicit transaction ROLLS BACK — no test
-- data persists in the production database.
--
--   * On success the statement "fails" with message  RISK_TESTS_PASSED
--   * On a failed assertion it fails with             FAIL: <which assertion>
-- ============================================================================
DO $$
DECLARE
  v_id   uuid;
  v_id2  uuid;
  v_rec  uuid := gen_random_uuid();
  v_json jsonb;
  v_int  integer;
  v_txt  text;
  v_bool boolean;
BEGIN
  -- 1. severity banding
  IF public.severity_for_score(10)  <> 'low'      THEN RAISE EXCEPTION 'FAIL: severity 10 should be low'; END IF;
  IF public.severity_for_score(30)  <> 'medium'   THEN RAISE EXCEPTION 'FAIL: severity 30 should be medium'; END IF;
  IF public.severity_for_score(55)  <> 'high'     THEN RAISE EXCEPTION 'FAIL: severity 55 should be high'; END IF;
  IF public.severity_for_score(75)  <> 'critical' THEN RAISE EXCEPTION 'FAIL: severity 75 should be critical'; END IF;
  IF public.severity_for_score(95)  <> 'extreme'  THEN RAISE EXCEPTION 'FAIL: severity 95 should be extreme'; END IF;

  -- 2. record_risk_event inserts with derived severity
  v_id := public.record_risk_event('duplicate_payment_reference', 85, 'test dup ref', NULL, NULL, 'mobile_money_transactions', v_rec, '{}'::jsonb);
  SELECT severity, risk_score INTO v_txt, v_int FROM public.risk_events WHERE id = v_id;
  IF v_txt <> 'extreme' THEN RAISE EXCEPTION 'FAIL: risk_event severity should be extreme for 85'; END IF;
  IF v_int <> 85 THEN RAISE EXCEPTION 'FAIL: risk_event score should be 85'; END IF;

  -- 3. dedupe within 1h returns same id
  v_id2 := public.record_risk_event('duplicate_payment_reference', 85, 'dup again', NULL, NULL, 'mobile_money_transactions', v_rec, '{}'::jsonb);
  IF v_id2 <> v_id THEN RAISE EXCEPTION 'FAIL: record_risk_event did not dedupe within window'; END IF;

  -- 4. live feed returns + severity filter works
  IF jsonb_array_length(public.get_live_risk_events()) < 1 THEN RAISE EXCEPTION 'FAIL: live feed empty after insert'; END IF;
  IF jsonb_array_length(public.get_live_risk_events('extreme')) < 1 THEN RAISE EXCEPTION 'FAIL: extreme filter excluded the event'; END IF;
  -- low filter must NOT include our extreme event
  SELECT count(*) INTO v_int FROM jsonb_array_elements(public.get_live_risk_events('low')) e WHERE (e->>'id') = v_id::text;
  IF v_int <> 0 THEN RAISE EXCEPTION 'FAIL: low filter wrongly returned an extreme event'; END IF;

  -- 5. reviewed/status update reflected in status filter
  UPDATE public.risk_events SET status = 'resolved' WHERE id = v_id;
  SELECT count(*) INTO v_int FROM jsonb_array_elements(public.get_live_risk_events(NULL, 'resolved')) e WHERE (e->>'id') = v_id::text;
  IF v_int <> 1 THEN RAISE EXCEPTION 'FAIL: resolved status filter did not return the event'; END IF;

  -- 6. admin action ledger + get_admin_activity
  PERFORM public.record_admin_action(NULL, 'suspend_user', 'profiles', NULL, NULL, 'test suspend', 'success', 45, NULL, NULL, '{}'::jsonb);
  SELECT count(*) INTO v_int FROM jsonb_array_elements(public.get_admin_activity()) e WHERE (e->>'action') = 'suspend_user';
  IF v_int < 1 THEN RAISE EXCEPTION 'FAIL: admin action not visible in get_admin_activity'; END IF;

  -- 7. security event writer
  v_id := public.log_security_event('login_failed', NULL, 'high', '1.2.3.4', 'agent', NULL, 'bad password', '{}'::jsonb);
  SELECT severity INTO v_txt FROM public.security_events WHERE id = v_id;
  IF v_txt <> 'high' THEN RAISE EXCEPTION 'FAIL: security event severity not stored'; END IF;

  -- 8. fraud case auto-number + update
  INSERT INTO public.fraud_cases (title, severity, status) VALUES ('test case', 'high', 'open') RETURNING id, case_number INTO v_id, v_txt;
  IF v_txt NOT LIKE 'FC-%' THEN RAISE EXCEPTION 'FAIL: fraud case_number not auto-generated'; END IF;
  UPDATE public.fraud_cases SET status = 'resolved', resolved_at = now() WHERE id = v_id;
  SELECT status INTO v_txt FROM public.fraud_cases WHERE id = v_id;
  IF v_txt <> 'resolved' THEN RAISE EXCEPTION 'FAIL: fraud case status update failed'; END IF;

  -- 9. overview metrics shape
  v_json := public.get_super_admin_overview_metrics();
  IF NOT (v_json ? 'users' AND v_json ? 'finance' AND v_json ? 'osusu' AND v_json ? 'security' AND v_json ? 'risk') THEN
    RAISE EXCEPTION 'FAIL: overview metrics missing a top-level section';
  END IF;

  -- 10. detection views are queryable
  PERFORM count(*) FROM public.v_same_phone_accounts;
  PERFORM count(*) FROM public.v_same_email_accounts;
  PERFORM count(*) FROM public.v_duplicate_kyc_documents;
  PERFORM count(*) FROM public.v_duplicate_payment_references;
  PERFORM count(*) FROM public.v_backdated_contributions;
  PERFORM count(*) FROM public.v_collector_risk;
  PERFORM count(*) FROM public.v_group_risk;

  -- 11. duplicate mobile-money reference is structurally prevented (UNIQUE)
  SELECT count(*) INTO v_int FROM pg_indexes
   WHERE schemaname='public' AND tablename='mobile_money_transactions' AND indexdef ILIKE '%UNIQUE%provider_reference%';
  IF v_int < 1 THEN RAISE EXCEPTION 'FAIL: no UNIQUE index on mobile_money_transactions.provider_reference'; END IF;

  -- 12. duplicate contribution period is structurally prevented (UNIQUE group/period/member)
  SELECT count(*) INTO v_int FROM pg_indexes
   WHERE schemaname='public' AND tablename='contribution_payments'
     AND indexdef ILIKE '%UNIQUE%group_id%period_id%member_id%';
  IF v_int < 1 THEN RAISE EXCEPTION 'FAIL: no UNIQUE index on contribution_payments(group,period,member)'; END IF;

  -- 13. anon cannot execute the super-admin RPC (role gating)
  SELECT has_function_privilege('anon', 'public.get_super_admin_overview_metrics()', 'EXECUTE') INTO v_bool;
  IF v_bool THEN RAISE EXCEPTION 'FAIL: anon has EXECUTE on get_super_admin_overview_metrics'; END IF;
  SELECT has_function_privilege('anon', 'public.get_user_risk_profile(uuid)', 'EXECUTE') INTO v_bool;
  IF v_bool THEN RAISE EXCEPTION 'FAIL: anon has EXECUTE on get_user_risk_profile'; END IF;

  -- 14. RLS enabled + policy present on risk_events
  SELECT relrowsecurity INTO v_bool FROM pg_class WHERE oid = 'public.risk_events'::regclass;
  IF NOT v_bool THEN RAISE EXCEPTION 'FAIL: RLS not enabled on risk_events'; END IF;
  SELECT count(*) INTO v_int FROM pg_policies WHERE schemaname='public' AND tablename='risk_events';
  IF v_int < 1 THEN RAISE EXCEPTION 'FAIL: no RLS policy on risk_events'; END IF;

  -- 15. rate_limit_log now has a policy (advisor fix)
  SELECT count(*) INTO v_int FROM pg_policies WHERE schemaname='public' AND tablename='rate_limit_log';
  IF v_int < 1 THEN RAISE EXCEPTION 'FAIL: rate_limit_log still has no RLS policy'; END IF;

  -- all good — force rollback of the test data via sentinel
  RAISE EXCEPTION 'RISK_TESTS_PASSED';
END $$;
