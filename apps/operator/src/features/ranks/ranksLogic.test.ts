import { describe, expect, it } from 'vitest';
import {
  SCORE_RE,
  addLevel,
  adjustDelta,
  adjustErrors,
  bookingRecordable,
  buildScore,
  canVoidResult,
  filterStatus,
  levelsDirty,
  levelsDraft,
  levelsErrors,
  levelsPayload,
  levelsValid,
  recordArgs,
  recordDraft,
  recordErrors,
  removeLevel,
  rulesDraft,
  rulesErrors,
  rulesPatch,
  seatPlayer,
  type RanksSettings,
} from './ranksLogic';

// 0364's function comments are the contract: the score pattern of game_results_score, the
// level list set_ranks_levels takes, the ranges of ranks_settings, ranks_adjust's limits.

const SETTINGS: RanksSettings = {
  enabled: true,
  win_points: 2,
  loss_points: 1,
  draw_points: 1,
  period: 'month',
  board_size: 10,
  count_reported: true,
  count_tournaments: true,
  report_hours: 48,
  updated_at: '2026-10-22T10:00:00Z',
};

const ali = { id: 'p1', name: 'Ali' };
const sara = { id: 'p2', name: 'Sara' };
const omar = { id: 'p3', name: 'Omar' };
const huda = { id: 'p4', name: 'Huda' };

describe('buildScore', () => {
  it('joins filled sets as the server spells them, side A first', () => {
    expect(buildScore([{ a: '6', b: '4' }, { a: '7', b: '5' }])).toEqual({ ok: true, score: '6-4, 7-5' });
  });

  it('is null (no score) when every set is empty, and skips an empty set in between', () => {
    expect(buildScore([{ a: '', b: '' }, { a: ' ', b: '' }])).toEqual({ ok: true, score: null });
    expect(buildScore([{ a: '6', b: '3' }, { a: '', b: '' }, { a: '6', b: '2' }])).toEqual({ ok: true, score: '6-3, 6-2' });
  });

  it('drops leading zeros so "06" reads 6', () => {
    expect(buildScore([{ a: '06', b: '0' }])).toEqual({ ok: true, score: '6-0' });
  });

  it('refuses a half-filled set or a number past two digits instead of guessing', () => {
    expect(buildScore([{ a: '6', b: '' }])).toEqual({ ok: false, error: 'incomplete' });
    expect(buildScore([{ a: '100', b: '2' }])).toEqual({ ok: false, error: 'incomplete' });
    expect(buildScore([{ a: 'x', b: '2' }])).toEqual({ ok: false, error: 'incomplete' });
  });

  it('refuses more than five sets', () => {
    const six = Array.from({ length: 6 }, () => ({ a: '6', b: '4' }));
    expect(buildScore(six)).toEqual({ ok: false, error: 'tooMany' });
    const five = six.slice(0, 5);
    const built = buildScore(five);
    expect(built.ok && built.score !== null && SCORE_RE.test(built.score)).toBe(true);
  });
});

describe('record a result', () => {
  it('puts the booker on side A and keeps the booking', () => {
    const d = recordDraft({ reservationId: 'r1', booker: ali });
    expect(d.seats.a1).toEqual(ali);
    expect(d.reservationId).toBe('r1');
    expect(recordErrors(d)).toEqual(['sides', 'winner']);
  });

  it('moves a player picked a second time instead of seating them twice', () => {
    let d = recordDraft({ booker: ali });
    d = seatPlayer(d, 'b1', ali);
    expect(d.seats.b1).toEqual(ali);
    expect(d.seats.a1).toBeNull();
  });

  it('closes the gap when a first seat is cleared, so a side never has only a partner', () => {
    let d = recordDraft({ booker: ali });
    d = seatPlayer(d, 'a2', sara);
    d = seatPlayer(d, 'a1', null);
    expect(d.seats.a1).toEqual(sara);
    expect(d.seats.a2).toBeNull();
  });

  it('builds ranks_desk_record arguments, empty partner seats as null', () => {
    let d = recordDraft({ reservationId: 'r1', booker: ali });
    d = seatPlayer(d, 'b1', omar);
    d = { ...d, winner: 'a', sets: [{ a: '6', b: '4' }, { a: '', b: '' }] };
    expect(recordArgs(d)).toEqual({
      p_reservation_id: 'r1',
      p_a1: 'p1',
      p_a2: null,
      p_b1: 'p3',
      p_b2: null,
      p_winner: 'a',
      p_score: '6-4',
    });
  });

  it('sends four players and a draw with no score and no booking', () => {
    let d = recordDraft();
    d = seatPlayer(d, 'a1', ali);
    d = seatPlayer(d, 'a2', sara);
    d = seatPlayer(d, 'b1', omar);
    d = seatPlayer(d, 'b2', huda);
    d = { ...d, winner: 'draw' };
    expect(recordArgs(d)).toMatchObject({ p_reservation_id: null, p_a2: 'p2', p_b2: 'p4', p_winner: 'draw', p_score: null });
  });

  it('gives no arguments while the draft would be refused', () => {
    let d = recordDraft({ booker: ali });
    d = seatPlayer(d, 'b1', omar);
    d = { ...d, winner: 'b', sets: [{ a: '6', b: '' }] };
    expect(recordErrors(d)).toEqual(['score']);
    expect(recordArgs(d)).toBeNull();
  });
});

describe('levels', () => {
  const saved = [
    { name_en: 'Rising', name_ar: 'صاعد', min_points: 20 },
    { name_en: 'Rookie', name_ar: 'مبتدئ', min_points: 0 },
  ];

  it('lists the saved levels lowest first and is not dirty until something changes', () => {
    const rows = levelsDraft(saved);
    expect(rows.map((r) => r.name_en)).toEqual(['Rookie', 'Rising']);
    expect(levelsDirty(rows, saved)).toBe(false);
    expect(levelsDirty([{ ...rows[0]!, name_en: 'Starter' }, rows[1]!], saved)).toBe(true);
  });

  it('adds a level a step above the highest and stops at ten', () => {
    let rows = addLevel(levelsDraft(saved));
    expect(rows[2]!.min).toBe('40');
    while (rows.length < 10) rows = addLevel(rows);
    expect(addLevel(rows)).toHaveLength(10);
  });

  it('never removes the base level', () => {
    const rows = levelsDraft(saved);
    expect(removeLevel(rows, rows[0]!.key)).toHaveLength(2);
    expect(removeLevel(rows, rows[1]!.key)).toHaveLength(1);
  });

  it('refuses a missing or too long name and points not above the level before', () => {
    const rows = levelsDraft(saved);
    const bad = [
      { ...rows[0]!, name_ar: ' ' },
      { ...rows[1]!, min: '0' },
      { key: 'x', name_en: 'A'.repeat(25), name_ar: 'ب', min: '30' },
    ];
    const check = levelsErrors(bad);
    expect(check.rows[rows[0]!.key]).toEqual(['names']);
    expect(check.rows[rows[1]!.key]).toEqual(['points']);
    expect(check.rows.x).toEqual(['names']);
    expect(levelsValid(check)).toBe(false);
    expect(levelsValid(levelsErrors(rows))).toBe(true);
  });

  it('sends trimmed names and the first level at 0', () => {
    const rows = levelsDraft(saved);
    rows[1] = { ...rows[1]!, name_en: '  Rising ' };
    expect(levelsPayload(rows)).toEqual([
      { name_en: 'Rookie', name_ar: 'مبتدئ', min_points: 0 },
      { name_en: 'Rising', name_ar: 'صاعد', min_points: 20 },
    ]);
  });

  it('refuses an empty list', () => {
    expect(levelsErrors([]).count).toBe(true);
  });
});

describe('rules', () => {
  it('patches only what changed', () => {
    const saved = rulesDraft(SETTINGS);
    expect(rulesPatch(saved, saved)).toEqual({});
    expect(rulesPatch({ ...saved, win_points: 3, period: 'all' }, saved)).toEqual({ win_points: 3, period: 'all' });
  });

  it('holds the table ranges', () => {
    const saved = rulesDraft(SETTINGS);
    expect(rulesErrors(saved)).toEqual({});
    expect(rulesErrors({ ...saved, board_size: 2, report_hours: 337, win_points: 101 })).toEqual({
      board_size: 'range',
      report_hours: 'range',
      win_points: 'range',
    });
    expect(rulesErrors({ ...saved, report_hours: Number.NaN })).toEqual({ report_hours: 'range' });
  });
});

describe('adjust, void and the booking action', () => {
  it('signs the delta and holds ranks_adjust limits', () => {
    expect(adjustDelta({ sign: 'remove', amount: 5 })).toBe(-5);
    expect(adjustDelta({ sign: 'add', amount: 5 })).toBe(5);
    expect(adjustErrors({ player: null, sign: 'add', amount: 0, note: 'ab' })).toEqual(['player', 'amount', 'reason']);
    expect(adjustErrors({ player: ali, sign: 'add', amount: 1001, note: 'fix' })).toEqual(['amount']);
    expect(adjustErrors({ player: ali, sign: 'remove', amount: 1000, note: 'fix' })).toEqual([]);
  });

  it('voids only a pending or confirmed result, and asks for every status on All', () => {
    expect(canVoidResult({ status: 'pending' })).toBe(true);
    expect(canVoidResult({ status: 'confirmed' })).toBe(true);
    expect(canVoidResult({ status: 'voided' })).toBe(false);
    expect(canVoidResult({ status: 'expired' })).toBe(false);
    expect(filterStatus('all')).toBeNull();
    expect(filterStatus('pending')).toBe('pending');
  });

  it('offers Record result on a played or playing booking only', () => {
    expect(bookingRecordable({ kind: 'booking', status: 'completed' })).toBe(true);
    expect(bookingRecordable({ kind: 'booking', status: 'arrived' })).toBe(true);
    expect(bookingRecordable({ kind: 'booking', status: 'cancelled' })).toBe(false);
    expect(bookingRecordable({ kind: 'booking', status: 'no_show' })).toBe(false);
    expect(bookingRecordable({ kind: 'maintenance', status: 'confirmed' })).toBe(false);
  });
});
