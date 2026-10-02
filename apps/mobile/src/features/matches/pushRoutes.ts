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
 * The coaching routes and kinds are owned by `features/coaching/pushRoutes.ts`
 * (where a lesson tap opens: `lessonPushHref`); the guest lists here append
 * them after the open-match ones, in the JSON's order, so there is one copy.
 *
 * A guest tap opens whatever the staff status (a guest route is never a staff
 * one); `features/profile/pushSync.ts` asks `isGuestPushRoute` before its
 * staff check. PURE (vitest).
 */
import { LESSON_PUSH_KINDS, LESSON_PUSH_ROUTES } from '../coaching/pushRoutes';

/** The open-match routes: what `guestPushHref` opens. */
export const MATCH_PUSH_ROUTES = ['match', 'tickets'] as const;
export type MatchPushRoute = (typeof MATCH_PUSH_ROUTES)[number];

/** Every guest route, open matches then coaching (the JSON's order). */
export const GUEST_PUSH_ROUTES = [...MATCH_PUSH_ROUTES, ...LESSON_PUSH_ROUTES] as const;
export type GuestPushRoute = (typeof GUEST_PUSH_ROUTES)[number];

/** The open-match kinds: a foreground push of one of these refreshes `['match']`. */
export const MATCH_PUSH_KINDS = ['match_update', 'match_reminder', 'match_message'] as const;

/** The outbox kinds of the guest family, open matches then coaching (the JSON's order). */
export const GUEST_PUSH_KINDS = [...MATCH_PUSH_KINDS, ...LESSON_PUSH_KINDS] as const;
export type GuestPushKind = (typeof GUEST_PUSH_KINDS)[number];

const ROUTES: readonly string[] = GUEST_PUSH_ROUTES;
const KINDS: readonly string[] = GUEST_PUSH_KINDS;

export function isGuestPushRoute(value: unknown): value is GuestPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

export function isGuestPushKind(value: unknown): value is GuestPushKind {
  return typeof value === 'string' && KINDS.includes(value);
}

/** Where an open-match tap goes: a root-stack screen and its params, or the tabs. */
export type GuestHref =
  | { pathname: '/match/[id]'; params: { id: string } }
  | { pathname: '/tickets' }
  | { pathname: '/(tabs)' };

/**
 * The screen an open-match route opens (§4.21): `match` with an id its match,
 * the tabs without one; `tickets` the wallet (`tickets_refunded` carries no
 * id). A coaching route opens through `lessonPushHref`
 * (features/coaching/pushRoutes.ts).
 */
export function guestPushHref(route: MatchPushRoute, id: string | null | undefined): GuestHref {
  switch (route) {
    case 'match':
      return id ? { pathname: '/match/[id]', params: { id } } : { pathname: '/(tabs)' };
    case 'tickets':
      return { pathname: '/tickets' };
  }
}
