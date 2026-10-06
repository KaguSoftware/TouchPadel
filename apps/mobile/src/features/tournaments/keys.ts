/**
 * The guest tournament query key family (plan §5.2; build contracts §1.11).
 *
 * Split out of `hooks.ts`, like `coaching/keys.ts`, because pure readers need the exact arrays:
 * `lib/queryClient.ts` keeps the whole `['tournament']` root off the disk cache (a detail carries
 * other players' names and the guest's own entry and money, and a "registered" read back from
 * disk would be shown before it is re-checked) and gives the mutation prefix "run now or fail
 * now"; `__tests__/queryDefaults.test.ts` pins both. `hooks.ts` re-exports it.
 *
 * One `invalidateQueries({queryKey: tournamentKeys.all})` after a register, a withdraw or a
 * tournament push refreshes the list and every open detail at once.
 */
export type TournamentMutation = 'register' | 'withdraw';

export const tournamentKeys = {
  /** Every tournament read and write: the persister's filter and the push refresh match on this root. */
  all: ['tournament'] as const,
  /** app.tournaments_public(null): every live branch's tournaments, with the guest's own entries. */
  list: ['tournament', 'list'] as const,
  /** app.tournament_public for one tournament. */
  one: (id: string) => ['tournament', 'one', id] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: TournamentMutation) => ['tournament', 'mutation', name] as const,
};
