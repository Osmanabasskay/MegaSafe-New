import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type Extra = { supabaseUrl?: string; supabaseAnonKey?: string };

function readSupabaseEnv(): { url: string; key: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
  const url = (extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  return { url, key };
}

const { url: supabaseUrl, key: supabaseAnonKey } = readSupabaseEnv();

/** Set when URL/key look like a real Supabase project (avoids silent use of placeholder hosts). */
export const supabaseConfigured =
  Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      supabaseUrl.startsWith('https://') &&
      supabaseAnonKey.length > 30
  );

if (__DEV__ && !supabaseConfigured) {
  console.warn(
    '[MegaSafe] Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart with: npx expo start -c'
  );
}

// Unused when supabaseConfigured is false; avoids hitting fake.supabase.co (DNS/network spam).
const PLACEHOLDER_URL = 'https://disabled.invalid';
const PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder';

export const supabase = createClient(
  supabaseConfigured ? supabaseUrl : PLACEHOLDER_URL,
  supabaseConfigured ? supabaseAnonKey : PLACEHOLDER_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: supabaseConfigured,
      persistSession: supabaseConfigured,
      // Web Google OAuth redirect lands with tokens in the URL; native uses WebBrowser + exchangeCodeForSession.
      detectSessionInUrl: supabaseConfigured && Platform.OS === 'web',
    },
  }
);
