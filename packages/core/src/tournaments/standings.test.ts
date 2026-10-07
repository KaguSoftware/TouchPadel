import { describe, expect, it } from 'vitest';
import {
  rankStandings,
  type TourScoredMatch,
  type TourScoredRound,
  type TourStandingsEntry,
} from './standings';
import type { TourEntryStatus } from './types';

const id = (n: number): string => `e${String(n).padStart(2, '0')}`;
const entries = (n: number, status: Record<number, TourEntryStatus> = {}): TourStandingsEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    entry_id: id(i + 1),
    seed_no: i + 1,
    status: status[i + 1] ?? 'registered',
  }));

/** `m('c1', [1, 2], [3, 4], 12, 8)`; null points = not scored yet. */
const m = (
  court: string,
  a: [number, number],
  b: [number, number],
  pa: number | null,
  pb: number | null,
): TourScoredMatch => ({
  court_id: court,
  a: [id(a[0]), id(a[1])],
  b: [id(b[0]), id(b[1])],
  points_a: pa,
  points_b: pb,
});
const r = (round_no: number, matches: TourScoredMatch[], sit: number[] = []): TourScoredRound => ({
  round_no,
  matches,
  sit_out: sit.map(id),
});

/** entry → [rank, points_won, points_against, diff, h2h, played, sat_out] */
const brief = (rows: ReturnType<typeof rankStandings>) =>
  rows.map((x) => [
    x.entry_id,
    x.rank,
    x.points_won,
    x.points_against,
    x.diff,
    x.h2h,
    x.played,
    x.sat_out,
  ]);

// Scenario A (target 20, 8 players): 5 and 8 tie on (21, +2); 8 beat 5 in round 1.
const SCENARIO_A: TourScoredRound[] = [
  r(1, [m('c1', [1, 2], [3, 4], 12, 8), m('c2', [5, 6], [7, 8], 9, 11)]),
  r(2, [m('c1', [1, 3], [5, 7], 8, 12), m('c2', [2, 4], [6, 8], 10, 10)]),
];

describe('rankStandings: head-to-head', () => {
  it('breaks a 2-way tie by the match the two played, over the seed', () => {
    const rows = rankStandings({ points_target: 20, entries: entries(8), rounds: SCENARIO_A });
    expect(brief(rows)).toEqual([
      [id(7), 1, 23, 17, 6, 0, 2, 0],
      [id(2), 2, 22, 18, 4, 0, 2, 0],
      [id(8), 3, 21, 19, 2, 2, 2, 0],
      [id(5), 4, 21, 19, 2, -2, 2, 0],
      [id(1), 5, 20, 20, 0, 0, 2, 0],
      [id(6), 6, 19, 21, -2, 0, 2, 0],
      [id(4), 7, 18, 22, -4, 0, 2, 0],
      [id(3), 8, 16, 24, -8, 0, 2, 0],
    ]);
    expect(rows.every((x) => !x.withdrawn)).toBe(true);
  });

  it('counts a 3-way tie once per match, and shares the rank it cannot break', () => {
    // Four players, every partnering once (target 24): 1, 2 and 3 end on (38, +4).
    const rows = rankStandings({
      points_target: 24,
      entries: entries(4),
      rounds: [
        r(1, [m('c1', [1, 2], [3, 4], 14, 10)]),
        r(2, [m('c1', [1, 3], [2, 4], 14, 10)]),
        r(3, [m('c1', [1, 4], [2, 3], 10, 14)]),
      ],
    });
    // Each of 1, 2, 3 is +4 over the matches against the group (a count per opponent would
    // give 0: round 3 has two group opponents for player 1).
    expect(brief(rows)).toEqual([
      [id(1), 1, 38, 34, 4, 4, 3, 0],
      [id(2), 1, 38, 34, 4, 4, 3, 0],
      [id(3), 1, 38, 34, 4, 4, 3, 0],
      [id(4), 4, 30, 42, -12, 0, 3, 0],
    ]);
  });

  it('shares a rank across a full tie and orders it by seed', () => {
    const rows = rankStandings({
      points_target: 20,
      entries: entries(8),
      rounds: [r(1, [m('c1', [1, 2], [3, 4], 12, 8), m('c2', [5, 6], [7, 8], 12, 8)])],
    });
    expect(rows.map((x) => [x.entry_id, x.rank])).toEqual([
      [id(1), 1],
      [id(2), 1],
      [id(5), 1],
      [id(6), 1],
      [id(3), 5],
      [id(4), 5],
      [id(7), 5],
      [id(8), 5],
    ]);
  });
});

describe('rankStandings: sit-outs', () => {
  it('credits floor(target / 2) only for a sit-out in a complete round', () => {
    // 9 players, target 20: round 1 complete (9 sits, +10), round 2 half scored (8 sits, nothing).
    const rows = rankStandings({
      points_target: 20,
      entries: entries(9),
      rounds: [
        r(1, [m('c1', [1, 2], [3, 4], 12, 8), m('c2', [5, 6], [7, 8], 10, 10)], [9]),
        r(2, [m('c1', [1, 9], [2, 3], 14, 6), m('c2', [4, 5], [6, 7], null, null)], [8]),
      ],
    });
    expect(brief(rows)).toEqual([
      [id(1), 1, 26, 14, 12, 0, 2, 0],
      [id(9), 2, 24, 6, 8, 0, 1, 1],
      [id(2), 3, 18, 22, -4, 0, 2, 0],
      [id(3), 4, 14, 26, -12, 0, 2, 0],
      [id(5), 5, 10, 10, 0, 0, 1, 0],
      [id(6), 5, 10, 10, 0, 0, 1, 0],
      [id(7), 5, 10, 10, 0, 0, 1, 0],
      [id(8), 5, 10, 10, 0, 0, 1, 0],
      [id(4), 9, 8, 12, -4, 0, 1, 0],
    ]);
  });

  it('floors an odd target', () => {
    const rows = rankStandings({
      points_target: 21,
      entries: entries(5),
      rounds: [r(1, [m('c1', [1, 2], [3, 4], 11, 10)], [5])],
    });
    expect(rows.find((x) => x.entry_id === id(5))).toMatchObject({
      points_won: 10,
      diff: 0,
      played: 0,
      sat_out: 1,
    });
  });

  it('gives a round with no matches no credit', () => {
    const rows = rankStandings({
      points_target: 20,
      entries: entries(4),
      rounds: [r(1, [], [1, 2, 3, 4])],
    });
    expect(rows.every((x) => x.points_won === 0 && x.sat_out === 0)).toBe(true);
  });
});

describe('rankStandings: who is in the table', () => {
  it('keeps a withdrawn or no-show player who played, drops one who did not', () => {
    const rows = rankStandings({
      points_target: 20,
      entries: [
        ...entries(8, { 3: 'no_show', 6: 'withdrawn' }),
        { entry_id: id(9), seed_no: 9, status: 'withdrawn' },
        { entry_id: id(10), seed_no: null, status: 'waitlisted' },
        { entry_id: id(11), seed_no: 10, status: 'registered' },
        { entry_id: id(12), seed_no: 11, status: 'no_show' },
      ],
      rounds: SCENARIO_A,
    });
    // 0311 (c27): the rows who left rank after every registered row, among themselves by points.
    expect(rows.map((x) => [x.entry_id, x.rank, x.withdrawn])).toEqual([
      [id(7), 1, false],
      [id(2), 2, false],
      [id(8), 3, false],
      [id(5), 4, false],
      [id(1), 5, false],
      [id(4), 6, false],
      [id(11), 7, false],
      [id(6), 8, true],
      [id(3), 9, true],
    ]);
  });

  it('answers the registered players at zero before any score', () => {
    const rows = rankStandings({
      points_target: 24,
      entries: entries(4),
      rounds: [r(1, [m('c1', [1, 2], [3, 4], null, null)])],
    });
    expect(brief(rows)).toEqual([
      [id(1), 1, 0, 0, 0, 0, 0, 0],
      [id(2), 1, 0, 0, 0, 0, 0, 0],
      [id(3), 1, 0, 0, 0, 0, 0, 0],
      [id(4), 1, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it('is the same whatever order the rounds and entries come in', () => {
    const a = rankStandings({ points_target: 20, entries: entries(8), rounds: SCENARIO_A });
    const b = rankStandings({
      points_target: 20,
      entries: entries(8).reverse(),
      rounds: SCENARIO_A.slice().reverse(),
    });
    expect(b).toEqual(a);
  });
});
