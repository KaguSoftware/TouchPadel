/**
 * "Is there an intent waiting for sign-in?" asked once, for both stores
 * (docs/design/open-matches/guest.md §4.18): the slot a signed-out guest
 * tapped (`pendingSlot`) and the open-match intent (`pendingJoin`, a link, a
 * chip, a start or the list).
 *
 * Every check that used to read `pendingSlot` alone for this question reads
 * these instead: the signed-out gate's exemption (a signed-in guest stays on
 * the auth screen while its continuation routes), the sign-in and social
 * sign-in steps, the verify and welcome screens, and the complete-profile
 * save, which clears both. Both stores stay in memory only.
 */
import { useSyncExternalStore } from 'react';
import { clearPendingSlot, getPendingSlot, subscribePendingSlot } from './pendingSlot';
import { clearPendingJoin, getPendingJoin, subscribePendingJoin } from '../matches/pendingJoin';

export function hasPendingIntent(): boolean {
  return getPendingSlot() !== null || getPendingJoin() !== null;
}

function subscribe(listener: () => void): () => void {
  const offSlot = subscribePendingSlot(listener);
  const offJoin = subscribePendingJoin(listener);
  return () => {
    offSlot();
    offJoin();
  };
}

/** Render-time subscription: re-renders when either intent is set or cleared. */
export function usePendingIntent(): boolean {
  return useSyncExternalStore(subscribe, hasPendingIntent, hasPendingIntent);
}

/** Forget both intents (a complete-profile save that is not continuing, a payment that outranks them). */
export function clearPendingIntents(): void {
  clearPendingSlot();
  clearPendingJoin();
}
