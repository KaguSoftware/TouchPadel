/**
 * Re-check (plan §3.5, DECIDE 10): the owner presses a button on a saved
 * answer, the chat function re-runs that message's tool calls against live
 * data with the same arguments, and this module says which of the figures the
 * answer printed are no longer in the data. No model is involved: the diff is
 * pure arithmetic over three number sets.
 *
 *   then   every number the tools returned when the answer was written
 *          (persisted as `gate.numbers` on the assistant message);
 *   now    every number the same tool calls return today;
 *   shown  every number in the answer text (gate.ts `numbersIn`).
 *
 * Only figures that were BOTH shown and given by a tool then are compared —
 * a number the owner typed, a small count, or a figure the gate already
 * flagged as unverified is not a "then" figure and is left alone. A figure
 * holds when the same value is in `now`; otherwise it changed, and the
 * nearest value that is new today (in `now`, not in `then`) is offered as
 * what likely replaced it, when one sits close enough.
 *
 * Pure: no imports, no Deno.
 */

export interface NumberChange {
  /** The figure as the answer printed it. */
  value_then: number;
  /** The nearest new live value, when one is close enough to be its successor. */
  value_now?: number;
}

export interface NumberDiff {
  changed: NumberChange[];
  /** Figures that were in the data then and still are. */
  unchanged: number;
}

/** Two numbers are the same figure when they differ by less than this (the values are normalised the same way both times). */
export const SAME_EPS = 1e-6;
/** A replacement is offered only within this share of the old value (never less than one unit). */
export const NEAREST_MAX_RATIO = 0.5;

function dedupe(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (!out.some((x) => Math.abs(x - v) <= SAME_EPS)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

function has(sorted: readonly number[], v: number): boolean {
  return sorted.some((x) => Math.abs(x - v) <= SAME_EPS);
}

/** The value in `pool` closest to `v`, when within NEAREST_MAX_RATIO of it (or within 1). */
export function nearestOf(pool: readonly number[], v: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const x of pool) {
    const d = Math.abs(x - v);
    if (d < bestDist) {
      best = x;
      bestDist = d;
    }
  }
  if (best === null) return null;
  const limit = Math.max(1, Math.abs(v) * NEAREST_MAX_RATIO);
  return bestDist <= limit + SAME_EPS ? best : null;
}

/**
 * Compare the figures an answer printed with what the same tools return now.
 * Returns each shown-and-given figure that is no longer in the live set, with
 * a likely replacement where one exists, and the count of those that hold.
 */
export function diffNumbers(then: readonly number[], now: readonly number[], shown: readonly number[]): NumberDiff {
  const thenSet = dedupe(then);
  const nowSet = dedupe(now);
  const candidates = dedupe(shown).filter((v) => has(thenSet, v));
  const fresh = nowSet.filter((v) => !has(thenSet, v));
  const changed: NumberChange[] = [];
  let unchanged = 0;
  for (const v of candidates) {
    if (has(nowSet, v)) {
      unchanged += 1;
      continue;
    }
    const near = nearestOf(fresh, v);
    changed.push(near === null ? { value_then: v } : { value_then: v, value_now: near });
  }
  return { changed, unchanged };
}
