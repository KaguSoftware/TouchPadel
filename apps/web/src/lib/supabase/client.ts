import { createBrowserClient } from '@supabase/ssr';
import { supabaseEnv } from './env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

// Browser-side Supabase client (anonymous cafe sessions use the standard sb-* cookie
// via @supabase/ssr — design-arch.md §4).
// The cast unifies on the hoisted supabase-js generic signature — @supabase/ssr's
// .d.ts was built against an older supabase-js and instantiates SupabaseClient
// with a different arity, which otherwise poisons every downstream query type.
export function createBrowserSupabase(): SupabaseClient<Database> {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient<Database>(url, anonKey) as unknown as SupabaseClient<Database>;
}

/**
 * Non-throwing variant for OPTIONAL client features (live refresh, presence).
 * A misconfigured deployment must degrade those features, never take down a
 * page whose server-rendered content already arrived (seen on the first
 * Vercel deploy: missing env vars nuked the whole menu page via MenuLive).
 */
export function tryCreateBrowserSupabase(): SupabaseClient<Database> | null {
  try {
    return createBrowserSupabase();
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[supabase] client disabled:', e);
    return null;
  }
}

/**
 * A client whose session lives in memory only — for /delete-account, where a
 * guest signs in with a password just to delete the account. It must NOT use
 * the shared sb-* cookie: that cookie is the café table session, and a
 * password sign-in written into it would replace a guest's open tab. Nothing
 * persists, nothing refreshes, and closing the page forgets the session.
 */
export function createEphemeralBrowserSupabase(): SupabaseClient<Database> {
  const { url, anonKey } = supabaseEnv();
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'tp-delete-account',
    },
  });
}

export type BrowserSupabase = SupabaseClient<Database>;
