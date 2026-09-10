'use client';

import { useSyncExternalStore } from 'react';

/**
 * `navigator.onLine` as a React store. The server snapshot is `true` so the
 * SSR HTML never ships an offline banner (hydration would flip it instantly
 * for a genuinely offline guest).
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = (): boolean =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
