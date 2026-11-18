import { describe, expect, it, vi } from 'vitest';
import {
  boostFactor,
  buildScore,
  coachRecordArgs,
  coachSeatsReady,
  myType,
  formatFactor,
  parseRules,
  rulesOf,
  formatLevel,
  formatLevelChange,
  higherThanLine,
  historyPath,
  howLines,
  initialView,
  levelName,
  normaliseUsername,
  parseBoard,
  parseMyRanks,
  playerLabel,
  playersReady,
  reliability,
  reliableRule,
  rowValue,
  rowsFor,
  splitPodium,
  tierProgress,
  type BoardRow,
  type MyTouch,
} from '../logic';
import { answerResult, coachRecordGame, fetchBoard, findPlayer, reportGame, setMyPlayLevel } from '../api';

/**
 * The leaderboard's phone rules (0364; 0444 Touch Level + Season Race): the server's numbers,
 * read and shown, never made.
 */

const tier = (name_en: string, min_level: number) => ({ name_en, name_ar: null, min_level, min_points: 0 });
const ROOKIE = { nameEn: 'Rookie', nameAr: 'مبتدئ', minLevel: 0, minPoints: 0 };

const row = (rank: number, over: Partial<BoardRow> = {}): BoardRow => ({
  rank,
  name: `P${rank}`,
  mine: false,
  points: 30 - rank,
  level: null,
  tier: ROOKIE,
  klass: null,
  gain: null,
  ...over,
});

/** A 0444 board, as app.ranks_board() sends it. */
const board0444 = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  headline: 'level',
  show_level: true,
  period: 'quarter',
  from: '2026-09-30T21:00:00Z',
  size: 10,
  race: [{ rank: 1, name: 'Sara M.', mine: false, points: 64, level: 4.3, tier: tier('Elite', 4), class: 'A' }],
  level: [
    { rank: 1, name: 'Sara M.', mine: false, level: 4.3, tier: tier('Elite', 4), class: 'A' },
    { rank: 2, name: 'Ali K.', mine: true, level: 3.1, tier: tier('Contender', 3), class: 'B' },
  ],
  classes: {
    A: [{ rank: 1, name: 'Sara M.', mine: false, level: 4.3, tier: tier('Elite', 4) }],
    B: [{ rank: 1, name: 'Ali K.', mine: true, level: 3.1, tier: tier('Contender', 3) }],
    C: [],
  },
  improved: [{ rank: 1, name: 'Omar H.', mine: false, gain: 0.42, level: 2.6, tier: tier('Rising', 2) }],
  improved_days: 30,
  rows: [],
  ...over,
});

const touch = (over: Partial<MyTouch> = {}): MyTouch => ({
  level: 3.12,
  showLevel: true,
  rated: true,
  games: 4,
  provisionalLeft: 1,
  gamesWindow: 4,
  opponentsWindow: 3,
  reliable: false,
  needsGames: 2,
  needsOpponents: 1,
  reliableDays: 90,
  klass: 'B',
  tier: { nameEn: 'Contender', nameAr: 'منافس', minLevel: 3, minPoints: 0 },
  nextTier: { nameEn: 'Elite', nameAr: 'نخبة', minLevel: 4, minPoints: 0 },
  toNext: 0.88,
  rank: null,
  higherThanPct: 62,
  history: [],
  selfType: null,
  checked: null,
  canChangeType: false,
  ...over,
});

describe('parsing the board', () => {
  it('a board switched off is just that', () => {
    expect(parseBoard({ enabled: false })).toEqual({ enabled: false });
    expect(parseBoard(null)).toEqual({ enabled: false });
  });

  it('reads the four boards, tiers, classes and the headline (0444)', () => {
    const b = parseBoard(board0444());
    if (!b.enabled) throw new Error('expected on');
    expect(b).toMatchObject({ headline: 'level', showLevel: true, period: 'quarter', legacy: false, improvedDays: 30 });
    expect(b.race[0]).toMatchObject({ rank: 1, name: 'Sara M.', points: 64, level: 4.3, klass: 'A' });
    expect(b.race[0]?.tier).toEqual({ nameEn: 'Elite', nameAr: null, minLevel: 4, minPoints: 0 });
    expect(b.level.map((r) => [r.rank, r.mine, r.klass])).toEqual([[1, false, 'A'], [2, true, 'B']]);
    expect(b.level[0]?.points).toBeNull();
    expect(b.classes.B[0]).toMatchObject({ name: 'Ali K.', mine: true, level: 3.1, klass: null });
    expect(b.classes.C).toEqual([]);
    expect(b.improved[0]).toMatchObject({ gain: 0.42, level: 2.6 });
  });

  it('reads a level of null when the owner hides the number, and never shows one sent anyway', () => {
    const b = parseBoard(
      board0444({
        show_level: false,
        level: [{ rank: 1, name: 'Sara M.', mine: false, level: null, tier: tier('Elite', 4), class: 'A' }],
        race: [{ rank: 1, name: 'Sara M.', mine: false, points: 64, level: 4.3, tier: tier('Elite', 4), class: 'A' }],
      }),
    );
    if (!b.enabled) throw new Error('expected on');
    expect(b.showLevel).toBe(false);
    expect(b.level[0]?.level).toBeNull();
    expect(b.race[0]?.level).toBeNull();
    expect(rowValue(b.level[0]!, 'level')).toBeNull();
    // The tier still names them.
    expect(levelName(b.level[0]!.tier, 'en')).toBe('Elite');
  });

  it('an older server (0364 `rows` alone) reads as the Race only, its tier under `level`', () => {
    const b = parseBoard({
      enabled: true,
      period: 'quarter',
      size: 10,
      headline: 'level',
      rows: [
        { rank: 1, name: 'Sara M.', points: 9, level: { name_en: 'Rising', name_ar: 'صاعد', min_points: 20 }, mine: true },
        { name: 'nobody' },
      ],
    });
    if (!b.enabled) throw new Error('expected on');
    expect(b.legacy).toBe(true);
    expect(b.headline).toBe('race');
    expect(b.race).toHaveLength(1);
    expect(b.race[0]).toMatchObject({ rank: 1, name: 'Sara M.', points: 9, mine: true, level: null });
    expect(b.race[0]?.tier).toEqual({ nameEn: 'Rising', nameAr: 'صاعد', minLevel: 0, minPoints: 20 });
    expect(b.level).toEqual([]);
    expect(b.classes).toEqual({ A: [], B: [], C: [] });
    expect(initialView(b)).toBe('race');
  });
});

describe('the headline and the rows', () => {
  it('opens on the owner\'s headline board, the Race by default', () => {
    expect(initialView(parseBoard(board0444()))).toBe('level');
    expect(initialView(parseBoard(board0444({ headline: 'race' })))).toBe('race');
    expect(initialView(parseBoard(board0444({ headline: 'something' })))).toBe('race');
    expect(initialView(parseBoard({ enabled: false }))).toBe('race');
    expect(initialView(undefined)).toBe('race');
  });

  it('draws the rows of the view picked, a class board by its class', () => {
    const b = parseBoard(board0444());
    if (!b.enabled) throw new Error('expected on');
    expect(rowsFor(b, 'race', 'A')).toBe(b.race);
    expect(rowsFor(b, 'level', 'A')).toBe(b.level);
    expect(rowsFor(b, 'classes', 'B')).toBe(b.classes.B);
    expect(rowsFor(b, 'improved', 'A')).toBe(b.improved);
  });

  it('ends each row with its board\'s number', () => {
    expect(rowValue(row(1, { points: 64 }), 'race')).toEqual({ kind: 'points', value: 64 });
    expect(rowValue(row(1, { points: null, level: 4.25 }), 'level')).toEqual({ kind: 'level', text: '4.3' });
    expect(rowValue(row(1, { level: 3 }), 'classes')).toEqual({ kind: 'level', text: '3.0' });
    expect(rowValue(row(1, { gain: 0.4, level: 2.6 }), 'improved')).toEqual({ kind: 'gain', text: '+0.40' });
  });
});

describe('parsing the guest page', () => {
  it('reads an older page, a missing rank as null and an unknown period as month', () => {
    const m = parseMyRanks({
      enabled: true,
      period: 'weekly',
      points: 0,
      lifetime: 0,
      rank: null,
      level: { name_en: 'Rookie', name_ar: 'مبتدئ', min_points: 0 },
      next_level: null,
      rules: { win: 3, loss: 0, draw: 1, report_hours: 24, reports: false },
      results: [{ id: 'r1', played_at: '2026-10-01T10:00:00Z', status: 'odd', outcome: 'won', us: [null], them: [] }],
      to_report: [{ reservation_id: 'rv', start_at: '2026-10-01T10:00:00Z', court: { name_en: 'Court 1' } }],
      recent: [{ username: 'sara', name: 'Sara M.' }, { name: 'no username' }],
    });
    if (!m.enabled) throw new Error('expected on');
    expect(m.period).toBe('month');
    expect(m.headline).toBe('race');
    expect(m.rank).toBeNull();
    expect(m.nextLevel).toBeNull();
    expect(m.touch).toBeNull();
    expect(m.race).toBeNull();
    expect(m.rules).toEqual({ win: 3, loss: 0, draw: 1, reportHours: 24, reports: false });
    expect(m.results[0]).toMatchObject({ id: 'r1', status: 'pending', outcome: 'won', us: [null], levelChange: null, boost: null });
    expect(m.toReport[0]).toMatchObject({ reservationId: 'rv', courtEn: 'Court 1', courtAr: 'Court 1' });
    expect(m.recent).toEqual([{ username: 'sara', name: 'Sara M.' }]);
  });

  it('reads touch, race and each result\'s level change and boost (0444)', () => {
    const m = parseMyRanks({
      enabled: true,
      headline: 'level',
      period: 'quarter',
      points: 36,
      rank: 4,
      level: tier('Contender', 3),
      next_level: tier('Elite', 4),
      rules: { win: 10, loss: 2, draw: 4, report_hours: 48, reports: true },
      touch: {
        level: 3.12, show_level: false, rated: true, games: 4, provisional_left: 1, games_window: 4,
        opponents_window: 3, reliable: false, needs_games: 2, needs_opponents: 1, reliable_days: 90,
        class: 'B', tier: tier('Contender', 3), next_tier: tier('Elite', 4), to_next: 0.88, rank: null,
        higher_than_pct: 62, history: [{ played_at: '2026-10-01T10:00:00Z', level: 3.0 }, { played_at: 'x' }],
      },
      race: { points: 36, rank: 4, matches: 12, matches_counted: 8, best_matches: 8, tournaments: 1, best_tournaments: 2, boosts_used: 1, boosts_max: 3 },
      results: [
        { id: 'r1', played_at: '2026-10-01T10:00:00Z', status: 'confirmed', outcome: 'won', us: [], them: [], points: 15, level_change: 0.12, boost: 'offpeak' },
        { id: 'r2', played_at: '2026-10-02T10:00:00Z', status: 'confirmed', outcome: 'lost', us: [], them: [], points: 2, level_change: -0.05, boost: 'event' },
      ],
    });
    if (!m.enabled) throw new Error('expected on');
    expect(m.headline).toBe('level');
    expect(m.level.minLevel).toBe(3);
    expect(m.touch).toMatchObject({ level: 3.12, showLevel: false, klass: 'B', toNext: 0.88, rank: null, higherThanPct: 62 });
    expect(m.touch?.nextTier?.nameEn).toBe('Elite');
    expect(m.touch?.history).toEqual([{ playedAt: '2026-10-01T10:00:00Z', level: 3 }]);
    expect(m.race).toEqual({
      points: 36, rank: 4, matches: 12, matchesCounted: 8, bestMatches: 8, tournaments: 1, bestTournaments: 2, boostsUsed: 1, boostsMax: 3,
    });
    expect(m.results.map((r) => [r.points, r.levelChange, r.boost])).toEqual([[15, 0.12, 'offpeak'], [2, -0.05, null]]);
  });
});

describe('the guest\'s level', () => {
  it('prints a level with one decimal and a change with its sign, never red for none', () => {
    expect(formatLevel(4.25)).toBe('4.3');
    expect(formatLevel(3)).toBe('3.0');
    expect(formatLevelChange(0.123)).toEqual({ text: '+0.12', tone: 'up' });
    expect(formatLevelChange(-0.05)).toEqual({ text: '\u22120.05', tone: 'down' });
    expect(formatLevelChange(0.001)).toEqual({ text: '0.00', tone: 'none' });
  });

  it('says the percent line only when the server counted a pool', () => {
    expect(higherThanLine(touch({ higherThanPct: 62 }))).toBe(62);
    expect(higherThanLine(touch({ higherThanPct: null }))).toBeNull();
    expect(higherThanLine(null)).toBeNull();
  });

  it('says what is still needed for the Touch Level board', () => {
    expect(reliability(touch())).toEqual({ kind: 'needs', games: 2, players: 1, days: 90 });
    expect(reliability(touch({ needsOpponents: 0 }))).toEqual({ kind: 'needs', games: 2, players: 0, days: 90 });
    expect(reliability(touch({ needsGames: 0, needsOpponents: 0, provisionalLeft: 2 }))).toEqual({ kind: 'provisional', games: 2 });
    expect(reliability(touch({ needsGames: 0, needsOpponents: 0, provisionalLeft: 0 }))).toEqual({ kind: 'inactive' });
    expect(reliability(touch({ reliable: true, rank: 3 }))).toEqual({ kind: 'reliable' });
  });

  it('reads the board\'s gate back only while both parts are still needed', () => {
    expect(reliableRule(touch())).toEqual({ games: 6, players: 4, days: 90 });
    expect(reliableRule(touch({ needsOpponents: 0 }))).toBeNull();
    expect(reliableRule(null)).toBeNull();
  });

  it('measures the way through a tier by level, full at the top', () => {
    const t = touch();
    expect(tierProgress(3.5, t.tier, t.nextTier)).toBeCloseTo(0.5);
    expect(tierProgress(2.5, t.tier, t.nextTier)).toBe(0);
    expect(tierProgress(6, t.tier, null)).toBe(1);
  });

  it('draws the history as a line, flat mid-height, nothing with one game', () => {
    expect(historyPath([{ level: 3 }], 100, 30)).toBeNull();
    expect(historyPath([{ level: 3 }, { level: 3 }], 100, 30)).toBe('M3.0 15.0 L97.0 15.0');
    expect(historyPath([{ level: 2 }, { level: 3 }], 100, 30)).toBe('M3.0 27.0 L97.0 3.0');
  });
});

describe('how ranking works', () => {
  it('uses the server\'s numbers, and goes without them signed out', () => {
    const b = parseBoard(board0444());
    const m = parseMyRanks({
      enabled: true,
      period: 'quarter',
      rules: { win: 10, loss: 2 },
      touch: { level: 3.1, rated: true, provisional_left: 0, games_window: 4, opponents_window: 3, needs_games: 2, needs_opponents: 1, reliable_days: 90 },
      race: { best_matches: 8, best_tournaments: 2, boosts_max: 3 },
    });
    const signedIn = howLines(b, m);
    expect(signedIn.level).toContainEqual({ key: 'ranks.emptyLevel.rule', params: { games: 6, players: 4, days: 90 } });
    expect(signedIn.level.map((l) => l.key)).not.toContain('ranks.how.levelFirst');
    expect(signedIn.race).toEqual([
      { key: 'ranks.how.raceSeason.quarter' },
      { key: 'ranks.how.racePoints', params: { win: 10, loss: 2 } },
      { key: 'ranks.how.raceBest', params: { best: 8 } },
      { key: 'ranks.how.raceTournaments', params: { best: 2 } },
      { key: 'ranks.how.raceBoosts', params: { max: 3 } },
      { key: 'ranks.how.raceNeverLevel' },
    ]);
    const signedOut = howLines(b, null);
    expect(signedOut.level.map((l) => l.key)).toContain('ranks.emptyLevel.ruleNoNumbers');
    expect(signedOut.race.map((l) => l.key)).toEqual([
      'ranks.how.raceSeason.quarter',
      'ranks.how.raceBestNoNumbers',
      'ranks.how.raceBoostsNoNumbers',
      'ranks.how.raceNeverLevel',
    ]);
    expect(howLines(parseBoard(board0444({ show_level: false })), null).level.map((l) => l.key)).toContain('ranks.how.levelHidden');
  });
});

const RULES = {
  reliable_games: 6, reliable_opponents: 4, reliable_days: 90, inactive_days: 45, provisional_games: 5,
  improved_days: 30, improved_min_games: 4, class_b_from: 2.5, class_a_from: 4, race_win: 10, race_loss: 2,
  race_draw: 4, race_strength_max: 2, race_best_matches: 8, race_best_tournaments: 2, boost_offpeak: 1.5,
  boost_event: 2, boost_welcome: 1.5, boost_max_per_season: 3,
};

describe('the rules in force (0444 rules / public_rules)', () => {
  it('reads every rule, and null for a read without them', () => {
    expect(parseRules(RULES)).toMatchObject({ reliableGames: 6, improvedMinGames: 4, boostOffpeak: 1.5, raceStrengthMax: 2 });
    expect(parseRules(undefined)).toBeNull();
    expect(parseRules({ race_win: 10 })?.boostOffpeak).toBeNull();
    const b = parseBoard(board0444({ rules: RULES, improved_days: undefined }));
    if (!b.enabled) throw new Error('expected on');
    expect(b.rules?.reliableOpponents).toBe(4);
    expect(b.improvedDays).toBe(30);
    expect(parseBoard(board0444()).enabled && (parseBoard(board0444()) as { rules: unknown }).rules).toBeNull();
    const m = parseMyRanks({ enabled: true, public_rules: RULES });
    expect(m.enabled && m.publicRules?.raceBestMatches).toBe(8);
  });

  it('takes the gate from the rules for everyone, signed out too, else from the guest block', () => {
    const rules = parseRules(RULES);
    expect(reliableRule(null, rules)).toEqual({ games: 6, players: 4, days: 90 });
    expect(reliableRule(touch({ needsOpponents: 0 }), rules)).toEqual({ games: 6, players: 4, days: 90 });
    expect(reliableRule(touch(), parseRules({ reliable_games: 6 }))).toEqual({ games: 6, players: 4, days: 90 });
    expect(reliableRule(null, null)).toBeNull();
  });

  it('prefers the guest page\'s rules over the board\'s', () => {
    const b = parseBoard(board0444({ rules: { ...RULES, reliable_games: 7 } }));
    const m = parseMyRanks({ enabled: true, public_rules: RULES });
    expect(rulesOf(b, m)?.reliableGames).toBe(6);
    expect(rulesOf(b, null)?.reliableGames).toBe(7);
    expect(rulesOf(null, null)).toBeNull();
  });

  it('sizes a boost from the rules, or not at all', () => {
    const rules = parseRules({ ...RULES, boost_welcome: 2 });
    expect(boostFactor('offpeak', rules)).toBe(1.5);
    expect(boostFactor('welcome', rules)).toBe(2);
    expect(boostFactor('offpeak', null)).toBeNull();
    expect(formatFactor(1.5)).toBe('1.5');
    expect(formatFactor(2)).toBe('2');
  });

  it('says how ranking works with the rules\' numbers, signed out from the board', () => {
    const { level, race } = howLines(parseBoard(board0444({ rules: RULES })), null);
    expect(level).toEqual([
      { key: 'ranks.how.levelMoves' },
      { key: 'ranks.how.levelMore' },
      { key: 'ranks.how.levelFirstCount', params: { games: 5 } },
      { key: 'ranks.emptyLevel.rule', params: { games: 6, players: 4, days: 90 } },
      { key: 'ranks.how.levelInactive', params: { days: 45 } },
      { key: 'ranks.how.levelClassBands', params: { a: '4.0', b: '2.5' } },
    ]);
    expect(race).toEqual([
      { key: 'ranks.how.raceSeason.quarter' },
      { key: 'ranks.how.racePointsMax', params: { win: 10, loss: 2, max: '2' } },
      { key: 'ranks.how.raceBest', params: { best: 8 } },
      { key: 'ranks.how.raceTournaments', params: { best: 2 } },
      { key: 'ranks.how.raceBoostsSized', params: { offpeak: '1.5', welcome: '1.5', max: 3 } },
      { key: 'ranks.how.raceNeverLevel' },
    ]);
  });
});

describe('the player\'s type (0444: they pick it, staff check it)', () => {
  it('reads what they picked, the last check that counted and whether it is still open', () => {
    const m = parseMyRanks({
      enabled: true,
      touch: {
        level: 3.2,
        self_type: 'intermediate',
        checked: { type: 'advanced', role: 'court_desk', at: '2026-11-10T10:00:00Z' },
        can_change_type: false,
      },
    });
    if (!m.enabled || !m.touch) throw new Error('expected touch');
    expect(m.touch.selfType).toBe('intermediate');
    expect(m.touch.checked).toEqual({ type: 'advanced', role: 'court_desk', at: '2026-11-10T10:00:00Z' });
    expect(m.touch.canChangeType).toBe(false);
    const older = parseMyRanks({ enabled: true, touch: { level: 3.2, self_type: 'pro', checked: { type: 'x' } } });
    if (!older.enabled || !older.touch) throw new Error('expected touch');
    expect(older.touch).toMatchObject({ selfType: null, checked: null, canChangeType: false });
  });

  it('shows the check when there is one, else their own pick, else none', () => {
    expect(myType(touch({ selfType: 'beginner', checked: { type: 'intermediate', role: 'coach', at: null } }))).toEqual({
      type: 'intermediate',
      source: 'check',
      role: 'coach',
    });
    expect(myType(touch({ selfType: 'new' }))).toEqual({ type: 'new', source: 'self', role: null });
    expect(myType(touch())).toEqual({ type: null, source: 'none', role: null });
  });

  it('sends the picked type as the stored code', async () => {
    const client = rpcClient({ data: { play_level: 'advanced' }, error: null });
    await setMyPlayLevel(client as never, 'advanced');
    expect(client.app.rpc).toHaveBeenCalledWith('set_my_play_level', { p_level: 'advanced' });
    const locked = { code: 'P0001', message: 'RANKS_LEVEL_LOCKED' };
    await expect(setMyPlayLevel(rpcClient({ data: null, error: locked }) as never, 'new')).rejects.toBe(locked);
  });
});

describe('a coach\'s game (0444 ranks_coach_record)', () => {
  it('wants each side\'s first player, lets the second be empty, never one person twice', () => {
    expect(coachSeatsReady(['a', '', 'b', ''])).toBe('ready');
    expect(coachSeatsReady(['a', 'c', 'b', 'd'])).toBe('ready');
    expect(coachSeatsReady(['', 'c', 'b', 'd'])).toBe('missing');
    expect(coachSeatsReady(['a', 'c', ' ', 'd'])).toBe('missing');
    expect(coachSeatsReady(['a', '@A', 'b', ''])).toBe('repeat');
    expect(coachSeatsReady(['a', '', 'b', 'B'])).toBe('repeat');
  });

  it('sends every argument, usernames folded, an empty seat and no score as null', async () => {
    expect(coachRecordArgs({ a1: '@Sara', a2: ' ', b1: 'Ali', b2: 'omar', winner: 'draw', score: null })).toEqual({
      p_a1: 'sara',
      p_a2: null,
      p_b1: 'ali',
      p_b2: 'omar',
      p_winner: 'draw',
      p_score: null,
    });
    const client = rpcClient({ data: { id: 'g1', status: 'confirmed' }, error: null });
    await coachRecordGame(client as never, { a1: 'sara', a2: 'noor', b1: 'ali', b2: '', winner: 'a', score: '6-4, 6-3' });
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_coach_record', {
      p_a1: 'sara',
      p_a2: 'noor',
      p_b1: 'ali',
      p_b2: null,
      p_winner: 'a',
      p_score: '6-4, 6-3',
    });
  });
});

describe('shared rules', () => {
  it('stands the first three as a podium does: second, first, third', () => {
    const rows = [row(1), row(2), row(3), row(4), row(5)];
    const { podium, rest } = splitPodium(rows);
    expect(podium.map((r) => r?.rank)).toEqual([2, 1, 3]);
    expect(rest.map((r) => r.rank)).toEqual([4, 5]);
    expect(splitPodium([row(1)]).podium).toEqual([null, rows[0], null]);
  });

  it('names a tier in the reading language, falling back to the other', () => {
    const l = { nameEn: 'Elite', nameAr: null, minLevel: 4, minPoints: 0 };
    expect(levelName(l, 'ar')).toBe('Elite');
    expect(levelName({ ...l, nameAr: 'نخبة' }, 'ar')).toBe('نخبة');
    expect(levelName(null, 'en')).toBeNull();
  });

  it('builds the score the server takes, or says it is half typed', () => {
    expect(buildScore([['6', '4'], ['7', '5'], ['', '']])).toBe('6-4, 7-5');
    expect(buildScore([['', ''], ['', '']])).toBeNull();
    expect(buildScore([['06', '4']])).toBe('6-4');
    expect(buildScore([['6', '']])).toBe('invalid');
    expect(buildScore([['a', '4']])).toBe('invalid');
    expect(buildScore([['100', '4']])).toBe('invalid');
  });

  it('folds a username as the server does', () => {
    expect(normaliseUsername('  @@Sara.M ')).toBe('sara.m');
  });

  it('wants three different players, none of them the guest', () => {
    expect(playersReady(['a', 'b', 'c'], 'me')).toBe('ready');
    expect(playersReady(['a', '', 'c'], 'me')).toBe('missing');
    expect(playersReady(['a', '@A', 'c'], 'me')).toBe('repeat');
    expect(playersReady(['me', 'b', 'c'], 'Me')).toBe('repeat');
  });

  it('labels a player by name, else by username, else not at all', () => {
    expect(playerLabel({ name: 'Sara M.', username: 'sara', former: false, me: false })).toBe('Sara M.');
    expect(playerLabel({ name: null, username: 'sara', former: false, me: false })).toBe('@sara');
    expect(playerLabel(null)).toBeNull();
  });
});

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(function (this: unknown) {
    expect(this).toBe(client.app);
    return Promise.resolve(result);
  });
  const app = { rpc };
  const client = { schema: vi.fn(() => app), app };
  return client;
}

describe('the calls', () => {
  it('reads the board on the app schema with no argument', async () => {
    const client = rpcClient({ data: { enabled: false }, error: null });
    expect(await fetchBoard(client as never)).toEqual({ enabled: false });
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_board');
  });

  it('looks a username up folded, and reads a miss as null', async () => {
    const client = rpcClient({ data: null, error: null });
    expect(await findPlayer(client as never, '@Sara')).toBeNull();
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_find_player', { p_username: 'sara' });
  });

  it('sends every report argument, the score as null when there is none', async () => {
    const client = rpcClient({ data: {}, error: null });
    await reportGame(client as never, {
      reservationId: 'rv',
      partner: '@Noor',
      opponent1: 'Sara',
      opponent2: 'ali',
      won: false,
      score: null,
    });
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_report', {
      p_reservation_id: 'rv',
      p_partner: 'noor',
      p_opponent1: 'sara',
      p_opponent2: 'ali',
      p_won: false,
      p_score: null,
    });
  });

  it('throws a refusal as it came', async () => {
    const err = { code: 'P0001', message: 'RANKS_RESULT_CLOSED' };
    const client = rpcClient({ data: null, error: err });
    await expect(answerResult(client as never, 'r1', true)).rejects.toBe(err);
  });
});
