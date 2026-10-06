/**
 * The tournaments read and write contracts (build contracts §1.6, §1.7, §1.8, S13).
 *
 * One entry per RPC answer the clients parse: the keys each answer always carries. The same form
 * as `COACHING_SHAPES` (`../coaching/shapes.ts`), and checked by the same walker:
 *
 * - The database's tournament suites assert every RPC result's keys ⊇ its list here.
 * - The phone, web and operator parsers read the same lists (a missing key falls back, never
 *   throws).
 * - A server may ADD keys; it never renames or drops one listed here.
 *
 * Conventions (as coaching's):
 * - A list describes the full answer: the switch on, the row found. The short answers
 *   (`{off: true}`, `{missing: true}`) are not described.
 * - A key whose value is null still counts as carried.
 * - `nested` maps a path to the keys of the object(s) found there; a segment ending in `[]` is an
 *   array whose every element is checked; an absent or null value is skipped (`mine`, `me`).
 * - A public player is the `{name, former, no}` object (§1.8): never a guest id, phone or full name.
 */
import { missingKeys, type CoachingShape } from '../coaching/shapes';

export interface TourShape {
  /** The callable whose answer this is: a public RPC, or an internal the suites read. */
  readonly rpc: string;
  readonly array?: boolean;
  readonly keys: readonly string[];
  readonly optional?: readonly string[];
  readonly oneOf?: readonly (readonly string[])[];
  readonly nested?: Readonly<Record<string, readonly string[]>>;
}

/** A player as a public surface shows them (§1.8). */
const PLAYER = ['name', 'former', 'no'] as const;

/** A branch as the public reads carry it, with the zone a client formats times in. */
const BRANCH = ['venue_id', 'name_en', 'name_ar', 'timezone'] as const;

/** An adopted event block. */
const BLOCK = ['reservation_id', 'court_id', 'start_at', 'end_at'] as const;

/** One row of app.tournament_standings (§1.5). */
/** A payment on an entry's settled tournament tab, as a refund is made against it (0310). */
const ENTRY_PAYMENT = [
  'payment_id',
  'tab_id',
  'method',
  'amount_iqd',
  'refunded_iqd',
  'refundable_iqd',
  'created_at',
] as const;

const STANDING = [
  'entry_id',
  'rank',
  'points_won',
  'points_against',
  'diff',
  'h2h',
  'played',
  'sat_out',
  'withdrawn',
] as const;

export const TOURNAMENT_SHAPES = {
  // ── lifecycle writes (file 2) ─────────────────────────────────────────────
  tournament_publish: {
    rpc: 'tournament_publish',
    keys: ['tournament_id', 'starts_at', 'ends_at', 'blocks', 'unblocked_windows'],
    nested: {
      'blocks[]': BLOCK,
      'unblocked_windows[]': ['court_id', 'start_at', 'end_at'],
    },
  },
  tournament_cancel: {
    rpc: 'tournament_cancel',
    keys: ['tournament_id', 'status', 'refunds_due'],
    nested: { 'refunds_due[]': ['entry_id', 'net_paid_iqd'] },
  },
  tournament_close: {
    rpc: 'tournament_close',
    keys: ['tournament_id', 'status', 'duplicate', 'registered'],
  },
  tournament_finish: {
    rpc: 'tournament_finish',
    keys: [
      'tournament_id',
      'status',
      'rounds_planned',
      'removed_from_round',
      'blocks_released',
      'revision',
    ],
  },
  tournament_register: {
    rpc: 'tournament_register',
    keys: ['entry_id', 'status', 'waitlist_position', 'duplicate'],
  },
  tournament_withdraw: {
    rpc: 'tournament_withdraw',
    keys: ['entry_id', 'status', 'refund_due_iqd', 'duplicate'],
  },
  tournament_add_entry: {
    rpc: 'tournament_add_entry',
    keys: ['entry_id', 'status', 'waitlist_position', 'duplicate'],
  },
  tournament_remove_entry: {
    rpc: 'tournament_remove_entry',
    keys: ['entry_id', 'status', 'refund_due_iqd'],
  },
  set_tournaments_enabled: {
    rpc: 'set_tournaments_enabled',
    keys: ['venue_id', 'tournaments_enabled'],
  },

  // ── play writes (file 3) ──────────────────────────────────────────────────
  tournament_set_rounds: {
    rpc: 'tournament_set_rounds',
    keys: ['revision', 'rounds_planned', 'status'],
  },
  tournament_score: {
    rpc: 'tournament_score',
    keys: ['match_id', 'revision', 'tournament_revision', 'removed_from_round', 'status'],
  },
  tournament_mark_no_show: {
    rpc: 'tournament_mark_no_show',
    keys: ['entry_id', 'status', 'substitute_entry_id', 'removed_from_round', 'revision'],
  },

  // ── money (file 1) ────────────────────────────────────────────────────────
  tournament_settle: {
    rpc: 'tournament_settle',
    keys: [
      'duplicate',
      'payment_id',
      'tab_id',
      'entry_id',
      'amount_iqd',
      'change_iqd',
      'method',
      'owed_iqd',
      'status',
    ],
  },
  tournament_entry_money: {
    rpc: 'tournament_entry_money',
    keys: [
      'entry_id',
      'tournament_id',
      'entry_status',
      'tournament_status',
      'fee_iqd',
      'desk_paid_iqd',
      'desk_refunded_iqd',
      'online_paid_iqd',
      'net_iqd',
      'payable',
      'owed_iqd',
      'refund_due_iqd',
    ],
  },

  // ── staff reads ───────────────────────────────────────────────────────────
  desk_tournaments: {
    rpc: 'desk_tournaments',
    keys: ['tournaments_enabled', 'server_now', 'tournaments'],
    nested: {
      'tournaments[]': [
        'id',
        'name_en',
        'name_ar',
        'status',
        'format',
        'category',
        'starts_at',
        'ends_at',
        'registered',
        'waitlisted',
        'max_entries',
        'refund_due_iqd',
        'blocks',
      ],
      'tournaments[].blocks[]': BLOCK,
    },
  },
  tournament_refunds_due: {
    rpc: 'tournament_refunds_due',
    keys: ['venue_id', 'total_iqd', 'items'],
    nested: {
      'items[]': [
        'entry_id',
        'tournament_id',
        'name_en',
        'name_ar',
        'tournament_status',
        'starts_at',
        'cancelled_at',
        'entry_status',
        'full_name',
        'phone',
        'refund_due_iqd',
        'payments',
      ],
      'items[].payments[]': ENTRY_PAYMENT,
    },
  },
  desk_tournament_detail: {
    rpc: 'desk_tournament_detail',
    keys: [
      'id',
      'venue_id',
      'protocol_run_id',
      'name_en',
      'name_ar',
      'format',
      'category',
      'class',
      'points_target',
      'rounds_planned',
      'max_entries',
      'min_entries',
      'waitlist_max',
      'entry_fee_iqd',
      'prize_en',
      'prize_ar',
      'starts_at',
      'ends_at',
      'registration_closes_at',
      'status',
      'cancel_reason',
      'revision',
      'closed_at',
      'finished_at',
      'cancelled_at',
      'sweep_errors',
      'timezone',
      'server_now',
      'entries',
      'courts',
      'rounds',
      'standings',
      'can',
    ],
    nested: {
      'entries[]': [
        'entry_id',
        'guest_id',
        'full_name',
        'phone',
        'status',
        'seed_no',
        'waitlist_position',
        'added_by_kind',
        'owed_iqd',
        'net_paid_iqd',
        'refund_due_iqd',
        'substitute_for',
        'payments',
      ],
      'entries[].payments[]': ENTRY_PAYMENT,
      'courts[]': ['court_id', 'name_en', 'name_ar', 'sort_order'],
      'rounds[]': ['round_no', 'sit_out', 'matches'],
      'rounds[].matches[]': [
        'match_id',
        'court_id',
        'a',
        'b',
        'points_a',
        'points_b',
        'revision',
        'corrections',
      ],
      'standings[]': STANDING,
      can: ['add', 'set_rounds', 'score', 'cancel', 'close', 'finish', 'settle'],
    },
  },

  // ── public reads (anon too; never raise) ──────────────────────────────────
  tournaments_public: {
    rpc: 'tournaments_public',
    keys: ['off', 'server_now', 'branches', 'tournaments'],
    nested: {
      'branches[]': BRANCH,
      'tournaments[]': [
        'id',
        'venue_id',
        'name_en',
        'name_ar',
        'format',
        'category',
        'starts_at',
        'ends_at',
        'registration_closes_at',
        'entry_fee_iqd',
        'prize_en',
        'prize_ar',
        'max_entries',
        'places_left',
        'waitlist_open',
        'status',
        'mine',
      ],
      'tournaments[].mine': ['entry_id', 'status', 'waitlist_position'],
    },
  },
  tournament_public: {
    rpc: 'tournament_public',
    keys: [
      'missing',
      'id',
      'venue_id',
      'branch',
      'name_en',
      'name_ar',
      'format',
      'category',
      'points_target',
      'rounds_planned',
      'starts_at',
      'ends_at',
      'registration_closes_at',
      'entry_fee_iqd',
      'prize_en',
      'prize_ar',
      'status',
      'max_entries',
      'entries_count',
      'places_left',
      'waitlist_open',
      'server_now',
      'rounds',
      'standings',
      'me',
    ],
    nested: {
      branch: BRANCH,
      'rounds[]': ['round_no', 'sit_out', 'matches'],
      'rounds[].sit_out[]': PLAYER,
      'rounds[].matches[]': ['court_no', 'a', 'b', 'points_a', 'points_b'],
      'rounds[].matches[].a[]': PLAYER,
      'rounds[].matches[].b[]': PLAYER,
      'standings[]': ['rank', 'player', 'points_won', 'diff', 'played', 'withdrawn'],
      'standings[].player': PLAYER,
      me: ['entry_id', 'status', 'waitlist_position', 'owed_iqd'],
    },
  },
} as const satisfies Record<string, TourShape>;

export type TournamentShapeName = keyof typeof TOURNAMENT_SHAPES;

/** The two reads granted to anon (`publicByDesign`): no guest id, phone or full name. */
export const PUBLIC_TOURNAMENT_READS = [
  'tournaments_public',
  'tournament_public',
] as const satisfies readonly TournamentShapeName[];

/** Keys a public read may never carry, at any depth (§1.8, T-8). */
export const TOUR_PUBLIC_FORBIDDEN_KEYS = [
  'guest_id',
  'phone',
  'full_name',
  'court_id',
  'profile_id',
] as const;

const asCoaching = (shape: TourShape | readonly string[]): CoachingShape | readonly string[] =>
  Array.isArray(shape) ? (shape as readonly string[]) : { ...(shape as TourShape), x: null };

/**
 * The places where `value` falls short of `shape`, as JSON paths from `$` (the coaching walker,
 * `missingKeys`). Empty when the answer carries everything.
 */
export function tourMissingKeys(value: unknown, shape: TourShape | readonly string[]): string[] {
  return missingKeys(value, asCoaching(shape));
}

/** True when `value` carries every key of `shape`. */
export function tourHasKeys(value: unknown, shape: TourShape | readonly string[]): boolean {
  return tourMissingKeys(value, shape).length === 0;
}
