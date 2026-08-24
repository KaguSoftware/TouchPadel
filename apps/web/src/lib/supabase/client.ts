import { createBrowserClient } from '@supabase/ssr';

// Browser-side Supabase client (anonymous cafe sessions use the standard sb-* cookie
// via @supabase/ssr — design-arch.md §4).
// TODO: type as createBrowserClient<Database> once @touch/db types.gen.ts is generated.
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // TODO: shared zod env loader (design-arch.md §7).
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createBrowserClient(url, anonKey);
}
