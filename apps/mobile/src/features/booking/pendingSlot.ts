/**
 * The slot a signed-out guest tapped, carried across the auth flow
 * (design 2026-08-31: availability -> Welcome -> sign-in/up/verify -> hold).
 *
 * In-memory only, deliberately: it is a few-minutes-old intent, and persisting
 * it would revive stale taps after the RTL-flip restart or a cold start. If the
 * guest loses it by restarting mid-auth, the grid is one tap away.
 */
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

export function setPendingSlot(slot: PendingSlot): void {
  pending = slot;
}

export function getPendingSlot(): PendingSlot | null {
  return pending;
}

/** Returns the slot AND forgets it — the hold attempt consumes the intent. */
export function takePendingSlot(): PendingSlot | null {
  const p = pending;
  pending = null;
  return p;
}

export function clearPendingSlot(): void {
  pending = null;
}
