'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** How often a tournament page in play asks the server again (its read caches 30 s). */
export const TOURNAMENT_REFRESH_MS = 30_000;

/**
 * The tournament page's one client island (`app/[locale]/events/[id]/page.tsx`, T-8): while the
 * tournament is in play, `router.refresh()` every 30 s re-renders the server page in place, so
 * new scores and standings show without a reload or a lost scroll position. Only while the tab
 * is visible: a phone left in a pocket asks nothing. The page mounts it only for `running`, so a
 * finished or cancelled tournament never polls. It renders nothing.
 */
export function RefreshWhileRunning({ everyMs = TOURNAMENT_REFRESH_MS }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
