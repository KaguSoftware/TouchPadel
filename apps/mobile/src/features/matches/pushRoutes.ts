/**
 * The guest push routes and kinds the phone knows (docs/design/open-matches/guest.md
 * §4.21; build contracts §1.9, R3).
 *
 * `send-push` puts `{kind, route, title_key, id?}` in a guest notification's
 * data. The one catalogue is
 * packages/db/supabase/functions/_shared/guest-push.json, which `send-push` and
 * `app.match_notify` read too; the phone cannot import it at runtime, so these
 * copies are compared with it in __tests__/pushRoutes.test.ts.
 *
 * A guest tap opens whatever the staff status (a guest route is never a staff
 * one); `features/profile/pushSync.ts` asks `isGuestPushRoute` before its
 * staff check. PURE (vitest).
 */

export const GUEST_PUSH_ROUTES = ['match', 'tickets'] as const;
export type GuestPushRoute = (typeof GUEST_PUSH_ROUTES)[number];

/** The outbox kinds of the guest family: a foreground push of one of these refreshes `['match']`. */
export const GUEST_PUSH_KINDS = ['match_update', 'match_reminder', 'match_message'] as const;
export type GuestPushKind = (typeof GUEST_PUSH_KINDS)[number];

const ROUTES: readonly string[] = GUEST_PUSH_ROUTES;
const KINDS: readonly string[] = GUEST_PUSH_KINDS;

export function isGuestPushRoute(value: unknown): value is GuestPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

export function isGuestPushKind(value: unknown): value is GuestPushKind {
  return typeof value === 'string' && KINDS.includes(value);
}

/** Where a guest tap goes: a root-stack screen and its params, or the tabs. */
export type GuestHref =
  | { pathname: '/match/[id]'; params: { id: string } }
  | { pathname: '/tickets' }
  | { pathname: '/(tabs)' };

/**
 * The screen a guest route opens (§4.21): `match` with an id its match, the
 * tabs without one; `tickets` the wallet (`tickets_refunded` carries no id).
 */
export function guestPushHref(route: GuestPushRoute, id: string | null | undefined): GuestHref {
  switch (route) {
    case 'match':
      return id ? { pathname: '/match/[id]', params: { id } } : { pathname: '/(tabs)' };
    case 'tickets':
      return { pathname: '/tickets' };
  }
}
