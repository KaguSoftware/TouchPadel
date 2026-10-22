/**
 * The leaderboard's query key family (migration 0364, Majed 2026-10-22).
 *
 * Nothing under `['ranks']` is written to disk (lib/queryClient.ts): the board carries other
 * players' names, and the guest's own page carries the names of the people they played, as a
 * match read does. Every write runs now or fails now.
 */
export type RanksMutation = 'report' | 'confirm';

export const ranksKeys = {
  /** Every leaderboard read and write. */
  all: ['ranks'] as const,
  /** app.ranks_board(): the public top of the board. */
  board: ['ranks', 'board'] as const,
  /** app.my_ranks(): the guest's own points, place, level, results and bookings to report. */
  mine: ['ranks', 'mine'] as const,
  /** app.ranks_find_player(username). */
  player: (username: string) => ['ranks', 'player', username] as const,
  /** Mutation keys: queryClient.ts gives this prefix "run now or fail now". */
  mutation: (name: RanksMutation) => ['ranks', 'mutation', name] as const,
};
