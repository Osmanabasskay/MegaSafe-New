-- Restrict mobile-money linking to signed-in users only.
-- The function also checks auth.uid(), but anon should not have EXECUTE.

REVOKE ALL ON FUNCTION public.link_payment_method(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_payment_method(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_payment_method(TEXT, TEXT) TO authenticated;
