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

/** The local stack, in every form a person writes it. */
function isLocalBackend(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/i.test(url);
}

/**
 * Resolve the backend, refusing to guess in a build that is not a dev build.
 *
 * The demo fallback used to apply unconditionally. That is right for `vite dev`
 * and dangerous for the shipped installer: a packaged station with a missing
 * `VITE_SUPABASE_URL` would boot pointed at `127.0.0.1:54321`, find nothing
 * there, and present as "the network is down" — which, on a till whose whole
 * degraded story is about network loss, is the single most expensive way to be
 * wrong. Fail at startup instead, where the crash screen names the cause.
 *
 * The SECOND guard runs the other way, and it exists because the first one is
 * not the expensive mistake in practice. A dev build pointed at a real project
 * heartbeats as a till (lib/heartbeat.ts, `p_is_till: true`), and
 * `app.is_degraded()` is "a till row exists AND none is fresh" — so a developer
 * closing their laptop, or merely leaving the window behind another one, flips
 * the LIVE venue into degraded mode: every guest gets "Venue connection lost",
 * and holds are refused with DEGRADED_LOCKOUT. Measured on the hosted project
 * 2026-09-04: a dev operator beating every 10s went quiet for 48s while
 * backgrounded, and `is_degraded()` returned true for the tail of that window.
 * This has now happened at least three times (migration 0057, its 09-02 repeat,
 * and today), each time diagnosed from the guest side hours later.
 *
 * `.env.local` is gitignored, so a comment in it cannot survive a fresh clone.
 * The guard has to live here. Set `VITE_ALLOW_HOSTED=1` to opt in deliberately.
 */
export function resolveSupabaseEnv(
  env: {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_ANON_KEY?: string;
    VITE_ALLOW_HOSTED?: string;
    DEV?: boolean;
  },
): { url: string; anonKey: string } {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  if (env.DEV && url && !isLocalBackend(url) && env.VITE_ALLOW_HOSTED?.trim() !== '1') {
    throw new Error(
      `Refusing to run a dev build against ${url}. A dev operator heartbeats as a till, ` +
        'so leaving this window in the background flips that venue into degraded mode for ' +
        'every guest. Point VITE_SUPABASE_URL at the local stack, or set VITE_ALLOW_HOSTED=1 ' +
        'if you really mean to run against a hosted project — and keep the window in front.',
    );
  }

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
