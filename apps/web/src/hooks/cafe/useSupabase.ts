'use client';

import { useMemo } from 'react';
import { tryCreateBrowserSupabase, type BrowserSupabase } from '@/lib/supabase/client';

/**
 * ONE browser Supabase client for the whole cafe app (module scope, not a
 * ref): two clients would mint two anonymous users racing for the `sb-*`
 * cookie, and each would open its own realtime socket.
 *
 * Returns `null` when the public env vars are missing — every optional live
 * feature must degrade, never take down a server-rendered menu (the first
 * Vercel deploy shipped a blank page exactly this way).
 */
let cached: BrowserSupabase | null | undefined;

export function useSupabase(): BrowserSupabase | null {
  return useMemo(() => {
    if (cached === undefined) cached = tryCreateBrowserSupabase();
    return cached;
  }, []);
}

/** Test seam / hard reset (never called by the app). */
export function __resetSupabaseForTests(): void {
  cached = undefined;
}
