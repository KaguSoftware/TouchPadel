import { formatIQD, isolate, isolateLtr, makeT, type Locale, type MessageKey } from '@touch/i18n';
import { inviteWhen } from './site/matchInvite';

/**
 * The pure half of the website's tournament surfaces (T-8; docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.6, §1.8, §1.11): the landing's event cards read
 * `app.tournaments_public` through `parseTournamentsPublic`, and the noindex
 * `/{locale}/events/<id>` page reads `app.tournament_public` through `parseTournamentPublic`.
 *
 * - **Only the read contract's fields** (`TOURNAMENT_SHAPES` in `@touch/core/tournaments`):
 *   each row is copied field by field, so a key the server ever adds cannot reach the markup by
 *   accident. `tournaments.test.ts` holds every parsed row's keys equal to the shapes list, less
 *   `WEB_DROPPED_KEYS`.
 * - **No signed-in parts.** The site reads with the cookie-free client, so `mine` (the list) and
 *   `me` (the page) are always null; the parser drops both rather than carry a field the site
 *   can never fill.
 * - **A player is `{name, former, no}`** (§1.8): "First I." from `app.match_display_name`, a
 *   deleted account (`former`), or "Player <no>" for a desk-added profile without accepted
 *   terms. Never a guest id, phone, full name or court id: the server sends none, and nothing
 *   here would copy one. The server sends names only once a schedule exists, never the waitlist.
 *
 * Every enum is parsed with a fallback (an unknown status, format or category drops its row),
 * every missing field falls back, nothing throws. Null only for an answer that is not an object
 * at all.
 */

export type TourFormat = 'americano' | 'mexicano';
export type TourCategory = 'open' | 'women' | 'men';
export type TourStatus = 'open' | 'closed' | 'running' | 'finished' | 'cancelled';

const FORMATS: readonly string[] = ['americano', 'mexicano'];
const CATEGORIES: readonly string[] = ['open', 'women', 'men'];
const STATUSES: readonly string[] = ['open', 'closed', 'running', 'finished', 'cancelled'];

/** The statuses the landing lists as "upcoming": registration open or closed, or in play. */
export const UPCOMING_STATUSES: readonly TourStatus[] = ['open', 'closed', 'running'];

/** The contract keys the site never carries (no session: always null for the site). */
export const WEB_DROPPED_KEYS = {
  tournaments_public: ['mine'],
  tournament_public: ['me', 'missing'],
} as const;

export interface TourBranch {
  venue_id: string;
  name_en: string;
  name_ar: string;
  timezone: string;
}

/** One `tournaments_public` row: no names, no court ids (§1.8). */
export interface TourCard {
  id: string;
  venue_id: string;
  name_en: string;
  name_ar: string;
  format: TourFormat;
  category: TourCategory;
  starts_at: string;
  ends_at: string;
  registration_closes_at: string | null;
  entry_fee_iqd: number;
  prize_en: string;
  prize_ar: string;
  max_entries: number;
  places_left: number;
  waitlist_open: boolean;
  status: TourStatus;
}

export interface PublicTournaments {
  /** `{off: true}`: tournaments are off everywhere the read asked about; every list is empty. */
  off: boolean;
  server_now: string | null;
  branches: TourBranch[];
  tournaments: TourCard[];
}

/** What the landing renders: an upcoming tournament or more, none, switched off, or a failed read. */
export type TournamentsStatus = 'ok' | 'empty' | 'off' | 'error';

export interface TournamentsRead {
  status: TournamentsStatus;
  /** Set for `ok` and `empty`; null for `off` and `error`. */
  tournaments: PublicTournaments | null;
}

/** A player as a public surface shows them (§1.8). */
export interface TourPlayer {
  /** "First I.", or null: a desk-added profile without accepted terms ("Player <no>"). */
  name: string | null;
  /** A deleted account ("Former player"). */
  former: boolean;
  /** The entry's seed number, null before the draw. */
  no: number | null;
}

export interface TourPublicMatch {
  /** An ordinal (1 = the lowest court the tournament plays on), never a court id. */
  court_no: number;
  a: [TourPlayer, TourPlayer];
  b: [TourPlayer, TourPlayer];
  /** Both null until the desk records the score. */
  points_a: number | null;
  points_b: number | null;
}

export interface TourPublicRound {
  round_no: number;
  sit_out: TourPlayer[];
  matches: TourPublicMatch[];
}

export interface TourPublicStanding {
  rank: number;
  player: TourPlayer;
  points_won: number;
  diff: number;
  played: number;
  /** 0311 (c27): the entry left the play (withdrawn or a no-show); ranked after the rest. */
  withdrawn: boolean;
}

/** `tournament_public` as the page's model. */
export interface PublicTournament {
  id: string;
  venue_id: string;
  branch: TourBranch | null;
  name_en: string;
  name_ar: string;
  format: TourFormat;
  category: TourCategory;
  points_target: number | null;
  rounds_planned: number | null;
  starts_at: string;
  ends_at: string;
  registration_closes_at: string | null;
  entry_fee_iqd: number;
  prize_en: string;
  prize_ar: string;
  status: TourStatus;
  max_entries: number;
  entries_count: number;
  places_left: number;
  waitlist_open: boolean;
  server_now: string | null;
  rounds: TourPublicRound[];
  standings: TourPublicStanding[];
}

/**
 * What the page renders: the tournament, one `missing` for every reason the server gives none
 * (unknown, an id that is no id, the branch off or closed, cancelled more than 7 days ago), or a
 * failed read.
 */
export type TournamentPageStatus = 'ok' | 'missing' | 'error';

export interface TournamentPageRead {
  status: TournamentPageStatus;
  /** Set for `ok` only. */
  tournament: PublicTournament | null;
}

// ---------------------------------------------------------------------------------------------
// Parsing

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const id = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** A whole, non-negative number, else null. */
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** A whole number of either sign (a point difference), else null. */
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

const instant = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;

const oneOf = <T extends string>(value: unknown, allowed: readonly string[]): T | null =>
  typeof value === 'string' && allowed.includes(value) ? (value as T) : null;

const TOUR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `[id]` segment as a lower-case uuid, else null (the server is never asked about anything else). */
export function parseTournamentId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return TOUR_ID.test(lower) ? lower : null;
}

function parseBranch(row: unknown): TourBranch | null {
  if (!isRecord(row)) return null;
  const venueId = id(row.venue_id);
  if (!venueId) return null;
  return {
    venue_id: venueId,
    name_en: text(row.name_en),
    name_ar: text(row.name_ar),
    timezone: text(row.timezone),
  };
}

/** The fields a list row and the page share; null when a required one is missing or unknown. */
function parseCommon(row: Record<string, unknown>) {
  const tourId = parseTournamentId(text(row.id));
  const venueId = id(row.venue_id);
  const format = oneOf<TourFormat>(row.format, FORMATS);
  const category = oneOf<TourCategory>(row.category, CATEGORIES);
  const status = oneOf<TourStatus>(row.status, STATUSES);
  const startsAt = instant(row.starts_at);
  const nameEn = text(row.name_en);
  const nameAr = text(row.name_ar);
  if (!tourId || !venueId || !format || !category || !status || !startsAt) return null;
  if (!nameEn && !nameAr) return null;
  return {
    id: tourId,
    venue_id: venueId,
    name_en: nameEn,
    name_ar: nameAr,
    format,
    category,
    starts_at: startsAt,
    ends_at: instant(row.ends_at) ?? startsAt,
    registration_closes_at: instant(row.registration_closes_at),
    entry_fee_iqd: whole(row.entry_fee_iqd) ?? 0,
    prize_en: text(row.prize_en),
    prize_ar: text(row.prize_ar),
    max_entries: whole(row.max_entries) ?? 0,
    places_left: whole(row.places_left) ?? 0,
    waitlist_open: row.waitlist_open === true,
    status,
  };
}

function parseCard(row: Record<string, unknown>): TourCard | null {
  return parseCommon(row);
}

/** `app.tournaments_public`'s jsonb (§1.8) as the landing's model; null when unreadable. */
export function parseTournamentsPublic(raw: unknown): PublicTournaments | null {
  if (!isRecord(raw)) return null;
  const serverNow = instant(raw.server_now);
  if (raw.off === true) return { off: true, server_now: serverNow, branches: [], tournaments: [] };
  return {
    off: false,
    server_now: serverNow,
    branches: rows(raw.branches)
      .map(parseBranch)
      .filter((b): b is TourBranch => b !== null),
    tournaments: rows(raw.tournaments)
      .map(parseCard)
      .filter((t): t is TourCard => t !== null)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)),
  };
}

/** The tournaments still to play or in play, soonest first (finished and cancelled left out). */
export function upcomingTournaments(read: PublicTournaments): TourCard[] {
  return read.tournaments.filter((t) => UPCOMING_STATUSES.includes(t.status));
}

/** `off` while tournaments are off; `ok` with one upcoming or more; `empty` otherwise. */
export function tournamentsStatus(read: PublicTournaments): TournamentsStatus {
  if (read.off) return 'off';
  return upcomingTournaments(read).length > 0 ? 'ok' : 'empty';
}

/** The branch a row belongs to, from the list's branches. */
export function branchOf(read: PublicTournaments, venueId: string): TourBranch | null {
  return read.branches.find((b) => b.venue_id === venueId) ?? null;
}

function parsePlayer(value: unknown): TourPlayer | null {
  if (!isRecord(value)) return null;
  const name = text(value.name).trim();
  return { name: name === '' ? null : name, former: value.former === true, no: whole(value.no) };
}

const players = (value: unknown): TourPlayer[] =>
  Array.isArray(value) ? value.map(parsePlayer).filter((p): p is TourPlayer => p !== null) : [];

function parseMatch(row: Record<string, unknown>): TourPublicMatch | null {
  const courtNo = whole(row.court_no);
  const a = players(row.a);
  const b = players(row.b);
  if (!courtNo || a.length !== 2 || b.length !== 2) return null;
  const pa = whole(row.points_a);
  const pb = whole(row.points_b);
  // Both or neither: a half score is no score.
  const scored = pa !== null && pb !== null;
  return {
    court_no: courtNo,
    a: [a[0]!, a[1]!],
    b: [b[0]!, b[1]!],
    points_a: scored ? pa : null,
    points_b: scored ? pb : null,
  };
}

function parseRound(row: Record<string, unknown>): TourPublicRound | null {
  const roundNo = whole(row.round_no);
  if (!roundNo) return null;
  return {
    round_no: roundNo,
    sit_out: players(row.sit_out),
    matches: rows(row.matches)
      .map(parseMatch)
      .filter((m): m is TourPublicMatch => m !== null)
      .sort((x, y) => x.court_no - y.court_no),
  };
}

function parseStanding(row: Record<string, unknown>): TourPublicStanding | null {
  const rank = whole(row.rank);
  const player = parsePlayer(row.player);
  if (!rank || !player) return null;
  return {
    rank,
    player,
    points_won: whole(row.points_won) ?? 0,
    diff: integer(row.diff) ?? 0,
    played: whole(row.played) ?? 0,
    withdrawn: row.withdrawn === true,
  };
}

/**
 * `app.tournament_public`'s jsonb (§1.8) as the page's model: `{missing: true}`, and any answer
 * whose required fields are missing or unknown, read as missing; null only when unreadable.
 */
export function parseTournamentPublic(raw: unknown): TournamentPageRead | null {
  if (!isRecord(raw)) return null;
  if (raw.missing === true) return { status: 'missing', tournament: null };
  const common = parseCommon(raw);
  if (!common) return { status: 'missing', tournament: null };
  const tournament: PublicTournament = {
    id: common.id,
    venue_id: common.venue_id,
    branch: parseBranch(raw.branch),
    name_en: common.name_en,
    name_ar: common.name_ar,
    format: common.format,
    category: common.category,
    points_target: whole(raw.points_target),
    rounds_planned: whole(raw.rounds_planned),
    starts_at: common.starts_at,
    ends_at: common.ends_at,
    registration_closes_at: common.registration_closes_at,
    entry_fee_iqd: common.entry_fee_iqd,
    prize_en: common.prize_en,
    prize_ar: common.prize_ar,
    status: common.status,
    max_entries: common.max_entries,
    entries_count: whole(raw.entries_count) ?? 0,
    places_left: common.places_left,
    waitlist_open: common.waitlist_open,
    server_now: instant(raw.server_now),
    rounds: rows(raw.rounds)
      .map(parseRound)
      .filter((r): r is TourPublicRound => r !== null)
      .sort((x, y) => x.round_no - y.round_no),
    standings: rows(raw.standings)
      .map(parseStanding)
      .filter((s): s is TourPublicStanding => s !== null)
      .sort((x, y) => x.rank - y.rank),
  };
  return { status: 'ok', tournament };
}

// ---------------------------------------------------------------------------------------------
// Words

/** The Arabic text on an Arabic page when there is one, else the English (never a blank). */
export function localText(locale: Locale, en: string, ar: string): string {
  return locale === 'ar' && ar.trim() !== '' ? ar : en || ar;
}

export function tournamentName(t: { name_en: string; name_ar: string }, locale: Locale): string {
  return localText(locale, t.name_en, t.name_ar);
}

/** The prize line in the page's language ('' when there is none). */
export function tournamentPrize(t: { prize_en: string; prize_ar: string }, locale: Locale): string {
  return localText(locale, t.prize_en, t.prize_ar).trim();
}

const CATEGORY_KEYS: Record<TourCategory, MessageKey> = {
  open: 'matches.common.categoryOpen',
  women: 'matches.common.categoryWomen',
  men: 'matches.common.categoryMen',
};

/** "Americano · Women only". */
export function formatLine(t: { format: TourFormat; category: TourCategory }, locale: Locale) {
  const tr = makeT(locale);
  return `${tr(`tournaments.common.format.${t.format}`)} · ${tr(CATEGORY_KEYS[t.category])}`;
}

/** "Free entry", or "Entry 25,000 IQD". */
export function feeLine(feeIqd: number, locale: Locale): string {
  const tr = makeT(locale);
  return feeIqd > 0
    ? tr('tournaments.web.fee', { amount: formatIQD(feeIqd, locale) })
    : tr('tournaments.common.free');
}

/**
 * Whether "Register in the app" is still true: the status is open AND the read's server_now is
 * before the cut-off. The status flips to closed only on the next minutely sweep, so a read
 * between the cut-off and that sweep still says open; the phone's tourActionOf judges the
 * cut-off the same way. (The read's own cache, up to a minute, is the remaining lag.)
 */
export function registrationOpen(
  t: { status: TourStatus; registration_closes_at: string | null },
  serverNow: string | null,
): boolean {
  if (t.status !== 'open') return false;
  const cutoff = t.registration_closes_at ? Date.parse(t.registration_closes_at) : NaN;
  const now = serverNow ? Date.parse(serverNow) : NaN;
  return !(Number.isFinite(cutoff) && Number.isFinite(now) && now >= cutoff);
}

/**
 * Where the registration stands, for a card or the page: places left while registration is
 * open, "Full: waitlist open" once the places are gone, otherwise the tournament's state.
 */
export function placesLine(
  t: { status: TourStatus; places_left: number; waitlist_open: boolean },
  locale: Locale,
): string {
  const tr = makeT(locale);
  if (t.status === 'open') {
    if (t.places_left > 0) {
      return tr('tournaments.web.eventsCards.placesLeft', {
        count: isolateLtr(String(t.places_left)),
      });
    }
    return t.waitlist_open
      ? tr('tournaments.web.eventsCards.full')
      : tr('tournaments.web.eventsCards.fullNoWaitlist');
  }
  return tr(`tournaments.common.status.${t.status}`);
}

/**
 * When, in the branch's own timezone: "Thu 2 Oct 2026 · 6:00 PM – 10:00 PM". Null for a date
 * it cannot read.
 */
export function tournamentWhen(
  t: { starts_at: string; ends_at: string },
  timezone: string,
  locale: Locale,
): string | null {
  const start = inviteWhen(t.starts_at, timezone, locale);
  if (!start) return null;
  const end = inviteWhen(t.ends_at, timezone, locale);
  return makeT(locale)('tournaments.web.when', {
    weekday: start.weekday,
    date: start.date,
    from: start.time,
    to: end?.time ?? start.time,
  });
}

/** A player as the page names them: "Sara A.", "Former player" or "Player 7". */
export function playerLabel(player: TourPlayer, locale: Locale): string {
  const tr = makeT(locale);
  if (player.former) return tr('tournaments.common.formerPlayer');
  if (player.name) return isolate(player.name);
  return tr('tournaments.common.player', { no: isolateLtr(String(player.no ?? '')) });
}

/** "Sara A. & Huda K.". */
export function teamLabel(team: readonly [TourPlayer, TourPlayer], locale: Locale): string {
  return makeT(locale)('tournaments.web.page.team', {
    one: playerLabel(team[0], locale),
    two: playerLabel(team[1], locale),
  });
}

/** A point difference with its sign: "+6", "−4", "0" (LTR-isolated, so Arabic keeps the sign first). */
export function signedDiff(diff: number): string {
  if (diff > 0) return isolateLtr(`+${diff}`);
  if (diff < 0) return isolateLtr(`−${Math.abs(diff)}`);
  return isolateLtr('0');
}

// ---------------------------------------------------------------------------------------------
// Links

/** The tournament's public page. */
export function tournamentPath(locale: Locale, tourId: string): string {
  return `/${locale}/events/${tourId}`;
}

/** The app's tournament route (apps/mobile `app/tournament/[id].tsx`); `scheme: 'touchpadel'`. */
export const APP_TOURNAMENT_URL = 'touchpadel://tournament';

/** The app on the tournament; the app's home without one. */
export function appTournamentHref(tourId: string | null): string {
  return tourId ? `${APP_TOURNAMENT_URL}/${tourId}` : 'touchpadel://';
}
