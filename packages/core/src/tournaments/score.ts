/**
 * One match's score (build contracts §1.6 score, TD-9). PURE.
 *
 * The desk enters each side's points; they must add up to the tournament's points target exactly.
 * A time-capped game is entered as the split the players agreed, a forfeit as 0 against the
 * target. `app.tournament_score` refuses anything else with `TOURNAMENT_SCORE_REFUSED` `invalid`;
 * relaxing the rule to `≤ target` is a one-line change here and in the RPC together.
 */

/** True when `a` and `b` are whole numbers ≥ 0 adding up to `target`. */
export function isValidScore(a: number, b: number, target: number): boolean {
  return (
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    Number.isInteger(target) &&
    target > 0 &&
    a >= 0 &&
    b >= 0 &&
    a + b === target
  );
}

/** The other side's points once one side is typed (`target − a`), or null when `a` cannot score. */
export function otherSide(a: number, target: number): number | null {
  if (!Number.isInteger(a) || !Number.isInteger(target) || a < 0 || a > target) return null;
  return target - a;
}
