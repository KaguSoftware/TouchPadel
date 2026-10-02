/**
 * The lesson intent a signed-out guest left behind, carried across the auth
 * flow (docs/design/coaching/guest.md §4.9.5). A copy of the `pendingJoin`
 * store (features/matches/pendingJoin.ts): in memory, subscribable, NEVER
 * persisted. A cold start forgets it, and the lesson is one tap away again.
 *
 * Signing in never books by itself (the open-matches GD-2 rule):
 * `continueAfterAuth` (features/booking/usePostAuthContinue.ts) only opens the
 * screen the intent names, and the guest taps there. `features/booking/
 * pendingIntent.ts` answers "is there an intent" for this store too.
 */
import { useSyncExternalStore } from 'react';

export type PendingLesson =
  /** A time tapped on a coach's grid. */
  | {
      kind: 'private';
      coachId: string;
      lessonTypeId: string;
      venueId: string;
      startAt: string;
      priceIqd: number | null;
    }
  /** "Join" on a group session or a course. */
  | { kind: 'class'; classKind: 'session' | 'course'; id: string };

/** How long an intent outlives the tap that made it. */
export const PENDING_LESSON_TTL_MS = 30 * 60_000;

let pending: PendingLesson | null = null;
let pendingAt = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPendingLesson(intent: PendingLesson): void {
  pending = intent;
  pendingAt = Date.now();
  emit();
}

export function getPendingLesson(): PendingLesson | null {
  if (pending !== null && Date.now() - pendingAt > PENDING_LESSON_TTL_MS) {
    // Stale: forget it without emitting (this runs during render).
    pending = null;
  }
  return pending;
}

/** Forget the intent once its screen has been opened (or the account signed out). */
export function clearPendingLesson(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

export function subscribePendingLesson(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Render-time subscription: re-renders when the intent is set or cleared. */
export function usePendingLesson(): PendingLesson | null {
  return useSyncExternalStore(subscribePendingLesson, getPendingLesson, getPendingLesson);
}

/** Where an intent lands after sign-in: a root-stack route and its params. */
export type PendingLessonHref =
  | {
      pathname: '/lesson-review';
      params: {
        coachId: string;
        lessonTypeId: string;
        venueId: string;
        startAt: string;
        priceIqd?: string;
      };
    }
  | { pathname: '/class/[id]'; params: { id: string; kind: 'session' | 'course' } };

/**
 * The screen an intent opens: a private time its review (which reads the
 * price again: the param is a hint), a class its offer.
 */
export function pendingLessonHref(intent: PendingLesson): PendingLessonHref {
  switch (intent.kind) {
    case 'private':
      return {
        pathname: '/lesson-review',
        params: {
          coachId: intent.coachId,
          lessonTypeId: intent.lessonTypeId,
          venueId: intent.venueId,
          startAt: intent.startAt,
          ...(intent.priceIqd !== null ? { priceIqd: String(intent.priceIqd) } : {}),
        },
      };
    case 'class':
      return { pathname: '/class/[id]', params: { id: intent.id, kind: intent.classKind } };
  }
}
