/**
 * The open-match intent a signed-out (or phone-less, or unverified) guest left behind,
 * carried across the auth flow (docs/design/open-matches/guest.md §4.18). A
 * copy of the `pendingSlot` store (features/booking/pendingSlot.ts): in
 * memory, subscribable, NEVER persisted (§4.23). It is a few-minutes-old
 * intent; a cold start forgets it, and the match is one tap away again.
 *
 * Signing in never joins by itself (GD-2): `continueAfterAuth`
 * (features/booking/usePostAuthContinue.ts) only opens the screen the intent
 * names, and the guest taps there, past the gender ask, the wallet and any
 * refusal. `features/booking/pendingIntent.ts` answers "is there an intent"
 * for this store and `pendingSlot` together.
 */
import { useSyncExternalStore } from 'react';

export type PendingJoin =
  /** An invite link opened signed out (m/[token]). */
  | { kind: 'link'; token: string }
  /** "Join the open match" on a Book-tab chip. */
  | { kind: 'slot'; venueId: string; startAt: string }
  /** "Start an open match" on a free time. */
  | {
      kind: 'start';
      venueId: string;
      courtId: string;
      startAt: string;
      durationMin: number;
      priceIqd: number | null;
    }
  /** The Book tab's "Open matches · Sign in" row. */
  | { kind: 'list'; venueId: string; date: string };

let pending: PendingJoin | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPendingJoin(intent: PendingJoin): void {
  pending = intent;
  emit();
}

export function getPendingJoin(): PendingJoin | null {
  return pending;
}

/** Forget the intent once its screen has been opened. */
export function clearPendingJoin(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

export function subscribePendingJoin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Render-time subscription: re-renders when the intent is set or cleared. */
export function usePendingJoin(): PendingJoin | null {
  return useSyncExternalStore(subscribePendingJoin, getPendingJoin, getPendingJoin);
}

/**
 * Does the intent end in a court booking? A start and a join (a chip's, an
 * invite's) do, so they pass the booking gate a slot does (owner, 2026-09-29:
 * a phone nobody has verified stops them as it stops a hold; `bookingGateHref`).
 * The list is browsing and opens as it is.
 */
export function intentBooksCourt(intent: PendingJoin): boolean {
  return intent.kind !== 'list';
}

/** Where an intent lands after sign-in: a root-stack route and its params. */
export type PendingJoinHref =
  | { pathname: '/m/[token]'; params: { token: string } }
  | { pathname: '/matches'; params: { at: string } | { date: string } }
  | {
      pathname: '/match-new';
      params: { venueId: string; courtId: string; startAt: string; durationMin: string; priceIqd?: string };
    };

/**
 * The screen an intent opens (§4.18): a link its invite, a chip the list at
 * that time, a start the new-match form (which re-quotes: the price is a
 * hint, DF-3), the entry row the list on that night.
 */
export function pendingJoinHref(intent: PendingJoin): PendingJoinHref {
  switch (intent.kind) {
    case 'link':
      return { pathname: '/m/[token]', params: { token: intent.token } };
    case 'slot':
      return { pathname: '/matches', params: { at: intent.startAt } };
    case 'list':
      return { pathname: '/matches', params: { date: intent.date } };
    case 'start':
      return {
        pathname: '/match-new',
        params: {
          venueId: intent.venueId,
          courtId: intent.courtId,
          startAt: intent.startAt,
          durationMin: String(intent.durationMin),
          ...(intent.priceIqd !== null ? { priceIqd: String(intent.priceIqd) } : {}),
        },
      };
  }
}
