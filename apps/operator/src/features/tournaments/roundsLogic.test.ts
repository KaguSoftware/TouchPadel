import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TourRound } from '@touch/core/tournaments';

// The Rounds tab's logic (tournaments build contracts §1.9, §1.10). The engine
// is the engine lane's (core americano / mexicano); here it is mocked at the
// desk's adapter, so these pin what the desk does with what it draws.

const engine = vi.hoisted(() => ({
  americanoSchedule: vi.fn(),
  mexicanoRound: vi.fn(),
  seedFrom: vi.fn(() => 42),
}));
vi.mock('./engine', () => engine);

import {
  activeEntries,
  boardAction,
  buildFrom,
  buildStart,
  checkPayload,
  courtsInPlay,
  defaultAmericanoRounds,
  drawBlocker,
  pickedCourts,
  readScoreInput,
  scoreTyping,
  renumber,
  roundsContext,
  shortName,
} from './roundsLogic';
import type { TourDetailRound, TourEntry, TournamentDetail } from './tournamentPayloads';

const entry = (
  id: string,
  seed: number | null,
  status: TourEntry['status'] = 'registered',
): TourEntry => ({
  entry_id: id,
  guest_id: `g-${id}`,
  full_name: `Player ${id}`,
  phone: null,
  status,
  seed_no: seed,
  waitlist_position: status === 'waitlisted' ? 1 : null,
  added_by_kind: 'guest',
  owed_iqd: 0,
  net_paid_iqd: 0,
  refund_due_iqd: 0,
  substitute_for: null,
});

const E = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'];

function detail(over: Partial<TournamentDetail> = {}): TournamentDetail {
  return {
    id: 't1',
    venue_id: 'v1',
    protocol_run_id: 'r1',
    name_en: 'Cup',
    name_ar: 'كأس',
    format: 'americano',
    category: 'open',
    class: 'B',
    points_target: 24,
    rounds_planned: null,
    max_entries: 16,
    min_entries: 4,
    waitlist_max: 8,
    entry_fee_iqd: 0,
    prize_en: null,
    prize_ar: null,
    starts_at: '2026-10-09T15:00:00Z',
    ends_at: '2026-10-09T19:00:00Z',
    registration_closes_at: '2026-10-09T13:00:00Z',
    status: 'closed',
    cancel_reason: null,
    revision: 3,
    closed_at: null,
    finished_at: null,
    cancelled_at: null,
    timezone: 'Asia/Baghdad',
    server_now: null,
    entries: E.map((id, i) => entry(id, i + 1)),
    courts: [
      { court_id: 'c2', name_en: 'Court 2', name_ar: 'ملعب ٢', sort_order: 2 },
      { court_id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', sort_order: 1 },
    ].sort((a, b) => a.sort_order - b.sort_order),
    rounds: [],
    standings: [],
    can: {
      add: true,
      set_rounds: true,
      score: true,
      cancel: true,
      close: false,
      finish: false,
      settle: true,
    },
    ...over,
  };
}

/** A valid round for the eight players on both courts. */
function round(no: number, scored: boolean | 'one' = false): TourDetailRound {
  return {
    round_no: no,
    sit_out: [],
    matches: [
      {
        match_id: `m${no}a`,
        court_id: 'c1',
        a: ['e1', 'e2'],
        b: ['e3', 'e4'],
        points_a: scored ? 12 : null,
        points_b: scored ? 12 : null,
        revision: 0,
        corrections: 0,
      },
      {
        match_id: `m${no}b`,
        court_id: 'c2',
        a: ['e5', 'e6'],
        b: ['e7', 'e8'],
        points_a: scored === true ? 20 : null,
        points_b: scored === true ? 4 : null,
        revision: 0,
        corrections: 0,
      },
    ],
  };
}

const drawn = (n: number): TourRound[] =>
  Array.from({ length: n }, (_, i) => ({
    round_no: 99 + i,
    sit_out: [],
    matches: [
      { court_id: 'c1', a: ['e1', 'e5'], b: ['e2', 'e6'] },
      { court_id: 'c2', a: ['e3', 'e7'], b: ['e4', 'e8'] },
    ],
  }));

beforeEach(() => {
  engine.americanoSchedule.mockReset();
  engine.mexicanoRound.mockReset();
});

describe('activeEntries', () => {
  it('keeps registered entries in seed order and seeds the unstamped ones after the highest, in list order', () => {
    const d = detail({
      entries: [
        entry('a', null),
        entry('b', 2),
        entry('w', null, 'waitlisted'),
        entry('c', 1),
        entry('d', null),
      ],
    });
    expect(activeEntries(d)).toEqual([
      { entry_id: 'c', seed_no: 1 },
      { entry_id: 'b', seed_no: 2 },
      { entry_id: 'a', seed_no: 3 },
      { entry_id: 'd', seed_no: 4 },
    ]);
  });
});

describe('boardAction', () => {
  it('offers Start on a closed tournament with nothing drawn, and nothing while open or cancelled', () => {
    expect(boardAction(detail())).toEqual({ kind: 'start' });
    expect(boardAction(detail({ status: 'open' }))).toEqual({ kind: 'none' });
    expect(boardAction(detail({ status: 'cancelled' }))).toEqual({ kind: 'none' });
  });

  it('Americano: regenerates from the first missing planned round', () => {
    const d = detail({ status: 'running', rounds_planned: 5, rounds: [round(1, true), round(2)] });
    expect(boardAction(d)).toEqual({ kind: 'regenerate', fromRound: 3 });
    expect(boardAction({ ...d, rounds_planned: 2 })).toEqual({ kind: 'none' });
  });

  it('Mexicano: Next round once the last round is scored, otherwise score it first', () => {
    const d = detail({
      status: 'running',
      format: 'mexicano',
      rounds_planned: 4,
      rounds: [round(1, 'one')],
    });
    expect(boardAction(d)).toEqual({ kind: 'scoreFirst' });
    expect(boardAction({ ...d, rounds: [round(1, true)] })).toEqual({ kind: 'next', fromRound: 2 });
    expect(
      boardAction({
        ...d,
        rounds: [round(1, true), round(2, true), round(3, true), round(4, true)],
      }),
    ).toEqual({ kind: 'none' });
  });

  it('a running tournament whose rounds were all removed starts again', () => {
    expect(boardAction(detail({ status: 'running', rounds_planned: 7, rounds: [] }))).toEqual({
      kind: 'start',
    });
  });
});

describe('the payloads', () => {
  it('starts an Americano with the whole schedule on the picked courts, numbered from 1, at the tournament revision', () => {
    engine.americanoSchedule.mockReturnValue(drawn(3));
    const d = detail();
    const p = buildStart(d, { courtIds: ['c1', 'c2'], rounds: 3 });
    expect(engine.americanoSchedule).toHaveBeenCalledWith({
      entries: activeEntries(d),
      courts: [
        { court_id: 'c1', sort: 1 },
        { court_id: 'c2', sort: 2 },
      ],
      rounds: 3,
      seed: 42,
      history: [],
    });
    expect(p).toMatchObject({
      engine: 'tp-tour-1',
      format: 'americano',
      based_on_revision: 3,
      from_round: 1,
    });
    expect(p.rounds.map((r) => r.round_no)).toEqual([1, 2, 3]);
    expect(checkPayload(d, p)).toEqual([]);
  });

  it('regenerates an Americano from round 3 with the played rounds as history, only the missing ones', () => {
    engine.americanoSchedule.mockReturnValue(drawn(3));
    const d = detail({
      status: 'running',
      rounds_planned: 5,
      rounds: [round(1, true), round(2, true)],
    });
    const p = buildFrom(d, 3);
    const call = engine.americanoSchedule.mock.calls[0]![0];
    expect(call.rounds).toBe(3);
    expect(call.history.map((r: TourRound) => r.round_no)).toEqual([1, 2]);
    expect(p.from_round).toBe(3);
    expect(p.rounds.map((r) => r.round_no)).toEqual([3, 4, 5]);
    expect(checkPayload(d, p)).toEqual([]);
  });

  it('draws one Mexicano round from the server standings and the last round', () => {
    engine.mexicanoRound.mockReturnValue(drawn(1)[0]);
    const standings = [
      {
        entry_id: 'e1',
        rank: 1,
        points_won: 20,
        points_against: 4,
        diff: 16,
        h2h: 0,
        played: 1,
        sat_out: 0,
        withdrawn: false,
      },
    ];
    const d = detail({
      status: 'running',
      format: 'mexicano',
      rounds_planned: 3,
      rounds: [round(1, true)],
      standings,
    });
    const p = buildFrom(d, 2);
    const call = engine.mexicanoRound.mock.calls[0]![0];
    expect(call.standings).toBe(standings);
    expect(call.lastRound.round_no).toBe(1);
    expect(call.roundNo).toBe(2);
    expect(p.rounds).toHaveLength(1);
    expect(p.rounds[0]!.round_no).toBe(2);
    expect(checkPayload(d, p)).toEqual([]);
  });

  it('catches what the server would refuse before sending (a court not adopted, a stale revision)', () => {
    engine.americanoSchedule.mockReturnValue(
      drawn(1).map((r) => ({
        ...r,
        matches: [{ ...r.matches[0]!, court_id: 'cX' }, r.matches[1]!],
      })),
    );
    const d = detail();
    expect(checkPayload(d, buildStart(d, { courtIds: ['c1', 'c2'], rounds: 1 }))).toEqual([
      'court',
    ]);
    engine.americanoSchedule.mockReturnValue(drawn(1));
    const p = buildStart(d, { courtIds: ['c1', 'c2'], rounds: 1 });
    expect(checkPayload({ ...d, revision: 4 }, p)).toEqual(['stale']);
  });
});

describe('small rules', () => {
  it('reads the score input as a, target − a', () => {
    expect(readScoreInput('15', 24)).toEqual({ a: 15, b: 9 });
    expect(readScoreInput('0', 24)).toEqual({ a: 0, b: 24 });
    expect(readScoreInput('24', 24)).toEqual({ a: 24, b: 0 });
    expect(readScoreInput('25', 24)).toBeNull();
    expect(readScoreInput('', 24)).toBeNull();
    expect(readScoreInput('1.5', 24)).toBeNull();
  });

  it('defaults Americano rounds to N − 1, at most 30, at least 1', () => {
    expect(defaultAmericanoRounds(8)).toBe(7);
    expect(defaultAmericanoRounds(64)).toBe(30);
    expect(defaultAmericanoRounds(1)).toBe(1);
  });

  it('renumbers and picks courts lowest sort first', () => {
    expect(renumber(drawn(2), 4).map((r) => r.round_no)).toEqual([4, 5]);
    expect(pickedCourts(detail(), ['c2'])).toEqual([{ court_id: 'c2', sort: 2 }]);
  });

  it('builds the server context: scored and complete rounds, the active set and the courts', () => {
    const ctx = roundsContext(
      detail({ status: 'running', rounds: [round(1, true), round(2, 'one'), round(3)] }),
    );
    expect(ctx.last_round).toBe(3);
    expect(ctx.scored_rounds).toEqual([1, 2]);
    expect(ctx.complete_rounds).toEqual([1]);
    expect(ctx.active).toEqual(E);
    expect(ctx.courts).toEqual(['c1', 'c2']);
  });

  it('shortens a name to "First I."', () => {
    expect(shortName('Sara Kareem Ali')).toBe('Sara K.');
    expect(shortName('Ali')).toBe('Ali');
    expect(shortName('  ')).toBe('');
  });
});

describe('the courts after Start', () => {
  const three = [
    { court_id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', sort_order: 1 },
    { court_id: 'c2', name_en: 'Court 2', name_ar: 'ملعب ٢', sort_order: 2 },
    { court_id: 'c3', name_en: 'Court 3', name_ar: 'ملعب ٣', sort_order: 3 },
  ];

  it('Next round keeps the courts the desk picked at Start (court 3 left out)', () => {
    engine.mexicanoRound.mockReturnValue(drawn(1)[0]);
    const d = detail({
      status: 'running',
      format: 'mexicano',
      rounds_planned: 3,
      courts: three,
      rounds: [round(1, true)],
    });
    expect(courtsInPlay(d)).toEqual(['c1', 'c2']);
    buildFrom(d, 2);
    const call = engine.mexicanoRound.mock.calls[0]![0];
    expect(call.courts.map((c: { court_id: string }) => c.court_id)).toEqual(['c1', 'c2']);
  });

  it('Regenerate keeps them too; nothing drawn (or no picked court still adopted) means every adopted court', () => {
    engine.americanoSchedule.mockReturnValue(drawn(2));
    const d = detail({
      status: 'running',
      rounds_planned: 3,
      courts: three,
      rounds: [round(1, true)],
    });
    buildFrom(d, 2);
    const call = engine.americanoSchedule.mock.calls[0]![0];
    expect(call.courts.map((c: { court_id: string }) => c.court_id)).toEqual(['c1', 'c2']);
    expect(courtsInPlay(detail({ courts: three }))).toBeUndefined();
    expect(courtsInPlay(detail({ courts: [three[2]!], rounds: [round(1, true)] }))).toBeUndefined();
  });

  it('an explicit court list still wins', () => {
    engine.americanoSchedule.mockReturnValue(drawn(2));
    const d = detail({
      status: 'running',
      rounds_planned: 3,
      courts: three,
      rounds: [round(1, true)],
    });
    buildFrom(d, 2, ['c3']);
    const call = engine.americanoSchedule.mock.calls[0]![0];
    expect(call.courts.map((c: { court_id: string }) => c.court_id)).toEqual(['c3']);
  });
});

describe('drawBlocker', () => {
  it('names the missing players or courts the engine would refuse, else null', () => {
    const d = detail({ status: 'running', rounds: [round(1, true)] });
    expect(drawBlocker(d)).toBeNull();
    // Four registered players, one marked a no-show: three left.
    const few = detail({
      status: 'running',
      rounds: [round(1, true)],
      entries: [entry('e1', 1), entry('e2', 2), entry('e3', 3), entry('e4', 4, 'no_show')],
    });
    expect(drawBlocker(few)).toBe('needPlayers');
    expect(drawBlocker(detail({ status: 'running', rounds: [round(1, true)], courts: [] }))).toBe(
      'needCourts',
    );
  });
});

describe('scoreTyping', () => {
  it('keeps digits only, the last two, and never past the target', () => {
    expect(scoreTyping('15', 24)).toBe('15');
    expect(scoreTyping('159', 24)).toBe('9'); // 59 is past 24
    expect(scoreTyping('122', 24)).toBe('22');
    expect(scoreTyping('25', 24)).toBe('5');
    expect(scoreTyping('24', 24)).toBe('24');
    expect(scoreTyping('0', 24)).toBe('0');
    expect(scoreTyping('1a', 24)).toBe('1');
    expect(scoreTyping('', 24)).toBe('');
    // An Arabic keyboard types Arabic-Indic digits.
    expect(scoreTyping('١٥', 24)).toBe('15');
    expect(scoreTyping('۹', 24)).toBe('9');
  });
});
