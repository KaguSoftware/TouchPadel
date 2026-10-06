/**
 * The coach-mode query key family (docs/design/coaching/guest.md §4.7.3;
 * build contracts §1.11: `coachKeys`, `['coach', …]`).
 *
 * Split out of `hooks.ts`, like `matches/keys.ts`, because pure readers need
 * the exact arrays: `lib/queryClient.ts` keeps the whole `['coach']` root off
 * the disk cache (a roster carries students' phones, a statement carries the
 * coach's pay) and gives the mutation prefix "run now or fail now" (CD-6);
 * `__tests__/queryDefaults.test.ts` pins both.
 *
 * One `invalidateQueries({queryKey: coachKeys.all})` after any coach write, or
 * when a coach push lands, refreshes coach_me, the schedule, the hours, every
 * roster and the statements at once.
 */
export type CoachMutation =
  | 'accept'
  | 'hours'
  | 'time_off'
  | 'time_off_cancel'
  | 'book'
  | 'create_group'
  | 'create_course'
  | 'add_student'
  | 'remove_student'
  | 'attendance'
  | 'cancel_lesson'
  | 'cancel_course'
  | 'reschedule';

export const coachKeys = {
  /** Every coach-mode read and write: the persister's filter and the push refresh match on this root. */
  all: ['coach'] as const,
  /** app.coach_me for one account (R45): read on Profile, the staff hub and every coach-mode screen. */
  me: (uid: string) => ['coach', 'me', uid] as const,
  /** Every account's coach_me: what a NOT_A_COACH refusal re-reads, so RequireCoach re-gates. */
  meAny: ['coach', 'me'] as const,
  /** app.coach_schedule over one window. */
  schedule: (from: string, to: string) => ['coach', 'schedule', from, to] as const,
  /** Every schedule window: what a refused booking re-reads (MB-08). */
  scheduleAny: ['coach', 'schedule'] as const,
  /** app.coach_hours_mine. */
  hours: ['coach', 'hours'] as const,
  /** app.coach_lesson: one lesson's roster. */
  lesson: (lessonId: string) => ['coach', 'lesson', lessonId] as const,
  /**
   * app.coach_slots for the coach's own private type (the book screen's grid).
   * An addition to guest.md §4.7.3: the guest's `coachingKeys.slots` lives in
   * the guest feature, and coach mode keeps its reads under its own root.
   */
  slots: (coachId: string, typeId: string, from: string, to: string) =>
    ['coach', 'slots', coachId, typeId, from, to] as const,
  /** Every free-times read: what a refused booking re-reads, the start being taken (MB-08). */
  slotsAny: ['coach', 'slots'] as const,
  /** app.my_coach_statements; `month` is 'YYYY-MM-01', or `summary` for the summaries read. */
  statements: (month: string) => ['coach', 'statements', month] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: CoachMutation) => ['coach', 'mutation', name] as const,
};
