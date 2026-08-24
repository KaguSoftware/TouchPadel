/**
 * Single source for Supabase env access — used by client.ts / server.ts / static.ts.
 *
 * Accepts BOTH key names: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy JWT anon key)
 * and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the newer sb_publishable_* key —
 * a drop-in anon-key replacement). Deployments have shown up with either name;
 * both must work.
 *
 * NOTE: these MUST stay as literal `process.env.NEXT_PUBLIC_*` member
 * expressions — Next.js inlines them at build time for client bundles, so a
 * dynamic `process.env[name]` lookup would be undefined in the browser.
 */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
        '(or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)',
    );
  }
  return { url, anonKey };
}
