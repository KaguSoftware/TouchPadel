import { describe, expect, it } from 'vitest';
import { mexicanoRound, type MexicanoInput } from './mexicano';
import { seedFrom } from './prng';
import type { TourCourt, TourEntryRef, TourRound } from './types';

const SEED = seedFrom('00000000-0000-4000-8000-00000000000b');

const entries = (n: number): TourEntryRef[] =>
  Array.from({ length: n }, (_, i) => ({
    entry_id: `e${String(i + 1).padStart(2, '0')}`,
    seed_no: i + 1,
  }));
const courts = (n: number): TourCourt[] =>
  Array.from({ length: n }, (_, i) => ({ court_id: `c${i + 1}`, sort: i + 1 }));
const id = (n: number): string => `e${String(n).padStart(2, '0')}`;

/** Standings where seed s is ranked `rankOrder.indexOf(s) + 1` (no ties), none sat out. */
const table = (rankOrder: number[], satOut: Record<number, number> = {}) =>
  rankOrder.map((s, i) => ({ entry_id: id(s), rank: i + 1, sat_out: satOut[s] ?? 0 }));

const round = (over: Partial<MexicanoInput>): TourRound =>
  mexicanoRound({
    entries: entries(8),
    courts: courts(2),
    standings: [],
    lastRound: null,
    roundNo: 2,
    seed: SEED,
    ...over,
  });

describe('mexicanoRound: round 1', () => {
  it('is a seeded shuffle, the same every time', () => {
    const a = round({ roundNo: 1 });
    const b = round({ roundNo: 1 });
    expect(a).toEqual(b);
    expect(a.round_no).toBe(1);
    expect(a.matches).toHaveLength(2);
    const seated = [...a.matches.flatMap((m) => [...m.a, ...m.b]), ...a.sit_out].sort();
    expect(seated).toEqual(entries(8).map((e) => e.entry_id));
    // Another tournament, another draw.
    expect(round({ roundNo: 1, seed: seedFrom('another') })).not.toEqual(a);
  });

  it('ignores the standings it is handed', () => {
    const plain = round({ roundNo: 1 });
    expect(round({ roundNo: 1, standings: table([8, 7, 6, 5, 4, 3, 2, 1]) })).toEqual(plain);
  });
});

describe('mexicanoRound: grouping', () => {
  it('groups four by four in rank order, group 1 on the lowest court, 1&4 v 2&3', () => {
    const r = round({
      standings: table([5, 2, 7, 1, 8, 3, 6, 4]),
      courts: [
        { court_id: 'cB', sort: 2 },
        { court_id: 'cA', sort: 1 },
      ],
    });
    expect(r.sit_out).toEqual([]);
    // Group 1 = 5,2,7,1 → 5&1 v 2&7; team a holds the lowest seed (1).
    expect(r.matches[0]).toEqual({ court_id: 'cA', a: [id(1), id(5)], b: [id(2), id(7)] });
    // Group 2 = 8,3,6,4 → 8&4 v 3&6.
    expect(r.matches[1]).toEqual({ court_id: 'cB', a: [id(3), id(6)], b: [id(4), id(8)] });
  });

  it('breaks a shared rank by seed_no', () => {
    const r = round({
      entries: entries(4),
      courts: courts(1),
      standings: [
        { entry_id: id(4), rank: 1, sat_out: 0 },
        { entry_id: id(3), rank: 1, sat_out: 0 },
        { entry_id: id(2), rank: 3, sat_out: 0 },
        { entry_id: id(1), rank: 3, sat_out: 0 },
      ],
    });
    // Order 3,4,1,2 → 3&2 v 4&1.
    expect(r.matches[0]).toEqual({ court_id: 'c1', a: [id(1), id(4)], b: [id(2), id(3)] });
  });

  it('puts an entry the standings do not carry yet (a late walk-in) last', () => {
    const r = round({ entries: entries(4), courts: courts(1), standings: table([2, 3, 4]) });
    // Order 2,3,4,1 → 2&1 v 3&4.
    expect(r.matches[0]).toEqual({ court_id: 'c1', a: [id(1), id(2)], b: [id(3), id(4)] });
  });

  it('plays only floor(N / 4) matches even with more courts', () => {
    const r = round({
      entries: entries(9),
      courts: courts(4),
      standings: table([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });
    expect(r.matches.map((m) => m.court_id)).toEqual(['c1', 'c2']);
    expect(r.sit_out).toHaveLength(1);
  });
});

describe('mexicanoRound: the partner swap', () => {
  const four = entries(4);
  const st = table([1, 2, 3, 4]);
  const last = (a: [number, number], b: [number, number]): TourRound => ({
    round_no: 1,
    matches: [{ court_id: 'c1', a: [id(a[0]), id(a[1])], b: [id(b[0]), id(b[1])] }],
    sit_out: [],
  });
  const next = (lastRound: TourRound | null) =>
    round({ entries: four, courts: courts(1), standings: st, lastRound }).matches[0];

  it('plays 1&4 v 2&3 when neither pair partnered last round', () => {
    expect(next(last([1, 2], [3, 4]))).toEqual({
      court_id: 'c1',
      a: [id(1), id(4)],
      b: [id(2), id(3)],
    });
    expect(next(null)).toEqual({ court_id: 'c1', a: [id(1), id(4)], b: [id(2), id(3)] });
  });

  it('switches to 1&3 v 2&4 when 1&4 or 2&3 partnered last round', () => {
    expect(next(last([1, 4], [2, 3]))).toEqual({
      court_id: 'c1',
      a: [id(1), id(3)],
      b: [id(2), id(4)],
    });
  });

  it('then to 1&2 v 3&4', () => {
    // 1&4 and 1&3 cannot both have partnered in one round, so use two matches' worth of pairs.
    const twoCourts: TourRound = {
      round_no: 1,
      matches: [
        { court_id: 'c1', a: [id(1), id(4)], b: [id(5), id(6)] },
        { court_id: 'c2', a: [id(2), id(4)], b: [id(7), id(8)] },
      ],
      sit_out: [],
    };
    // 1&4 repeats in the first split, 2&4 in the second: the third has none.
    expect(next(twoCourts)).toEqual({ court_id: 'c1', a: [id(1), id(2)], b: [id(3), id(4)] });
  });

  it('keeps the split with the fewest repeats when all three repeat', () => {
    const all: TourRound = {
      round_no: 1,
      matches: [
        { court_id: 'c1', a: [id(1), id(4)], b: [id(2), id(3)] },
        { court_id: 'c2', a: [id(1), id(3)], b: [id(5), id(6)] },
        { court_id: 'c3', a: [id(1), id(2)], b: [id(7), id(8)] },
      ],
      sit_out: [],
    };
    // Split 1 repeats twice (1&4, 2&3), split 2 once (1&3), split 3 once (1&2): split 2 wins.
    expect(next(all)).toEqual({ court_id: 'c1', a: [id(1), id(3)], b: [id(2), id(4)] });
  });
});

describe('mexicanoRound: sit-outs', () => {
  it('sits out the lowest-ranked among the fewest sit-outs', () => {
    const r = round({
      entries: entries(6),
      courts: courts(1),
      standings: table([1, 2, 3, 4, 5, 6]),
    });
    expect(r.sit_out).toEqual([id(5), id(6)]);
    expect(r.matches[0]).toEqual({ court_id: 'c1', a: [id(1), id(4)], b: [id(2), id(3)] });
  });

  it('spares whoever already sat out more', () => {
    const r = round({
      entries: entries(6),
      courts: courts(1),
      standings: table([1, 2, 3, 4, 5, 6], { 6: 1, 5: 1 }),
    });
    expect(r.sit_out).toEqual([id(3), id(4)]);
    // The players left keep rank order: 1,2,5,6 → 1&6 v 2&5.
    expect(r.matches[0]).toEqual({ court_id: 'c1', a: [id(1), id(6)], b: [id(2), id(5)] });
  });

  it('round 1 sits out the end of the seeded order', () => {
    const r = round({ entries: entries(5), courts: courts(1), roundNo: 1 });
    expect(r.sit_out).toHaveLength(1);
    expect(r.matches).toHaveLength(1);
  });

  it('refuses what no round can be built from', () => {
    expect(() => round({ entries: entries(3), courts: courts(1) })).toThrow(RangeError);
    expect(() => round({ roundNo: 0 })).toThrow(RangeError);
  });
});
