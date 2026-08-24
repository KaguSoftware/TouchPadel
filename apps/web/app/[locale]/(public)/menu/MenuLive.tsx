'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/client';

/**
 * Invisible client island: re-renders the server menu the moment the till
 * edits it. 0022 broadcasts 'menu_changed' on topic 'menu' (private channel,
 * RLS open to anon+authenticated); the payload is only a cache-bust hint, so
 * we simply router.refresh() (debounced — bulk edits arrive in bursts).
 */
export function MenuLive() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;

    // broadcast-from-database topics are private; setAuth falls back to the
    // anon key for signed-out visitors (the 'menu' topic RLS allows anon).
    void supabase.realtime.setAuth();
    const channel = supabase
      .channel('menu', { config: { private: true } })
      .on('broadcast', { event: 'menu_changed' }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 400);
      })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
