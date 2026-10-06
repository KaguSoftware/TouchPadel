/**
 * The rounds payload's invariants (build contracts §1.9, TD-7). PURE.
 *
 * `app.tournament_set_rounds` checks the same rules in the same order and raises
 * `TOURNAMENT_ROUNDS_INVALID` with the first failing detail; this twin returns every failing
 * detail in that order, so its first equals the server's. The desk runs it before sending, and the
 * parity suite (`packages/db/tests/tournament-rounds.test.ts`) feeds both the same corpus.
 *
 * A payload that is not the §1.10 shape at all (not an object, `rounds` not an array, a match
 * without two two-id teams, a non-integer number) is not a rules question: the server answers
 * `INVALID_ARGUMENT` detail `p_payload`, and this returns `['payload']` alone.
 *
 * Fairness (partner and opponent repeats) is the engine's, never checked here. Who sits out is
 * (0311, c26, check 12): a sit-out is worth floor(points_target / 2), so each round's sit-outs
 * must be entries with the fewest sit-outs so far, the rule both engines draw by.
 */
import {
  TOUR_ENGINE,
  TOUR_LIMITS,
  type TourFormat,
  type TourRoundsDetail,
  type TourRoundsPayload,
  type TourStatus,
} from './types';

/** What the server knows when it checks a payload, read under the tournament lock. */
export interface TourRoundsContext {
  status: TourStatus;
  /** `tournaments.revision` now. */
  revision: number;
  format: TourFormat;
  /** `tournaments.rounds_planned` (null for an Americano before its first schedule). */
  rounds_planned: number | null;
  /** The highest `round_no` that exists (0 when none). */
  last_round: number;
  /** Round numbers holding at least one scored match. */
  scored_rounds: readonly number[];
  /** Round numbers whose every match is scored. */
  complete_rounds: readonly number[];
  /** The registered entries' ids: the active set every round seats exactly once. */
  active: readonly string[];
  /** The courts of the run's live adopted blocks. */
  courts: readonly string[];
  /**
   * The rounds that exist, by their sit-outs (0311, check 12): those before `from_round` count.
   * Omitted: none.
   */
  sit_outs?: readonly { round_no: number; sit_out: readonly string[] }[];
}

export type TourRoundsCheck = TourRoundsDetail | 'payload';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isPair = (v: unknown): v is [string, string] =>
  Array.isArray(v) && v.length === 2 && v.every(isStr);

/** True when `value` has the §1.10 shape (the rules are checked separately). */
export function isRoundsPayloadShape(value: unknown): value is TourRoundsPayload {
  if (!isRecord(value)) return false;
  if (!isInt(value.based_on_revision) || !isInt(value.from_round)) return false;
  if (!Array.isArray(value.rounds)) return false;
  return value.rounds.every(
    (r) =>
      isRecord(r) &&
      isInt(r.round_no) &&
      Array.isArray(r.matches) &&
      Array.isArray(r.sit_out) &&
      r.sit_out.every(isStr) &&
      r.matches.every((m) => isRecord(m) && isStr(m.court_id) && isPair(m.a) && isPair(m.b)),
  );
}

/** Every failing detail of `payload` against `ctx`, in the server's order; `[]` when it passes. */
export function validateRoundsPayload(payload: unknown, ctx: TourRoundsContext): TourRoundsCheck[] {
  if (!isRoundsPayloadShape(payload)) return ['payload'];
  const p = payload;
  const out: TourRoundsDetail[] = [];
  const n = p.rounds.length;
  const mexicano = ctx.format === 'mexicano';

  // 1. status
  if (ctx.status !== 'closed' && ctx.status !== 'running') out.push('status');
  // 2. stale
  if (p.based_on_revision !== ctx.revision) out.push('stale');
  // 3. engine
  if (p.engine !== TOUR_ENGINE) out.push('engine');
  // 4. format
  if (p.format !== ctx.format) out.push('format');
  // 5. numbering: from_round in 1..last+1, at least one round, contiguous, none past 30.
  const contiguous = p.rounds.every((r, i) => r.round_no === p.from_round + i);
  if (
    p.from_round < 1 ||
    p.from_round > ctx.last_round + 1 ||
    n < 1 ||
    !contiguous ||
    p.from_round - 1 + n > TOUR_LIMITS.roundsMax
  ) {
    out.push('numbering');
  }
  // 6. played: nothing at or after from_round has a score.
  if (ctx.scored_rounds.some((r) => r >= p.from_round)) out.push('played');
  // 7–8. Mexicano: one round at a time, within the plan, after a fully scored round.
  if (mexicano) {
    if (n !== 1 || ctx.rounds_planned === null || p.from_round > ctx.rounds_planned)
      out.push('mexicano_one');
    if (p.from_round > 1 && !ctx.complete_rounds.includes(p.from_round - 1)) out.push('round_open');
  }
  // 9. seat: every round seats the active set exactly once, four distinct players per match.
  const active = new Set(ctx.active);
  const seatOk = p.rounds.every((r) => {
    const seen = new Set<string>();
    for (const m of r.matches) {
      const four = [...m.a, ...m.b];
      if (new Set(four).size !== 4) return false;
      for (const id of four) {
        if (seen.has(id) || !active.has(id)) return false;
        seen.add(id);
      }
    }
    for (const id of r.sit_out) {
      if (seen.has(id) || !active.has(id)) return false;
      seen.add(id);
    }
    return seen.size === active.size;
  });
  if (!seatOk) out.push('seat');
  // 10. court: distinct per round, each an adopted court.
  const courts = new Set(ctx.courts);
  const courtOk = p.rounds.every((r) => {
    const ids = r.matches.map((m) => m.court_id);
    return new Set(ids).size === ids.length && ids.every((c) => courts.has(c));
  });
  if (!courtOk) out.push('court');
  // 11. courts_used: 1..floor(active / 4) matches per round.
  const most = Math.floor(ctx.active.length / 4);
  if (!p.rounds.every((r) => r.matches.length >= 1 && r.matches.length <= most))
    out.push('courts_used');
  // 12. sit_out: no sit-out has sat out more than a player of the round (the rounds before
  // from_round, then the payload's earlier rounds).
  const sat = new Map<string, number>();
  for (const r of ctx.sit_outs ?? [])
    if (r.round_no < p.from_round) for (const id of r.sit_out) sat.set(id, (sat.get(id) ?? 0) + 1);
  const satOf = (id: string): number => sat.get(id) ?? 0;
  const sitOk = p.rounds.every((r) => {
    const sitting = new Set(r.sit_out);
    const playing = ctx.active.filter((id) => !sitting.has(id));
    const ok =
      r.sit_out.length === 0 ||
      playing.length === 0 ||
      Math.max(...r.sit_out.map(satOf)) <= Math.min(...playing.map(satOf));
    for (const id of r.sit_out) sat.set(id, satOf(id) + 1);
    return ok;
  });
  if (!sitOk) out.push('sit_out');

  return out;
}
