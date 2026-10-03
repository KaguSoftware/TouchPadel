/**
 * One `tournament_set_rounds` payload from round `fromRound` on (plan §3.6, §4). PURE.
 *
 * Every rounds write goes through here: the Americano start (`fromRound = 1`), each next Mexicano
 * round, and every regeneration after `removed_from_round` (a no-show without a substitute, or a
 * Mexicano correction). Rounds before `fromRound` are history: they are read for the counts and
 * never sent again, so a regeneration cannot touch a played round.
 *
 * - Americano: rounds `fromRound..rounds`, `rounds` being the tournament's total (the server then
 *   sets `rounds_planned = rounds`). Unchanged entries and history reproduce the original rounds.
 * - Mexicano: exactly round `fromRound` (`rounds` is not read; the server keeps `rounds_planned`).
 */
import { americanoDefaultRounds, americanoSchedule } from './americano';
import { mexicanoRound, type MexicanoInput } from './mexicano';
import {
  TOUR_ENGINE,
  type TourCourt,
  type TourEntryRef,
  type TourFormat,
  type TourRound,
  type TourRoundsPayload,
} from './types';

export interface RegenerateInput {
  format: TourFormat;
  fromRound: number;
  /** The tournament's rounds as they stand; only those before `fromRound` are read. */
  history: readonly TourRound[];
  /** The active set: the registered entries now. */
  entries: readonly TourEntryRef[];
  courts: readonly TourCourt[];
  /** Americano: the total rounds (default: the history's rounds + `americanoDefaultRounds`). */
  rounds?: number;
  /** Mexicano: the server's standings now. */
  standings: MexicanoInput['standings'];
  /** `seedFrom(tournament_id)`. */
  seed: number;
  /** `tournaments.revision` the desk read (the server answers `stale` otherwise). */
  basedOnRevision: number;
}

export function regenerateFrom(input: RegenerateInput): TourRoundsPayload {
  const { format, fromRound, entries, courts, seed, basedOnRevision } = input;
  if (!Number.isInteger(fromRound) || fromRound < 1) throw new RangeError('fromRound must be ≥ 1');
  const history = input.history
    .filter((r) => r.round_no < fromRound)
    .slice()
    .sort((x, y) => x.round_no - y.round_no);

  let rounds: TourRound[];
  if (format === 'americano') {
    const total = input.rounds ?? fromRound - 1 + americanoDefaultRounds(entries.length);
    if (!Number.isInteger(total) || total < fromRound)
      throw new RangeError(`rounds (${String(total)}) must reach fromRound (${fromRound})`);
    rounds = americanoSchedule({
      entries,
      courts,
      rounds: total - fromRound + 1,
      seed,
      history,
      firstRound: fromRound,
    });
  } else {
    const lastRound = history.find((r) => r.round_no === fromRound - 1) ?? null;
    rounds = [
      mexicanoRound({
        entries,
        courts,
        standings: input.standings,
        lastRound,
        roundNo: fromRound,
        seed,
      }),
    ];
  }

  return {
    engine: TOUR_ENGINE,
    format,
    based_on_revision: basedOnRevision,
    from_round: fromRound,
    rounds,
  };
}
