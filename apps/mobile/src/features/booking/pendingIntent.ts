/**
 * "Is there an intent waiting for sign-in?" asked once, for both stores
 * (docs/design/open-matches/guest.md §4.18): the slot a signed-out guest
 * tapped (`pendingSlot`), the open-match intent (`pendingJoin`, a link, a
 * chip, a start or the list) and the lesson intent (`pendingLesson`, a coach's
 * time or a class's Join; coaching guest.md §4.9.5).
 *
 * Every check that used to read `pendingSlot` alone for this question reads
 * these instead: the signed-out gate's exemption (a signed-in guest stays on
 * the auth screen while its continuation routes), the sign-in and social
 * sign-in steps, the verify and welcome screens, and the complete-profile
 * save, which clears them all. Every store stays in memory only.
 */
import { useSyncExternalStore } from 'react';
import { clearPendingSlot, getPendingSlot, subscribePendingSlot } from './pendingSlot';
import { clearPendingJoin, getPendingJoin, subscribePendingJoin } from '../matches/pendingJoin';
import {
  clearPendingLesson,
  getPendingLesson,
  subscribePendingLesson,
} from '../coaching/pendingLesson';

export function hasPendingIntent(): boolean {
  return getPendingSlot() !== null || getPendingJoin() !== null || getPendingLesson() !== null;
}

function subscribe(listener: () => void): () => void {
  const offSlot = subscribePendingSlot(listener);
  const offJoin = subscribePendingJoin(listener);
  const offLesson = subscribePendingLesson(listener);
  return () => {
    offSlot();
    offJoin();
    offLesson();
  };
}

/** Render-time subscription: re-renders when any intent is set or cleared. */
export function usePendingIntent(): boolean {
  return useSyncExternalStore(subscribe, hasPendingIntent, hasPendingIntent);
}

/** Forget every intent (a complete-profile save that is not continuing, a payment that outranks them). */
export function clearPendingIntents(): void {
  clearPendingSlot();
  clearPendingJoin();
  clearPendingLesson();
}
