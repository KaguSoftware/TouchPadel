/**
 * The tournament push route and kind the phone knows (build contracts §1.10, S12). PURE (vitest).
 *
 * `send-push` puts `{kind, route, title_key, id?}` in a guest notification's data, as for open
 * matches and coaching; the one catalogue is
 * packages/db/supabase/functions/_shared/guest-push.json, which gains `tournament_update` (kinds)
 * and `tournament` (routes), each appended last, with the database lane's commit (S12). This
 * module owns that family (`features/matches/pushRoutes.ts`'s guest lists spread it after the
 * coaching one) and where a tournament tap opens; `__tests__/pushRoutes.test.ts` holds its lists
 * equal to the JSON's tournament entries.
 *
 * Two title keys ride the kind, `tournament.cancelled` and `tournament.promoted`; both open the
 * tournament (the id is the tournament's), and a foreground push refreshes `['tournament']`.
 */

export const TOURNAMENT_PUSH_ROUTES = ['tournament'] as const;
export type TournamentPushRoute = (typeof TOURNAMENT_PUSH_ROUTES)[number];

/** The tournament outbox kind: a foreground push of it refreshes `['tournament']`, nothing else. */
export const TOURNAMENT_PUSH_KINDS = ['tournament_update'] as const;
export type TournamentPushKind = (typeof TOURNAMENT_PUSH_KINDS)[number];

const ROUTES: readonly string[] = TOURNAMENT_PUSH_ROUTES;
const KINDS: readonly string[] = TOURNAMENT_PUSH_KINDS;

export function isTournamentPushRoute(value: unknown): value is TournamentPushRoute {
  return typeof value === 'string' && ROUTES.includes(value);
}

export function isTournamentPushKind(value: unknown): value is TournamentPushKind {
  return typeof value === 'string' && KINDS.includes(value);
}

export type TournamentHref =
  { pathname: '/tournament/[id]'; params: { id: string } } | { pathname: '/tournaments' };

/** `tournament` with an id opens that tournament; without one, the list. */
export function tournamentPushHref(id: string | null | undefined): TournamentHref {
  return id ? { pathname: '/tournament/[id]', params: { id } } : { pathname: '/tournaments' };
}
