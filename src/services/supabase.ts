import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ── Env resolution ────────────────────────────────────────────────────────────

type Extra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function readSupabaseEnv(): { url: string; key: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

  const url = (
    extra.supabaseUrl ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    ''
  ).trim();

  const key = (
    extra.supabaseAnonKey ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ''
  ).trim();

  return { url, key };
}

const { url: supabaseUrl, key: supabaseAnonKey } = readSupabaseEnv();

function isValidSupabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);

    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.supabase.co')
    );
  } catch {
    return false;
  }
}

function isValidPublishableKey(value: string): boolean {
  const key = value.trim();

  return key.startsWith('sb_publishable_') && key.length > 30;
}

function assertNoPrivilegedKey(value: string): void {
  const key = value.trim().toLowerCase();

  if (
    key.startsWith('sb_secret_') ||
    key.includes('service_role') ||
    key.includes('supabase_service_role_key')
  ) {
    throw new Error(
      '[Mi Osusu] Invalid Supabase key. Never use a secret/service_role key in the mobile app.'
    );
  }
}

assertNoPrivilegedKey(supabaseAnonKey);

export const supabaseConfigured =
  isValidSupabaseUrl(supabaseUrl) &&
  isValidPublishableKey(supabaseAnonKey);

if (!supabaseConfigured) {
  const message =
    '[Mi Osusu] Supabase is not configured correctly. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your new sb_publishable_ key, then restart with: npx expo start -c';

  // Warn but do NOT throw — throwing at module load time cascades and breaks
  // every route that transitively imports this file (all "missing default export"
  // warnings are downstream of a module-level throw). The app handles the
  // unconfigured state via the supabaseConfigured export at the UI layer.
  console.error(message);
}

// ── Secure session storage ────────────────────────────────────────────────────
// expo-secure-store has a 2,048-byte value limit on iOS.
// Large values are chunked and stored in SecureStore.
// Chunk metadata is stored in AsyncStorage because it is not sensitive.
// AsyncStorage is used only on web, where SecureStore is unavailable.

const CHUNK_SIZE = 1800;
const CHUNK_META_PREFIX = 'miosusu:sec:chunks:';
const CHUNK_KEY_SEPARATOR = '__chunk__';

async function removeSecureChunks(key: string): Promise<void> {
  if (Platform.OS === 'web') return;

  const metaKey = CHUNK_META_PREFIX + key;
  const chunkCountRaw = await AsyncStorage.getItem(metaKey);

  if (chunkCountRaw == null) return;

  const chunkCount = Number.parseInt(chunkCountRaw, 10);

  if (Number.isFinite(chunkCount) && chunkCount > 0) {
    await Promise.all(
      Array.from({ length: chunkCount }, (_, index) =>
        SecureStore.deleteItemAsync(`${key}${CHUNK_KEY_SEPARATOR}${index}`).catch(
          () => {}
        )
      )
    );
  }

  await AsyncStorage.removeItem(metaKey);
}

const SecureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return await AsyncStorage.getItem(key);
      }

      const metaKey = CHUNK_META_PREFIX + key;
      const chunkCountRaw = await AsyncStorage.getItem(metaKey);

      if (chunkCountRaw != null) {
        const chunkCount = Number.parseInt(chunkCountRaw, 10);

        if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
          await AsyncStorage.removeItem(metaKey);
          return null;
        }

        const chunks: string[] = [];

        for (let index = 0; index < chunkCount; index += 1) {
          const chunk = await SecureStore.getItemAsync(
            `${key}${CHUNK_KEY_SEPARATOR}${index}`
          );

          if (chunk == null) {
            return null;
          }

          chunks.push(chunk);
        }

        return chunks.join('');
      }

      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(key, value);
        return;
      }

      if (value.length <= CHUNK_SIZE) {
        await removeSecureChunks(key);
        await SecureStore.setItemAsync(key, value);
        return;
      }

      const chunks: string[] = [];

      for (let index = 0; index < value.length; index += CHUNK_SIZE) {
        chunks.push(value.slice(index, index + CHUNK_SIZE));
      }

      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Ignore missing direct entry.
      }

      await removeSecureChunks(key);

      await Promise.all(
        chunks.map((chunk, index) =>
          SecureStore.setItemAsync(`${key}${CHUNK_KEY_SEPARATOR}${index}`, chunk)
        )
      );

      await AsyncStorage.setItem(CHUNK_META_PREFIX + key, String(chunks.length));
    } catch {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Ignore cleanup failure.
      }

      throw new Error('[Mi Osusu] Secure session storage is unavailable.');
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem(key);
        return;
      }

      await removeSecureChunks(key);

      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Ignore missing direct entry.
      }
    } catch {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Ignore cleanup failure.
      }
    }
  },
};

// ── Fetch with timeout ────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 20_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const signal = init?.signal ?? controller.signal;

  return fetch(input as RequestInfo, {
    ...init,
    signal,
  }).finally(() => clearTimeout(timeoutId));
}

// ── Supabase client ───────────────────────────────────────────────────────────
// Mobile/frontend must use only:
// EXPO_PUBLIC_SUPABASE_URL
// EXPO_PUBLIC_SUPABASE_ANON_KEY
//
// EXPO_PUBLIC_SUPABASE_ANON_KEY must contain your new Supabase publishable key:
// sb_publishable_...
//
// Never use these in the mobile app:
// sb_secret_...
// service_role
// SUPABASE_SERVICE_ROLE_KEY

// Use placeholder values when misconfigured so createClient doesn't throw at
// import time. All API calls will fail with network errors in this state, but
// the app can still render and show a proper error screen via supabaseConfigured.
const effectiveUrl = isValidSupabaseUrl(supabaseUrl)
  ? supabaseUrl
  : 'https://placeholder.supabase.co';
const effectiveKey = isValidPublishableKey(supabaseAnonKey)
  ? supabaseAnonKey
  : 'sb_publishable_placeholder_key_not_configured';

export const supabase = createClient(effectiveUrl, effectiveKey, {
  auth: {
    storage: SecureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    fetch: supabaseConfigured ? fetchWithTimeout : fetch,
  },
});