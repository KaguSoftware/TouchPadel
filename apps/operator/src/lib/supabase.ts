import { createClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

// Renderer Supabase client. In browser mode (this session) it carries both
// reads AND writes (writes go through app.* RPCs — see lib/appRpc.ts).
// TODO(Electron): durable writes move to the IPC bridge -> SQLite queue; this
// client then returns to READS + REALTIME only (design-arch.md §2.1).

// Local `supabase start` demo defaults so `vite dev` works with zero setup.
const LOCAL_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/**
 * Resolve the backend, refusing to guess in a build that is not a dev build.
 *
 * The demo fallback used to apply unconditionally. That is right for `vite dev`
 * and dangerous for the shipped installer: a packaged station with a missing
 * `VITE_SUPABASE_URL` would boot pointed at `127.0.0.1:54321`, find nothing
 * there, and present as "the network is down" — which, on a till whose whole
 * degraded story is about network loss, is the single most expensive way to be
 * wrong. Fail at startup instead, where the crash screen names the cause.
 */
export function resolveSupabaseEnv(
  env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string; DEV?: boolean },
): { url: string; anonKey: string } {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (url && anonKey) return { url, anonKey };

  if (env.DEV) return { url: url || LOCAL_URL, anonKey: anonKey || LOCAL_ANON_KEY };

  const missing = [!url && 'VITE_SUPABASE_URL', !anonKey && 'VITE_SUPABASE_ANON_KEY']
    .filter(Boolean)
    .join(' and ');
  throw new Error(
    `Operator build is missing ${missing}. This station has no backend configured — ` +
      'set it in the station environment and reinstall; do not run against the local demo stack.',
  );
}

const resolved = resolveSupabaseEnv(import.meta.env);

export const supabaseUrl = resolved.url;
export const supabaseAnonKey = resolved.anonKey;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
