'use client';

import { useEffect, useState } from 'react';
import { appRpc } from '@/lib/appRpc';
import type { BrowserSupabase } from '@/lib/supabase/client';

/**
 * Degraded mode (0021): when the till has gone dark, guest ordering and the
 * bell are refused server-side, so the UI must say so BEFORE the guest builds
 * a basket. Polled every 30 s and PAUSED while the tab is hidden — a phone in
 * a pocket must not keep a request loop alive.
 */
const POLL_MS = 30_000;

export function useVenueMode(supabase: BrowserSupabase | null): { degraded: boolean } {
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      const { data } = await appRpc(supabase, 'venue_mode');
      if (!cancelled && data && typeof data === 'object') {
        setDegraded(Boolean((data as { degraded?: boolean }).degraded));
      }
    };
    const start = () => {
      if (timer) return;
      void check();
      timer = setInterval(check, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [supabase]);

  return { degraded };
}
