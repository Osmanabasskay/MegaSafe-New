import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK_SIZE = 1800;
const CHUNK_META_PREFIX = 'miosusu:secure-json:chunks:';

async function deleteChunks(key: string): Promise<void> {
  const metaKey = CHUNK_META_PREFIX + key;
  const chunkCountRaw = await AsyncStorage.getItem(metaKey);
  if (chunkCountRaw != null) {
    const chunkCount = Number.parseInt(chunkCountRaw, 10);
    await Promise.all(
      Array.from({ length: Number.isFinite(chunkCount) ? chunkCount : 0 }, (_, i) =>
        SecureStore.deleteItemAsync(`${key}__chunk__${i}`).catch(() => {})
      )
    );
    await AsyncStorage.removeItem(metaKey);
  }
}

export const secureJsonStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);

    const metaKey = CHUNK_META_PREFIX + key;
    const chunkCountRaw = await AsyncStorage.getItem(metaKey);
    if (chunkCountRaw != null) {
      const chunkCount = Number.parseInt(chunkCountRaw, 10);
      if (!Number.isFinite(chunkCount) || chunkCount < 1) return null;
      const parts: string[] = [];
      for (let i = 0; i < chunkCount; i += 1) {
        const chunk = await SecureStore.getItemAsync(`${key}__chunk__${i}`);
        if (chunk == null) return null;
        parts.push(chunk);
      }
      return parts.join('');
    }

    return SecureStore.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
      return;
    }

    await deleteChunks(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    await SecureStore.deleteItemAsync(key).catch(() => {});
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}__chunk__${i}`, chunk))
    );
    await AsyncStorage.setItem(CHUNK_META_PREFIX + key, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem(key);
      return;
    }

    await deleteChunks(key);
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};
