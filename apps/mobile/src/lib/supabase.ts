import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

// TODO: replace the throw with the shared zod env loader once @touch/core exposes one
// (design-arch.md §7: "env.ts zod-validated loader in each app fails fast").
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env',
  );
}

// Auth token storage in the device keychain/keystore (design-arch.md §4 auth table).
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * All business writes go through app.* RPCs (schema-qualified — mirrors
 * packages/db/tests/helpers.ts appRpc). The generated Database type covers the
 * `app` schema, so function names and args are typed.
 */
export const appSchema = () => supabase.schema('app');
