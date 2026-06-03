import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Creates a Supabase client that inherits the caller's JWT (anon/authenticated). */
export function createUserClient(authHeader: string | null) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader ?? '' } },
      auth: { persistSession: false },
    }
  );
}

/** Creates a service-role client — ONLY use in Edge Functions, never send the key to clients. */
export function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

/** Extracts and verifies the caller's user from the JWT. Returns null if invalid. */
export async function getAuthUser(authHeader: string | null) {
  if (!authHeader) return null;
  const client = createUserClient(authHeader);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** Reads role from user_roles (authoritative) and checks profiles.is_active. */
export async function getDbRole(userId: string): Promise<string | null> {
  const svc = createServiceClient();
  const [roleResult, profileResult] = await Promise.all([
    svc.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    svc.from('profiles').select('is_active, kyc_verified, kyc_status').eq('id', userId).maybeSingle(),
  ]);
  if (!roleResult.data) return null;
  if (profileResult.data?.is_active === false) return null;
  return roleResult.data.role as string;
}

/** Returns true if the user's KYC is fully verified. */
export async function isKycVerified(userId: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('profiles')
    .select('kyc_verified')
    .eq('id', userId)
    .maybeSingle();
  return data?.kyc_verified === true;
}
