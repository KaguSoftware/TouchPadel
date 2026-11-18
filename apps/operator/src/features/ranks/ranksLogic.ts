/**
 * Player ranks on the operator (0364, Majed 2026-10-22; Touch Level and Season Race, 0443/0444,
 * Majed 2026-11-13 to 2026-11-16): the pure half of the screens. The shapes app.ranks_admin,
 * app.ranks_board, app.ranks_desk_results, app.ranks_level_checks_list and
 * app.ranks_results_to_check answer with, the drafts the forms edit, what each form refuses
 * before it calls the server, and the arguments each write sends. The server re-checks every
 * rule here (the migrations' function comments are the contract); these only keep a refusal
 * from being the first thing the person sees.
 */

// ---------------------------------------------------------------------------
// Server shapes
// ---------------------------------------------------------------------------

export type RanksPeriod = 'all' | 'month' | 'quarter';

export interface RanksSettings {
  enabled: boolean;
  win_points: number;
  loss_points: number;
  draw_points: number;
  period: RanksPeriod;
  board_size: number;
  count_reported: boolean;
  count_tournaments: boolean;
  report_hours: number;
  updated_at?: string | null;
}

/**
 * A tier (0444: by Touch Level). `min_points` is 0364's column, kept by the server as
 * min_level x 100 for older builds; this build reads and writes `min_level`.
 */
export interface RanksLevel {
  name_en: string;
  name_ar: string;
  min_level: number;
  min_points?: number;
}

/** app.ranks_admin() (0444). `rules` is what is in force, `overrides` only what the owner changed. */
export interface RanksAdmin {
  settings: RanksSettings;
  levels: RanksLevel[];
  rules?: RanksRules;
  defaults?: RanksRules;
  overrides?: Partial<RanksRules> | null;
  rebuild?: { at: string | null; results: number | null; ms: number | null } | null;
}

export interface BoardRow {
  rank: number;
  /** "First L." (app.match_display_name), null when the profile has no usable name. */
  name: string | null;
  points: number;
  /** The tier the player's Touch Level reaches. */
  level: RanksLevel | null;
  mine: boolean;
}

/** A row of 0444's Race board: the Race points, the Touch Level (null while it is hidden). */
export interface RaceRow {
  rank: number;
  name: string | null;
  mine: boolean;
  points: number;
  level: number | null;
  tier: RanksLevel | null;
  class: 'A' | 'B' | 'C' | null;
}

/** A row of 0444's Touch Level board (reliable players only). */
export interface LevelRow {
  rank: number;
  name: string | null;
  mine: boolean;
  level: number | null;
  tier: RanksLevel | null;
  class: 'A' | 'B' | 'C' | null;
}

/** app.ranks_board(): {enabled:false} while the owner has it off. 0444 adds the two boards. */
export type RanksBoard =
  | { enabled: false }
  | {
      enabled: true;
      period: RanksPeriod;
      from: string | null;
      size: number;
      rows: BoardRow[];
      headline?: Headline;
      show_level?: boolean;
      race?: RaceRow[];
      level?: LevelRow[];
    };

export type ResultStatus = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'voided';
export type ResultSource = 'player' | 'desk' | 'tournament';
export type Winner = 'a' | 'b' | 'draw';

/** app.ranks_staff_player_json: the desk knows its guests (full name, username), never a phone. */
export interface DeskPlayer {
  id: string;
  name: string | null;
  username: string | null;
  former: boolean;
}

/** One row of app.ranks_desk_results. */
export interface DeskResult {
  id: string;
  source: ResultSource;
  status: ResultStatus;
  winner: Winner;
  score: string | null;
  played_at: string;
  reported_at: string;
  reservation_id: string | null;
  void_reason: string | null;
  court: { name_en: string; name_ar: string } | null;
  a: [DeskPlayer | null, DeskPlayer | null];
  b: [DeskPlayer | null, DeskPlayer | null];
}

// ---------------------------------------------------------------------------
// The results list's filter
// ---------------------------------------------------------------------------

export type ResultsFilter = 'pending' | 'confirmed' | 'voided' | 'all';
export const RESULTS_FILTERS: readonly ResultsFilter[] = ['pending', 'confirmed', 'voided', 'all'];

/** The p_status a filter asks for: 'all' is null (every status, newest first). */
export function filterStatus(filter: ResultsFilter): ResultStatus | null {
  return filter === 'all' ? null : filter;
}

/** ranks_void takes a pending or a confirmed result; anything else is RANKS_RESULT_CLOSED. */
export function canVoidResult(r: Pick<DeskResult, 'status'>): boolean {
  return r.status === 'pending' || r.status === 'confirmed';
}

// ---------------------------------------------------------------------------
// Rules (set_ranks_settings)
// ---------------------------------------------------------------------------

/** The table's own checks (ranks_settings), so the form says the range before the server does. */
export const RULE_LIMITS = {
  win_points: { min: 0, max: 100 },
  loss_points: { min: 0, max: 100 },
  draw_points: { min: 0, max: 100 },
  board_size: { min: 3, max: 25 },
  report_hours: { min: 1, max: 336 },
} as const;

export type RuleNumberKey = keyof typeof RULE_LIMITS;

export type RulesDraft = Omit<RanksSettings, 'updated_at'>;

export function rulesDraft(s: RanksSettings): RulesDraft {
  return {
    enabled: s.enabled,
    win_points: s.win_points,
    loss_points: s.loss_points,
    draw_points: s.draw_points,
    period: s.period,
    board_size: s.board_size,
    count_reported: s.count_reported,
    count_tournaments: s.count_tournaments,
    report_hours: s.report_hours,
  };
}

/** Number fields outside the table's range. */
export function rulesErrors(d: RulesDraft): Partial<Record<RuleNumberKey, 'range'>> {
  const out: Partial<Record<RuleNumberKey, 'range'>> = {};
  for (const key of Object.keys(RULE_LIMITS) as RuleNumberKey[]) {
    const v = d[key];
    const { min, max } = RULE_LIMITS[key];
    if (!Number.isInteger(v) || v < min || v > max) out[key] = 'range';
  }
  return out;
}

/** Only the keys that changed: set_ranks_settings patches, and an unchanged rule is not sent. */
export function rulesPatch(draft: RulesDraft, saved: RulesDraft): Partial<RulesDraft> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof RulesDraft)[]) {
    if (draft[key] !== saved[key]) patch[key] = draft[key];
  }
  return patch as Partial<RulesDraft>;
}

// ---------------------------------------------------------------------------
// Tiers (set_ranks_levels, 0444: by Touch Level)
// ---------------------------------------------------------------------------

export const LEVELS_MAX = 10;
export const LEVEL_NAME_MAX = 24;
/** The Touch Level scale's top (app.ranks_rules_check level_max reaches 10). */
export const TIER_LEVEL_MAX = 10;

/** One editable row. `min` is a string so a half-typed "3." is not forced to 3. */
export interface LevelDraft {
  key: string;
  name_en: string;
  name_ar: string;
  min: string;
}

let levelSeq = 0;
function nextKey(prefix = 'level'): string {
  levelSeq += 1;
  return `${prefix}-${levelSeq}`;
}

/** A level as one decimal, the way the boards show it: 3 reads "3.0". */
export function levelText(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '';
}

/** The saved tiers as rows, lowest first; the first is the one at 0. */
export function levelsDraft(levels: readonly RanksLevel[]): LevelDraft[] {
  return [...levels]
    .sort((a, b) => a.min_level - b.min_level)
    .map((l) => ({ key: nextKey(), name_en: l.name_en, name_ar: l.name_ar, min: levelText(l.min_level) }));
}

/**
 * A new row under the last: it starts a step above the highest (the last gap again, or 1.0),
 * capped at the scale's top, so the list stays in order without the owner touching the number.
 */
export function addLevel(rows: readonly LevelDraft[]): LevelDraft[] {
  if (rows.length >= LEVELS_MAX) return [...rows];
  const mins = rows.map((r) => parseDecimal(r.min)).filter((n) => Number.isFinite(n));
  const top = mins.length ? Math.max(...mins) : 0;
  const prev = mins.length > 1 ? [...mins].sort((a, b) => a - b)[mins.length - 2]! : 0;
  const step = top - prev > 0 ? top - prev : 1;
  const next = rows.length === 0 ? 0 : Math.min(TIER_LEVEL_MAX, Math.round((top + step) * 10) / 10);
  return [...rows, { key: nextKey(), name_en: '', name_ar: '', min: levelText(next) }];
}

/** The first row is the base (everyone starts there) and cannot be removed. */
export function removeLevel(rows: readonly LevelDraft[], key: string): LevelDraft[] {
  const index = rows.findIndex((r) => r.key === key);
  if (index <= 0) return [...rows];
  return rows.filter((r) => r.key !== key);
}

export type LevelError = 'names' | 'level';

export interface LevelsCheck {
  /** Per row key. */
  rows: Record<string, LevelError[]>;
  count: boolean;
}

/**
 * What set_ranks_levels would refuse: 1 to 10 tiers, the first at 0, each name 1-24 characters
 * once trimmed, and every later tier strictly above the one before it at one decimal (the
 * server rounds to one decimal, so 3.04 and 3.0 would be the same tier).
 */
export function levelsErrors(rows: readonly LevelDraft[]): LevelsCheck {
  const out: LevelsCheck = { rows: {}, count: rows.length < 1 || rows.length > LEVELS_MAX };
  let prev = -1;
  rows.forEach((r, i) => {
    const errs: LevelError[] = [];
    const en = r.name_en.trim();
    const ar = r.name_ar.trim();
    if (en.length < 1 || en.length > LEVEL_NAME_MAX || ar.length < 1 || ar.length > LEVEL_NAME_MAX) {
      errs.push('names');
    }
    const raw = parseDecimal(r.min);
    const min = Number.isFinite(raw) ? Math.round(raw * 10) / 10 : NaN;
    const ok = i === 0 ? true : Number.isFinite(min) && min > prev && min <= TIER_LEVEL_MAX;
    if (!ok) errs.push('level');
    if (i === 0) prev = 0;
    else if (Number.isFinite(min)) prev = Math.max(prev, min);
    if (errs.length) out.rows[r.key] = errs;
  });
  return out;
}

export function levelsValid(check: LevelsCheck): boolean {
  return !check.count && Object.keys(check.rows).length === 0;
}

/** set_ranks_levels' p_levels: [{name_en, name_ar, min_level}], the first at 0, one decimal. */
export function levelsPayload(rows: readonly LevelDraft[]): RanksLevel[] {
  return rows.map((r, i) => ({
    name_en: r.name_en.trim(),
    name_ar: r.name_ar.trim(),
    min_level: i === 0 ? 0 : Math.round(parseDecimal(r.min) * 10) / 10,
  }));
}

/** Same tiers as saved (names trimmed), so Save stays off until something changed. */
export function levelsDirty(rows: readonly LevelDraft[], saved: readonly RanksLevel[]): boolean {
  const a = JSON.stringify(levelsPayload(rows));
  const b = JSON.stringify(
    [...saved].sort((x, y) => x.min_level - y.min_level).map((l) => ({
      name_en: l.name_en,
      name_ar: l.name_ar,
      min_level: Math.round(l.min_level * 10) / 10,
    })),
  );
  return a !== b;
}

// ---------------------------------------------------------------------------
// The score: built from per-set boxes, never typed as text
// ---------------------------------------------------------------------------

export const MAX_SETS = 5;

/** The same pattern game_results_score checks. */
export const SCORE_RE = /^[0-9]{1,2}-[0-9]{1,2}(, [0-9]{1,2}-[0-9]{1,2}){0,4}$/;

/** One set's games, side A then side B, as typed. */
export interface SetDraft {
  a: string;
  b: string;
}

export type ScoreBuild = { ok: true; score: string | null } | { ok: false; error: 'incomplete' | 'tooMany' };

/**
 * "6-4, 7-5" from the set boxes. A set left wholly empty is skipped (so no score at all is
 * null, the score being optional); a set with one side filled, or a number outside 0-99, is
 * refused rather than guessed.
 */
export function buildScore(sets: readonly SetDraft[]): ScoreBuild {
  const parts: string[] = [];
  for (const s of sets) {
    const a = s.a.trim();
    const b = s.b.trim();
    if (a === '' && b === '') continue;
    if (!/^\d{1,2}$/.test(a) || !/^\d{1,2}$/.test(b)) return { ok: false, error: 'incomplete' };
    parts.push(`${Number(a)}-${Number(b)}`);
  }
  if (parts.length === 0) return { ok: true, score: null };
  if (parts.length > MAX_SETS) return { ok: false, error: 'tooMany' };
  const score = parts.join(', ');
  return SCORE_RE.test(score) ? { ok: true, score } : { ok: false, error: 'incomplete' };
}

// ---------------------------------------------------------------------------
// Record a result (ranks_desk_record)
// ---------------------------------------------------------------------------

/** A player picked into a seat from the customer search. */
export interface SeatPlayer {
  id: string;
  name: string;
}

export type SeatKey = 'a1' | 'a2' | 'b1' | 'b2';
export const SEATS: readonly SeatKey[] = ['a1', 'a2', 'b1', 'b2'];

export interface RecordDraft {
  reservationId: string | null;
  seats: Record<SeatKey, SeatPlayer | null>;
  winner: Winner | null;
  sets: SetDraft[];
}

export function recordDraft(init?: { reservationId?: string | null; booker?: SeatPlayer | null }): RecordDraft {
  return {
    reservationId: init?.reservationId ?? null,
    seats: { a1: init?.booker ?? null, a2: null, b1: null, b2: null },
    winner: null,
    sets: [
      { a: '', b: '' },
      { a: '', b: '' },
    ],
  };
}

/**
 * Seat a player. A side's first seat fills before its second, so "A side's second seat may be
 * empty" never turns into a side with only a partner. Seating someone already on the court
 * moves them (the game_results_four check refuses a player twice).
 */
export function seatPlayer(d: RecordDraft, seat: SeatKey, player: SeatPlayer | null): RecordDraft {
  const seats = { ...d.seats };
  if (player) {
    for (const k of SEATS) if (seats[k]?.id === player.id) seats[k] = null;
  }
  seats[seat] = player;
  // Close the gap a cleared first seat leaves.
  if (!seats.a1 && seats.a2) [seats.a1, seats.a2] = [seats.a2, null];
  if (!seats.b1 && seats.b2) [seats.b1, seats.b2] = [seats.b2, null];
  return { ...d, seats };
}

export type RecordError = 'sides' | 'twice' | 'winner' | 'score';

export function recordErrors(d: RecordDraft): RecordError[] {
  const out: RecordError[] = [];
  if (!d.seats.a1 || !d.seats.b1) out.push('sides');
  const ids = SEATS.map((k) => d.seats[k]?.id).filter((x): x is string => Boolean(x));
  if (new Set(ids).size !== ids.length) out.push('twice');
  if (!d.winner) out.push('winner');
  if (!buildScore(d.sets).ok) out.push('score');
  return out;
}

/** app.ranks_desk_record's arguments, or null while the draft would be refused. */
export function recordArgs(d: RecordDraft): Record<string, string | null> | null {
  const built = buildScore(d.sets);
  if (recordErrors(d).length > 0 || !built.ok || !d.winner || !d.seats.a1 || !d.seats.b1) return null;
  return {
    p_reservation_id: d.reservationId,
    p_a1: d.seats.a1.id,
    p_a2: d.seats.a2?.id ?? null,
    p_b1: d.seats.b1.id,
    p_b2: d.seats.b2?.id ?? null,
    p_winner: d.winner,
    p_score: built.score,
  };
}

// ---------------------------------------------------------------------------
// Staff confirm and edit (0444: ranks_staff_confirm, ranks_edit_result; Majed 2026-11-16:
// "they themselves write it and it's confirmed; if they don't, the operator or coach can set it;
// the operator can confirm / edit / set")
// ---------------------------------------------------------------------------

/**
 * Confirm is offered on a player's report still waiting. ranks_desk_results reads a report whose
 * window lapsed as 'expired' whether or not a sweep has closed it, and ranks_staff_confirm takes
 * the lapsed one that is still open, so a lapsed player report offers it too (a closed one is
 * refused with RANKS_RESULT_CLOSED, shown beside the row).
 */
export function canStaffConfirm(r: Pick<DeskResult, 'status' | 'source'>): boolean {
  return r.source === 'player' && (r.status === 'pending' || r.status === 'expired');
}

/** ranks_edit_result takes a pending or confirmed result; a tournament match is corrected on the tournament. */
export function canEditResult(r: Pick<DeskResult, 'status' | 'source'>): boolean {
  return r.source !== 'tournament' && (r.status === 'pending' || r.status === 'confirmed');
}

/** A player on a result as a seat: their name, else @username, else nothing to show. */
export function seatOf(p: DeskPlayer | null): SeatPlayer | null {
  if (!p) return null;
  return { id: p.id, name: p.name ?? (p.username ? `@${p.username}` : '') };
}

/** "6-4, 7-5" back into set boxes (side A first); always at least two rows, as a new draft has. */
export function setsOfScore(score: string | null): SetDraft[] {
  const sets = (score && SCORE_RE.test(score) ? score.split(', ') : []).map((part) => {
    const [a, b] = part.split('-');
    return { a: a ?? '', b: b ?? '' };
  });
  while (sets.length < 2) sets.push({ a: '', b: '' });
  return sets;
}

/** The Edit dialog's draft: the result as it stands. */
export function draftFromResult(r: DeskResult): RecordDraft {
  return {
    reservationId: r.reservation_id,
    seats: { a1: seatOf(r.a[0]), a2: seatOf(r.a[1]), b1: seatOf(r.b[0]), b2: seatOf(r.b[1]) },
    winner: r.winner,
    sets: setsOfScore(r.score),
  };
}

export const EDIT_REASON_MIN = 3;

export function editReasonOk(reason: string): boolean {
  return reason.trim().length >= EDIT_REASON_MIN;
}

/** app.ranks_edit_result's arguments, or null while the draft or the reason would be refused. */
export function editArgs(d: RecordDraft, resultId: string, reason: string): Record<string, string | null> | null {
  const rec = recordArgs(d);
  if (!rec || !editReasonOk(reason)) return null;
  // The booking stays the old row's; ranks_edit_result takes no reservation.
  const { p_reservation_id: _booking, ...seats } = rec;
  return { p_result_id: resultId, ...seats, p_reason: reason.trim() };
}

// ---------------------------------------------------------------------------
// Adjust points (ranks_adjust)
// ---------------------------------------------------------------------------

export const ADJUST_MAX = 1000;

export type AdjustError = 'player' | 'amount' | 'reason';
export type AdjustSign = 'add' | 'remove';

export interface AdjustDraft {
  player: SeatPlayer | null;
  sign: AdjustSign;
  amount: number;
  note: string;
}

/** The signed delta ranks_adjust takes: "Take off" 5 is -5. */
export function adjustDelta(d: Pick<AdjustDraft, 'sign' | 'amount'>): number {
  return d.sign === 'remove' ? -d.amount : d.amount;
}

/** What ranks_adjust refuses: no player, 0 or more than 1,000 points, a reason under 3 characters. */
export function adjustErrors(d: AdjustDraft): AdjustError[] {
  const out: AdjustError[] = [];
  if (!d.player) out.push('player');
  if (!Number.isInteger(d.amount) || d.amount < 1 || d.amount > ADJUST_MAX) out.push('amount');
  if (d.note.trim().length < 3) out.push('reason');
  return out;
}

// ---------------------------------------------------------------------------
// The booking screen's "Record result"
// ---------------------------------------------------------------------------

/**
 * ranks_desk_record takes a booking that is not cancelled, expired or still pending payment;
 * a no-show had no game to score, so it is not offered either.
 */
export function bookingRecordable(r: { kind: string; status: string }): boolean {
  return r.kind === 'booking' && (r.status === 'confirmed' || r.status === 'arrived' || r.status === 'completed');
}

// ---------------------------------------------------------------------------
// Ranking rules (app.set_ranks_rules, 0443/0444)
// ---------------------------------------------------------------------------

export type Headline = 'race' | 'level';
export type CheckRole = 'coach' | 'court_desk' | 'manager' | 'owner';
/** The order the server's default lists them in, and the order this build always sends. */
export const CHECK_ROLES: readonly CheckRole[] = ['coach', 'court_desk', 'manager', 'owner'];

/** One off-peak window: weekdays (0 = Sunday) and a time of day, 'to' may be '24:00'. */
export interface OffpeakWindow {
  days: number[];
  from: string;
  to: string;
}

/**
 * Every number rule with app.ranks_rules_check's range. `whole` marks the rules the server
 * reads as an integer (a day count, a game count, a "best N", points): the check itself takes
 * any number in range, but the replay and the boards cast these with ::int, so a 5.5 would
 * break them. Points are whole here too, because the boards show whole points.
 */
export const NUMBER_RULES = {
  class_b_from: { min: 1, max: 7, whole: false },
  class_a_from: { min: 1, max: 7, whole: false },
  improved_days: { min: 7, max: 180, whole: true },
  improved_min_games: { min: 1, max: 50, whole: true },
  start_a: { min: 1, max: 7, whole: false },
  start_b: { min: 1, max: 7, whole: false },
  start_c: { min: 1, max: 7, whole: false },
  start_new: { min: 1, max: 7, whole: false },
  self_advanced: { min: 1, max: 7, whole: false },
  self_intermediate: { min: 1, max: 7, whole: false },
  self_beginner: { min: 1, max: 7, whole: false },
  self_new: { min: 1, max: 7, whole: false },
  start_unknown: { min: 1, max: 7, whole: false },
  scale: { min: 0.25, max: 4, whole: false },
  win_weight: { min: 0, max: 1, whole: false },
  k_provisional: { min: 0.01, max: 2, whole: false },
  k_settling: { min: 0.01, max: 2, whole: false },
  k_settled: { min: 0.01, max: 2, whole: false },
  provisional_games: { min: 0, max: 50, whole: true },
  settling_games: { min: 0, max: 200, whole: true },
  trust_tournament: { min: 0, max: 2, whole: false },
  trust_desk: { min: 0, max: 2, whole: false },
  trust_player: { min: 0, max: 2, whole: false },
  repeat_days: { min: 0, max: 365, whole: true },
  repeat_half_from: { min: 2, max: 100, whole: true },
  repeat_zero_from: { min: 2, max: 100, whole: true },
  soft_loss_below: { min: 1, max: 7, whole: false },
  soft_loss_factor: { min: 0, max: 1, whole: false },
  max_move: { min: 0.01, max: 2, whole: false },
  level_min: { min: 0, max: 7, whole: false },
  level_max: { min: 1, max: 10, whole: false },
  reliable_games: { min: 1, max: 100, whole: true },
  reliable_days: { min: 7, max: 730, whole: true },
  reliable_opponents: { min: 1, max: 50, whole: true },
  inactive_days: { min: 7, max: 730, whole: true },
  return_games: { min: 0, max: 50, whole: true },
  check_days: { min: 0, max: 730, whole: true },
  check_max_change: { min: 0, max: 7, whole: false },
  race_win: { min: 0, max: 1000, whole: true },
  race_strength_max: { min: 1, max: 10, whole: false },
  race_loss: { min: 0, max: 1000, whole: true },
  race_draw: { min: 0, max: 1000, whole: true },
  race_best_matches: { min: 1, max: 100, whole: true },
  race_best_tournaments: { min: 0, max: 50, whole: true },
  t_first: { min: 0, max: 10000, whole: true },
  t_second: { min: 0, max: 10000, whole: true },
  t_semi: { min: 0, max: 10000, whole: true },
  t_top_half: { min: 0, max: 10000, whole: true },
  t_played: { min: 0, max: 10000, whole: true },
  boost_offpeak: { min: 1, max: 10, whole: false },
  boost_event: { min: 1, max: 10, whole: false },
  boost_welcome: { min: 1, max: 10, whole: false },
  boost_max_per_season: { min: 0, max: 100, whole: true },
} as const satisfies Record<string, { min: number; max: number; whole: boolean }>;

export type NumberRuleKey = keyof typeof NUMBER_RULES;
export const NUMBER_RULE_KEYS = Object.keys(NUMBER_RULES) as NumberRuleKey[];
export type RuleKey = NumberRuleKey | 'headline' | 'show_level' | 'check_roles' | 'offpeak';

export type RanksRules = Record<NumberRuleKey, number> & {
  headline: Headline;
  show_level: boolean;
  check_roles: CheckRole[];
  offpeak: OffpeakWindow[];
};

/**
 * The rules whose change re-scores every player's Touch Level from history: where players
 * start, how a game moves the level, Level checks, and the inactivity gap (it decides when a
 * returning player's games count at the settling K). The board bands, Most improved, the
 * reliable gate, the Race and the boosts only change what the boards show.
 */
export const LEVEL_RULES: ReadonlySet<RuleKey> = new Set<RuleKey>([
  'start_a', 'start_b', 'start_c', 'start_new',
  'self_advanced', 'self_intermediate', 'self_beginner', 'self_new', 'start_unknown',
  'scale', 'win_weight', 'k_provisional', 'k_settling', 'k_settled', 'provisional_games', 'settling_games',
  'trust_tournament', 'trust_desk', 'trust_player', 'repeat_days', 'repeat_half_from', 'repeat_zero_from',
  'soft_loss_below', 'soft_loss_factor', 'max_move', 'level_min', 'level_max', 'return_games', 'inactive_days',
  'check_roles', 'check_days', 'check_max_change',
]);

/**
 * A decimal as typed: Arabic-Indic digits and the Arabic decimal separator are read as Latin,
 * a comma as the point. NaN for anything that is not a plain number.
 */
export function parseDecimal(raw: string): number {
  const s = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.');
  return /^\d+(\.\d+)?$|^\.\d+$/.test(s) ? Number(s) : NaN;
}

/** What may be typed into a number box: digits and one point, nothing else. */
export function decimalTyping(raw: string, whole: boolean): string {
  const s = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.]/g, '');
  if (whole) return s.replace(/\./g, '');
  const dot = s.indexOf('.');
  return dot < 0 ? s : s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
}

/** One off-peak window as the editor holds it (a key for React, the days kept sorted). */
export interface OffpeakDraft extends OffpeakWindow {
  key: string;
}

export interface RulesEditDraft {
  nums: Record<NumberRuleKey, string>;
  headline: Headline;
  show_level: boolean;
  check_roles: CheckRole[];
  offpeak: OffpeakDraft[];
  period: RanksPeriod;
}

function numberText(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
}

/** The rules in force (and the season length, a ranks_settings column) as the editor's draft. */
export function rulesEditDraft(rules: RanksRules, period: RanksPeriod): RulesEditDraft {
  const nums = {} as Record<NumberRuleKey, string>;
  for (const k of NUMBER_RULE_KEYS) nums[k] = numberText(Number(rules[k]));
  return {
    nums,
    headline: rules.headline === 'level' ? 'level' : 'race',
    show_level: rules.show_level !== false,
    check_roles: CHECK_ROLES.filter((r) => (rules.check_roles ?? []).includes(r)),
    offpeak: (rules.offpeak ?? []).map((w) => ({
      key: nextKey('offpeak'),
      days: [...w.days].sort((a, b) => a - b),
      from: w.from,
      to: w.to,
    })),
    period,
  };
}

export const OFFPEAK_MAX = 20;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes since midnight; '24:00' is 1440. NaN for anything else. */
export function minutesOf(t: string): number {
  if (t === '24:00') return 1440;
  if (!HHMM.test(t)) return NaN;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

/** A new window: the weekdays, 10:00 to 16:00 (the quiet middle of the day). */
export function addOffpeak(rows: readonly OffpeakDraft[]): OffpeakDraft[] {
  if (rows.length >= OFFPEAK_MAX) return [...rows];
  return [...rows, { key: nextKey('offpeak'), days: [0, 1, 2, 3, 4], from: '10:00', to: '16:00' }];
}

export function toggleOffpeakDay(w: OffpeakDraft, day: number): OffpeakDraft {
  const days = w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort((a, b) => a - b);
  return { ...w, days };
}

export type RuleError = 'range' | 'whole' | 'order';
export type OffpeakError = 'days' | 'time';

export interface RulesCheck {
  fields: Partial<Record<NumberRuleKey, RuleError>>;
  /** Per off-peak window key. */
  offpeak: Record<string, OffpeakError[]>;
}

/**
 * app.ranks_rules_check, mirrored: each number in its range (and whole where the server reads
 * an integer), then the set as a whole: class A above B, the top level above the bottom, "no
 * points from" not before "half points from", settling not before provisional, tournament
 * points falling with the place. Each window needs a weekday and must end after it starts
 * (the server would keep a window that never matches; refusing it here is kinder).
 */
export function rulesCheck(d: RulesEditDraft): RulesCheck {
  const fields: RulesCheck['fields'] = {};
  const n = {} as Record<NumberRuleKey, number>;
  for (const k of NUMBER_RULE_KEYS) {
    const spec = NUMBER_RULES[k];
    const v = parseDecimal(d.nums[k]);
    n[k] = v;
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) fields[k] = 'range';
    else if (spec.whole && !Number.isInteger(v)) fields[k] = 'whole';
  }
  const both = (a: NumberRuleKey, b: NumberRuleKey) => !fields[a] && !fields[b];
  if (both('class_a_from', 'class_b_from') && n.class_a_from <= n.class_b_from) fields.class_a_from = 'order';
  if (both('level_max', 'level_min') && n.level_max <= n.level_min) fields.level_max = 'order';
  if (both('repeat_zero_from', 'repeat_half_from') && n.repeat_zero_from < n.repeat_half_from) fields.repeat_zero_from = 'order';
  if (both('settling_games', 'provisional_games') && n.settling_games < n.provisional_games) fields.settling_games = 'order';
  const places: NumberRuleKey[] = ['t_first', 't_second', 't_semi', 't_top_half', 't_played'];
  if (places.every((k) => !fields[k])) {
    for (let i = 1; i < places.length; i += 1) {
      if (n[places[i]!] > n[places[i - 1]!]) fields[places[i]!] = 'order';
    }
  }
  const offpeak: RulesCheck['offpeak'] = {};
  for (const w of d.offpeak) {
    const errs: OffpeakError[] = [];
    if (w.days.length === 0) errs.push('days');
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    if (!Number.isFinite(from) || from >= 1440 || !Number.isFinite(to) || to <= from) errs.push('time');
    if (errs.length) offpeak[w.key] = errs;
  }
  return { fields, offpeak };
}

export function rulesCheckValid(c: RulesCheck, d: RulesEditDraft): boolean {
  return Object.keys(c.fields).length === 0 && Object.keys(c.offpeak).length === 0 && d.offpeak.length <= OFFPEAK_MAX;
}

/** A rule's value in the draft, in the server's JSON shape (a number box that does not parse is NaN). */
export function draftValue(d: RulesEditDraft, key: RuleKey): unknown {
  switch (key) {
    case 'headline':
      return d.headline;
    case 'show_level':
      return d.show_level;
    case 'check_roles':
      return CHECK_ROLES.filter((r) => d.check_roles.includes(r));
    case 'offpeak':
      return d.offpeak.map((w) => ({ days: [...w.days].sort((a, b) => a - b), from: w.from, to: w.to }));
    default:
      return parseDecimal(d.nums[key]);
  }
}

/** Order-proof equality for a rule's value: role lists as sets, windows with sorted days. */
export function sameRuleValue(key: RuleKey, a: unknown, b: unknown): boolean {
  if (key === 'check_roles') {
    const x = new Set(Array.isArray(a) ? (a as string[]) : []);
    const y = new Set(Array.isArray(b) ? (b as string[]) : []);
    return x.size === y.size && [...x].every((r) => y.has(r));
  }
  if (key === 'offpeak') {
    const norm = (v: unknown) =>
      JSON.stringify(
        (Array.isArray(v) ? (v as OffpeakWindow[]) : []).map((w) => ({
          days: [...(w.days ?? [])].sort((p, q) => p - q),
          from: w.from,
          to: w.to,
        })),
      );
    return norm(a) === norm(b);
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

export const ALL_RULE_KEYS: readonly RuleKey[] = ['headline', 'show_level', ...NUMBER_RULE_KEYS, 'check_roles', 'offpeak'];

/**
 * set_ranks_rules' p_rules: every rule that differs from its default, in the server's shape.
 * The server REPLACES the overrides with this, so a rule left out goes back to its default;
 * that is how "Back to default" is saved.
 */
export function rulesOverrides(d: RulesEditDraft, defaults: RanksRules): Partial<Record<RuleKey, unknown>> {
  const out: Partial<Record<RuleKey, unknown>> = {};
  for (const k of ALL_RULE_KEYS) {
    const v = draftValue(d, k);
    if (!sameRuleValue(k, v, defaults[k])) out[k] = v;
  }
  return out;
}

/** The rules the draft changes against what is in force now. */
export function changedRules(d: RulesEditDraft, inForce: RanksRules): RuleKey[] {
  return ALL_RULE_KEYS.filter((k) => !sameRuleValue(k, draftValue(d, k), inForce[k]));
}

/** Whether saving these changes re-scores every player's level (the screen asks first). */
export function rescoresLevels(changed: readonly RuleKey[]): boolean {
  return changed.some((k) => LEVEL_RULES.has(k));
}

export function isDefaultRule(d: RulesEditDraft, key: RuleKey, defaults: RanksRules): boolean {
  return sameRuleValue(key, draftValue(d, key), defaults[key]);
}

/** The draft with one rule put back to its default. */
export function resetRule(d: RulesEditDraft, key: RuleKey, defaults: RanksRules): RulesEditDraft {
  switch (key) {
    case 'headline':
      return { ...d, headline: defaults.headline };
    case 'show_level':
      return { ...d, show_level: defaults.show_level };
    case 'check_roles':
      return { ...d, check_roles: CHECK_ROLES.filter((r) => defaults.check_roles.includes(r)) };
    case 'offpeak':
      return { ...d, offpeak: rulesEditDraft(defaults, d.period).offpeak };
    default:
      return { ...d, nums: { ...d.nums, [key]: numberText(Number(defaults[key])) } };
  }
}

/** The default shown beside a changed rule, as text (numbers as the server holds them). */
export function defaultText(key: NumberRuleKey, defaults: RanksRules): string {
  return numberText(Number(defaults[key]));
}

// ---------------------------------------------------------------------------
// The two review lists (0444)
// ---------------------------------------------------------------------------

export type CheckClass = 'A' | 'B' | 'C' | 'new';

/** One row of app.ranks_level_checks_list. */
export interface LevelCheck {
  id: string;
  player: DeskPlayer | null;
  class: CheckClass;
  role: CheckRole | string | null;
  checked_by: string | null;
  checked_at: string;
  note: string | null;
  applied: boolean;
  level_set: number | null;
  games_after: number | null;
  level_after: number | null;
  drift: number | null;
}

/** A drift worth a colour: the player's level moved this far from what the checker gave. */
export const DRIFT_FLAG = 0.3;

export function driftFlagged(drift: number | null | undefined): boolean {
  return typeof drift === 'number' && Math.abs(drift) >= DRIFT_FLAG - 1e-9;
}

/** "+0.4" / "−0.5" / "0.0": signed, one decimal, a real minus sign. */
export function signedLevel(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0.0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
}

/** One side of a pair in app.ranks_results_to_check. */
export interface CheckResult {
  id: string;
  played_at: string;
  score: string | null;
  source: ResultSource;
  winner: Winner;
  a: [DeskPlayer | null, DeskPlayer | null];
  b: [DeskPlayer | null, DeskPlayer | null];
}

export interface ResultPair {
  first: CheckResult;
  second: CheckResult;
}
