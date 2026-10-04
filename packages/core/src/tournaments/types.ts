/**
 * The tournaments milestone's shared names (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.3, §1.9, §1.10). PURE: no I/O, integers only.
 *
 * Every name here carries the `Tour` prefix: `TournamentFormat` and its siblings already belong
 * to the protocol records (`../protocols/types.ts`), which is also why `@touch/core/tournaments`
 * is a subpath export and never re-exported from the package root.
 */
import type { TournamentFormat } from '../protocols/types';

/** The two formats v1 plays (T-1). */
export type TourFormat = Extract<TournamentFormat, 'americano' | 'mexicano'>;
export const TOUR_FORMATS = ['americano', 'mexicano'] as const satisfies readonly TourFormat[];

/** `tournaments.category` (TD-1): who may enter, by `profiles.gender`. */
export const TOUR_CATEGORIES = ['open', 'women', 'men'] as const;
export type TourCategory = (typeof TOUR_CATEGORIES)[number];

/** `tournaments.status` (§1.3). */
export const TOUR_STATUSES = ['open', 'closed', 'running', 'finished', 'cancelled'] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];

/** `tournament_entries.status` (§1.3). A live entry is registered or waitlisted. */
export const TOUR_ENTRY_STATUSES = ['registered', 'waitlisted', 'withdrawn', 'no_show'] as const;
export type TourEntryStatus = (typeof TOUR_ENTRY_STATUSES)[number];

/** The engine tag every rounds payload carries; set_rounds refuses any other (`engine`). */
export const TOUR_ENGINE = 'tp-tour-1' as const;
export type TourEngine = typeof TOUR_ENGINE;

/** The table's bounds (§1.2), shared by the publish dialog, the engine and the validator. */
export const TOUR_LIMITS = {
  pointsTargetMin: 8,
  pointsTargetMax: 64,
  pointsTargetDefault: 24,
  roundsMax: 30,
  entriesMin: 4,
  entriesMax: 64,
  waitlistMax: 64,
  waitlistDefault: 8,
  prizeMax: 200,
  nameMax: 80,
  reasonMax: 300,
} as const;

/** An entry as the engine sees it: its id and the seed that breaks ties (stamped 1..N). */
export interface TourEntryRef {
  entry_id: string;
  seed_no: number;
}

/** A court the desk picked for the play; `sort` orders them (lowest first takes group 1). */
export interface TourCourt {
  court_id: string;
  sort: number;
}

/** One match of a round: two teams of two entry ids. */
export interface TourMatch {
  court_id: string;
  a: [string, string];
  b: [string, string];
}

/** One round: its matches and the entries sitting out. */
export interface TourRound {
  round_no: number;
  matches: TourMatch[];
  sit_out: string[];
}

/** The one write of the play (`tournament_set_rounds` `p_payload`, §1.10). */
export interface TourRoundsPayload {
  engine: TourEngine;
  format: TourFormat;
  based_on_revision: number;
  from_round: number;
  rounds: TourRound[];
}

/** One row of `app.tournament_standings` (§1.5), the order of the SQL columns. */
export interface TourStandingRow {
  entry_id: string;
  rank: number;
  points_won: number;
  points_against: number;
  diff: number;
  h2h: number;
  played: number;
  sat_out: number;
  withdrawn: boolean;
}

/**
 * `TOURNAMENT_ROUNDS_INVALID` details, in the order set_rounds checks them (§1.9): the SQL raises
 * the first failing one, `validateRoundsPayload` returns every failing one in this order.
 */
export const TOUR_ROUNDS_DETAILS = [
  'status',
  'stale',
  'engine',
  'format',
  'numbering',
  'played',
  'mexicano_one',
  'round_open',
  'seat',
  'court',
  'courts_used',
] as const;
export type TourRoundsDetail = (typeof TOUR_ROUNDS_DETAILS)[number];

/** `TOURNAMENT_SCORE_REFUSED` details (§1.9). */
export const TOUR_SCORE_DETAILS = ['status', 'invalid', 'changed', 'locked'] as const;
export type TourScoreDetail = (typeof TOUR_SCORE_DETAILS)[number];

/** `TOURNAMENT_NOT_OPEN` details (§1.9). */
export const TOUR_NOT_OPEN_DETAILS = ['status', 'cutoff'] as const;
export type TourNotOpenDetail = (typeof TOUR_NOT_OPEN_DETAILS)[number];

/** `TOURNAMENT_NOT_PAYABLE` details, in the order settle tests them (§1.9, S14). */
export const TOUR_NOT_PAYABLE_DETAILS = [
  'waitlisted',
  'withdrawn',
  'no_show',
  'cancelled',
  'nothing_owed',
] as const;
export type TourNotPayableDetail = (typeof TOUR_NOT_PAYABLE_DETAILS)[number];

/**
 * `TOURNAMENT_PUBLISH_REFUSED` details (§1.9). A bad settings value is `settings:<key>`, one of
 * `TOUR_PUBLISH_SETTINGS`.
 */
export const TOUR_PUBLISH_DETAILS = [
  'not_done',
  'already_published',
  'capacity_unit',
  'capacity_count',
  'format',
  'fee_not_approved',
  'no_blocks',
] as const;
export type TourPublishDetail =
  (typeof TOUR_PUBLISH_DETAILS)[number] | `settings:${TourPublishSetting}`;

/** The keys `tournament_publish` reads from `p_settings` (§1.6). */
export const TOUR_PUBLISH_SETTINGS = [
  'format',
  'category',
  'points_target',
  'rounds',
  'min_entries',
  'waitlist_max',
  'registration_closes_at',
  'prize_en',
  'prize_ar',
] as const;
export type TourPublishSetting = (typeof TOUR_PUBLISH_SETTINGS)[number];

/** The 12 codes the milestone adds (§1.9), each in `ERROR_CODE_KEYS` (@touch/i18n). */
export const TOUR_ERROR_CODES = [
  'TOURNAMENTS_OFF',
  'TOURNAMENT_NOT_FOUND',
  'TOURNAMENT_PUBLISH_REFUSED',
  'TOURNAMENT_NOT_OPEN',
  'TOURNAMENT_FULL',
  'TOURNAMENT_CATEGORY_MISMATCH',
  'TOURNAMENT_ENTRY_NOT_FOUND',
  'TOURNAMENT_ROUNDS_INVALID',
  'TOURNAMENT_SCORE_REFUSED',
  'TOURNAMENT_NOT_PAYABLE',
  'TOURNAMENT_OWED_CHANGED',
  'TOURNAMENT_VIA_EVENTS',
] as const;
export type TourErrorCode = (typeof TOUR_ERROR_CODES)[number];
