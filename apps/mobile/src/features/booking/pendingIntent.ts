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
 *
 * ONE INTENT AT A TIME (MB-04): the latest tap is the one the auth flow
 * continues, so every set site goes through `setOnlyPending*`, which clears
 * the other two stores. An old court slot or open-match intent can then never
 * outrank a newer lesson tap in `continueAfterAuth`.
 */
import { useSyncExternalStore } from 'react';
import {
  clearPendingSlot,
  getPendingSlot,
  setPendingSlot,
  subscribePendingSlot,
  type PendingSlot,
} from './pendingSlot';
import {
  clearPendingJoin,
  getPendingJoin,
  setPendingJoin,
  subscribePendingJoin,
  type PendingJoin,
} from '../matches/pendingJoin';
import {
  clearPendingLesson,
  getPendingLesson,
  setPendingLesson,
  subscribePendingLesson,
  type PendingLesson,
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

/** Keep this slot as the one intent (MB-04): the open-match and lesson intents go. */
export function setOnlyPendingSlot(slot: PendingSlot): void {
  clearPendingJoin();
  clearPendingLesson();
  setPendingSlot(slot);
}

/** Keep this open-match intent as the one intent (MB-04): the slot and lesson intents go. */
export function setOnlyPendingJoin(intent: PendingJoin): void {
  clearPendingSlot();
  clearPendingLesson();
  setPendingJoin(intent);
}

/** Keep this lesson intent as the one intent (MB-04): the slot and open-match intents go. */
export function setOnlyPendingLesson(intent: PendingLesson): void {
  clearPendingSlot();
  clearPendingJoin();
  setPendingLesson(intent);
}
