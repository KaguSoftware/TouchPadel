import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

// Browser-side Supabase client (anonymous cafe sessions use the standard sb-* cookie
// via @supabase/ssr — design-arch.md §4).
// The cast unifies on the hoisted supabase-js generic signature — @supabase/ssr's
// .d.ts was built against an older supabase-js and instantiates SupabaseClient
// with a different arity, which otherwise poisons every downstream query type.
export function createBrowserSupabase(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // TODO: shared zod env loader (design-arch.md §7).
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createBrowserClient<Database>(url, anonKey) as unknown as SupabaseClient<Database>;
}

export type BrowserSupabase = SupabaseClient<Database>;
