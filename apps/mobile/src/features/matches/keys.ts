/**
 * The open-match query key family (docs/design/open-matches/guest.md §4.23).
 *
 * Split out of `hooks.ts`, like `deposit/keys.ts`, because pure readers need
 * the exact arrays: `lib/queryClient.ts` keeps the whole `['match']` root off
 * the disk cache (a match read carries other players' names, and a wallet read
 * back from disk would be shown before it is re-checked) and gives the
 * mutation prefix "run now or fail now"; the query-defaults test pins both.
 * `hooks.ts` re-exports it, so the family is still found next to its hooks.
 *
 * The ticket wallet lives under the same root (`['match', 'tickets']`), so one
 * `invalidateQueries({queryKey: matchKeys.all})` after any match write, or when
 * a match push lands, refreshes the detail, both lists and the wallet at once.
 */
export type MatchScope = 'upcoming' | 'past';

export type MatchMutation =
  | 'start'
  | 'join'
  | 'request'
  | 'withdraw'
  | 'decide'
  | 'leave'
  | 'remove'
  | 'cancel'
  | 'message'
  | 'report'
  | 'block'
  | 'unblock'
  | 'gender'
  | 'buy';

export const matchKeys = {
  /** Every match read and write: the persister's filter and the push refresh match on this root. */
  all: ['match'] as const,
  /** app.match_slots: the Book tab's chips (signed in or out). */
  slots: (venueId: string, from: string, to: string) => ['match', 'slots', venueId, from, to] as const,
  /** app.open_matches: the Open matches list, and the Book tab's one-minute lookups. */
  open: (venueId: string, from: string, to: string) => ['match', 'open', venueId, from, to] as const,
  /** app.match_detail by id (with the link's token when the guest came from one). */
  one: (id: string, token = '') => ['match', 'one', id, token] as const,
  /** app.match_detail by token alone (m/[token], signed in). */
  byToken: (token: string) => ['match', 'token', token] as const,
  /** app.match_invite (m/[token], signed out). */
  invite: (token: string) => ['match', 'invite', token] as const,
  /** app.my_matches. */
  mine: (scope: MatchScope) => ['match', 'mine', scope] as const,
  /** app.match_quote for a start on one court and time. */
  quote: (venueId: string, courtId: string, startAt: string, min: number) =>
    ['match', 'quote', venueId, courtId, startAt, min] as const,
  /** app.my_tickets: the wallet. */
  tickets: ['match', 'tickets'] as const,
  /** app.my_match_blocks. */
  blocks: ['match', 'blocks'] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: MatchMutation) => ['match', 'mutation', name] as const,
};
