/**
 * `op.errors.<CODE>` for tournaments (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.9), spread at the end of `op.errors` in en.ts. Mirror every key in
 * opErrors.tournaments.ar.ts.
 *
 * Each code is in ERROR_CODE_KEYS (packages/i18n/src/errors.ts), which the operator, the phone and
 * the web all resolve through; the wording fits staff and guests alike, and a screen with words of
 * its own passes an override. The detail sentences (which publish check failed, which rounds rule,
 * why a score was refused) are the lane catalogs' (ws.tournaments.*, tournaments.*).
 */
export const opErrorsTournamentsEn = {
  TOURNAMENTS_OFF: 'Tournaments are switched off at this branch.',
  TOURNAMENT_NOT_FOUND: "That tournament can't be found. The list has been refreshed.",
  TOURNAMENT_PUBLISH_REFUSED: "This plan can't be published as a tournament yet.",
  TOURNAMENT_NOT_OPEN: "Registration for this tournament isn't open.",
  TOURNAMENT_FULL: 'This tournament and its waitlist are full.',
  TOURNAMENT_CATEGORY_MISMATCH: "This tournament's category doesn't match the player.",
  TOURNAMENT_ENTRY_NOT_FOUND: 'That entry changed. The list has been refreshed.',
  TOURNAMENT_ROUNDS_INVALID: "These rounds can't be saved. Refresh and generate them again.",
  TOURNAMENT_SCORE_REFUSED: "This score can't be saved. Check it and try again.",
  TOURNAMENT_UNDER_FILLED:
    'Fewer players than the minimum have registered. Add players or cancel the tournament.',
  TOURNAMENT_FINISH_REFUSED:
    "This tournament can't be finished yet. Score the round in play first, or cancel it if no round was played.",
  TOURNAMENT_NOT_PAYABLE: 'Nothing can be taken for this entry now.',
  TOURNAMENT_OWED_CHANGED: "What's owed for this entry just changed. Check the new amount.",
  TOURNAMENT_VIA_EVENTS:
    "This court is blocked for a tournament. Change it from the tournament's own screen.",
};
