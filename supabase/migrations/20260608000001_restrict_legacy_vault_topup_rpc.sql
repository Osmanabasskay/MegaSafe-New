-- The mobile-money vault top-up flow now binds every top-up to a verified
-- linked payment method. Keep the legacy provider-method overload unavailable
-- to client roles so callers cannot bypass that linked-account ownership check.

REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_vault_topup_record(NUMERIC, TEXT, TEXT, TEXT) TO service_role;
