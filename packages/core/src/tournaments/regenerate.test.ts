import { describe, expect, it } from 'vitest';
import { americanoSchedule } from './americano';
import { seedFrom } from './prng';
import { regenerateFrom } from './regenerate';
import { rankStandings } from './standings';
import { TOUR_ENGINE, type TourCourt, type TourEntryRef, type TourRound } from './types';
import { validateRoundsPayload, type TourRoundsContext } from './validate';

const SEED = seedFrom('00000000-0000-4000-8000-00000000000c');

const entries = (n: number): TourEntryRef[] =>
  Array.from({ length: n }, (_, i) => ({
    entry_id: `e${String(i + 1).padStart(2, '0')}`,
    seed_no: i + 1,
  }));
const COURTS: TourCourt[] = [
  { court_id: 'c1', sort: 1 },
  { court_id: 'c2', sort: 2 },
];
const ids = (rounds: TourRound[]): string[] =>
  rounds.flatMap((r) => [...r.matches.flatMap((m) => [...m.a, ...m.b]), ...r.sit_out]);

const ctx = (over: Partial<TourRoundsContext>): TourRoundsContext => ({
  status: 'running',
  revision: 5,
  format: 'americano',
  rounds_planned: 7,
  last_round: 2,
  scored_rounds: [1, 2],
  complete_rounds: [1, 2],
  active: [],
  courts: COURTS.map((c) => c.court_id),
  ...over,
});

describe('regenerateFrom: Americano', () => {
  const all = entries(8);
  const full = americanoSchedule({ entries: all, courts: COURTS, rounds: 7, seed: SEED });

  it('a no-show at round 3 of 7 rebuilds rounds 3..7 and leaves the played ones untouched', () => {
    const before = JSON.stringify(full);
    const left = all.filter((e) => e.entry_id !== 'e05');
    const payload = regenerateFrom({
      format: 'americano',
      fromRound: 3,
      history: full,
      entries: left,
      courts: COURTS,
      rounds: 7,
      standings: [],
      seed: SEED,
      basedOnRevision: 5,
    });
    expect(payload).toMatchObject({
      engine: TOUR_ENGINE,
      format: 'americano',
      based_on_revision: 5,
      from_round: 3,
    });
    expect(payload.rounds.map((r) => r.round_no)).toEqual([3, 4, 5, 6, 7]);
    expect(ids(payload.rounds)).not.toContain('e05');
    // The server, which deleted rounds 3..7 with the no-show, accepts it.
    expect(validateRoundsPayload(payload, ctx({ active: left.map((e) => e.entry_id) }))).toEqual(
      [],
    );
    // History is read, never written.
    expect(JSON.stringify(full)).toBe(before);
    // Seven players on two courts: one match a round, three sit out.
    for (const r of payload.rounds) {
      expect(r.matches).toHaveLength(1);
      expect(r.sit_out).toHaveLength(3);
    }
  });

  it('with nothing changed, reproduces the rounds it replaces', () => {
    const payload = regenerateFrom({
      format: 'americano',
      fromRound: 4,
      history: full,
      entries: all,
      courts: COURTS,
      rounds: 7,
      standings: [],
      seed: SEED,
      basedOnRevision: 9,
    });
    expect(payload.rounds).toEqual(full.slice(3));
  });

  it('starts a schedule at round 1 with the default length', () => {
    const payload = regenerateFrom({
      format: 'americano',
      fromRound: 1,
      history: [],
      entries: all,
      courts: COURTS,
      standings: [],
      seed: SEED,
      basedOnRevision: 0,
    });
    expect(payload.from_round).toBe(1);
    expect(payload.rounds).toEqual(americanoSchedule({ entries: all, courts: COURTS, seed: SEED }));
    expect(
      validateRoundsPayload(
        payload,
        ctx({
          status: 'closed',
          revision: 0,
          rounds_planned: null,
          last_round: 0,
          scored_rounds: [],
          complete_rounds: [],
          active: all.map((e) => e.entry_id),
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a total that ends before fromRound', () => {
    expect(() =>
      regenerateFrom({
        format: 'americano',
        fromRound: 5,
        history: full,
        entries: all,
        courts: COURTS,
        rounds: 4,
        standings: [],
        seed: SEED,
        basedOnRevision: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      regenerateFrom({
        format: 'americano',
        fromRound: 0,
        history: [],
        entries: all,
        courts: COURTS,
        standings: [],
        seed: SEED,
        basedOnRevision: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe('regenerateFrom: Mexicano', () => {
  it('builds exactly the next round from the standings, after the last one', () => {
    const all = entries(9);
    const r1 = regenerateFrom({
      format: 'mexicano',
      fromRound: 1,
      history: [],
      entries: all,
      courts: COURTS,
      standings: [],
      seed: SEED,
      basedOnRevision: 1,
    }).rounds[0]!;
    // Score round 1: team a wins 14–10 on both courts.
    const scored = {
      ...r1,
      matches: r1.matches.map((m) => ({ ...m, points_a: 14, points_b: 10 })),
    };
    const standings = rankStandings({
      points_target: 24,
      entries: all.map((e) => ({ ...e, status: 'registered' as const })),
      rounds: [scored],
    });
    const payload = regenerateFrom({
      format: 'mexicano',
      fromRound: 2,
      history: [r1],
      entries: all,
      courts: COURTS,
      standings,
      seed: SEED,
      basedOnRevision: 3,
    });
    expect(payload).toMatchObject({ format: 'mexicano', from_round: 2, based_on_revision: 3 });
    expect(payload.rounds).toHaveLength(1);
    expect(
      validateRoundsPayload(
        payload,
        ctx({
          format: 'mexicano',
          revision: 3,
          rounds_planned: 5,
          last_round: 1,
          scored_rounds: [1],
          complete_rounds: [1],
          active: all.map((e) => e.entry_id),
        }),
      ),
    ).toEqual([]);
    // Whoever sat out round 1 plays round 2 (fewest sit-outs first).
    expect(payload.rounds[0]!.sit_out).not.toEqual(r1.sit_out);
    // Group 1 on the lowest court holds the top four of the table (the four round-1 winners; the
    // round-1 sitter is credited 12 and ranks fifth, and a loser sits out).
    const top = standings
      .slice(0, 4)
      .map((s) => s.entry_id)
      .sort();
    const m1 = payload.rounds[0]!.matches[0]!;
    expect(m1.court_id).toBe('c1');
    expect([...m1.a, ...m1.b].sort()).toEqual(top);
    expect(standings[4]!.entry_id).toBe(r1.sit_out[0]);
  });
});
