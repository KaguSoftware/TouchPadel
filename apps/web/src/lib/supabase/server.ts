import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Server-side Supabase client for Server Components / Route Handlers.
// TODO: type as createServerClient<Database> once @touch/db types.gen.ts is generated.
export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // TODO: shared zod env loader (design-arch.md §7).
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
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
}
