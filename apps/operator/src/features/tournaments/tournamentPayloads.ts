/**
 * The tournament answers the operator parses (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.6, §1.8, S13), keyed from
 * `TOURNAMENT_SHAPES` (@touch/core/tournaments). PURE.
 *
 * Read defensively, the coaching way (features/coaching/lessonPayloads.ts): a
 * key the server lacks falls back (null, 0, []), never throws, and nothing is
 * invented. A payload with no readable tournament id is null, which the screen
 * treats as "not at this branch".
 */
import {
  TOUR_CATEGORIES,
  TOUR_ENTRY_STATUSES,
  TOUR_FORMATS,
  TOUR_STATUSES,
  type TourCategory,
  type TourEntryStatus,
  type TourFormat,
  type TourStandingRow,
  type TourStatus,
} from '@touch/core/tournaments';

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
}
function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
}
function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

// ── desk_tournaments ─────────────────────────────────────────────────────────

/** An adopted event block: one court of the run's plan, held for the tournament. */
export interface TourBlock {
  reservation_id: string;
  court_id: string;
  start_at: string;
  end_at: string;
}

export interface DeskTournament {
  id: string;
  name_en: string;
  name_ar: string;
  status: TourStatus;
  format: TourFormat;
  category: TourCategory;
  starts_at: string;
  ends_at: string;
  registered: number;
  waitlisted: number;
  max_entries: number;
  blocks: TourBlock[];
}

export interface DeskTournaments {
  tournaments_enabled: boolean;
  server_now: string | null;
  tournaments: DeskTournament[];
}

function readBlock(r: Raw): TourBlock | null {
  const reservation_id = str(r.reservation_id);
  const court_id = str(r.court_id);
  const start_at = str(r.start_at);
  const end_at = str(r.end_at);
  return reservation_id && court_id && start_at && end_at
    ? { reservation_id, court_id, start_at, end_at }
    : null;
}

export function readDeskTournaments(payload: unknown): DeskTournaments {
  const p = obj(payload);
  return {
    tournaments_enabled: p.tournaments_enabled === true,
    server_now: str(p.server_now),
    tournaments: list(p.tournaments)
      .map((t): DeskTournament | null => {
        const id = str(t.id);
        if (!id) return null;
        return {
          id,
          name_en: str(t.name_en) ?? '',
          name_ar: str(t.name_ar) ?? '',
          status: oneOf(t.status, TOUR_STATUSES, 'open'),
          format: oneOf(t.format, TOUR_FORMATS, 'americano'),
          category: oneOf(t.category, TOUR_CATEGORIES, 'open'),
          starts_at: str(t.starts_at) ?? '',
          ends_at: str(t.ends_at) ?? '',
          registered: int(t.registered) ?? 0,
          waitlisted: int(t.waitlisted) ?? 0,
          max_entries: int(t.max_entries) ?? 0,
          blocks: list(t.blocks)
            .map(readBlock)
            .filter((b): b is TourBlock => b !== null),
        };
      })
      .filter((t): t is DeskTournament => t !== null),
  };
}

// ── desk_tournament_detail ───────────────────────────────────────────────────

export interface TourEntry {
  entry_id: string;
  guest_id: string | null;
  full_name: string;
  phone: string | null;
  status: TourEntryStatus;
  seed_no: number | null;
  waitlist_position: number | null;
  added_by_kind: 'guest' | 'staff';
  owed_iqd: number;
  net_paid_iqd: number;
  refund_due_iqd: number;
  substitute_for: string | null;
}

export interface TourDetailCourt {
  court_id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

export interface TourDetailMatch {
  match_id: string;
  court_id: string;
  a: [string, string];
  b: [string, string];
  points_a: number | null;
  points_b: number | null;
  revision: number;
  corrections: number;
}

export interface TourDetailRound {
  round_no: number;
  sit_out: string[];
  matches: TourDetailMatch[];
}

export interface TourCan {
  add: boolean;
  set_rounds: boolean;
  score: boolean;
  cancel: boolean;
  /** 0310: close registration (open; past the cut-off, or a manager early). */
  close: boolean;
  /** 0310: end a running tournament at its last complete round (managers). */
  finish: boolean;
  settle: boolean;
}

export interface TournamentDetail {
  id: string;
  venue_id: string | null;
  protocol_run_id: string | null;
  name_en: string;
  name_ar: string;
  format: TourFormat;
  category: TourCategory;
  class: string | null;
  points_target: number;
  rounds_planned: number | null;
  max_entries: number;
  min_entries: number;
  waitlist_max: number;
  entry_fee_iqd: number;
  prize_en: string | null;
  prize_ar: string | null;
  starts_at: string;
  ends_at: string;
  registration_closes_at: string;
  status: TourStatus;
  cancel_reason: 'under_filled' | 'staff' | null;
  revision: number;
  closed_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  timezone: string | null;
  server_now: string | null;
  entries: TourEntry[];
  courts: TourDetailCourt[];
  rounds: TourDetailRound[];
  standings: TourStandingRow[];
  can: TourCan;
}

function pair(v: unknown): [string, string] | null {
  const xs = ids(v);
  return xs.length === 2 ? [xs[0]!, xs[1]!] : null;
}

function readEntry(e: Raw): TourEntry | null {
  const entry_id = str(e.entry_id);
  if (!entry_id) return null;
  return {
    entry_id,
    guest_id: str(e.guest_id),
    full_name: str(e.full_name) ?? '',
    phone: str(e.phone),
    status: oneOf(e.status, TOUR_ENTRY_STATUSES, 'registered'),
    seed_no: int(e.seed_no),
    waitlist_position: int(e.waitlist_position),
    added_by_kind: e.added_by_kind === 'staff' ? 'staff' : 'guest',
    owed_iqd: int(e.owed_iqd) ?? 0,
    net_paid_iqd: int(e.net_paid_iqd) ?? 0,
    refund_due_iqd: int(e.refund_due_iqd) ?? 0,
    substitute_for: str(e.substitute_for),
  };
}

function readMatch(m: Raw): TourDetailMatch | null {
  const match_id = str(m.match_id);
  const court_id = str(m.court_id);
  const a = pair(m.a);
  const b = pair(m.b);
  if (!match_id || !court_id || !a || !b) return null;
  return {
    match_id,
    court_id,
    a,
    b,
    points_a: int(m.points_a),
    points_b: int(m.points_b),
    revision: int(m.revision) ?? 0,
    corrections: int(m.corrections) ?? 0,
  };
}

function readStanding(s: Raw): TourStandingRow | null {
  const entry_id = str(s.entry_id);
  if (!entry_id) return null;
  return {
    entry_id,
    rank: int(s.rank) ?? 0,
    points_won: int(s.points_won) ?? 0,
    points_against: int(s.points_against) ?? 0,
    diff: int(s.diff) ?? 0,
    h2h: int(s.h2h) ?? 0,
    played: int(s.played) ?? 0,
    sat_out: int(s.sat_out) ?? 0,
    withdrawn: s.withdrawn === true,
  };
}

export function readTournamentDetail(payload: unknown): TournamentDetail | null {
  const p = obj(payload);
  const id = str(p.id);
  if (!id) return null;
  const can = obj(p.can);
  return {
    id,
    venue_id: str(p.venue_id),
    protocol_run_id: str(p.protocol_run_id),
    name_en: str(p.name_en) ?? '',
    name_ar: str(p.name_ar) ?? '',
    format: oneOf(p.format, TOUR_FORMATS, 'americano'),
    category: oneOf(p.category, TOUR_CATEGORIES, 'open'),
    class: str(p.class),
    points_target: int(p.points_target) ?? 24,
    rounds_planned: int(p.rounds_planned),
    max_entries: int(p.max_entries) ?? 0,
    min_entries: int(p.min_entries) ?? 0,
    waitlist_max: int(p.waitlist_max) ?? 0,
    entry_fee_iqd: int(p.entry_fee_iqd) ?? 0,
    prize_en: str(p.prize_en),
    prize_ar: str(p.prize_ar),
    starts_at: str(p.starts_at) ?? '',
    ends_at: str(p.ends_at) ?? '',
    registration_closes_at: str(p.registration_closes_at) ?? '',
    status: oneOf(p.status, TOUR_STATUSES, 'open'),
    cancel_reason:
      p.cancel_reason === 'under_filled' || p.cancel_reason === 'staff' ? p.cancel_reason : null,
    revision: int(p.revision) ?? 0,
    closed_at: str(p.closed_at),
    finished_at: str(p.finished_at),
    cancelled_at: str(p.cancelled_at),
    timezone: str(p.timezone),
    server_now: str(p.server_now),
    entries: list(p.entries)
      .map(readEntry)
      .filter((e): e is TourEntry => e !== null),
    courts: list(p.courts)
      .map((c): TourDetailCourt | null => {
        const court_id = str(c.court_id);
        return court_id
          ? {
              court_id,
              name_en: str(c.name_en) ?? '',
              name_ar: str(c.name_ar) ?? '',
              sort_order: int(c.sort_order) ?? 0,
            }
          : null;
      })
      .filter((c): c is TourDetailCourt => c !== null)
      .sort((x, y) => x.sort_order - y.sort_order),
    rounds: list(p.rounds)
      .map((r): TourDetailRound | null => {
        const round_no = int(r.round_no);
        if (round_no === null) return null;
        return {
          round_no,
          sit_out: ids(r.sit_out),
          matches: list(r.matches)
            .map(readMatch)
            .filter((m): m is TourDetailMatch => m !== null),
        };
      })
      .filter((r): r is TourDetailRound => r !== null)
      .sort((x, y) => x.round_no - y.round_no),
    standings: list(p.standings)
      .map(readStanding)
      .filter((s): s is TourStandingRow => s !== null)
      .sort((x, y) => x.rank - y.rank),
    can: {
      add: can.add === true,
      set_rounds: can.set_rounds === true,
      score: can.score === true,
      cancel: can.cancel === true,
      close: can.close === true,
      finish: can.finish === true,
      settle: can.settle === true,
    },
  };
}

// ── write answers ────────────────────────────────────────────────────────────

export interface PublishAnswer {
  tournament_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  blocks: TourBlock[];
  unblocked_windows: { court_id: string; start_at: string; end_at: string }[];
}

export function readPublishAnswer(payload: unknown): PublishAnswer {
  const p = obj(payload);
  return {
    tournament_id: str(p.tournament_id),
    starts_at: str(p.starts_at),
    ends_at: str(p.ends_at),
    blocks: list(p.blocks)
      .map(readBlock)
      .filter((b): b is TourBlock => b !== null),
    unblocked_windows: list(p.unblocked_windows)
      .map((w) => ({
        court_id: str(w.court_id) ?? '',
        start_at: str(w.start_at) ?? '',
        end_at: str(w.end_at) ?? '',
      }))
      .filter((w) => w.court_id !== ''),
  };
}

export interface CancelAnswer {
  tournament_id: string | null;
  status: TourStatus | null;
  refunds_due: { entry_id: string; net_paid_iqd: number }[];
}

export function readCancelAnswer(payload: unknown): CancelAnswer {
  const p = obj(payload);
  return {
    tournament_id: str(p.tournament_id),
    status: typeof p.status === 'string' ? oneOf(p.status, TOUR_STATUSES, 'cancelled') : null,
    refunds_due: list(p.refunds_due)
      .map((r) => ({ entry_id: str(r.entry_id) ?? '', net_paid_iqd: int(r.net_paid_iqd) ?? 0 }))
      .filter((r) => r.entry_id !== ''),
  };
}

export interface AddEntryAnswer {
  entry_id: string | null;
  status: TourEntryStatus | null;
  waitlist_position: number | null;
  duplicate: boolean;
}

export function readAddEntryAnswer(payload: unknown): AddEntryAnswer {
  const p = obj(payload);
  return {
    entry_id: str(p.entry_id),
    status:
      typeof p.status === 'string' ? oneOf(p.status, TOUR_ENTRY_STATUSES, 'registered') : null,
    waitlist_position: int(p.waitlist_position),
    duplicate: p.duplicate === true,
  };
}

/** `tournament_score` and `tournament_mark_no_show`: the rounds a write removed, if any. */
export interface PlayAnswer {
  revision: number | null;
  tournament_revision: number | null;
  removed_from_round: number | null;
  status: string | null;
}

export function readPlayAnswer(payload: unknown): PlayAnswer {
  const p = obj(payload);
  return {
    revision: int(p.revision),
    tournament_revision: int(p.tournament_revision),
    removed_from_round: int(p.removed_from_round),
    status: str(p.status),
  };
}

export interface SettleAnswer {
  duplicate: boolean;
  amount_iqd: number | null;
  change_iqd: number | null;
}

export function readSettleAnswer(payload: unknown): SettleAnswer {
  const p = obj(payload);
  return {
    duplicate: p.duplicate === true,
    amount_iqd: int(p.amount_iqd),
    change_iqd: int(p.change_iqd),
  };
}
