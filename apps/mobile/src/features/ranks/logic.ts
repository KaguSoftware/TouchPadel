/**
 * The leaderboard on the phone (migration 0364, Majed 2026-10-22; 0444 Touch Level and Season
 * Race, Majed 2026-11-13/16). PURE: parsers for the two reads, and the small rules the screens
 * share, so vitest can pin them.
 *
 * The server owns every number: points, places, levels, tiers and classes come from
 * `ranks_board` and `my_ranks`, and the phone never adds points up or ranks anyone. A player
 * below a board is never sent.
 *
 * An older server (0364) sends `rows` alone on the board and no `touch` / `race` on the guest's
 * page: the board then reads as the Race only, and the page as the Race with no level card.
 */
import type { Locale } from '@touch/i18n';

export type RanksPeriod = 'all' | 'month' | 'quarter';
/** The board the Ranks tab opens on: the owner's switch, default the Race (Majed, 2026-11-16). */
export type Headline = 'race' | 'level';
export type RankClass = 'A' | 'B' | 'C';
export const RANK_CLASSES: readonly RankClass[] = ['A', 'B', 'C'];
/** The four views of the tab, in the order the switch shows them. */
export type BoardView = 'race' | 'level' | 'classes' | 'improved';
export const BOARD_VIEWS: readonly BoardView[] = ['race', 'level', 'classes', 'improved'];

/**
 * The owner's rules in force, as the reads send them (0444 `ranks_board.rules`,
 * `my_ranks.public_rules`, both `app.ranks_public_rules`). Every field is null when an older
 * server leaves it out: a sentence then goes without its number.
 */
export interface PublicRules {
  reliableGames: number | null;
  reliableOpponents: number | null;
  reliableDays: number | null;
  inactiveDays: number | null;
  provisionalGames: number | null;
  improvedDays: number | null;
  improvedMinGames: number | null;
  classBFrom: number | null;
  classAFrom: number | null;
  raceWin: number | null;
  raceLoss: number | null;
  raceDraw: number | null;
  raceStrengthMax: number | null;
  raceBestMatches: number | null;
  raceBestTournaments: number | null;
  boostOffpeak: number | null;
  boostEvent: number | null;
  boostWelcome: number | null;
  boostMaxPerSeason: number | null;
}

/** A tier (Rookie … Legend): the band a Touch Level reaches (0444: by min_level). */
export interface RanksLevel {
  nameEn: string | null;
  nameAr: string | null;
  /** The Touch Level the tier starts at; 0 from a 0364 server. */
  minLevel: number;
  minPoints: number;
}

export interface BoardRow {
  rank: number;
  /** "First L." as players see each other; null when the account has no name. */
  name: string | null;
  mine: boolean;
  /** Race points (the Race board); null on the level boards. */
  points: number | null;
  /** The Touch Level, one decimal; null while the owner hides the number (show_level off). */
  level: number | null;
  tier: RanksLevel;
  /** A, B or C; null where the server sends none (a class board's own rows, a 0364 row). */
  klass: RankClass | null;
  /** Most improved: the gain over the window. */
  gain: number | null;
}

export type Board =
  | { enabled: false }
  | {
      enabled: true;
      headline: Headline;
      showLevel: boolean;
      period: RanksPeriod;
      from: string | null;
      size: number;
      race: BoardRow[];
      level: BoardRow[];
      classes: Record<RankClass, BoardRow[]>;
      improved: BoardRow[];
      improvedDays: number | null;
      /** The rules in force; null from an older server. */
      rules: PublicRules | null;
      /** A 0364 server: the Race alone, no other board to switch to. */
      legacy: boolean;
    };

export interface ResultPlayer {
  name: string | null;
  username: string | null;
  former: boolean;
  me: boolean;
}

export type ResultStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'voided';
export type ResultOutcome = 'won' | 'lost' | 'draw';
export type ResultBoost = 'offpeak' | 'welcome';

export interface MyResult {
  id: string;
  source: 'player' | 'desk' | 'tournament';
  status: ResultStatus;
  playedAt: string;
  score: string | null;
  outcome: ResultOutcome;
  /** The guest's side, them first. A seat may be empty (a desk entry with a walk-in). */
  us: (ResultPlayer | null)[];
  them: (ResultPlayer | null)[];
  reportedByMe: boolean;
  canConfirm: boolean;
  expiresAt: string | null;
  /** Its Race points for this guest (0444), net of any void. */
  points: number;
  /** What it did to their Touch Level; null until confirmed or from a 0364 server. */
  levelChange: number | null;
  boost: ResultBoost | null;
}

export interface ToReport {
  reservationId: string;
  startAt: string;
  endAt: string;
  courtEn: string;
  courtAr: string;
}

export interface RecentPlayer {
  username: string;
  name: string | null;
}

/** The guest's Touch Level block (0444 `my_ranks.touch`). */
export interface MyTouch {
  /** Two decimals; shown to the player whatever show_level says. */
  level: number;
  showLevel: boolean;
  rated: boolean;
  games: number;
  provisionalLeft: number;
  gamesWindow: number;
  opponentsWindow: number;
  reliable: boolean;
  needsGames: number;
  needsOpponents: number;
  reliableDays: number;
  klass: RankClass | null;
  tier: RanksLevel;
  nextTier: RanksLevel | null;
  toNext: number | null;
  /** Their place on the Touch Level board; reliable players only. */
  rank: number | null;
  higherThanPct: number | null;
  history: { playedAt: string; level: number }[];
  /** What the player picked themself (`profiles.play_level`), or null. */
  selfType: TypeCode | null;
  /** The last Level check that counted (desk, coach, manager or owner), or null. */
  checked: { type: TypeCode; role: CheckRole | null; at: string | null } | null;
  /** `set_my_play_level` is open to them (no check applied, still in their first games). */
  canChangeType: boolean;
}

/** A stored type code: new | beginner (Type C) | intermediate (Type B) | advanced (Type A). */
export type TypeCode = 'new' | 'beginner' | 'intermediate' | 'advanced';
/** The choices a player picks from, Type A first (0444). */
export const TYPE_CODES: readonly TypeCode[] = ['advanced', 'intermediate', 'beginner', 'new'];
export type CheckRole = 'coach' | 'court_desk' | 'manager' | 'owner';

/** The guest's Season Race block (0444 `my_ranks.race`). */
export interface MyRace {
  points: number;
  rank: number | null;
  matches: number;
  matchesCounted: number;
  bestMatches: number;
  tournaments: number;
  bestTournaments: number;
  boostsUsed: number;
  boostsMax: number;
}

export type MyRanks =
  | { enabled: false }
  | {
      enabled: true;
      headline: Headline;
      period: RanksPeriod;
      from: string | null;
      size: number;
      /** The Race's points this season (0444; 0364: the period's points). */
      points: number;
      lifetime: number;
      /** Their place in the Race; null with no points yet. */
      rank: number | null;
      /** The tier their Touch Level reaches (0444; 0364: by lifetime points). */
      level: RanksLevel;
      nextLevel: RanksLevel | null;
      rules: { win: number; loss: number; draw: number; reportHours: number; reports: boolean };
      username: string | null;
      results: MyResult[];
      toReport: ToReport[];
      recent: RecentPlayer[];
      /** Null from a 0364 server. */
      touch: MyTouch | null;
      race: MyRace | null;
      /** The rules in force (`public_rules`); null from an older server. */
      publicRules: PublicRules | null;
    };

// ── Parsing (defensive: a field the server leaves out reads as nothing, never a crash) ───────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const isObj = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
/** A number as sent (levels and gains carry decimals; numeric arrives as a JSON number). */
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const posInt = (v: unknown): number | null => {
  const n = int(v, 0);
  return n > 0 ? n : null;
};
const period = (v: unknown): RanksPeriod => (v === 'all' || v === 'quarter' ? v : 'month');
const headline = (v: unknown): Headline => (v === 'level' ? 'level' : 'race');
const typeCode = (v: unknown): TypeCode | null =>
  v === 'new' || v === 'beginner' || v === 'intermediate' || v === 'advanced' ? v : null;
const checkRole = (v: unknown): CheckRole | null =>
  v === 'coach' || v === 'court_desk' || v === 'manager' || v === 'owner' ? v : null;
const rankClass = (v: unknown): RankClass | null => (v === 'A' || v === 'B' || v === 'C' ? v : null);

/** `app.ranks_public_rules`: null when the key is not there (an older server). */
export function parseRules(v: unknown): PublicRules | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  const n = (k: string) => num(o[k]);
  return {
    reliableGames: n('reliable_games'),
    reliableOpponents: n('reliable_opponents'),
    reliableDays: n('reliable_days'),
    inactiveDays: n('inactive_days'),
    provisionalGames: n('provisional_games'),
    improvedDays: n('improved_days'),
    improvedMinGames: n('improved_min_games'),
    classBFrom: n('class_b_from'),
    classAFrom: n('class_a_from'),
    raceWin: n('race_win'),
    raceLoss: n('race_loss'),
    raceDraw: n('race_draw'),
    raceStrengthMax: n('race_strength_max'),
    raceBestMatches: n('race_best_matches'),
    raceBestTournaments: n('race_best_tournaments'),
    boostOffpeak: n('boost_offpeak'),
    boostEvent: n('boost_event'),
    boostWelcome: n('boost_welcome'),
    boostMaxPerSeason: n('boost_max_per_season'),
  };
}

function parseLevel(v: unknown): RanksLevel {
  const o = obj(v);
  return {
    nameEn: str(o.name_en),
    nameAr: str(o.name_ar),
    minLevel: num(o.min_level) ?? 0,
    minPoints: int(o.min_points),
  };
}

const parseLevelOrNull = (v: unknown): RanksLevel | null => (isObj(v) ? parseLevel(v) : null);

function parsePlayer(v: unknown): ResultPlayer | null {
  if (!v || typeof v !== 'object') return null;
  const o = obj(v);
  return { name: str(o.name), username: str(o.username), former: o.former === true, me: o.me === true };
}

const STATUSES: readonly ResultStatus[] = ['pending', 'confirmed', 'rejected', 'expired', 'voided'];

function parseResult(v: unknown): MyResult | null {
  const o = obj(v);
  const id = str(o.id);
  const playedAt = str(o.played_at);
  if (!id || !playedAt) return null;
  const status = STATUSES.includes(o.status as ResultStatus) ? (o.status as ResultStatus) : 'pending';
  const source = o.source === 'desk' || o.source === 'tournament' ? o.source : 'player';
  const outcome = o.outcome === 'won' || o.outcome === 'draw' ? o.outcome : 'lost';
  return {
    id,
    source,
    status,
    playedAt,
    score: str(o.score),
    outcome,
    us: arr(o.us).map(parsePlayer),
    them: arr(o.them).map(parsePlayer),
    reportedByMe: o.reported_by_me === true,
    canConfirm: o.can_confirm === true,
    expiresAt: str(o.expires_at),
    points: int(o.points),
    levelChange: num(o.level_change),
    boost: o.boost === 'offpeak' || o.boost === 'welcome' ? o.boost : null,
  };
}

/**
 * One board row. A 0444 row carries `level` as a number and `tier` as an object; a 0364 row
 * (`rows`) carries its tier under `level`. Both read here.
 */
export function parseBoardRow(r: unknown): BoardRow {
  const x = obj(r);
  const tierRaw = isObj(x.tier) ? x.tier : isObj(x.level) ? x.level : null;
  return {
    rank: int(x.rank, 0),
    name: str(x.name),
    mine: x.mine === true,
    points: x.points === undefined || x.points === null ? null : int(x.points),
    level: num(x.level),
    tier: parseLevel(tierRaw),
    klass: rankClass(x.class),
    gain: num(x.gain),
  };
}

const parseRows = (v: unknown): BoardRow[] => arr(v).map(parseBoardRow).filter((r) => r.rank > 0);

export function parseBoard(raw: unknown): Board {
  const o = obj(raw);
  if (o.enabled !== true) return { enabled: false };
  const legacy = !Array.isArray(o.race);
  const showLevel = o.show_level !== false;
  const classes = obj(o.classes);
  const scrub = (rows: BoardRow[]): BoardRow[] => (showLevel ? rows : rows.map((r) => ({ ...r, level: null })));
  const rules = parseRules(o.rules);
  return {
    enabled: true,
    headline: legacy ? 'race' : headline(o.headline),
    showLevel,
    period: period(o.period),
    from: str(o.from),
    size: int(o.size, 10),
    race: scrub(parseRows(legacy ? o.rows : o.race)),
    level: scrub(parseRows(o.level)),
    classes: {
      A: scrub(parseRows(classes.A)),
      B: scrub(parseRows(classes.B)),
      C: scrub(parseRows(classes.C)),
    },
    improved: scrub(parseRows(o.improved)),
    improvedDays: posInt(o.improved_days) ?? (rules?.improvedDays && rules.improvedDays > 0 ? rules.improvedDays : null),
    rules,
    legacy,
  };
}

function parseTouch(v: unknown): MyTouch | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  const level = num(o.level);
  if (level === null) return null;
  return {
    level,
    showLevel: o.show_level !== false,
    rated: o.rated === true,
    games: int(o.games),
    provisionalLeft: Math.max(0, int(o.provisional_left)),
    gamesWindow: int(o.games_window),
    opponentsWindow: int(o.opponents_window),
    reliable: o.reliable === true,
    needsGames: Math.max(0, int(o.needs_games)),
    needsOpponents: Math.max(0, int(o.needs_opponents)),
    reliableDays: int(o.reliable_days, 90),
    klass: rankClass(o.class),
    tier: parseLevel(o.tier),
    nextTier: parseLevelOrNull(o.next_tier),
    toNext: num(o.to_next),
    rank: posInt(o.rank),
    higherThanPct: num(o.higher_than_pct) === null ? null : Math.round(num(o.higher_than_pct)!),
    history: arr(o.history)
      .map((h) => {
        const x = obj(h);
        const playedAt = str(x.played_at);
        const lv = num(x.level);
        return playedAt && lv !== null ? { playedAt, level: lv } : null;
      })
      .filter((h): h is { playedAt: string; level: number } => h !== null),
    selfType: typeCode(o.self_type),
    checked: (() => {
      const c = obj(o.checked);
      const type = typeCode(c.type);
      return type ? { type, role: checkRole(c.role), at: str(c.at) } : null;
    })(),
    canChangeType: o.can_change_type === true,
  };
}

function parseRace(v: unknown): MyRace | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  return {
    points: int(o.points),
    rank: posInt(o.rank),
    matches: int(o.matches),
    matchesCounted: int(o.matches_counted),
    bestMatches: int(o.best_matches),
    tournaments: int(o.tournaments),
    bestTournaments: int(o.best_tournaments),
    boostsUsed: int(o.boosts_used),
    boostsMax: int(o.boosts_max),
  };
}

export function parseMyRanks(raw: unknown): MyRanks {
  const o = obj(raw);
  if (o.enabled !== true) return { enabled: false };
  const rules = obj(o.rules);
  const rank = int(o.rank, 0);
  return {
    enabled: true,
    headline: headline(o.headline),
    period: period(o.period),
    from: str(o.from),
    size: int(o.size, 10),
    points: int(o.points),
    lifetime: int(o.lifetime),
    rank: rank > 0 ? rank : null,
    level: parseLevel(o.level),
    nextLevel: parseLevelOrNull(o.next_level),
    rules: {
      win: num(rules.win) ?? 0,
      loss: num(rules.loss) ?? 0,
      draw: num(rules.draw) ?? 0,
      reportHours: int(rules.report_hours, 48),
      reports: rules.reports !== false,
    },
    username: str(o.username),
    results: arr(o.results)
      .map(parseResult)
      .filter((r): r is MyResult => r !== null),
    toReport: arr(o.to_report)
      .map((r): ToReport | null => {
        const x = obj(r);
        const id = str(x.reservation_id);
        const startAt = str(x.start_at);
        if (!id || !startAt) return null;
        const court = obj(x.court);
        return {
          reservationId: id,
          startAt,
          endAt: str(x.end_at) ?? startAt,
          courtEn: str(court.name_en) ?? '',
          courtAr: str(court.name_ar) ?? str(court.name_en) ?? '',
        };
      })
      .filter((r): r is ToReport => r !== null),
    recent: arr(o.recent)
      .map((r): RecentPlayer | null => {
        const x = obj(r);
        const username = str(x.username);
        return username ? { username, name: str(x.name) } : null;
      })
      .filter((r): r is RecentPlayer => r !== null),
    touch: parseTouch(o.touch),
    race: parseRace(o.race),
    publicRules: parseRules(o.public_rules),
  };
}

// ── Shared rules ───────────────────────────────────────────────────────────

/** A level's name in the reading language, the other one when it has none. */
export function levelName(level: RanksLevel | null | undefined, locale: Locale): string | null {
  if (!level) return null;
  return (locale === 'ar' ? level.nameAr ?? level.nameEn : level.nameEn ?? level.nameAr) ?? null;
}

/** A Touch Level as the boards print it: one decimal, Latin digits ("4.3"). */
export function formatLevel(level: number): string {
  return (Math.round(level * 10) / 10).toFixed(1);
}

/**
 * A level change as a result shows it: "+0.12", "−0.05" (a true minus), "0.00". The tone is
 * the screen's: up is green, down and none are neutral, never red.
 */
export function formatLevelChange(change: number): { text: string; tone: 'up' | 'down' | 'none' } {
  const r = Math.round(change * 100) / 100;
  if (r === 0) return { text: '0.00', tone: 'none' };
  return r > 0 ? { text: `+${r.toFixed(2)}`, tone: 'up' } : { text: `\u2212${Math.abs(r).toFixed(2)}`, tone: 'down' };
}

/** The view the tab opens on: the owner's headline, the Race from an older server. */
export function initialView(board: Board | null | undefined): BoardView {
  return board && board.enabled && !board.legacy && board.headline === 'level' ? 'level' : 'race';
}

/** The rows a view draws (Classes: the class picked). */
export function rowsFor(
  board: Extract<Board, { enabled: true }>,
  view: BoardView,
  klass: RankClass,
): BoardRow[] {
  switch (view) {
    case 'race':
      return board.race;
    case 'level':
      return board.level;
    case 'classes':
      return board.classes[klass];
    case 'improved':
      return board.improved;
  }
}

/**
 * What a row shows at its end: Race points, the level (one decimal) on the level boards, the
 * gain on Most improved. Null when the number is hidden (show_level off): the tier name stands
 * in for it.
 */
export function rowValue(
  row: BoardRow,
  view: BoardView,
): { kind: 'points'; value: number } | { kind: 'level'; text: string } | { kind: 'gain'; text: string } | null {
  if (view === 'race') return row.points === null ? null : { kind: 'points', value: row.points };
  if (view === 'improved' && row.gain !== null) return { kind: 'gain', text: `+${(Math.round(row.gain * 100) / 100).toFixed(2)}` };
  return row.level === null ? null : { kind: 'level', text: formatLevel(row.level) };
}

/**
 * How far into their tier a player is: 0..1 along the way to the next tier, by Touch Level.
 * At the top tier there is no next one: full.
 */
export function tierProgress(level: number, tier: RanksLevel, next: RanksLevel | null): number {
  if (!next) return 1;
  const span = next.minLevel - tier.minLevel;
  if (!(span > 0)) return 0;
  return Math.min(Math.max((level - tier.minLevel) / span, 0), 1);
}

/** "You're at a higher level than X% of players": shown only when the server counted a pool. */
export function higherThanLine(touch: MyTouch | null): number | null {
  if (!touch || touch.higherThanPct === null) return null;
  return Math.min(Math.max(touch.higherThanPct, 0), 100);
}

/**
 * Where the guest stands against the Touch Level board's gate:
 * - reliable: on it (or eligible);
 * - needs: N more games and/or M more different opponents in the window;
 * - provisional: enough games and people, still inside the first rated games;
 * - inactive: enough of both, but no game lately.
 */
export type Reliability =
  | { kind: 'reliable' }
  | { kind: 'needs'; games: number; players: number; days: number }
  | { kind: 'provisional'; games: number }
  | { kind: 'inactive' };

export function reliability(touch: MyTouch): Reliability {
  if (touch.reliable) return { kind: 'reliable' };
  if (touch.needsGames > 0 || touch.needsOpponents > 0) {
    return { kind: 'needs', games: touch.needsGames, players: touch.needsOpponents, days: touch.reliableDays };
  }
  if (touch.provisionalLeft > 0) return { kind: 'provisional', games: touch.provisionalLeft };
  return { kind: 'inactive' };
}

/**
 * The Touch Level board's gate in numbers ("6 games against 4 different people in 90 days"):
 * the owner's rules when the read sends them (0444 `rules` / `public_rules`, signed out too).
 * From an older server, read back from the guest's own block: the totals are what they still
 * need plus what they have, so they are known only while they still need some of both. Null
 * otherwise (the sentence then goes without numbers).
 */
export function reliableRule(
  touch: MyTouch | null,
  rules: PublicRules | null = null,
): { games: number; players: number; days: number } | null {
  if (rules && rules.reliableGames !== null && rules.reliableOpponents !== null && rules.reliableDays !== null) {
    return { games: rules.reliableGames, players: rules.reliableOpponents, days: rules.reliableDays };
  }
  if (!touch || touch.needsGames <= 0 || touch.needsOpponents <= 0) return null;
  return {
    games: touch.needsGames + touch.gamesWindow,
    players: touch.needsOpponents + touch.opponentsWindow,
    days: touch.reliableDays,
  };
}

/** The rules in force from whichever read has them: the guest's page first, then the board. */
export function rulesOf(board: Board | null | undefined, mine: MyRanks | null | undefined): PublicRules | null {
  return (mine && mine.enabled ? mine.publicRules : null) ?? (board && board.enabled ? board.rules : null);
}

/** A multiplier as a badge prints it: "1.5", "2" (no trailing zeros). */
export function formatFactor(x: number): string {
  return String(Math.round(x * 100) / 100);
}

/** A result's boost size from the rules ("×1.5"), or null when the read did not send it. */
export function boostFactor(boost: ResultBoost, rules: PublicRules | null): number | null {
  const x = rules ? (boost === 'offpeak' ? rules.boostOffpeak : rules.boostWelcome) : null;
  return x !== null && x > 0 ? x : null;
}

/**
 * The level history as a line, x by game, y by level, inside a width x height box (SVG path
 * "M x y L x y …"). Null with fewer than two points. A flat history draws mid-height.
 */
export function historyPath(points: readonly { level: number }[], width: number, height: number, pad = 3): string | null {
  if (points.length < 2) return null;
  const levels = points.map((p) => p.level);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const span = hi - lo;
  const step = (width - pad * 2) / (points.length - 1);
  return levels
    .map((lv, i) => {
      const x = pad + i * step;
      const y = span === 0 ? height / 2 : pad + (1 - (lv - lo) / span) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * The podium reads second, first, third, as a podium stands; the rest of the board follows as
 * a list. Ties share a rank, so the three are the first three rows, whatever their numbers.
 */
export function splitPodium(rows: readonly BoardRow[]): {
  podium: (BoardRow | null)[];
  rest: BoardRow[];
} {
  const [first = null, second = null, third = null] = rows;
  return { podium: [second, first, third], rest: rows.slice(3) };
}

/** A username as typed: no "@", no spaces, lower case (the server folds it the same way). */
export function normaliseUsername(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

/** A set's two games, as typed: empty, or a whole number 0..99. */
export type SetInput = readonly [string, string];

/**
 * The optional score from the sets typed: "6-4, 7-5" (the server's exact form), null when no set
 * was typed, or 'invalid' when a set is half filled or not a number.
 */
export function buildScore(sets: readonly SetInput[]): string | null | 'invalid' {
  const parts: string[] = [];
  for (const [a, b] of sets) {
    const x = a.trim();
    const y = b.trim();
    if (x === '' && y === '') continue;
    if (!/^\d{1,2}$/.test(x) || !/^\d{1,2}$/.test(y)) return 'invalid';
    parts.push(`${Number(x)}-${Number(y)}`);
  }
  if (parts.length > 5) return 'invalid';
  return parts.length ? parts.join(', ') : null;
}

/** The three other players, each known and none twice nor the guest themself. */
export function playersReady(
  usernames: readonly [string, string, string],
  own: string | null,
): 'ready' | 'missing' | 'repeat' {
  const names = usernames.map(normaliseUsername);
  if (names.some((n) => n === '')) return 'missing';
  const seen = new Set(own ? [own.toLowerCase()] : []);
  for (const n of names) {
    if (seen.has(n)) return 'repeat';
    seen.add(n);
  }
  return 'ready';
}

/** A player's line on a result: their name, else their @username, else null for "Player". */
export function playerLabel(p: ResultPlayer | null): string | null {
  if (!p) return null;
  return p.name ?? (p.username ? `@${p.username}` : null);
}

/** One sentence of "How ranking works": a catalog key and the server's numbers for it. */
export interface HowLine {
  key:
    | 'ranks.how.levelMoves'
    | 'ranks.how.levelMore'
    | 'ranks.how.levelFirst'
    | 'ranks.how.levelFirstCount'
    | 'ranks.how.levelClasses'
    | 'ranks.how.levelClassBands'
    | 'ranks.how.levelHidden'
    | 'ranks.emptyLevel.rule'
    | 'ranks.emptyLevel.ruleNoNumbers'
    | 'ranks.how.levelInactive'
    | 'ranks.how.raceSeason.month'
    | 'ranks.how.raceSeason.quarter'
    | 'ranks.how.raceSeason.all'
    | 'ranks.how.racePoints'
    | 'ranks.how.racePointsMax'
    | 'ranks.how.raceBest'
    | 'ranks.how.raceBestNoNumbers'
    | 'ranks.how.raceTournaments'
    | 'ranks.how.raceBoosts'
    | 'ranks.how.raceBoostsSized'
    | 'ranks.how.raceBoostsNoNumbers'
    | 'ranks.how.raceNeverLevel';
  params?: Record<string, number | string>;
}

const has = (...xs: (number | null | undefined)[]): boolean => xs.every((x) => typeof x === 'number');

/**
 * The sentences of "How ranking works", in order, with the numbers the reads carry: the owner's
 * rules (0444 `rules` on the board, `public_rules` on the guest's page, so signed out too),
 * else what `my_ranks.race` and the guest's block say. A number no read sent leaves its
 * sentence without one, never a guessed one.
 */
export function howLines(
  board: Board | null | undefined,
  mine: MyRanks | null | undefined,
): { level: HowLine[]; race: HowLine[] } {
  const b = board && board.enabled ? board : null;
  const m = mine && mine.enabled ? mine : null;
  const touch = m?.touch ?? null;
  const race = m?.race ?? null;
  const r = rulesOf(board, mine);
  const gate = reliableRule(touch, r);

  const level: HowLine[] = [{ key: 'ranks.how.levelMoves' }, { key: 'ranks.how.levelMore' }];
  if (r && has(r.provisionalGames) && r.provisionalGames! > 0) {
    level.push({ key: 'ranks.how.levelFirstCount', params: { games: r.provisionalGames! } });
  } else if (!touch || touch.provisionalLeft > 0 || !touch.rated) {
    level.push({ key: 'ranks.how.levelFirst' });
  }
  level.push(gate ? { key: 'ranks.emptyLevel.rule', params: gate } : { key: 'ranks.emptyLevel.ruleNoNumbers' });
  if (r && has(r.inactiveDays)) level.push({ key: 'ranks.how.levelInactive', params: { days: r.inactiveDays! } });
  level.push(
    r && has(r.classAFrom, r.classBFrom)
      ? { key: 'ranks.how.levelClassBands', params: { a: formatLevel(r.classAFrom!), b: formatLevel(r.classBFrom!) } }
      : { key: 'ranks.how.levelClasses' },
  );
  const hidden = b ? !b.showLevel : touch ? !touch.showLevel : false;
  if (hidden) level.push({ key: 'ranks.how.levelHidden' });

  const out: HowLine[] = [{ key: `ranks.how.raceSeason.${b?.period ?? m?.period ?? 'quarter'}` }];
  if (r && has(r.raceWin, r.raceLoss)) {
    out.push(
      has(r.raceStrengthMax) && r.raceStrengthMax! > 1
        ? { key: 'ranks.how.racePointsMax', params: { win: r.raceWin!, loss: r.raceLoss!, max: formatFactor(r.raceStrengthMax!) } }
        : { key: 'ranks.how.racePoints', params: { win: r.raceWin!, loss: r.raceLoss! } },
    );
  } else if (m && race) {
    out.push({ key: 'ranks.how.racePoints', params: { win: m.rules.win, loss: m.rules.loss } });
  }
  const best = r?.raceBestMatches ?? race?.bestMatches ?? null;
  out.push(best !== null && best > 0 ? { key: 'ranks.how.raceBest', params: { best } } : { key: 'ranks.how.raceBestNoNumbers' });
  const bestT = r?.raceBestTournaments ?? race?.bestTournaments ?? null;
  if (bestT !== null && bestT > 0) out.push({ key: 'ranks.how.raceTournaments', params: { best: bestT } });
  const maxB = r?.boostMaxPerSeason ?? race?.boostsMax ?? null;
  if (maxB === null) out.push({ key: 'ranks.how.raceBoostsNoNumbers' });
  else if (maxB > 0) {
    out.push(
      r && has(r.boostOffpeak, r.boostWelcome)
        ? {
            key: 'ranks.how.raceBoostsSized',
            params: { offpeak: formatFactor(r.boostOffpeak!), welcome: formatFactor(r.boostWelcome!), max: maxB },
          }
        : { key: 'ranks.how.raceBoosts', params: { max: maxB } },
    );
  }
  out.push({ key: 'ranks.how.raceNeverLevel' });
  return { level, race: out };
}

/**
 * The player's type as Mine shows it: the last Level check that counted wins (the desk or a
 * coach set it), else what they picked themself, else none yet.
 */
export function myType(
  touch: MyTouch,
): { type: TypeCode | null; source: 'check' | 'self' | 'none'; role: CheckRole | null } {
  if (touch.checked) return { type: touch.checked.type, source: 'check', role: touch.checked.role };
  if (touch.selfType) return { type: touch.selfType, source: 'self', role: null };
  return { type: null, source: 'none', role: null };
}

/**
 * A coach's game (0444 `ranks_coach_record`): the first seat of each side is required, the
 * second may be empty, and nobody may be in it twice.
 */
export function coachSeatsReady(
  seats: readonly [string, string, string, string],
): 'ready' | 'missing' | 'repeat' {
  const [a1, a2, b1, b2] = seats.map(normaliseUsername) as [string, string, string, string];
  if (a1 === '' || b1 === '') return 'missing';
  const filled = [a1, a2, b1, b2].filter((n) => n !== '');
  return new Set(filled).size === filled.length ? 'ready' : 'repeat';
}

export type CoachWinner = 'a' | 'b' | 'draw';

export interface CoachRecordInput {
  a1: string;
  a2: string;
  b1: string;
  b2: string;
  winner: CoachWinner;
  /** "6-4, 7-5" (buildScore), or null. */
  score: string | null;
}

/** ranks_coach_record's arguments: usernames folded, an empty second seat and no score as null. */
export function coachRecordArgs(input: CoachRecordInput): {
  p_a1: string;
  p_a2: string | null;
  p_b1: string;
  p_b2: string | null;
  p_winner: CoachWinner;
  p_score: string | null;
} {
  const seat = (v: string) => (normaliseUsername(v) === '' ? null : normaliseUsername(v));
  return {
    p_a1: normaliseUsername(input.a1),
    p_a2: seat(input.a2),
    p_b1: normaliseUsername(input.b1),
    p_b2: seat(input.b2),
    p_winner: input.winner,
    p_score: input.score,
  };
}
