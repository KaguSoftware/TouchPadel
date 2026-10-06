/**
 * The slot a signed-out guest tapped, carried across the auth flow
 * (design 2026-08-31: availability -> Welcome -> sign-in/up/verify -> hold).
 *
 * In-memory only, deliberately: it is a few-minutes-old intent, and persisting
 * it would revive stale taps after the RTL-flip restart or a cold start. If the
 * guest loses it by restarting mid-auth, the grid is one tap away.
 *
 * It is a tiny SUBSCRIBABLE store, not a bare module variable. (auth)/_layout
 * reads it at render to decide whether a freshly signed-in user may stay in the
 * auth group while the post-auth hold is in flight; a plain `let` gave that
 * guard no way to re-evaluate, and `takePendingSlot()` cleared the intent
 * BEFORE the hold RPC settled — so the layout saw `session && !pending`, its
 * <Redirect href="/(tabs)"> won the race, and the guest landed on the tabs
 * instead of Review. The intent now lives until the hold settles.
 *
 * It lives at most PENDING_SLOT_TTL_MS (MB-04, the pendingJoin and
 * pendingLesson rule): a guest who backed out of sign-in is never steered by
 * an old tap later.
 */
import { useSyncExternalStore } from 'react';

/**
 * Which surface the slot was tapped on. Only the booking sheet over the court
 * on the Book tab is left — the standalone Availability screen was removed
 * (owner, 2026-09-26) — but Review still reads it to tell "the sheet is open
 * beneath me, pop back to it" from a way in that must ask for the sheet.
 */
export type SlotOrigin = 'sheet';

export interface PendingSlot {
  courtId: string;
  /** ISO instant. */
  startAt: string;
  durationMin: number;
  priceIqd: number | null;
  courtNameEn: string;
  courtNameAr: string;
  origin?: SlotOrigin;
}

/** How long an intent outlives the tap that made it. */
export const PENDING_SLOT_TTL_MS = 30 * 60_000;

let pending: PendingSlot | null = null;
let pendingAt = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPendingSlot(slot: PendingSlot): void {
  pending = slot;
  pendingAt = Date.now();
  emit();
}

export function getPendingSlot(): PendingSlot | null {
  if (pending !== null && Date.now() - pendingAt > PENDING_SLOT_TTL_MS) {
    // Stale: forget it without emitting (this runs during render).
    pending = null;
  }
  return pending;
}

/** Forget the intent — call once the hold attempt has SETTLED, not before. */
export function clearPendingSlot(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

export function subscribePendingSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Render-time subscription: re-renders when the intent is set or cleared. */
export function usePendingSlot(): PendingSlot | null {
  return useSyncExternalStore(subscribePendingSlot, getPendingSlot, getPendingSlot);
}
