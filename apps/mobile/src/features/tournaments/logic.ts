/**
 * Tournaments on the guest's phone, decided in PURE code (no RN / expo / supabase imports, so
 * vitest runs it under plain node). Plan §5.2; build contracts §1.6, §1.8, S13.
 *
 * Binding shapes: `TOURNAMENT_SHAPES` (`@touch/core/tournaments`). Every parser below reads
 * exactly the keys its shape lists, top level and nested, and nothing else:
 * `__tests__/logic.test.ts` runs each one over a recording proxy and holds the keys it read equal
 * to the shape. A server may add keys; it never renames or drops one, and a missing one falls back
 * here rather than throwing.
 *
 * The phone never computes standings, a fee owed, a place left or a refusal: it renders what
 * `tournaments_public` / `tournament_public` sent and parses every enum defensively (an unknown
 * value falls back, never throws). The helpers only arrange what the server decided: which rows a
 * filter lists, which action the detail offers, whether the read is worth polling.
 */
import type { Locale } from '@touch/i18n';
import type { MatchCategory } from '../matches/logic';

// ── Server vocabulary (build contracts §1.3) ────────────────────────────────

export const TOUR_FORMATS = ['americano', 'mexicano'] as const;
export type TourFormat = (typeof TOUR_FORMATS)[number];

export const TOUR_STATUSES = ['open', 'closed', 'running', 'finished', 'cancelled'] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];

export const TOUR_ENTRY_STATUSES = ['registered', 'waitlisted', 'withdrawn', 'no_show'] as const;
export type TourEntryStatus = (typeof TOUR_ENTRY_STATUSES)[number];

const CATEGORIES = ['open', 'women', 'men'] as const satisfies readonly MatchCategory[];

/** The zone a branch's times read in when an answer names none (every branch today). */
export const DEFAULT_TZ = 'Asia/Baghdad';

// ── Defensive readers ───────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const obj = (v: unknown): Json =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
};
const bool = (v: unknown): boolean => v === true;
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null;

// ── Shared pieces ───────────────────────────────────────────────────────────

/** A branch as the public reads carry it, with the zone its times read in. */
export interface TourBranch {
  venueId: string;
  nameEn: string | null;
  nameAr: string | null;
  timezone: string;
}

function parseBranch(json: unknown): TourBranch | null {
  const o = obj(json);
  const venueId = str(o.venue_id);
  if (!venueId) return null;
  return {
    venueId,
    nameEn: str(o.name_en),
    nameAr: str(o.name_ar),
    timezone: str(o.timezone) ?? DEFAULT_TZ,
  };
}

/**
 * A player as a public surface shows them (§1.8): "First I." or null, `former` for a deleted
 * account, `no` the seed number a nameless player is called by ("Player 3").
 */
export interface TourPlayer {
  name: string | null;
  former: boolean;
  no: number | null;
}

function parsePlayer(json: unknown): TourPlayer {
  const o = obj(json);
  return { name: str(o.name), former: bool(o.former), no: int(o.no) };
}

/** The guest's own entry on a list row. */
export interface TourMine {
  entryId: string;
  status: TourEntryStatus | null;
  waitlistPosition: number | null;
}

function parseMine(json: unknown): TourMine | null {
  if (json === null || json === undefined) return null;
  const o = obj(json);
  const entryId = str(o.entry_id);
  if (!entryId) return null;
  return {
    entryId,
    status: oneOf(o.status, TOUR_ENTRY_STATUSES),
    waitlistPosition: int(o.waitlist_position),
  };
}

// ── tournaments_public (the list, Mine, the Book row) ───────────────────────

export interface TourListItem {
  id: string;
  venueId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  format: TourFormat | null;
  category: MatchCategory;
  startsAt: string;
  endsAt: string | null;
  registrationClosesAt: string | null;
  entryFeeIqd: number;
  prizeEn: string | null;
  prizeAr: string | null;
  maxEntries: number | null;
  placesLeft: number;
  waitlistOpen: boolean;
  status: TourStatus | null;
  mine: TourMine | null;
}

export interface TournamentsPublic {
  /** Every branch is switched off (or none is known): the list shows the notice and nothing else. */
  off: boolean;
  serverNow: string | null;
  branches: TourBranch[];
  tournaments: TourListItem[];
}

function parseListItem(json: unknown): TourListItem | null {
  const o = obj(json);
  const id = str(o.id);
  const startsAt = str(o.starts_at);
  if (!id || !startsAt) return null;
  return {
    id,
    venueId: str(o.venue_id),
    nameEn: str(o.name_en),
    nameAr: str(o.name_ar),
    format: oneOf(o.format, TOUR_FORMATS),
    category: oneOf(o.category, CATEGORIES) ?? 'open',
    startsAt,
    endsAt: str(o.ends_at),
    registrationClosesAt: str(o.registration_closes_at),
    entryFeeIqd: int(o.entry_fee_iqd) ?? 0,
    prizeEn: str(o.prize_en),
    prizeAr: str(o.prize_ar),
    maxEntries: int(o.max_entries),
    placesLeft: Math.max(0, int(o.places_left) ?? 0),
    waitlistOpen: bool(o.waitlist_open),
    status: oneOf(o.status, TOUR_STATUSES),
    mine: parseMine(o.mine),
  };
}

export function parseTournamentsPublic(json: unknown): TournamentsPublic {
  const o = obj(json);
  if (bool(o.off)) return { off: true, serverNow: null, branches: [], tournaments: [] };
  return {
    off: false,
    serverNow: str(o.server_now),
    branches: list(o.branches)
      .map(parseBranch)
      .filter((b): b is TourBranch => b !== null),
    tournaments: list(o.tournaments)
      .map(parseListItem)
      .filter((t): t is TourListItem => t !== null),
  };
}

// ── tournament_public (the detail) ──────────────────────────────────────────

export interface TourPublicMatch {
  courtNo: number | null;
  a: TourPlayer[];
  b: TourPlayer[];
  pointsA: number | null;
  pointsB: number | null;
}

export interface TourPublicRound {
  roundNo: number;
  sitOut: TourPlayer[];
  matches: TourPublicMatch[];
}

export interface TourPublicStanding {
  rank: number | null;
  player: TourPlayer;
  pointsWon: number;
  diff: number;
  played: number;
  /** 0311 (c27): the entry left the play (withdrawn or a no-show); ranked after the rest. */
  withdrawn: boolean;
}

/** The guest's own entry on the detail, with what the desk takes on the day. */
export interface TourMe extends TourMine {
  owedIqd: number;
}

export interface TournamentPublic {
  /** Unknown, branch off or closed, or cancelled more than 7 days ago: one "not available" state. */
  missing: boolean;
  id: string;
  venueId: string | null;
  branch: TourBranch | null;
  nameEn: string | null;
  nameAr: string | null;
  format: TourFormat | null;
  category: MatchCategory;
  pointsTarget: number | null;
  roundsPlanned: number | null;
  startsAt: string;
  endsAt: string | null;
  registrationClosesAt: string | null;
  entryFeeIqd: number;
  prizeEn: string | null;
  prizeAr: string | null;
  status: TourStatus | null;
  maxEntries: number | null;
  entriesCount: number;
  placesLeft: number;
  waitlistOpen: boolean;
  serverNow: string | null;
  rounds: TourPublicRound[];
  standings: TourPublicStanding[];
  me: TourMe | null;
}

const MISSING: Omit<TournamentPublic, 'id'> = {
  missing: true,
  venueId: null,
  branch: null,
  nameEn: null,
  nameAr: null,
  format: null,
  category: 'open',
  pointsTarget: null,
  roundsPlanned: null,
  startsAt: '',
  endsAt: null,
  registrationClosesAt: null,
  entryFeeIqd: 0,
  prizeEn: null,
  prizeAr: null,
  status: null,
  maxEntries: null,
  entriesCount: 0,
  placesLeft: 0,
  waitlistOpen: false,
  serverNow: null,
  rounds: [],
  standings: [],
  me: null,
};

function parseMatch(json: unknown): TourPublicMatch {
  const o = obj(json);
  return {
    courtNo: int(o.court_no),
    a: list(o.a).map(parsePlayer),
    b: list(o.b).map(parsePlayer),
    pointsA: int(o.points_a),
    pointsB: int(o.points_b),
  };
}

function parseRound(json: unknown): TourPublicRound | null {
  const o = obj(json);
  const roundNo = int(o.round_no);
  if (roundNo === null) return null;
  return {
    roundNo,
    sitOut: list(o.sit_out).map(parsePlayer),
    matches: list(o.matches).map(parseMatch),
  };
}

function parseStanding(json: unknown): TourPublicStanding {
  const o = obj(json);
  return {
    rank: int(o.rank),
    player: parsePlayer(o.player),
    pointsWon: int(o.points_won) ?? 0,
    diff: int(o.diff) ?? 0,
    played: int(o.played) ?? 0,
    withdrawn: bool(o.withdrawn),
  };
}

function parseMe(json: unknown): TourMe | null {
  const mine = parseMine(json);
  if (!mine) return null;
  return { ...mine, owedIqd: Math.max(0, int(obj(json).owed_iqd) ?? 0) };
}

/** `id` is the id the screen asked for: a `{missing: true}` answer carries none. */
export function parseTournamentPublic(json: unknown, id: string): TournamentPublic {
  const o = obj(json);
  if (bool(o.missing)) return { ...MISSING, id };
  const startsAt = str(o.starts_at);
  if (!startsAt) return { ...MISSING, id };
  return {
    missing: false,
    id: str(o.id) ?? id,
    venueId: str(o.venue_id),
    branch: parseBranch(o.branch),
    nameEn: str(o.name_en),
    nameAr: str(o.name_ar),
    format: oneOf(o.format, TOUR_FORMATS),
    category: oneOf(o.category, CATEGORIES) ?? 'open',
    pointsTarget: int(o.points_target),
    roundsPlanned: int(o.rounds_planned),
    startsAt,
    endsAt: str(o.ends_at),
    registrationClosesAt: str(o.registration_closes_at),
    entryFeeIqd: int(o.entry_fee_iqd) ?? 0,
    prizeEn: str(o.prize_en),
    prizeAr: str(o.prize_ar),
    status: oneOf(o.status, TOUR_STATUSES),
    maxEntries: int(o.max_entries),
    entriesCount: int(o.entries_count) ?? 0,
    placesLeft: Math.max(0, int(o.places_left) ?? 0),
    waitlistOpen: bool(o.waitlist_open),
    serverNow: str(o.server_now),
    rounds: list(o.rounds)
      .map(parseRound)
      .filter((r): r is TourPublicRound => r !== null)
      .sort((x, y) => x.roundNo - y.roundNo),
    standings: list(o.standings).map(parseStanding),
    me: parseMe(o.me),
  };
}

// ── Writes (S13) ────────────────────────────────────────────────────────────

export interface RegisterResult {
  entryId: string;
  status: TourEntryStatus | null;
  waitlistPosition: number | null;
  /** A live entry answered again (a double tap): nothing changed. */
  duplicate: boolean;
}

export function parseRegisterResult(json: unknown): RegisterResult {
  const o = obj(json);
  const entryId = str(o.entry_id);
  if (!entryId) throw new Error('MALFORMED_TOURNAMENT_REGISTER');
  return {
    entryId,
    status: oneOf(o.status, TOUR_ENTRY_STATUSES),
    waitlistPosition: int(o.waitlist_position),
    duplicate: bool(o.duplicate),
  };
}

export interface WithdrawResult {
  entryId: string;
  status: TourEntryStatus | null;
  /** Desk money paid before the withdrawal, which the desk hands back. */
  refundDueIqd: number;
  duplicate: boolean;
}

export function parseWithdrawResult(json: unknown): WithdrawResult {
  const o = obj(json);
  const entryId = str(o.entry_id);
  if (!entryId) throw new Error('MALFORMED_TOURNAMENT_WITHDRAW');
  return {
    entryId,
    status: oneOf(o.status, TOUR_ENTRY_STATUSES),
    refundDueIqd: Math.max(0, int(o.refund_due_iqd) ?? 0),
    duplicate: bool(o.duplicate),
  };
}

// ── Gating (rule: switch off means no guest work at all) ────────────────────

/** The branch knob the phone reads from `venue_settings_public` (tournaments file 1). */
export interface TournamentsBranchSettings {
  tournaments_enabled?: boolean | null;
}

/** The branch has tournaments switched on (the twin of coaching's `coachingEnabled`). */
export function tournamentsEnabled(
  settings: TournamentsBranchSettings | null | undefined,
): boolean {
  return settings?.tournaments_enabled === true;
}

/** Some open branch has tournaments on: Profile shows "My tournaments". */
export function anyTournaments(
  branches: readonly { tournaments_enabled?: boolean | null }[] | null | undefined,
): boolean {
  return (branches ?? []).some((b) => b.tournaments_enabled === true);
}

// ── Arranging what the server sent ──────────────────────────────────────────

export type TourFilter = 'upcoming' | 'mine';

/** The statuses a guest can still play in or watch live. */
const UPCOMING: ReadonlySet<TourStatus> = new Set<TourStatus>(['open', 'closed', 'running']);

/** A live own entry: registered, on the waitlist, or marked absent (not withdrawn). */
export function isOwnEntry(mine: TourMine | null): boolean {
  return mine !== null && mine.status !== null && mine.status !== 'withdrawn';
}

/**
 * The list's rows: Upcoming is everything not yet finished, Mine every tournament the guest is
 * entered in (finished ones included, the server keeps them for 7 days). Soonest first, then by
 * id so the order is stable.
 */
export function tournamentRows(pub: TournamentsPublic, filter: TourFilter): TourListItem[] {
  const rows = pub.tournaments.filter((t) =>
    filter === 'mine' ? isOwnEntry(t.mine) : t.status !== null && UPCOMING.has(t.status),
  );
  return rows.sort((a, b) =>
    a.startsAt === b.startsAt ? a.id.localeCompare(b.id) : a.startsAt.localeCompare(b.startsAt),
  );
}

/** The `?filter=` param a screen opened with (Profile's row asks for `mine`). */
export function filterFromParam(raw: unknown): TourFilter {
  return raw === 'mine' ? 'mine' : 'upcoming';
}

/** A tournament's name in the screen's language, the other as a fallback. */
export function tournamentName(
  t: { nameEn: string | null; nameAr: string | null },
  locale: Locale,
): string {
  return (locale === 'ar' ? (t.nameAr ?? t.nameEn) : (t.nameEn ?? t.nameAr)) ?? '';
}

/** A prize line in the screen's language, or null. */
export function prizeText(
  t: { prizeEn: string | null; prizeAr: string | null },
  locale: Locale,
): string | null {
  return locale === 'ar' ? (t.prizeAr ?? t.prizeEn) : (t.prizeEn ?? t.prizeAr);
}

/** The zone a row's times read in: its branch's, else Baghdad. */
export function timezoneOf(pub: TournamentsPublic, venueId: string | null): string {
  return pub.branches.find((b) => b.venueId === venueId)?.timezone ?? DEFAULT_TZ;
}

/**
 * How a player reads (§1.8): the name, "Former player" for a deleted account, else
 * "Player {no}". `labels` carries the two words so this stays pure.
 */
export function playerLabel(
  p: TourPlayer,
  labels: { former: string; numbered: (no: string) => string },
): string {
  if (p.former) return labels.former;
  if (p.name) return p.name;
  return labels.numbered(p.no === null ? '?' : String(p.no));
}

/**
 * What the detail offers the guest. The server stays the wall (it refuses a late or full
 * register); this only keeps the screen from offering what it would refuse.
 *
 *  register   open, before the cut-off, a place left, not entered
 *  waitlist   the same, no place left but the waitlist open
 *  withdraw   open, before the cut-off, registered or waitlisted
 *  full       open and before the cut-off, no place and no waitlist
 *  closed     past the cut-off, or closed / running / finished / cancelled
 */
export type TourAction = 'register' | 'waitlist' | 'withdraw' | 'full' | 'closed';

export function tourActionOf(t: TournamentPublic, nowMs: number): TourAction {
  const cutoff = t.registrationClosesAt ? Date.parse(t.registrationClosesAt) : NaN;
  const open = t.status === 'open' && !(Number.isFinite(cutoff) && nowMs >= cutoff);
  if (!open) return 'closed';
  const own = t.me?.status;
  if (own === 'registered' || own === 'waitlisted') return 'withdraw';
  if (t.placesLeft > 0) return 'register';
  return t.waitlistOpen ? 'waitlist' : 'full';
}

/**
 * Where the registration stands, for the list row and the detail's "Places left": the places
 * while registration is open, then full or waitlist-only; once it is closed (or in play,
 * finished, cancelled) the tournament's state, because the server's places_left is counted
 * whatever the status (the web's `placesLine`). An unknown status reads as places.
 */
export type TourPlaces =
  | { kind: 'left'; count: number }
  | { kind: 'waitlist' }
  | { kind: 'full' }
  | { kind: 'status'; status: Exclude<TourStatus, 'open'> };

export function tourPlacesOf(
  t: Pick<TourListItem, 'status' | 'placesLeft' | 'waitlistOpen'>,
): TourPlaces {
  if (t.status !== null && t.status !== 'open') return { kind: 'status', status: t.status };
  if (t.placesLeft > 0) return { kind: 'left', count: t.placesLeft };
  return t.waitlistOpen ? { kind: 'waitlist' } : { kind: 'full' };
}

/**
 * How full a list card's bar reads, 0–100: the entries taken of the maximum, from the server's
 * places_left (counted whatever the status). Null when the tournament names no maximum, so the
 * card draws no bar. The operator's `fillPercent` (2026-10-05 cards).
 */
export function tourFillPercent(t: Pick<TourListItem, 'maxEntries' | 'placesLeft'>): number | null {
  if (t.maxEntries === null || t.maxEntries <= 0) return null;
  const taken = t.maxEntries - t.placesLeft;
  return Math.min(100, Math.max(0, Math.round((taken / t.maxEntries) * 100)));
}

/**
 * The tone a list card's date tile, status pill and bar wear, as the operator cards do: green
 * while it plays, muted once it is over, the brand blue before it starts (and for an unknown state).
 */
export type TourTone = 'upcoming' | 'running' | 'over';

export function tourToneOf(status: TourStatus | null): TourTone {
  if (status === 'running') return 'running';
  if (status === 'finished' || status === 'cancelled') return 'over';
  return 'upcoming';
}

/** Worth polling every 30 s while the screen is focused: play is under way (plan §5.2). */
export function isLive(
  t: Pick<TournamentPublic, 'missing' | 'status'> | null | undefined,
): boolean {
  return !!t && !t.missing && t.status === 'running';
}

/** The schedule and the standings are shown once a schedule exists (running or finished). */
export function showsPlay(t: TournamentPublic): boolean {
  return (t.status === 'running' || t.status === 'finished') && t.rounds.length > 0;
}
