/**
 * The guest coaching query key family (docs/design/coaching/guest.md §4.7.3;
 * build contracts §1.11).
 *
 * Split out of `hooks.ts`, like `matches/keys.ts`, because pure readers need
 * the exact arrays: `lib/queryClient.ts` keeps the whole `['coaching']` root
 * off the disk cache (a lesson read carries money, and a held enrolment read
 * back from disk would be shown before it is re-checked) and gives the
 * mutation prefix "run now or fail now" (CD-6); the query-defaults test pins
 * both. `hooks.ts` re-exports it, so the family is still found next to its
 * hooks.
 *
 * One `invalidateQueries({queryKey: coachingKeys.all})` after any lesson
 * write, a payment, or a lesson push refreshes every lesson read at once.
 * Coach mode's family is `coachKeys` (`['coach', …]`, features/coach).
 */
export type LessonScope = 'upcoming' | 'past' | 'cancelled';

/** A group session's or a course's offer (`class/[id]?kind=`). */
export type ClassKind = 'session' | 'course';

export type CoachingMutation = 'book' | 'join' | 'course' | 'cancel' | 'pay' | 'confirm';

export const coachingKeys = {
  /** Every guest lesson read and write: the persister's filter and the push refresh match on this root. */
  all: ['coaching'] as const,
  /** app.coaching_public for one branch (the coach list, the classes). */
  public: (venueId: string) => ['coaching', 'public', venueId] as const,
  /** app.coach_profile; `venueId` '' is the link's read with no branch (R17). */
  profile: (coachId: string, venueId: string) => ['coaching', 'profile', coachId, venueId] as const,
  /** Every coach grid: refreshed after a COACH_BUSY or NO_COURT_FREE refusal (§4.8.3). */
  slotsAll: ['coaching', 'slots'] as const,
  /** app.coach_slots over one 14-day window (stable for a day). */
  slots: (coachId: string, typeId: string, from: string, to: string) =>
    ['coaching', 'slots', coachId, typeId, from, to] as const,
  /** app.lesson_offer for a group session or a course. */
  offer: (kind: ClassKind, id: string) => ['coaching', 'offer', kind, id] as const,
  /** app.my_lessons. */
  mine: (scope: LessonScope) => ['coaching', 'mine', scope] as const,
  /** app.my_lesson for one enrolment. */
  one: (enrolmentId: string) => ['coaching', 'one', enrolmentId] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: CoachingMutation) => ['coaching', 'mutation', name] as const,
};
