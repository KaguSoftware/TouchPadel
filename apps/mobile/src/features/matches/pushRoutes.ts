/**
 * The guest push routes and kinds the phone knows (docs/design/open-matches/guest.md
 * §4.21; build contracts §1.9, R3), and since coaching's outbox_lesson_kinds the lesson family
 * (docs/design/coaching/guest.md §4.11; coaching build contracts §1.9, R18).
 *
 * `send-push` puts `{kind, route, title_key, id?}` in a guest notification's
 * data. The one catalogue is
 * packages/db/supabase/functions/_shared/guest-push.json, which `send-push`,
 * `app.match_notify` and `app.lesson_notify` read too; the phone cannot import
 * it at runtime, so these copies are compared with it in
 * __tests__/pushRoutes.test.ts.
 *
 * A guest tap opens whatever the staff status (a guest route is never a staff
 * one); `features/profile/pushSync.ts` asks `isGuestPushRoute` before its
 * staff check. Until the lesson and coach-mode screens land (guest.md G4, G5),
 * the three coaching routes open the tabs. PURE (vitest).
 */

export const GUEST_PUSH_ROUTES = [
  'match',
  'tickets',
  'lesson',
  'coach_lesson',
  'coach_statements',
] as const;
export type GuestPushRoute = (typeof GUEST_PUSH_ROUTES)[number];

/** The outbox kinds of the guest family, open matches then coaching (the JSON's order). */
export const GUEST_PUSH_KINDS = [
  'match_update',
  'match_reminder',
  'match_message',
  'lesson_update',
  'lesson_reminder',
  'coach_update',
] as const;
export type GuestPushKind = (typeof GUEST_PUSH_KINDS)[number];

/** The coaching kinds of the guest family: a foreground push of one of these never refreshes `['match']`. */
export const LESSON_PUSH_KINDS = ['lesson_update', 'lesson_reminder', 'coach_update'] as const;
export type LessonPushKind = (typeof LESSON_PUSH_KINDS)[number];

const ROUTES: readonly string[] = GUEST_PUSH_ROUTES;
const KINDS: readonly string[] = GUEST_PUSH_KINDS;
const LESSON_KINDS: readonly string[] = LESSON_PUSH_KINDS;

export function isGuestPushRoute(value: unknown): value is GuestPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

export function isGuestPushKind(value: unknown): value is GuestPushKind {
  return typeof value === 'string' && KINDS.includes(value);
}

export function isLessonPushKind(value: unknown): value is LessonPushKind {
  return typeof value === 'string' && LESSON_KINDS.includes(value);
}

/** Where a guest tap goes: a root-stack screen and its params, or the tabs. */
export type GuestHref =
  | { pathname: '/match/[id]'; params: { id: string } }
  | { pathname: '/tickets' }
  | { pathname: '/(tabs)' };

/**
 * The screen a guest route opens (§4.21): `match` with an id its match, the
 * tabs without one; `tickets` the wallet (`tickets_refunded` carries no id).
 * The coaching routes (`lesson`, `coach_lesson`, `coach_statements`) open the
 * tabs until their screens exist (coaching guest.md §4.11, G4 and G5).
 */
export function guestPushHref(route: GuestPushRoute, id: string | null | undefined): GuestHref {
  switch (route) {
    case 'match':
      return id ? { pathname: '/match/[id]', params: { id } } : { pathname: '/(tabs)' };
    case 'tickets':
      return { pathname: '/tickets' };
    case 'lesson':
    case 'coach_lesson':
    case 'coach_statements':
      return { pathname: '/(tabs)' };
  }
}
