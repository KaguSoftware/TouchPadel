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
 */
import { useSyncExternalStore } from 'react';

export interface PendingSlot {
  courtId: string;
  /** ISO instant. */
  startAt: string;
  durationMin: number;
  priceIqd: number | null;
  courtNameEn: string;
  courtNameAr: string;
}

let pending: PendingSlot | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPendingSlot(slot: PendingSlot): void {
  pending = slot;
  emit();
}

export function getPendingSlot(): PendingSlot | null {
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
