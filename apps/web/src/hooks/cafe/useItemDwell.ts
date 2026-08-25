'use client';

import { useEffect, useRef } from 'react';
import type { MenuItem } from '@/lib/menu';

/**
 * Dwell timer for the item sheet (analytics `item_view_abandoned`).
 *
 * Starts when an item opens, and fires `onAbandon(item, dwellMs)` when the
 * sheet closes WITHOUT an add — call `markAdded()` from the CTA to suppress
 * it. Also fires on `visibilitychange → hidden` (the tab may never come back),
 * with `beacon: true` so the request survives the page going away; a beacon
 * send disarms the close-time report so the event is never doubled.
 */
export interface UseItemDwell {
  /** call from the ItemSheet CTA — an add is not an abandon */
  markAdded(): void;
}

export function useItemDwell(
  item: MenuItem | null,
  onAbandon: (item: MenuItem, dwellMs: number, opts: { beacon: boolean }) => void,
): UseItemDwell {
  const openedAt = useRef(0);
  const addedRef = useRef(false);
  const sentRef = useRef(false);
  const abandonRef = useRef(onAbandon);
  abandonRef.current = onAbandon;

  useEffect(() => {
    if (!item) return;
    openedAt.current = Date.now();
    addedRef.current = false;
    sentRef.current = false;
    const current = item;

    const report = (beacon: boolean) => {
      if (addedRef.current || sentRef.current) return;
      sentRef.current = true;
      abandonRef.current(current, Date.now() - openedAt.current, { beacon });
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') report(true);
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      report(false);
    };
  }, [item]);

  return {
    markAdded() {
      addedRef.current = true;
    },
  };
}
