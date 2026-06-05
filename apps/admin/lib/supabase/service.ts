import 'server-only';
import { createClient } from '@supabase/supabase-js';

export const createServiceClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service-role not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
};
