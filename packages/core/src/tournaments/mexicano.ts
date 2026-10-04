/**
 * The next Mexicano round (T-1, plan §4). PURE, integers only.
 *
 * Mexicano plays one round at a time: once every match of round k − 1 is scored the desk asks for
 * round k, built from the **server's** standings (`desk_tournament_detail.standings`, the rows of
 * `app.tournament_standings`). This file never recomputes them.
 *
 * - Round 1: a seeded shuffle of the entries stands in for the table.
 * - Order: rank ascending, then `seed_no` (the server's own order once the three keys tie); an
 *   entry the standings do not carry yet goes last.
 * - Sit-outs (N − 4c of them): fewest sit-outs so far (`sat_out`), then the lowest-ranked first.
 * - The players left, in order, make groups of four; group 1 plays on the lowest court.
 * - Inside a group: 1&4 vs 2&3; when one of those pairs partnered the round before, 1&3 vs 2&4;
 *   then 1&2 vs 3&4. When all three repeat a pair, the option with the fewest repeats (first wins).
 * - Team `a` is the team holding the lowest `seed_no` (as Americano), ids inside teams and in
 *   `sit_out` by `seed_no`.
 */
import {
  tourCheckInput,
  tourCourtsPerRound,
  tourOrderMatch,
  tourPlayCourts,
  tourSeedLookup,
  tourSortBySeed,
} from './americano';
import { mulberry32, roundSeed, shuffle } from './prng';
import type { TourCourt, TourEntryRef, TourMatch, TourRound, TourStandingRow } from './types';

export interface MexicanoInput {
  /** The active set: the registered entries. */
  entries: readonly TourEntryRef[];
  /** The courts the desk picked. */
  courts: readonly TourCourt[];
  /** The server's standings now (ignored for round 1). */
  standings: readonly Pick<TourStandingRow, 'entry_id' | 'rank' | 'sat_out'>[];
  /** Round `roundNo − 1`, for the partner check (null for round 1). */
  lastRound: TourRound | null;
  roundNo: number;
  /** `seedFrom(tournament_id)`. */
  seed: number;
}

/** The three ways to split a group of four (seat indices), in the order they are tried. */
const SPLITS: readonly [[number, number], [number, number]][] = [
  [
    [0, 3],
    [1, 2],
  ],
  [
    [0, 2],
    [1, 3],
  ],
  [
    [0, 1],
    [2, 3],
  ],
];

const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

export function mexicanoRound(input: MexicanoInput): TourRound {
  const { entries, courts, standings, lastRound, roundNo, seed } = input;
  tourCheckInput(entries, courts);
  if (!Number.isInteger(roundNo) || roundNo < 1) throw new RangeError('roundNo must be ≥ 1');
  const seedOf = tourSeedLookup(entries);
  const n = entries.length;
  const c = tourCourtsPerRound(n, courts.length);
  const play = tourPlayCourts(courts, c);
  const sits = n - 4 * c;
  const bySeed = tourSortBySeed(
    entries.map((e) => e.entry_id),
    seedOf,
  );

  // The table order, best first.
  let order: string[];
  const satOut = new Map<string, number>();
  if (roundNo === 1) {
    order = shuffle(bySeed, mulberry32(roundSeed(seed, 1)));
  } else {
    const rank = new Map<string, number>();
    for (const s of standings) {
      rank.set(s.entry_id, s.rank);
      satOut.set(s.entry_id, s.sat_out);
    }
    const rankOf = (id: string): number => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
    order = bySeed.slice().sort((x, y) => rankOf(x) - rankOf(y) || seedOf(x) - seedOf(y));
  }
  const pos = new Map(order.map((id, i) => [id, i]));

  // Sit-outs: fewest so far, then the lowest in the table.
  const sitting = new Set(
    order
      .slice()
      .sort((x, y) => (satOut.get(x) ?? 0) - (satOut.get(y) ?? 0) || pos.get(y)! - pos.get(x)!)
      .slice(0, sits),
  );
  const players = order.filter((id) => !sitting.has(id));

  const last = new Set<string>();
  for (const m of lastRound?.matches ?? []) {
    last.add(pairKey(m.a[0], m.a[1]));
    last.add(pairKey(m.b[0], m.b[1]));
  }

  const matches: TourMatch[] = [];
  for (let g = 0; g < c; g++) {
    const four = players.slice(4 * g, 4 * g + 4);
    let pick = SPLITS[0]!;
    let fewest = Infinity;
    for (const split of SPLITS) {
      const repeats = split.filter(([i, j]) => last.has(pairKey(four[i]!, four[j]!))).length;
      if (repeats < fewest) {
        fewest = repeats;
        pick = split;
      }
      if (repeats === 0) break;
    }
    const [[a1, a2], [b1, b2]] = pick;
    matches.push(
      tourOrderMatch(play[g]!.court_id, [four[a1]!, four[a2]!], [four[b1]!, four[b2]!], seedOf),
    );
  }
  return { round_no: roundNo, matches, sit_out: tourSortBySeed([...sitting], seedOf) };
}
