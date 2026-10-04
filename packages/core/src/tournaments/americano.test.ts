import { describe, expect, it } from 'vitest';
import {
  AMERICANO_CANDIDATES,
  americanoDefaultRounds,
  americanoSchedule,
  tourCourtsPerRound,
} from './americano';
import { seedFrom } from './prng';
import { TOUR_ENGINE, type TourCourt, type TourEntryRef, type TourRound } from './types';
import { validateRoundsPayload } from './validate';

const SEED = seedFrom('00000000-0000-4000-8000-00000000000a');

const entries = (n: number): TourEntryRef[] =>
  Array.from({ length: n }, (_, i) => ({
    entry_id: `e${String(i + 1).padStart(2, '0')}`,
    seed_no: i + 1,
  }));
const courts = (n: number): TourCourt[] =>
  Array.from({ length: n }, (_, i) => ({ court_id: `c${i + 1}`, sort: i + 1 }));

/** `round: court a+a v b+b | … ; sit x,y` with seed numbers for ids. */
const num = (id: string): string => String(Number(id.slice(1)));
const line = (r: TourRound): string =>
  `${r.round_no}: ${r.matches
    .map((m) => `${m.court_id} ${num(m.a[0])}+${num(m.a[1])} v ${num(m.b[0])}+${num(m.b[1])}`)
    .join(' | ')}${r.sit_out.length ? ` ; sit ${r.sit_out.map(num).join(',')}` : ''}`;

/** The server's verdict on a first schedule (validate.ts is the SQL's twin). */
const verdict = (rounds: TourRound[], e: TourEntryRef[], c: TourCourt[]) =>
  validateRoundsPayload(
    { engine: TOUR_ENGINE, format: 'americano', based_on_revision: 0, from_round: 1, rounds },
    {
      status: 'closed',
      revision: 0,
      format: 'americano',
      rounds_planned: null,
      last_round: 0,
      scored_rounds: [],
      complete_rounds: [],
      active: e.map((x) => x.entry_id),
      courts: c.map((x) => x.court_id),
    },
  );

const partnerPairs = (rounds: TourRound[]): string[] =>
  rounds.flatMap((r) => r.matches.flatMap((m) => [m.a.join('|'), m.b.join('|')]));

describe('americanoSchedule: goldens (4 courts, one tournament seed)', () => {
  const golden = (n: number) =>
    americanoSchedule({ entries: entries(n), courts: courts(4), seed: SEED }).map(line);

  it('N = 8', () => {
    expect(golden(8)).toEqual([
      '1: c1 3+7 v 6+8 | c2 1+4 v 2+5',
      '2: c1 1+5 v 4+8 | c2 2+7 v 3+6',
      '3: c1 2+6 v 5+7 | c2 1+8 v 3+4',
      '4: c1 1+3 v 2+4 | c2 5+8 v 6+7',
      '5: c1 1+2 v 5+6 | c2 3+8 v 4+7',
      '6: c1 1+7 v 3+5 | c2 2+8 v 4+6',
      '7: c1 2+3 v 4+5 | c2 1+6 v 7+8',
    ]);
  });

  it('N = 9', () => {
    expect(golden(9)).toEqual([
      '1: c1 1+3 v 6+9 | c2 2+8 v 4+5 ; sit 7',
      '2: c1 4+6 v 5+8 | c2 1+9 v 2+7 ; sit 3',
      '3: c1 1+4 v 3+9 | c2 5+7 v 6+8 ; sit 2',
      '4: c1 1+8 v 6+7 | c2 2+5 v 3+4 ; sit 9',
      '5: c1 2+6 v 4+9 | c2 1+7 v 3+8 ; sit 5',
      '6: c1 3+7 v 5+6 | c2 1+2 v 8+9 ; sit 4',
      '7: c1 4+8 v 7+9 | c2 1+5 v 2+3 ; sit 6',
      '8: c1 2+9 v 3+5 | c2 1+6 v 4+7 ; sit 8',
    ]);
  });

  it('N = 12', () => {
    expect(golden(12)).toEqual([
      '1: c1 2+6 v 9+10 | c2 1+4 v 8+12 | c3 3+5 v 7+11',
      '2: c1 7+9 v 8+11 | c2 2+10 v 3+12 | c3 1+5 v 4+6',
      '3: c1 1+6 v 3+11 | c2 5+12 v 8+9 | c3 2+7 v 4+10',
      '4: c1 4+7 v 11+12 | c2 1+10 v 3+9 | c3 2+8 v 5+6',
      '5: c1 2+3 v 4+8 | c2 5+11 v 9+12 | c3 1+7 v 6+10',
      '6: c1 1+8 v 5+10 | c2 2+12 v 6+7 | c3 3+4 v 9+11',
      '7: c1 1+3 v 4+12 | c2 5+9 v 7+10 | c3 2+11 v 6+8',
      '8: c1 4+11 v 8+10 | c2 1+12 v 2+9 | c3 3+6 v 5+7',
      '9: c1 1+11 v 2+5 | c2 3+10 v 6+12 | c3 4+9 v 7+8',
      '10: c1 6+11 v 10+12 | c2 1+9 v 2+4 | c3 3+7 v 5+8',
      '11: c1 1+2 v 7+12 | c2 3+8 v 6+9 | c3 4+5 v 10+11',
    ]);
  });

  it('N = 13', () => {
    expect(golden(13)).toEqual([
      '1: c1 3+5 v 11+13 | c2 1+9 v 4+6 | c3 2+12 v 8+10 ; sit 7',
      '2: c1 2+4 v 3+12 | c2 5+8 v 6+7 | c3 1+13 v 10+11 ; sit 9',
      '3: c1 5+11 v 8+12 | c2 1+10 v 3+4 | c3 2+7 v 9+13 ; sit 6',
      '4: c1 3+7 v 4+8 | c2 2+6 v 11+12 | c3 1+5 v 9+10 ; sit 13',
      '5: c1 3+6 v 5+9 | c2 1+12 v 7+8 | c3 4+11 v 10+13 ; sit 2',
      '6: c1 7+11 v 9+12 | c2 1+4 v 5+13 | c3 2+3 v 6+8 ; sit 10',
      '7: c1 2+8 v 4+9 | c2 1+7 v 6+11 | c3 5+10 v 12+13 ; sit 3',
      '8: c1 4+13 v 7+9 | c2 3+8 v 10+12 | c3 1+6 v 2+11 ; sit 5',
      '9: c1 3+11 v 5+12 | c2 1+2 v 7+13 | c3 4+10 v 6+9 ; sit 8',
      '10: c1 6+13 v 7+10 | c2 4+5 v 8+11 | c3 1+3 v 2+9 ; sit 12',
      '11: c1 1+8 v 3+9 | c2 2+13 v 4+12 | c3 5+7 v 6+10 ; sit 11',
      '12: c1 3+13 v 5+6 | c2 2+10 v 8+9 | c3 1+11 v 7+12 ; sit 4',
    ]);
  });
});

describe('americanoSchedule: properties (N 4..64 × courts 1..16 × 3 seeds)', () => {
  const SEEDS = [1, SEED, seedFrom('ffffffff-ffff-4fff-bfff-ffffffffffff')];
  const NS = Array.from({ length: 61 }, (_, i) => i + 4);

  // ~3,000 schedules: the checks collect problems and assert once (an `expect` per round would
  // cost more than the engine).
  it.each(NS)('N = %i is always valid, fair on sit-outs and on the lowest courts', (n) => {
    const e = entries(n);
    const problems: string[] = [];
    for (let k = 1; k <= 16; k++) {
      // Courts handed over out of order: the lowest `sort` must still come first.
      const c = courts(k).reverse();
      const used = tourCourtsPerRound(n, k);
      const lowest = Array.from({ length: used }, (_, i) => `c${i + 1}`).join(',');
      for (const seed of SEEDS) {
        const at = `courts ${k} seed ${seed}`;
        const rounds = americanoSchedule({ entries: e, courts: c, seed });
        if (rounds.length !== americanoDefaultRounds(n)) problems.push(`${at}: length`);
        const v = verdict(rounds, e, c);
        if (v.length) problems.push(`${at}: ${v.join(',')}`);
        const sat = new Map(e.map((x) => [x.entry_id, 0]));
        for (const r of rounds) {
          if (r.matches.map((m) => m.court_id).join(',') !== lowest)
            problems.push(`${at} r${r.round_no}: courts`);
          if (r.sit_out.length !== n - 4 * used) problems.push(`${at} r${r.round_no}: sit-outs`);
          for (const id of r.sit_out) sat.set(id, sat.get(id)! + 1);
          const counts = [...sat.values()];
          if (Math.max(...counts) - Math.min(...counts) > 1)
            problems.push(`${at} r${r.round_no}: sit-out spread`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it.each([4, 5, 8, 9, 12, 13, 16])('N = %i: no partner repeat in the first N − 1 rounds', (n) => {
    for (const k of [Math.floor(n / 4), 16]) {
      for (const seed of SEEDS) {
        const rounds = americanoSchedule({ entries: entries(n), courts: courts(k), seed });
        const pairs = partnerPairs(rounds.slice(0, n - 1));
        expect(new Set(pairs).size).toBe(pairs.length);
      }
    }
  });

  it('N = 9 on 2 courts: everyone sits out exactly once in the first 9 rounds', () => {
    const e = entries(9);
    const rounds = americanoSchedule({ entries: e, courts: courts(2), rounds: 9, seed: SEED });
    const sat = rounds.flatMap((r) => r.sit_out).sort();
    expect(sat).toEqual(e.map((x) => x.entry_id));
    // And nobody sits out twice running.
    for (let i = 1; i < rounds.length; i++)
      expect(rounds[i]!.sit_out).not.toEqual(rounds[i - 1]!.sit_out);
  });
});

describe('americanoSchedule: the shape of a match', () => {
  it('puts the lowest seed in team a, each team and the sit-outs by seed', () => {
    for (const r of americanoSchedule({ entries: entries(11), courts: courts(2), seed: SEED })) {
      for (const m of r.matches) {
        const s = (id: string) => Number(id.slice(1));
        expect(s(m.a[0])).toBeLessThan(s(m.a[1]));
        expect(s(m.b[0])).toBeLessThan(s(m.b[1]));
        expect(s(m.a[0])).toBeLessThan(s(m.b[0]));
      }
      expect(r.sit_out).toEqual(r.sit_out.slice().sort());
    }
  });

  it('honours a lower round count and the first round number', () => {
    const rounds = americanoSchedule({
      entries: entries(8),
      courts: courts(2),
      rounds: 3,
      seed: SEED,
    });
    expect(rounds.map((r) => r.round_no)).toEqual([1, 2, 3]);
    const later = americanoSchedule({
      entries: entries(8),
      courts: courts(2),
      rounds: 2,
      seed: SEED,
      firstRound: 4,
    });
    expect(later.map((r) => r.round_no)).toEqual([4, 5]);
  });

  it('defaults to min(N − 1, 30) rounds', () => {
    expect(americanoDefaultRounds(4)).toBe(3);
    expect(americanoDefaultRounds(13)).toBe(12);
    expect(americanoDefaultRounds(31)).toBe(30);
    expect(americanoDefaultRounds(64)).toBe(30);
  });

  it('refuses what no round can be built from', () => {
    expect(() => americanoSchedule({ entries: entries(3), courts: courts(1), seed: 1 })).toThrow(
      RangeError,
    );
    expect(() => americanoSchedule({ entries: entries(8), courts: [], seed: 1 })).toThrow(
      RangeError,
    );
    const dup = [...entries(4), { entry_id: 'e01', seed_no: 9 }];
    expect(() => americanoSchedule({ entries: dup, courts: courts(1), seed: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      americanoSchedule({ entries: entries(8), courts: courts(2), rounds: 31, seed: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      americanoSchedule({ entries: entries(8), courts: courts(2), rounds: 0, seed: 1 }),
    ).toThrow(RangeError);
  });
});

describe('americanoSchedule: determinism', () => {
  it('gives the same JSON for the same input, in any input order', () => {
    const e = entries(23);
    const c = courts(5);
    const once = JSON.stringify(americanoSchedule({ entries: e, courts: c, seed: SEED }));
    const twice = JSON.stringify(americanoSchedule({ entries: e, courts: c, seed: SEED }));
    const shuffled = JSON.stringify(
      americanoSchedule({ entries: e.slice().reverse(), courts: c.slice().reverse(), seed: SEED }),
    );
    expect(twice).toBe(once);
    expect(shuffled).toBe(once);
  });

  it('a different seed gives a different schedule', () => {
    const a = americanoSchedule({ entries: entries(12), courts: courts(3), seed: 1 });
    const b = americanoSchedule({ entries: entries(12), courts: courts(3), seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('regenerating with the played history and the same entries reproduces the rest', () => {
    const e = entries(10);
    const c = courts(2);
    const full = americanoSchedule({ entries: e, courts: c, seed: SEED });
    const rest = americanoSchedule({
      entries: e,
      courts: c,
      rounds: full.length - 3,
      seed: SEED,
      history: full.slice(0, 3),
    });
    expect(rest).toEqual(full.slice(3));
  });
});

describe('americanoSchedule: performance', () => {
  it(`builds N = 64 on 16 courts (30 rounds × ${AMERICANO_CANDIDATES} candidates) under 150 ms`, () => {
    const e = entries(64);
    const c = courts(16);
    americanoSchedule({ entries: e, courts: c, seed: 1 }); // warm the JIT once
    const t0 = performance.now();
    const rounds = americanoSchedule({ entries: e, courts: c, seed: SEED });
    const ms = performance.now() - t0;
    expect(rounds).toHaveLength(30);
    expect(ms).toBeLessThan(150);
  });
});
