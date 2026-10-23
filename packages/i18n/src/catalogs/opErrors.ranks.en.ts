/**
 * `op.errors.<CODE>` for the players' leaderboard (0364 ranks_leaderboard), spread at the end of
 * `op.errors` in en.ts. Mirror every key in opErrors.ranks.ar.ts.
 *
 * Each code is in ERROR_CODE_KEYS (../errors.ts); the wording fits players and the desk alike.
 */
export const opErrorsRanksEn = {
  RANKS_OFF: 'The leaderboard is switched off right now.',
  RANKS_NOT_ELIGIBLE:
    "This booking can't be reported (it hasn't been played, or it's too long ago).",
  RANKS_PLAYER_NOT_FOUND: "We couldn't find one of the players. Check the usernames and try again.",
  RANKS_PLAYERS_INVALID: 'The same player is in this game twice. Check the four players.',
  RANKS_ALREADY_REPORTED: 'A result for this game has already been reported.',
  RANKS_NOT_YOURS: 'Only one of the two opponents can answer this result.',
  RANKS_RESULT_CLOSED: 'This result has already been confirmed, turned down or closed.',
};
