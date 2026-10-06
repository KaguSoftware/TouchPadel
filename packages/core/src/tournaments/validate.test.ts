import { describe, expect, it } from 'vitest';
import { TOUR_ENGINE, TOUR_ROUNDS_DETAILS, type TourRound, type TourRoundsPayload } from './types';
import { isRoundsPayloadShape, validateRoundsPayload, type TourRoundsContext } from './validate';

// Eight registered players on two adopted courts: two matches a round, nobody sits out.
const E = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'];
const C = ['c1', 'c2'];

const round = (round_no: number, ids = E, courts = C): TourRound => ({
  round_no,
  matches: [
    { court_id: courts[0]!, a: [ids[0]!, ids[1]!], b: [ids[2]!, ids[3]!] },
    { court_id: courts[1]!, a: [ids[4]!, ids[5]!], b: [ids[6]!, ids[7]!] },
  ],
  sit_out: [],
});

const americano = (over: Partial<TourRoundsPayload> = {}): TourRoundsPayload => ({
  engine: TOUR_ENGINE,
  format: 'americano',
  based_on_revision: 3,
  from_round: 1,
  rounds: [round(1), round(2), round(3)],
  ...over,
});

const ctxA = (over: Partial<TourRoundsContext> = {}): TourRoundsContext => ({
  status: 'closed',
  revision: 3,
  format: 'americano',
  rounds_planned: null,
  last_round: 0,
  scored_rounds: [],
  complete_rounds: [],
  active: E,
  courts: C,
  ...over,
});

const ctxM = (over: Partial<TourRoundsContext> = {}): TourRoundsContext =>
  ctxA({
    format: 'mexicano',
    rounds_planned: 5,
    status: 'running',
    last_round: 2,
    complete_rounds: [1, 2],
    scored_rounds: [1, 2],
    ...over,
  });

const mexicano = (over: Partial<TourRoundsPayload> = {}): TourRoundsPayload => ({
  engine: TOUR_ENGINE,
  format: 'mexicano',
  based_on_revision: 3,
  from_round: 3,
  rounds: [round(3)],
  ...over,
});

describe('validateRoundsPayload: a good payload passes', () => {
  it('an Americano full schedule from a closed tournament', () => {
    expect(validateRoundsPayload(americano(), ctxA())).toEqual([]);
  });

  it('an Americano regeneration from round 3 of a running one', () => {
    const p = americano({ from_round: 3, rounds: [round(3), round(4)] });
    expect(
      validateRoundsPayload(p, ctxA({ status: 'running', last_round: 5, scored_rounds: [1, 2] })),
    ).toEqual([]);
  });

  it('the next Mexicano round', () => {
    expect(validateRoundsPayload(mexicano(), ctxM())).toEqual([]);
  });

  it('a round with sit-outs (nine players, two courts)', () => {
    const nine = [...E, 'e9'];
    const r: TourRound = { ...round(1), sit_out: ['e9'] };
    expect(validateRoundsPayload(americano({ rounds: [r] }), ctxA({ active: nine }))).toEqual([]);
  });
});

describe('validateRoundsPayload: one case per detail (§1.9)', () => {
  it('status', () => {
    expect(validateRoundsPayload(americano(), ctxA({ status: 'open' }))).toEqual(['status']);
    expect(validateRoundsPayload(americano(), ctxA({ status: 'finished' }))).toEqual(['status']);
  });

  it('stale', () => {
    expect(validateRoundsPayload(americano({ based_on_revision: 2 }), ctxA())).toEqual(['stale']);
  });

  it('engine', () => {
    const p = { ...americano(), engine: 'tp-tour-0' } as unknown as TourRoundsPayload;
    expect(validateRoundsPayload(p, ctxA())).toEqual(['engine']);
  });

  it('format', () => {
    expect(
      validateRoundsPayload(americano(), ctxA({ format: 'mexicano', rounds_planned: 5 })),
    ).toContain('format');
  });

  it('numbering: from_round past last + 1, a gap, none, past 30', () => {
    expect(validateRoundsPayload(americano({ from_round: 2, rounds: [round(2)] }), ctxA())).toEqual(
      ['numbering'],
    );
    expect(validateRoundsPayload(americano({ rounds: [round(1), round(3)] }), ctxA())).toEqual([
      'numbering',
    ]);
    expect(validateRoundsPayload(americano({ rounds: [] }), ctxA())).toEqual(['numbering']);
    const many = Array.from({ length: 31 }, (_, i) => round(i + 1));
    expect(validateRoundsPayload(americano({ rounds: many }), ctxA())).toEqual(['numbering']);
  });

  it('played', () => {
    const p = americano({ from_round: 2, rounds: [round(2)] });
    expect(
      validateRoundsPayload(p, ctxA({ status: 'running', last_round: 3, scored_rounds: [1, 2] })),
    ).toEqual(['played']);
  });

  it('mexicano_one: two rounds, or past the plan', () => {
    expect(validateRoundsPayload(mexicano({ rounds: [round(3), round(4)] }), ctxM())).toEqual([
      'mexicano_one',
    ]);
    expect(validateRoundsPayload(mexicano({ from_round: 3 }), ctxM({ rounds_planned: 2 }))).toEqual(
      ['mexicano_one'],
    );
  });

  it('round_open', () => {
    expect(validateRoundsPayload(mexicano(), ctxM({ complete_rounds: [1] }))).toEqual([
      'round_open',
    ]);
  });

  it('seat: a missing player, a stranger, a repeat, a short match', () => {
    const missing: TourRound = { ...round(1), sit_out: [] };
    expect(
      validateRoundsPayload(americano({ rounds: [missing] }), ctxA({ active: [...E, 'e9'] })),
    ).toEqual(['seat']);
    const stranger = round(1, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'x9']);
    expect(validateRoundsPayload(americano({ rounds: [stranger] }), ctxA())).toEqual(['seat']);
    const twice: TourRound = { ...round(1), sit_out: ['e1'] };
    expect(validateRoundsPayload(americano({ rounds: [twice] }), ctxA())).toEqual(['seat']);
    const self = round(1, ['e1', 'e1', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
    expect(validateRoundsPayload(americano({ rounds: [self] }), ctxA())).toEqual(['seat']);
  });

  it('court: a repeat, or a court of no adopted block', () => {
    expect(
      validateRoundsPayload(americano({ rounds: [round(1, E, ['c1', 'c1'])] }), ctxA()),
    ).toEqual(['court']);
    expect(
      validateRoundsPayload(americano({ rounds: [round(1, E, ['c1', 'c9'])] }), ctxA()),
    ).toEqual(['court']);
  });

  it('courts_used: more matches than floor(active / 4), or none', () => {
    // Seven active: one match at most. Two matches need an eighth player, so the seats fail too.
    expect(
      validateRoundsPayload(americano({ rounds: [round(1)] }), ctxA({ active: E.slice(0, 7) })),
    ).toEqual(['seat', 'courts_used']);
    const empty: TourRound = { round_no: 1, matches: [], sit_out: E };
    expect(validateRoundsPayload(americano({ rounds: [empty] }), ctxA())).toEqual(['courts_used']);
  });

  it('sit_out (0311, c26): a sit-out with more sit-outs so far than a player of the round', () => {
    // Six active on one court: two sit out each round.
    const six = E.slice(0, 6);
    const r6 = (round_no: number, sit: [string, string]): TourRound => {
      const play = six.filter((x) => !sit.includes(x));
      return {
        round_no,
        matches: [{ court_id: 'c1', a: [play[0]!, play[1]!], b: [play[2]!, play[3]!] }],
        sit_out: sit,
      };
    };
    const ctx = ctxA({ active: six });
    const p = (rounds: TourRound[], from_round = 1) => americano({ from_round, rounds });
    expect(validateRoundsPayload(p([r6(1, ['e5', 'e6']), r6(2, ['e1', 'e2'])]), ctx)).toEqual([]);
    expect(validateRoundsPayload(p([r6(1, ['e5', 'e6']), r6(2, ['e5', 'e1'])]), ctx)).toEqual([
      'sit_out',
    ]);
    // The rounds before from_round count; later ones do not.
    const sat = [
      { round_no: 1, sit_out: ['e5', 'e6'] },
      { round_no: 2, sit_out: ['e1', 'e2'] },
    ];
    const ctx2 = ctxA({ active: six, last_round: 2, sit_outs: sat });
    expect(validateRoundsPayload(p([r6(2, ['e1', 'e5'])], 2), ctx2)).toEqual(['sit_out']);
    expect(validateRoundsPayload(p([r6(2, ['e1', 'e2'])], 2), ctx2)).toEqual([]);
    expect(validateRoundsPayload(p([r6(3, ['e3', 'e4'])], 3), ctx2)).toEqual([]);
    expect(validateRoundsPayload(p([r6(3, ['e3', 'e5'])], 3), ctx2)).toEqual(['sit_out']);
  });

  it('returns every failing detail in the server order, so its first is what SQL raises', () => {
    const p = {
      ...americano({ based_on_revision: 0, rounds: [round(1, E, ['c1', 'c9'])] }),
      engine: 'x',
    } as unknown as TourRoundsPayload;
    const got = validateRoundsPayload(p, ctxA({ status: 'open' }));
    expect(got).toEqual(['status', 'stale', 'engine', 'court']);
    const order = got.map((d) =>
      TOUR_ROUNDS_DETAILS.indexOf(d as (typeof TOUR_ROUNDS_DETAILS)[number]),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('a payload that is not the shape', () => {
  it.each([
    ['null', null],
    ['an array', []],
    [
      'rounds missing',
      { engine: TOUR_ENGINE, format: 'americano', based_on_revision: 0, from_round: 1 },
    ],
    ['a fractional revision', { ...americano(), based_on_revision: 1.5 }],
    [
      'a one-player team',
      {
        ...americano(),
        rounds: [
          { round_no: 1, matches: [{ court_id: 'c1', a: ['e1'], b: ['e2', 'e3'] }], sit_out: [] },
        ],
      },
    ],
    ['sit_out not ids', { ...americano(), rounds: [{ ...round(1), sit_out: [1] }] }],
  ])('%s is payload', (_name, value) => {
    expect(isRoundsPayloadShape(value)).toBe(false);
    expect(validateRoundsPayload(value, ctxA())).toEqual(['payload']);
  });
});
