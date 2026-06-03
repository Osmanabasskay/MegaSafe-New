import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ── Env resolution ────────────────────────────────────────────────────────────
type Extra = { supabaseUrl?: string; supabaseAnonKey?: string };

function readSupabaseEnv(): { url: string; key: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
  const url = (extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  return { url, key };
}

const { url: supabaseUrl, key: supabaseAnonKey } = readSupabaseEnv();

/** True when URL/key look like a real Supabase project. */
export const supabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    supabaseAnonKey.length > 30
);

if (__DEV__ && !supabaseConfigured) {
  console.warn(
    '[Mi Osusu] Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart with: npx expo start -c'
  );
}

// ── Secure session storage ────────────────────────────────────────────────────
// expo-secure-store has a 2 048-byte value limit on iOS.
// We chunk large values and track how many chunks a key has in AsyncStorage
// (the chunk count metadata is not sensitive, so AsyncStorage is fine for it).

const CHUNK_SIZE = 1800; // bytes – stay well within the 2 048-byte iOS limit
const CHUNK_META_PREFIX = 'miosusu:sec:chunks:';

/**
 * Encrypt-at-rest storage adapter for Supabase auth session tokens.
 *
 * • Small values (< CHUNK_SIZE chars) → stored directly in SecureStore.
 * • Large values → split into CHUNK_SIZE slices, each stored in SecureStore;
 *   a chunk-count key in AsyncStorage (non-sensitive) tracks how many slices exist.
 *
 * Uses AsyncStorage only on web, where SecureStore is unavailable.
 */
const SecureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return AsyncStorage.getItem(key);

      // Check if value was stored in chunks
      const metaKey = CHUNK_META_PREFIX + key;
      const chunkCountRaw = await AsyncStorage.getItem(metaKey);
      if (chunkCountRaw != null) {
        const chunkCount = parseInt(chunkCountRaw, 10);
        const parts: string[] = [];
        for (let i = 0; i < chunkCount; i++) {
          const chunk = await SecureStore.getItemAsync(`${key}__chunk__${i}`);
          if (chunk == null) return null; // incomplete – treat as missing
          parts.push(chunk);
        }
        return parts.join('');
      }

      // Try direct (small) value
      return SecureStore.getItemAsync(key);
    } catch {
      // Fallback: return null so Supabase re-authenticates
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') { await AsyncStorage.setItem(key, value); return; }

      if (value.length <= CHUNK_SIZE) {
        // Store directly and make sure any previous chunked version is cleaned up
        await SecureStore.setItemAsync(key, value);
        await AsyncStorage.removeItem(CHUNK_META_PREFIX + key);
        return;
      }

      // Chunk the value
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      // Remove any pre-existing direct (small) entry first
      try { await SecureStore.deleteItemAsync(key); } catch { /* ignore */ }

      await Promise.all(
        chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}__chunk__${i}`, chunk))
      );
      await AsyncStorage.setItem(CHUNK_META_PREFIX + key, String(chunks.length));
    } catch {
      await AsyncStorage.removeItem(key).catch(() => {});
      throw new Error('Secure session storage is unavailable.');
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') { await AsyncStorage.removeItem(key); return; }

      const metaKey = CHUNK_META_PREFIX + key;
      const chunkCountRaw = await AsyncStorage.getItem(metaKey);
      if (chunkCountRaw != null) {
        const chunkCount = parseInt(chunkCountRaw, 10);
        await Promise.all(
          Array.from({ length: chunkCount }, (_, i) =>
            SecureStore.deleteItemAsync(`${key}__chunk__${i}`).catch(() => {})
          )
        );
        await AsyncStorage.removeItem(metaKey);
      }
      // Also try removing a direct entry (handles both code paths)
      try { await SecureStore.deleteItemAsync(key); } catch { /* ignore */ }
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

// ── Fetch with timeout ────────────────────────────────────────────────────────
// Prevents Supabase from hanging indefinitely on unreachable hosts, which
// would otherwise trigger its full retry sequence and flood the console.
const FETCH_TIMEOUT_MS = 20_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(input as RequestInfo, {
    ...init,
    signal: init?.signal ?? controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}

// ── Supabase client ───────────────────────────────────────────────────────────
const PLACEHOLDER_URL = 'https://disabled.invalid';
const PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder';

// When not configured, reject immediately instead of waiting 20 s to abort.
const noopFetch = () => Promise.reject(new Error('[Mi Osusu] Supabase is not configured.'));

export const supabase = createClient(
  supabaseConfigured ? supabaseUrl : PLACEHOLDER_URL,
  supabaseConfigured ? supabaseAnonKey : PLACEHOLDER_KEY,
  {
    auth: {
      storage: SecureSessionStorage,
      autoRefreshToken: supabaseConfigured,
      persistSession: supabaseConfigured,
      // Web Google OAuth redirect lands with tokens in the URL;
      // native uses WebBrowser + exchangeCodeForSession.
      detectSessionInUrl: supabaseConfigured && Platform.OS === 'web',
    },
    global: {
      fetch: supabaseConfigured ? fetchWithTimeout : noopFetch,
    },
  }
);
