import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/services/**/*.ts'],
      exclude: ['src/services/supabase.ts', 'src/services/auth/**'],
    },
  },
  resolve: {
    alias: {
      'react-native': path.resolve('__tests__/mocks/react-native.ts'),
      'expo-secure-store': path.resolve('__tests__/mocks/expo-secure-store.ts'),
      '@react-native-async-storage/async-storage': path.resolve('__tests__/mocks/async-storage.ts'),
      'expo-constants': path.resolve('__tests__/mocks/expo-constants.ts'),
    },
  },
});
