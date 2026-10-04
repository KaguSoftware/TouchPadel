/**
 * `tournaments.common`: the words every tournament surface shares, on the phone, the website and
 * the operator (docs/design/tournaments/build-contracts-2026-10-03.md §1.3, §1.11): the formats,
 * the tournament and entry states and the play's units. Spread into tournaments.en.ts; mirror
 * every key in tournaments.common.ar.ts.
 *
 * The category pills reuse the open-match words (`matches.*.categoryOpen` / `categoryWomen` /
 * `categoryMen`, the phone's `CategoryPill`), so none are repeated here (TD-1).
 *
 * Scaffold stubs: a lane adds the keys its screens need under these groups, in this file pair
 * only when the word is shared, otherwise in its own fragment.
 */
export const tournamentsCommonEn = {
  common: {
    tournament: 'Tournament',
    format: {
      americano: 'Americano',
      mexicano: 'Mexicano',
    },
    status: {
      open: 'Registration open',
      closed: 'Registration closed',
      running: 'In play',
      finished: 'Finished',
      cancelled: 'Cancelled',
    },
    entryStatus: {
      registered: 'Registered',
      waitlisted: 'On the waitlist',
      withdrawn: 'Withdrawn',
      no_show: 'Did not show',
    },
    round: 'Round {round}',
    points: '{points} points',
    pointsTarget: 'Games to {points} points',
    entryFee: 'Entry fee',
    free: 'Free entry',
    prize: 'Prize',
    // A public player without a shown name (build contracts §1.8).
    player: 'Player {no}',
    formerPlayer: 'Former player',
  },
};
