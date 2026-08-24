import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseEnv } from './env';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

// Server-side Supabase client for Server Components / Route Handlers.
// (Return cast: see client.ts — unifies @supabase/ssr's older generic arity.)
export async function createServerSupabase(): Promise<SupabaseClient<Database>> {
  const { url, anonKey } = supabaseEnv();

  const cookieStore = await cookies();
  const client = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — safe to ignore; middleware refreshes sessions.
        }
      },
    },
  });
  return client as unknown as SupabaseClient<Database>;
}
