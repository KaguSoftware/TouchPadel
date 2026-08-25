'use client';

import { useEffect, useState } from 'react';

/**
 * True once the guest has scrolled past the hero sentinel — the hero then
 * collapses (grid-template-rows 1fr → 0fr) and the pill rail goes compact.
 *
 * IntersectionObserver against the SCROLLER (not the viewport): the app shell
 * is `position: fixed` and only `.tp-app__scroll` moves.
 */
export function useHeroCollapse(
  scrollRef: React.RefObject<HTMLElement | null>,
  sentinelRef: React.RefObject<HTMLElement | null>,
): boolean {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!(entry?.isIntersecting ?? true)),
      { root: root ?? null, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRef, sentinelRef]);

  return collapsed;
}
