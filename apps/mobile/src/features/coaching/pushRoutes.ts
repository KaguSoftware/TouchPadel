/**
 * The coaching push routes and kinds the phone knows (docs/design/coaching/
 * guest.md §4.11; build contracts §1.9, R18, R40). PURE (vitest).
 *
 * `send-push` puts `{kind, route, title_key, id?}` in a guest notification's
 * data, as for open matches; the one catalogue is
 * packages/db/supabase/functions/_shared/guest-push.json. The coaching family
 * is appended to it by the 0271 commit (guest.md G1), which also appends these
 * routes and kinds to `features/matches/pushRoutes.ts`'s guest lists. This
 * module holds where each coaching route OPENS (G4: the lesson; G5: coach
 * mode), and `__tests__/pushRoutes.test.ts` holds its lists equal to the
 * JSON's coaching entries once the JSON carries them.
 *
 * A coaching tap opens whatever the staff status: a guest who coaches and a
 * staff member who coaches (C-27) both open them (`features/profile/pushSync.ts`
 * asks `isLessonPushRoute` before its staff check).
 */

export const LESSON_PUSH_ROUTES = ['lesson', 'coach_lesson', 'coach_statements'] as const;
export type LessonPushRoute = (typeof LESSON_PUSH_ROUTES)[number];

/** The coaching outbox kinds: a foreground push of one refreshes `['coaching']` and `['coach']`, never `['match']`. */
export const LESSON_PUSH_KINDS = ['lesson_update', 'lesson_reminder', 'coach_update'] as const;
export type LessonPushKind = (typeof LESSON_PUSH_KINDS)[number];

const ROUTES: readonly string[] = LESSON_PUSH_ROUTES;
const KINDS: readonly string[] = LESSON_PUSH_KINDS;

export function isLessonPushRoute(value: unknown): value is LessonPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

export function isLessonPushKind(value: unknown): value is LessonPushKind {
  return typeof value === 'string' && KINDS.includes(value);
}

/**
 * Where a coaching tap goes. The two coach-mode screens are the coach-mode
 * lane's routes; they are answered as data here (not literal pushes) so the
 * one place that names them is this table.
 */
export type LessonHref =
  | { pathname: '/lesson/[id]'; params: { id: string } }
  | { pathname: '/coach-mode-lesson'; params: { id: string } }
  | { pathname: '/coach-mode-statements' }
  | { pathname: '/(tabs)' };

/**
 * `lesson` with an id opens that enrolment (its confirm card first, when the
 * link is unconfirmed, §4.8.10); `coach_lesson` with an id the coach's
 * roster; `coach_statements` the statements; a route that needs an id and
 * came without one, the tabs.
 */
export function lessonPushHref(route: LessonPushRoute, id: string | null | undefined): LessonHref {
  switch (route) {
    case 'lesson':
      return id ? { pathname: '/lesson/[id]', params: { id } } : { pathname: '/(tabs)' };
    case 'coach_lesson':
      return id ? { pathname: '/coach-mode-lesson', params: { id } } : { pathname: '/(tabs)' };
    case 'coach_statements':
      return { pathname: '/coach-mode-statements' };
  }
}
