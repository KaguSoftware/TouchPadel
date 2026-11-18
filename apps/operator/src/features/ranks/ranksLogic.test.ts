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
  canEditResult,
  canStaffConfirm,
  draftFromResult,
  editArgs,
  setsOfScore,
  type DeskResult,
  changedRules,
  decimalTyping,
  driftFlagged,
  isDefaultRule,
  levelText,
  levelsDirty,
  levelsDraft,
  levelsErrors,
  levelsPayload,
  levelsValid,
  recordArgs,
  recordDraft,
  recordErrors,
  removeLevel,
  rescoresLevels,
  resetRule,
  rulesCheck,
  rulesCheckValid,
  rulesEditDraft,
  rulesOverrides,
  parseDecimal,
  signedLevel,
  toggleOffpeakDay,
  addOffpeak,
  NUMBER_RULES,
  type RanksRules,
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

describe('tiers by Touch Level (0444)', () => {
  const saved = [
    { name_en: 'Rising', name_ar: 'صاعد', min_level: 2 },
    { name_en: 'Rookie', name_ar: 'مبتدئ', min_level: 0 },
  ];

  it('lists the saved tiers lowest first at one decimal, and is not dirty until something changes', () => {
    const rows = levelsDraft(saved);
    expect(rows.map((r) => r.name_en)).toEqual(['Rookie', 'Rising']);
    expect(rows.map((r) => r.min)).toEqual(['0.0', '2.0']);
    expect(levelsDirty(rows, saved)).toBe(false);
    expect(levelsDirty([{ ...rows[0]!, name_en: 'Starter' }, rows[1]!], saved)).toBe(true);
    expect(levelsDirty([rows[0]!, { ...rows[1]!, min: '2.5' }], saved)).toBe(true);
  });

  it('adds a tier a step above the highest, capped at the top of the scale, and stops at ten', () => {
    let rows = addLevel(levelsDraft(saved));
    expect(rows[2]!.min).toBe('4.0');
    while (rows.length < 10) rows = addLevel(rows);
    expect(addLevel(rows)).toHaveLength(10);
    expect(rows.every((r) => Number(r.min) <= 10)).toBe(true);
  });

  it('never removes the base tier', () => {
    const rows = levelsDraft(saved);
    expect(removeLevel(rows, rows[0]!.key)).toHaveLength(2);
    expect(removeLevel(rows, rows[1]!.key)).toHaveLength(1);
  });

  it('refuses a missing or too long name, a level not above the tier before (at one decimal), or past 10', () => {
    const rows = levelsDraft(saved);
    const bad = [
      { ...rows[0]!, name_ar: ' ' },
      { ...rows[1]!, min: '0' },
      { key: 'x', name_en: 'A'.repeat(25), name_ar: 'ب', min: '3' },
      { key: 'y', name_en: 'Same', name_ar: 'نفس', min: '3.04' },
      { key: 'z', name_en: 'Top', name_ar: 'قمة', min: '10.5' },
    ];
    const check = levelsErrors(bad);
    expect(check.rows[rows[0]!.key]).toEqual(['names']);
    expect(check.rows[rows[1]!.key]).toEqual(['level']);
    expect(check.rows.x).toEqual(['names']);
    expect(check.rows.y).toEqual(['level']);
    expect(check.rows.z).toEqual(['level']);
    expect(levelsValid(check)).toBe(false);
    expect(levelsValid(levelsErrors(rows))).toBe(true);
  });

  it('reads an Arabic keyboard and sends min_level at one decimal, the first at 0', () => {
    const rows = levelsDraft(saved);
    rows[1] = { ...rows[1]!, name_en: '  Rising ', min: '٢٫٥٦' };
    expect(levelsPayload(rows)).toEqual([
      { name_en: 'Rookie', name_ar: 'مبتدئ', min_level: 0 },
      { name_en: 'Rising', name_ar: 'صاعد', min_level: 2.6 },
    ]);
  });

  it('refuses an empty list', () => {
    expect(levelsErrors([]).count).toBe(true);
  });

  it('prints a level with one decimal', () => {
    expect(levelText(3)).toBe('3.0');
    expect(levelText(4.25)).toBe('4.3');
    expect(levelText(null)).toBe('');
  });
});

describe('rules', () => {
  it('patches only what changed', () => {
    const saved = rulesDraft(SETTINGS);
    expect(rulesPatch(saved, saved)).toEqual({});
    expect(rulesPatch({ ...saved, board_size: 12, count_reported: false }, saved)).toEqual({ board_size: 12, count_reported: false });
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

// 0443's app.ranks_rules_default(), the defaults the editor diffs against.
const DEFAULTS: RanksRules = {
  headline: 'race',
  show_level: true,
  class_b_from: 2.5,
  class_a_from: 4.0,
  improved_days: 30,
  improved_min_games: 4,
  start_a: 4.5,
  start_b: 3.2,
  start_c: 2.0,
  start_new: 1.0,
  self_advanced: 4.5,
  self_intermediate: 3.2,
  self_beginner: 2.0,
  self_new: 1.0,
  start_unknown: 2.0,
  scale: 1.0,
  win_weight: 0.7,
  k_provisional: 0.5,
  k_settling: 0.3,
  k_settled: 0.15,
  provisional_games: 5,
  settling_games: 20,
  trust_tournament: 1.0,
  trust_desk: 1.0,
  trust_player: 0.75,
  repeat_days: 30,
  repeat_half_from: 3,
  repeat_zero_from: 5,
  soft_loss_below: 2.5,
  soft_loss_factor: 0.6,
  max_move: 0.25,
  level_min: 1.0,
  level_max: 7.0,
  reliable_games: 6,
  reliable_days: 90,
  reliable_opponents: 4,
  inactive_days: 45,
  return_games: 3,
  check_roles: ['coach', 'court_desk', 'manager', 'owner'],
  check_days: 60,
  check_max_change: 0.5,
  race_win: 10,
  race_strength_max: 2.0,
  race_loss: 2,
  race_draw: 4,
  race_best_matches: 8,
  race_best_tournaments: 2,
  t_first: 100,
  t_second: 60,
  t_semi: 36,
  t_top_half: 18,
  t_played: 8,
  boost_offpeak: 1.5,
  boost_event: 2.0,
  boost_welcome: 1.5,
  boost_max_per_season: 3,
  offpeak: [],
};

describe('ranking rules editor (set_ranks_rules)', () => {
  const fresh = () => rulesEditDraft(DEFAULTS, 'quarter');

  it('mirrors every number key of app.ranks_rules_check, and only those', () => {
    const numeric = Object.entries(DEFAULTS)
      .filter(([, v]) => typeof v === 'number')
      .map(([k]) => k)
      .sort();
    expect(Object.keys(NUMBER_RULES).sort()).toEqual(numeric);
  });

  it('sends nothing while every rule is at its default, and is valid', () => {
    const d = fresh();
    expect(rulesOverrides(d, DEFAULTS)).toEqual({});
    expect(changedRules(d, DEFAULTS)).toEqual([]);
    expect(rulesCheckValid(rulesCheck(d), d)).toBe(true);
  });

  it('sends only what differs from the default, in the server shape', () => {
    let d = fresh();
    d = { ...d, headline: 'level', show_level: false, nums: { ...d.nums, start_a: '4.8', race_win: '12' } };
    d = { ...d, check_roles: ['owner', 'coach'] };
    expect(rulesOverrides(d, DEFAULTS)).toEqual({
      headline: 'level',
      show_level: false,
      start_a: 4.8,
      race_win: 12,
      check_roles: ['coach', 'owner'],
    });
  });

  it('keeps an override already in force when another rule changes (the server replaces the whole set)', () => {
    const inForce: RanksRules = { ...DEFAULTS, race_win: 15 };
    let d = rulesEditDraft(inForce, 'quarter');
    d = { ...d, nums: { ...d.nums, race_loss: '3' } };
    expect(changedRules(d, inForce)).toEqual(['race_loss']);
    expect(rulesOverrides(d, DEFAULTS)).toEqual({ race_win: 15, race_loss: 3 });
  });

  it('"Back to default" drops the rule from what is sent', () => {
    const inForce: RanksRules = {
      ...DEFAULTS,
      start_b: 3.5,
      show_level: false,
      check_roles: ['manager'],
      offpeak: [{ days: [1, 0], from: '10:00', to: '16:00' }],
    };
    let d = rulesEditDraft(inForce, 'quarter');
    expect(Object.keys(rulesOverrides(d, DEFAULTS)).sort()).toEqual(['check_roles', 'offpeak', 'show_level', 'start_b']);
    expect(isDefaultRule(d, 'start_b', DEFAULTS)).toBe(false);
    for (const k of ['start_b', 'show_level', 'check_roles', 'offpeak'] as const) d = resetRule(d, k, DEFAULTS);
    expect(isDefaultRule(d, 'start_b', DEFAULTS)).toBe(true);
    expect(d.nums.start_b).toBe('3.2');
    expect(rulesOverrides(d, DEFAULTS)).toEqual({});
  });

  it('reads role lists as sets and windows with their days in any order as the same', () => {
    const inForce: RanksRules = { ...DEFAULTS, offpeak: [{ days: [3, 1], from: '09:00', to: '12:00' }] };
    const d = rulesEditDraft(inForce, 'quarter');
    expect(d.offpeak[0]!.days).toEqual([1, 3]);
    expect(changedRules(d, inForce)).toEqual([]);
    expect(changedRules({ ...d, check_roles: ['owner', 'manager', 'court_desk', 'coach'] }, inForce)).toEqual([]);
  });

  it('holds each range and asks for whole numbers where the server reads an integer', () => {
    const d = fresh();
    const bad = {
      ...d,
      nums: { ...d.nums, scale: '0.1', provisional_games: '5.5', improved_days: '200', race_win: 'abc', start_a: '' },
    };
    expect(rulesCheck(bad).fields).toEqual({
      scale: 'range',
      provisional_games: 'whole',
      improved_days: 'range',
      race_win: 'range',
      start_a: 'range',
    });
    expect(rulesCheckValid(rulesCheck(bad), bad)).toBe(false);
    const edge = { ...d, nums: { ...d.nums, scale: '0.25', k_settled: '2', level_max: '10' } };
    expect(rulesCheck(edge).fields).toEqual({});
  });

  it('mirrors the server\'s checks of the whole set', () => {
    const d = fresh();
    const bad = {
      ...d,
      nums: {
        ...d.nums,
        class_a_from: '2.5',
        level_min: '5',
        level_max: '5',
        repeat_half_from: '6',
        repeat_zero_from: '4',
        provisional_games: '25',
        settling_games: '20',
        t_semi: '70',
      },
    };
    expect(rulesCheck(bad).fields).toEqual({
      class_a_from: 'order',
      level_max: 'order',
      repeat_zero_from: 'order',
      settling_games: 'order',
      t_semi: 'order',
    });
  });

  it('checks each off-peak window: a weekday, and an end after the start (midnight allowed)', () => {
    let d = fresh();
    d = { ...d, offpeak: addOffpeak(d.offpeak) };
    const w = d.offpeak[0]!;
    expect(w.days).toEqual([0, 1, 2, 3, 4]);
    expect(rulesCheck(d).offpeak).toEqual({});
    const late = { ...w, from: '22:00', to: '24:00' };
    expect(rulesCheck({ ...d, offpeak: [late] }).offpeak).toEqual({});
    const none = [0, 1, 2, 3, 4].reduce((acc, day) => toggleOffpeakDay(acc, day), w);
    const backwards = { ...w, from: '16:00', to: '10:00' };
    expect(rulesCheck({ ...d, offpeak: [none, backwards] }).offpeak).toEqual({ [none.key]: ['days'], [backwards.key]: ['time'] });
    expect(rulesOverrides(d, DEFAULTS)).toEqual({ offpeak: [{ days: [0, 1, 2, 3, 4], from: '10:00', to: '16:00' }] });
  });

  it('asks before a change that re-scores levels, and not for the boards, the Race or boosts', () => {
    expect(rescoresLevels(['headline', 'show_level', 'race_win', 't_first', 'boost_offpeak', 'offpeak', 'class_a_from', 'reliable_games'])).toBe(false);
    expect(rescoresLevels(['race_win', 'k_settled'])).toBe(true);
    expect(rescoresLevels(['start_a'])).toBe(true);
    expect(rescoresLevels(['check_roles'])).toBe(true);
    expect(rescoresLevels(['inactive_days'])).toBe(true);
  });

  it('reads Arabic digits and separators, and types only digits and one point', () => {
    expect(parseDecimal('٣٫٢')).toBe(3.2);
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(Number.isNaN(parseDecimal('1.2.3'))).toBe(true);
    expect(Number.isNaN(parseDecimal(''))).toBe(true);
    expect(decimalTyping('a1.2.3', false)).toBe('1.23');
    expect(decimalTyping('٤٥.٦', true)).toBe('456');
  });
});

describe('review lists (0444)', () => {
  it('colours a drift of 0.3 or more either way', () => {
    expect(driftFlagged(0.3)).toBe(true);
    expect(driftFlagged(-0.45)).toBe(true);
    expect(driftFlagged(0.29)).toBe(false);
    expect(driftFlagged(null)).toBe(false);
  });

  it('signs a level change with a real minus and one decimal', () => {
    expect(signedLevel(0.42)).toBe('+0.4');
    expect(signedLevel(-0.5)).toBe('\u22120.5');
    expect(signedLevel(0.01)).toBe('0.0');
  });
});

describe('staff confirm and edit (0444)', () => {
  const p = (id: string, name: string | null, username: string | null = null) => ({ id, name, username, former: false });
  const base: DeskResult = {
    id: 'g1',
    source: 'player',
    status: 'pending',
    winner: 'b',
    score: '4-6, 6-7',
    played_at: '2026-11-15T18:00:00Z',
    reported_at: '2026-11-15T19:30:00Z',
    reservation_id: 'r1',
    void_reason: null,
    court: null,
    a: [p('p1', 'Ali'), p('p2', null, 'sara')],
    b: [p('p3', 'Omar'), null],
  };

  it('offers Confirm on a player report waiting (or lapsed but maybe still open), never on a desk or closed result', () => {
    expect(canStaffConfirm(base)).toBe(true);
    expect(canStaffConfirm({ ...base, status: 'expired' })).toBe(true);
    expect(canStaffConfirm({ ...base, source: 'desk' })).toBe(false);
    expect(canStaffConfirm({ ...base, status: 'confirmed' })).toBe(false);
    expect(canStaffConfirm({ ...base, status: 'voided' })).toBe(false);
  });

  it('offers Edit on a pending or confirmed result, never on a tournament match', () => {
    expect(canEditResult(base)).toBe(true);
    expect(canEditResult({ ...base, source: 'desk', status: 'confirmed' })).toBe(true);
    expect(canEditResult({ ...base, source: 'tournament', status: 'confirmed' })).toBe(false);
    expect(canEditResult({ ...base, status: 'voided' })).toBe(false);
    expect(canEditResult({ ...base, status: 'expired' })).toBe(false);
  });

  it('reads a score back into set boxes, keeping two rows at least', () => {
    expect(setsOfScore('6-4, 7-5, 10-8')).toEqual([{ a: '6', b: '4' }, { a: '7', b: '5' }, { a: '10', b: '8' }]);
    expect(setsOfScore(null)).toEqual([{ a: '', b: '' }, { a: '', b: '' }]);
    expect(setsOfScore('6-4')).toEqual([{ a: '6', b: '4' }, { a: '', b: '' }]);
  });

  it('starts the Edit draft from the result as it stands', () => {
    const d = draftFromResult(base);
    expect(d.seats).toEqual({ a1: { id: 'p1', name: 'Ali' }, a2: { id: 'p2', name: '@sara' }, b1: { id: 'p3', name: 'Omar' }, b2: null });
    expect(d.winner).toBe('b');
    expect(d.sets).toEqual([{ a: '4', b: '6' }, { a: '6', b: '7' }]);
    expect(d.reservationId).toBe('r1');
  });

  it('sends ranks_edit_result with the corrected game and the reason, no booking, and nothing without a reason', () => {
    const d = { ...draftFromResult(base), winner: 'a' as const, sets: [{ a: '6', b: '4' }, { a: '7', b: '6' }] };
    expect(editArgs(d, 'g1', ' Score swapped ')).toEqual({
      p_result_id: 'g1',
      p_a1: 'p1',
      p_a2: 'p2',
      p_b1: 'p3',
      p_b2: null,
      p_winner: 'a',
      p_score: '6-4, 7-6',
      p_reason: 'Score swapped',
    });
    expect(editArgs(d, 'g1', 'ab')).toBeNull();
    expect(editArgs({ ...d, winner: null }, 'g1', 'Score swapped')).toBeNull();
  });
});
