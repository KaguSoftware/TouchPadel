/**
 * Player ranks on the operator (0364, Majed 2026-10-22): the pure half of the screens. The
 * shapes app.ranks_admin, app.ranks_board and app.ranks_desk_results answer with, the drafts
 * the forms edit, what each form refuses before it calls the server, and the arguments each
 * write sends. The server re-checks every rule here (the migration's function comments are the
 * contract); these only keep a refusal from being the first thing the person sees.
 */

// ---------------------------------------------------------------------------
// Server shapes
// ---------------------------------------------------------------------------

export type RanksPeriod = 'all' | 'month' | 'quarter';
export const RANKS_PERIODS: readonly RanksPeriod[] = ['all', 'month', 'quarter'];

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

export interface RanksLevel {
  name_en: string;
  name_ar: string;
  min_points: number;
}

/** app.ranks_admin(). */
export interface RanksAdmin {
  settings: RanksSettings;
  levels: RanksLevel[];
}

export interface BoardRow {
  rank: number;
  /** "First L." (app.match_display_name), null when the profile has no usable name. */
  name: string | null;
  points: number;
  level: RanksLevel | null;
  mine: boolean;
}

/** app.ranks_board(): {enabled:false} while the owner has it off. */
export type RanksBoard =
  | { enabled: false }
  | { enabled: true; period: RanksPeriod; from: string | null; size: number; rows: BoardRow[] };

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
// Levels (set_ranks_levels)
// ---------------------------------------------------------------------------

export const LEVELS_MAX = 10;
export const LEVEL_NAME_MAX = 24;

/** One editable row. `min` is a string so a half-typed number is not forced to 0. */
export interface LevelDraft {
  key: string;
  name_en: string;
  name_ar: string;
  min: string;
}

let levelSeq = 0;
function nextKey(): string {
  levelSeq += 1;
  return `level-${levelSeq}`;
}

/** The saved levels as rows, lowest first; the first is the one at 0. */
export function levelsDraft(levels: readonly RanksLevel[]): LevelDraft[] {
  return [...levels]
    .sort((a, b) => a.min_points - b.min_points)
    .map((l) => ({ key: nextKey(), name_en: l.name_en, name_ar: l.name_ar, min: String(l.min_points) }));
}

/**
 * A new row under the last: its points start a step above the highest (the last gap again,
 * or 10), so the list stays in order without the owner touching the number first.
 */
export function addLevel(rows: readonly LevelDraft[]): LevelDraft[] {
  if (rows.length >= LEVELS_MAX) return [...rows];
  const mins = rows.map((r) => Number(r.min)).filter((n) => Number.isFinite(n));
  const top = mins.length ? Math.max(...mins) : 0;
  const prev = mins.length > 1 ? [...mins].sort((a, b) => a - b)[mins.length - 2]! : 0;
  const step = top - prev > 0 ? top - prev : 10;
  return [...rows, { key: nextKey(), name_en: '', name_ar: '', min: String(rows.length === 0 ? 0 : top + step) }];
}

/** The first row is the base (everyone starts there) and cannot be removed. */
export function removeLevel(rows: readonly LevelDraft[], key: string): LevelDraft[] {
  const index = rows.findIndex((r) => r.key === key);
  if (index <= 0) return [...rows];
  return rows.filter((r) => r.key !== key);
}

export type LevelError = 'names' | 'points';

export interface LevelsCheck {
  /** Per row key. */
  rows: Record<string, LevelError[]>;
  count: boolean;
}

/**
 * What set_ranks_levels would refuse: 1 to 10 levels, the first at 0, each name 1-24 characters
 * once trimmed, and every later level strictly above the one before it (which also keeps two
 * levels off the same points, the table's unique key).
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
    const min = /^\d+$/.test(r.min) ? Number(r.min) : NaN;
    const ok = i === 0 ? min === 0 : Number.isInteger(min) && min > prev && min <= 1_000_000;
    if (!ok) errs.push('points');
    if (Number.isFinite(min)) prev = Math.max(prev, min);
    if (errs.length) out.rows[r.key] = errs;
  });
  return out;
}

export function levelsValid(check: LevelsCheck): boolean {
  return !check.count && Object.keys(check.rows).length === 0;
}

export function levelsPayload(rows: readonly LevelDraft[]): RanksLevel[] {
  return rows.map((r, i) => ({
    name_en: r.name_en.trim(),
    name_ar: r.name_ar.trim(),
    min_points: i === 0 ? 0 : Number(r.min),
  }));
}

/** Same levels as saved (names trimmed), so Save stays off until something changed. */
export function levelsDirty(rows: readonly LevelDraft[], saved: readonly RanksLevel[]): boolean {
  const a = JSON.stringify(levelsPayload(rows));
  const b = JSON.stringify(
    [...saved].sort((x, y) => x.min_points - y.min_points).map((l) => ({
      name_en: l.name_en,
      name_ar: l.name_ar,
      min_points: l.min_points,
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
