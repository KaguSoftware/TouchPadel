/**
 * Pure helpers for the day-close screen (spec 06.22). No money arithmetic:
 * expected, counted and variance arrive from `app.close_day` and the
 * `v_day_close_summary` view; this file only decides which state to render
 * and how to lay the server figures out for a CSV.
 */
import type { MutationType } from '@touch/core/schemas/mutations';
import type { MessageKey } from '@touch/i18n';
import { errorStringCode } from '../../lib/queueResults';
import type { CsvCell, ExportBundle, ExportTable } from '../analytics/exportTables';
import { cellText, momentCells, shortId } from '../analytics/cellFormat';
import { isUnfinished, readDayState, type DayStateList } from '../checklists/checklistLogic';
import type { ListShift, OutsideRow, ShiftList } from '../tillShift/tillShiftLogic';

export type DayCloseState =
  | 'loading'
  | 'noOpenDay'
  | 'ready'
  | 'blockedByOpenTabs'
  | 'blockedByUnsyncedQueue'
  | 'busy'
  | 'error'
  | 'closed';

export interface CloseResult {
  day_session_id: string;
  business_date: string;
  cash_expected_iqd: number;
  cash_counted_iqd: number;
  cash_variance_iqd: number;
  card_expected_iqd: number;
  card_terminal_batch_iqd: number | null;
}

/** v_day_close_summary (0020) — the columns this screen reads. */
export interface DaySummaryRow {
  day_session_id: string;
  business_date: string;
  status: string;
  opening_float_iqd: number;
  cash_payments_iqd: number;
  card_payments_iqd: number;
  cash_expected_iqd: number | null;
  cash_counted_iqd: number | null;
  cash_variance_iqd: number | null;
  card_expected_iqd: number | null;
  card_terminal_batch_iqd: number | null;
  discounts_iqd: number;
  adjustment_count: number;
  authorizer_names: string[] | null;
  voided_lines_iqd: number;
  voided_line_count: number;
  refunds_iqd: number;
  refund_count: number;
  waste_cost_iqd: number;
  /**
   * 0106: payments recorded by court-desk staff. ALREADY inside
   * cash_payments_iqd / card_payments_iqd and the expected cash — shown so the
   * manager knows how much of the cash sits in the desk's own box. Optional
   * because a row cached before the columns existed does not carry them.
   */
  desk_cash_iqd?: number | null;
  desk_card_iqd?: number | null;
}

/** v_day_close_adjustments (0020) — one row per PIN-authorised adjustment. */
export interface DayAdjustmentRow {
  adjustment_id: string;
  tab_id: string;
  kind: string;
  value: number | null;
  /** Null for a whole-bill adjustment; set when it touched one line. */
  order_item_id?: string | null;
  amount_iqd: number;
  reason_code: string | null;
  created_at: string;
  applied_by_name: string | null;
  authorized_by_name: string | null;
}

export interface DayCloseInputs {
  dayLoaded: boolean;
  dayOpen: boolean;
  openTabCount: number;
  queuedCount: number;
  busy: boolean;
  /** Set once the close succeeded. */
  closed: boolean;
  error: unknown;
}

/**
 * Which of the spec's states the screen is in. Blocks win over `error` so a
 * server refusal (DAY_OPEN_TABS / DAY_UNSYNCED) reads as the block it is, with
 * the rows that cause it, rather than as a bare error line.
 */
export function deriveDayCloseState(i: DayCloseInputs): DayCloseState {
  if (i.closed) return 'closed';
  if (!i.dayLoaded) return 'loading';
  if (!i.dayOpen) return 'noOpenDay';
  if (i.busy) return 'busy';
  if (i.openTabCount > 0) return 'blockedByOpenTabs';
  if (i.queuedCount > 0) return 'blockedByUnsyncedQueue';
  if (i.error != null) return 'error';
  return 'ready';
}

export type VarianceSign = 'over' | 'short' | 'exact';

/** Sign of a server-computed variance, for the sentence that states it. */
export function varianceSign(varianceIqd: number): VarianceSign {
  if (varianceIqd > 0) return 'over';
  if (varianceIqd < 0) return 'short';
  return 'exact';
}

/** Absolute value for display beside the sign word (formatting, not arithmetic). */
export function varianceMagnitude(varianceIqd: number): number {
  return varianceIqd < 0 ? -varianceIqd : varianceIqd;
}

export interface CsvLabels {
  /** The close figures sheet. */
  tabFigures: string;
  figure: string;
  value: string;
  count: string;
  authorisers: string;
  cashExpected: string;
  cashCounted: string;
  variance: string;
  cardExpected: string;
  cardBatch: string;
  discounts: string;
  voids: string;
  refunds: string;
  waste: string;
  openingFloat: string;
  cashPayments: string;
  cardPayments: string;
  deskCash: string;
  deskCard: string;
  note: string;
  partOf: string;
  /** The authorised adjustments sheet. */
  adjustments: string;
  date: string;
  time: string;
  what: string;
  appliesTo: string;
  reason: string;
  amount: string;
  appliedBy: string;
  authorisedBy: string;
  tab: string;
}

/** The words the screen already says for one adjustment, split into its columns. */
export interface AdjustmentWords {
  /** "10% off", "Amount off the bill", "Price changed by hand". */
  what: (a: DayAdjustmentRow) => string;
  /** "The whole bill" or "One item". */
  scope: (a: DayAdjustmentRow) => string;
  reason: (a: DayAdjustmentRow) => string | null;
}

/**
 * Two tables, so two files.
 *
 * They used to be one. The close figures are a list of amounts — opening
 * float, cash taken, expected, counted, the difference — and the authorised
 * adjustments are a list of events, each with its own time, reason and two
 * people. Putting the events under the figures meant the `Figure` column held
 * either the name of a figure or a whole sentence describing a discount
 * ("10% off · the whole bill · Complimentary"), the `Count` column held either
 * a real count or a hard-coded 1, and the two could not be sorted, filtered or
 * totalled apart. Split, each file is a table about one thing.
 *
 * Every number is the server's. `figuresCsv`'s `note` column says when a line
 * is a part of the line above it rather than an addition to it — the desk's
 * share of the cash is already inside the cash total, and a manager summing
 * the column would otherwise count it twice.
 */
export function dayCloseCsv(
  labels: CsvLabels,
  close: CloseResult | null,
  summary: DaySummaryRow | null,
  adjustments: readonly DayAdjustmentRow[],
  joinNames: (names: readonly string[]) => string,
  words: AdjustmentWords,
  /** The day's till-shift rows (tillShiftCsvRows), appended last on the figures sheet. */
  shiftRows: readonly CsvCell[][] = [],
): ExportBundle {
  return [figuresTable(labels, close, summary, joinNames, shiftRows), adjustmentsTable(labels, adjustments, words)];
}

function figuresTable(
  labels: CsvLabels,
  close: CloseResult | null,
  summary: DaySummaryRow | null,
  joinNames: (names: readonly string[]) => string,
  shiftRows: readonly CsvCell[][],
): ExportTable {
  const rows: CsvCell[][] = [];
  const line = (figure: string, value: CsvCell, count: CsvCell = null, who: CsvCell = null, note: CsvCell = null) => rows.push([figure, value, count, who, note]);

  if (summary) {
    line(labels.openingFloat, summary.opening_float_iqd);
    line(labels.cashPayments, summary.cash_payments_iqd);
    // Parts of the two lines above, not additions to them — the note column says so.
    if (summary.desk_cash_iqd != null) line(labels.deskCash, summary.desk_cash_iqd, null, null, labels.partOf);
    line(labels.cardPayments, summary.card_payments_iqd);
    if (summary.desk_card_iqd != null) line(labels.deskCard, summary.desk_card_iqd, null, null, labels.partOf);
  }
  if (close) {
    line(labels.cashExpected, close.cash_expected_iqd);
    line(labels.cashCounted, close.cash_counted_iqd);
    line(labels.variance, close.cash_variance_iqd);
    line(labels.cardExpected, close.card_expected_iqd);
    line(labels.cardBatch, close.card_terminal_batch_iqd);
  }
  if (summary) {
    line(labels.discounts, summary.discounts_iqd, summary.adjustment_count, joinNames(summary.authorizer_names ?? []));
    line(labels.voids, summary.voided_lines_iqd, summary.voided_line_count);
    line(labels.refunds, summary.refunds_iqd, summary.refund_count);
    line(labels.waste, summary.waste_cost_iqd);
  }
  // Figure, value, count and authoriser, like every line above; no note.
  for (const r of shiftRows) rows.push([...r.slice(0, 4), null]);
  return { name: labels.tabFigures, columns: [labels.figure, { header: labels.value, type: 'money' }, { header: labels.count, type: 'number' }, labels.authorisers, labels.note], rows };
}

function adjustmentsTable(labels: CsvLabels, adjustments: readonly DayAdjustmentRow[], words: AdjustmentWords): ExportTable {
  return {
    name: labels.adjustments,
    columns: [labels.date, labels.time, labels.what, labels.appliesTo, labels.reason, { header: labels.amount, type: 'money' }, labels.appliedBy, labels.authorisedBy, labels.tab],
    rows: adjustments.map((a): CsvCell[] => {
      const [day, time] = momentCells(a.created_at);
      return [day, time, cellText(words.what(a)), cellText(words.scope(a)), cellText(words.reason(a)), a.amount_iqd, cellText(a.applied_by_name), cellText(a.authorized_by_name), shortId(a.tab_id)];
    }),
  };
}

// ---------------------------------------------------------------------------
// Plain words for what the server stores as codes
// ---------------------------------------------------------------------------

export type AdjustmentKind = 'percent' | 'amount' | 'override' | 'other';

/**
 * `tab_adjustments.kind` (the `adjustment_kind` enum, 0002) in the words a
 * manager uses. The table used to print `discount_percent` verbatim. For a
 * percentage the stored value is in basis points (1000 = 10%, see
 * app.apply_discount in 0037), so the percent is value / 100 — a unit
 * conversion for the label, never a money figure.
 */
export function describeAdjustmentKind(a: Pick<DayAdjustmentRow, 'kind' | 'value'>): { kind: AdjustmentKind; percent: number | null } {
  switch (a.kind) {
    case 'discount_percent':
      return { kind: 'percent', percent: a.value == null ? null : a.value / 100 };
    case 'discount_amount':
      return { kind: 'amount', percent: null };
    case 'price_override':
      return { kind: 'override', percent: null };
    default:
      return { kind: 'other', percent: null };
  }
}

/** The reason codes staff pick from (op.reasons.*); anything else is shown as typed. */
export const KNOWN_REASONS = [
  'customer_request',
  'weather',
  'expired',
  'staff_error',
  'duplicate',
  'wrong_item',
  'changed_mind',
  'quality',
  'spill',
  'comp',
  'other',
] as const;
export type KnownReason = (typeof KNOWN_REASONS)[number];

export function knownReason(code: string | null | undefined): KnownReason | null {
  return code && (KNOWN_REASONS as readonly string[]).includes(code) ? (code as KnownReason) : null;
}

/**
 * The offline queue's mutation types (operator-shell ipc-validate.ts
 * MUTATION_TYPES) as catalog keys, so a blocking write reads "Payment" rather
 * than `payment.record`. An unknown type falls back to a generic word.
 */
export const QUEUE_WRITE_KEY = {
  'order.create': 'order',
  'order.add_items': 'order',
  'ticket.status': 'ticket',
  'payment.record': 'payment',
  'reservation.create': 'booking',
  'reservation.update': 'booking',
  'waiter_call.action': 'waiterCall',
  'stock.waste': 'waste',
  'tab.open': 'tab',
  'tab.settle': 'payment',
  'adjustment.apply': 'discount',
  // Item 9 / C3 (0120)
  'tab.cancel': 'tabRemoval',
  'tab.settle_zero': 'billClose',
  'payment.refund': 'refund',
  'order_item.void': 'voidLine',
  // `satisfies Record<MutationType, string>`: a queued type without a word here
  // fails typecheck instead of reading as "Change" on the day-close list.
} as const satisfies Record<MutationType, string>;
export type QueueWriteKey = (typeof QUEUE_WRITE_KEY)[keyof typeof QUEUE_WRITE_KEY] | 'other';

export function queueWriteKey(mutationType: string): QueueWriteKey {
  return (QUEUE_WRITE_KEY as Record<string, QueueWriteKey>)[mutationType] ?? 'other';
}

/**
 * The error code of a queue row's last error, if it has one: either leading
 * ("ITEM_UNAVAILABLE: …") or after the HTTP status the sync worker prefixes
 * ("400: ITEM_UNAVAILABLE", sync-worker.ts markFailed).
 */
export function queueErrorCode(lastError: string | null): string | null {
  // One reader for every error string (queueResults.ts), the toast's included.
  return errorStringCode(lastError);
}

/** One row of app.unpaid_played_bookings (0106): played on this business day, court fee still owed. */
export interface UnpaidPlayedBooking {
  reservation_id: string;
  guest_name: string | null;
  status: string;
  start_at: string;
  end_at: string;
  court_name_en: string | null;
  court_name_ar: string | null;
  price_iqd: number | null;
  /** What is still owed on the court — the server's figure, shown as is. */
  remaining_iqd: number;
  live_tab_id: string | null;
  /**
   * Open matches (0265, money.md §7.5): set on a match booking. The row then
   * lists the seats still owing; a booking whose only gap is written-off
   * shares no longer appears (court_fee_remaining nets them).
   */
  match_id?: string | null;
  owed_by_seats_iqd?: number | null;
  /** A price change after booking that no player owes (DF-4). */
  delta_owed_iqd?: number | null;
  seats_owing?: UnpaidSeat[] | null;
}

/** A seat still owing on a played match booking; `label` is the staff label booking_bill gives it. */
export interface UnpaidSeat {
  seat_no: number;
  label: string | null;
  owed_iqd: number;
}

/**
 * The RPC's payload as rows. A WARNING list, never a close block: it feeds a
 * soft section and nothing in deriveDayCloseState / closeBlock reads it. A
 * payload that is not an array (or a row with no id) is read as nothing to
 * warn about rather than breaking the close screen.
 */
export function unpaidPlayedRows(payload: unknown): UnpaidPlayedBooking[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (r): r is UnpaidPlayedBooking =>
      r != null && typeof r === 'object' && typeof (r as { reservation_id?: unknown }).reservation_id === 'string',
  );
}

/** A played-not-paid row that is an open match's booking (0265). */
export function isMatchUnpaid(r: Pick<UnpaidPlayedBooking, 'match_id'>): boolean {
  return typeof r.match_id === 'string' && r.match_id !== '';
}

/**
 * The name after "Open match · " on a match row: the label app.desk_match_states
 * gives the booking (the organiser, else the first desk seat's typed name),
 * else null and the row reads "Open match" (operator.md §5.18, the §5.8
 * bookingLabel rule). Never the booking's guest_name: every match booking
 * carries the DB literal there ('Open match', 0260 match_try_book), and
 * unpaid_played_bookings sends no label of its own.
 */
export function unpaidMatchLabel(state: { label: string | null } | null | undefined): string | null {
  const label = state?.label?.trim();
  return label ? label : null;
}

/** A match row's owing seats in seat order; a malformed seat is dropped rather than shown as 0. */
export function unpaidSeats(r: Pick<UnpaidPlayedBooking, 'seats_owing'>): UnpaidSeat[] {
  return (Array.isArray(r.seats_owing) ? r.seats_owing : [])
    .filter((x): x is UnpaidSeat => x != null && Number.isFinite(x.seat_no) && Number.isFinite(x.owed_iqd))
    .sort((a, b) => a.seat_no - b.seat_no);
}

// ---------------------------------------------------------------------------
// Money outside the drawer (app.day_close_online, 0265; open matches
// operator.md §5.18, money.md §7.2)
// ---------------------------------------------------------------------------

/**
 * The day's online money and open-match figures. Information only: close_day
 * never reads them and none of it is in the cash count. Every figure is the
 * server's; a missing one is null, printed "—".
 */
export interface DayCloseOnline {
  business_date: string | null;
  deposits: Record<'received_iqd' | 'received_count' | 'refunded_iqd' | 'refunded_count' | 'forfeited_iqd' | 'forfeited_count' | 'refunds_waiting_iqd' | 'refunds_waiting_count', number | null>;
  tickets_here: Record<'forfeited_iqd' | 'forfeited_count' | 'restored_count' | 'cashouts_iqd' | 'cashouts_count', number | null>;
  tickets_chain: Record<
    'sold_iqd' | 'sold_tickets' | 'purchases' | 'refunded_iqd' | 'refunded_tickets' | 'refunds_waiting_iqd' | 'refunds_waiting_count' | 'liability_iqd' | 'liability_tickets',
    number | null
  >;
  matches: Record<'bookings' | 'price_iqd' | 'desk_paid_iqd' | 'written_off_iqd' | 'owed_iqd' | 'called_off' | 'no_show_seats', number | null>;
  sandbox_excluded: Record<'deposits' | 'tickets', number | null>;
  /**
   * Coaching (0285; coaching operator.md §5.18.1, X27: Money's keys plus
   * `kept_*`): the day's lesson money. Null from a server before 0285, which
   * sends no block: the card then has no lessons group.
   */
  lessons: Record<LessonDayKey, number | null> | null;
  /**
   * C-31, R27, R71: true when this day's refunds are dated by the till shift
   * they were made in (an open day, or one closed under that rule); false for
   * a day closed before it; null from a server that does not say.
   */
  refunds_dated_by_shift: boolean | null;
}

/** `day_close_online.lessons` (COACHING_SHAPES.day_close_online, X27). */
export const LESSON_DAY_KEYS = [
  'desk_paid_iqd',
  'desk_paid_count',
  'desk_refunded_iqd',
  'online_received_iqd',
  'online_received_count',
  'online_refunded_iqd',
  'online_refunded_count',
  'online_refunds_waiting_iqd',
  'online_refunds_waiting_count',
  'refunds_due_desk_iqd',
  'refunds_due_desk_count',
  'kept_iqd',
  'kept_count',
  'lessons',
  'owed_iqd',
  'owed_count',
  'owed_to_coaches_iqd',
] as const;
export type LessonDayKey = (typeof LESSON_DAY_KEYS)[number];

type RawObj = Record<string, unknown>;
const objOf = (v: unknown): RawObj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as RawObj) : {});
const numOf = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
function pickNums<K extends string>(raw: unknown, keys: readonly K[]): Record<K, number | null> {
  const o = objOf(raw);
  return Object.fromEntries(keys.map((k) => [k, numOf(o[k])])) as Record<K, number | null>;
}

/** The payload read defensively; null when it is not an object at all. */
export function readDayCloseOnline(raw: unknown): DayCloseOnline | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as RawObj;
  return {
    business_date: typeof r.business_date === 'string' ? r.business_date : null,
    deposits: pickNums(r.deposits, ['received_iqd', 'received_count', 'refunded_iqd', 'refunded_count', 'forfeited_iqd', 'forfeited_count', 'refunds_waiting_iqd', 'refunds_waiting_count']),
    tickets_here: pickNums(r.tickets_here, ['forfeited_iqd', 'forfeited_count', 'restored_count', 'cashouts_iqd', 'cashouts_count']),
    tickets_chain: pickNums(r.tickets_chain, [
      'sold_iqd',
      'sold_tickets',
      'purchases',
      'refunded_iqd',
      'refunded_tickets',
      'refunds_waiting_iqd',
      'refunds_waiting_count',
      'liability_iqd',
      'liability_tickets',
    ]),
    matches: pickNums(r.matches, ['bookings', 'price_iqd', 'desk_paid_iqd', 'written_off_iqd', 'owed_iqd', 'called_off', 'no_show_seats']),
    sandbox_excluded: pickNums(r.sandbox_excluded, ['deposits', 'tickets']),
    lessons: r.lessons && typeof r.lessons === 'object' && !Array.isArray(r.lessons) ? pickNums(r.lessons, LESSON_DAY_KEYS) : null,
    refunds_dated_by_shift: typeof r.refunds_dated_by_shift === 'boolean' ? r.refunds_dated_by_shift : null,
  };
}

export type OnlineGroupId = 'deposits' | 'ticketsHere' | 'ticketsChain' | 'matches' | 'lessons' | 'sandbox';

/** One label-and-figure row: a count, an amount, or both, as the table in §5.18 lays them out. */
export interface OnlineRow {
  /** The row's word under `ws.matches.dayClose.<group>.<id>` (the lessons group: `ws.coaching.dayClose.rows.<id>`). */
  id: string;
  count: number | null;
  amount: number | null;
  /** Rows that are only a count (bookings, called off) or only money (court price). */
  shows: 'both' | 'count' | 'amount';
}

export interface OnlineGroup {
  id: OnlineGroupId;
  rows: OnlineRow[];
}

const both = (id: string, count: number | null, amount: number | null): OnlineRow => ({ id, count, amount, shows: 'both' });
const countOnly = (id: string, count: number | null): OnlineRow => ({ id, count, amount: null, shows: 'count' });
const amountOnly = (id: string, amount: number | null): OnlineRow => ({ id, count: null, amount, shows: 'amount' });

/**
 * The card's groups in the order of §5.18, each with its rows. A group with
 * no non-zero figure is left out (a branch that never took an online deposit
 * is not shown four zeros), and the test-payments group only ever shows when
 * something was left out.
 */
export function onlineMoneyOf(d: DayCloseOnline): OnlineGroup[] {
  const groups: OnlineGroup[] = [
    {
      id: 'deposits',
      rows: [
        both('received', d.deposits.received_count, d.deposits.received_iqd),
        both('refunded', d.deposits.refunded_count, d.deposits.refunded_iqd),
        both('forfeited', d.deposits.forfeited_count, d.deposits.forfeited_iqd),
        both('waiting', d.deposits.refunds_waiting_count, d.deposits.refunds_waiting_iqd),
      ],
    },
    {
      id: 'ticketsHere',
      rows: [both('forfeited', d.tickets_here.forfeited_count, d.tickets_here.forfeited_iqd), both('cashouts', d.tickets_here.cashouts_count, d.tickets_here.cashouts_iqd)],
    },
    {
      id: 'ticketsChain',
      rows: [
        both('sold', d.tickets_chain.sold_tickets, d.tickets_chain.sold_iqd),
        both('refunded', d.tickets_chain.refunded_tickets, d.tickets_chain.refunded_iqd),
        both('waiting', d.tickets_chain.refunds_waiting_count, d.tickets_chain.refunds_waiting_iqd),
        both('liability', d.tickets_chain.liability_tickets, d.tickets_chain.liability_iqd),
      ],
    },
    {
      id: 'matches',
      rows: [
        countOnly('bookings', d.matches.bookings),
        amountOnly('price', d.matches.price_iqd),
        amountOnly('deskPaid', d.matches.desk_paid_iqd),
        amountOnly('writtenOff', d.matches.written_off_iqd),
        amountOnly('owed', d.matches.owed_iqd),
        countOnly('calledOff', d.matches.called_off),
        countOnly('noShowSeats', d.matches.no_show_seats),
      ],
    },
    // Coaching (0285; coaching operator.md §5.18.1): information only, never in the cash count.
    ...(d.lessons ? [{ id: 'lessons' as const, rows: lessonRows(d.lessons) }] : []),
    { id: 'sandbox', rows: [countOnly('deposits', d.sandbox_excluded.deposits), countOnly('tickets', d.sandbox_excluded.tickets)] },
  ];
  return groups.filter((g) => g.rows.some((r) => Boolean(r.count) || Boolean(r.amount)));
}

/** The lessons group's rows, in the order of coaching operator.md §5.18.1's table. */
function lessonRows(l: Record<LessonDayKey, number | null>): OnlineRow[] {
  return [
    both('onlineReceived', l.online_received_count, l.online_received_iqd),
    both('onlineRefunded', l.online_refunded_count, l.online_refunded_iqd),
    both('onlineWaiting', l.online_refunds_waiting_count, l.online_refunds_waiting_iqd),
    both('kept', l.kept_count, l.kept_iqd),
    both('deskPaid', l.desk_paid_count, l.desk_paid_iqd),
    // C-31: refunded at the desk today, whatever day the money was taken.
    amountOnly('deskRefunded', l.desk_refunded_iqd),
    both('owed', l.owed_count, l.owed_iqd),
    both('refundsDueDesk', l.refunds_due_desk_count, l.refunds_due_desk_iqd),
    both('owedToCoaches', l.lessons, l.owed_to_coaches_iqd),
  ];
}

/** A group's title: open matches and deposits read `ws.matches.dayClose.*`, the lessons group `ws.coaching.dayClose.*`. */
export function onlineGroupTitleKey(group: OnlineGroupId): MessageKey {
  return group === 'lessons' ? 'ws.coaching.dayClose.title' : `ws.matches.dayClose.${group}.title`;
}

/** A row's words, by its group (coaching operator.md §5.18.1). */
export function onlineLabelKey(group: OnlineGroupId, row: Pick<OnlineRow, 'id'>): MessageKey {
  return (group === 'lessons' ? `ws.coaching.dayClose.rows.${row.id}` : `ws.matches.dayClose.${group}.${row.id}`) as MessageKey;
}

/**
 * The till-shifts step's cross-day sentence (C-31, R27, R71): on a day whose
 * refunds are dated by their till shift, the earlier days' cash refunds count
 * in this day's expected cash; on a day closed before that rule, or from a
 * server that does not say, they are left out, as the sentence always said.
 */
export function crossDayKey(datedByShift: boolean | null | undefined): MessageKey {
  return datedByShift === true ? 'ws.tillShift.dayClose.crossDayCounted' : 'ws.tillShift.dayClose.crossDay';
}

/** Every figure zero or missing: the card is not drawn. */
export function onlineIsEmpty(d: DayCloseOnline | null | undefined): boolean {
  return !d || onlineMoneyOf(d).length === 0;
}

/**
 * app.checklist_day_state (0165) for the day being closed: the daily lists
 * that still have a line nobody ticked, in the server's role and slot order.
 * Like the unpaid-played rows, a WARNING list, never a close block (plan
 * §7.3): nothing in deriveDayCloseState or closeBlock reads it. A payload
 * that is not the RPC's shape reads as nothing to warn about.
 */
export function unfinishedChecklists(payload: unknown): DayStateList[] {
  return readDayState(payload).lists.filter(isUnfinished);
}

export type CloseBlock = 'openTabs' | 'unsynced' | 'noCount' | null;

/**
 * Why the close button cannot be pressed, in the order the manager has to deal
 * with them. A count is required: `close_day` would accept 0, and a forgotten
 * count used to go through as "short by the whole drawer" because the field
 * started at 0.
 */
export function closeBlock(state: DayCloseState, countedCash: number | null): CloseBlock {
  if (state === 'blockedByOpenTabs') return 'openTabs';
  if (state === 'blockedByUnsyncedQueue') return 'unsynced';
  if (countedCash === null) return 'noCount';
  return null;
}

// ---------------------------------------------------------------------------
// Till shifts (wave5-addendum-2026-09-25 §5.2, V10)
// ---------------------------------------------------------------------------

/**
 * The day's till shifts, as the "Till shifts" step lays them out: each shift,
 * the money taken or paid out at a station with no shift open, and the one
 * cross-day line (refunds made on this day for earlier days' payments, which
 * close_day's expected cash leaves out, TI5). A WARNING section, never a close
 * block: nothing in deriveDayCloseState or closeBlock reads it, and an open
 * shift only warns (close_day ends it uncounted, TI9).
 */
export interface TillShiftDay {
  shifts: ListShift[];
  outside: OutsideRow[];
  /** Cash refunds made on this day for earlier days' payments (cross_day.earlier_days_cash_refunds_iqd). */
  earlierDaysCashRefundsIqd: number;
  openCount: number;
}

/** app.till_shift_list (already read by tillShift/api) narrowed to one business day. */
export function tillShiftRows(list: ShiftList | null | undefined, daySessionId: string | null): TillShiftDay {
  const mine = <T extends { day_session_id: string }>(rows: readonly T[]) => (daySessionId ? rows.filter((r) => r.day_session_id === daySessionId) : [...rows]);
  const shifts = mine(list?.shifts ?? []);
  const outside = mine(list?.outside ?? []).filter((o) => o.payment_count > 0 || o.refund_count > 0);
  const cross = mine(list?.cross_day ?? [])[0];
  return {
    shifts,
    outside,
    earlierDaysCashRefundsIqd: cross?.earlier_days_cash_refunds_iqd ?? 0,
    openCount: shifts.filter((s) => s.closed_at === null).length,
  };
}

export interface ShiftCsvLabels {
  /** "Till shift difference: {name}, {station}". */
  shift: (name: string, station: string) => string;
  /** "Till shift still open: …" — no value: an open shift has no count yet. */
  shiftOpen: (name: string, station: string) => string;
  /** "Till shift ended with the day, not counted: …". */
  shiftByDay: (name: string, station: string) => string;
  outsideIn: (station: string) => string;
  outsideOut: (station: string) => string;
  crossDay: string;
  noStation: string;
}

/**
 * CSV rows for the day's shifts, appended by dayCloseCsv: one per shift with
 * its stamped difference (count = its payments, the authoriser = whoever
 * signed), then the cash taken and paid out outside a shift per station, then
 * the cross-day refunds. Every value is a server figure; nothing is summed.
 */
export function tillShiftCsvRows(day: TillShiftDay, labels: ShiftCsvLabels): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const s of day.shifts) {
    if (s.closed_at === null) rows.push([labels.shiftOpen(s.staff_name, s.station_id), null, s.payment_count, null]);
    else if (s.closed_via === 'day_close') rows.push([labels.shiftByDay(s.staff_name, s.station_id), null, s.payment_count, null]);
    else rows.push([labels.shift(s.staff_name, s.station_id), s.cash_variance_iqd, s.payment_count, s.authorized_by_name]);
  }
  for (const o of day.outside) {
    const station = o.station_id ?? labels.noStation;
    if (o.cash_payments_iqd !== 0) rows.push([labels.outsideIn(station), o.cash_payments_iqd, o.payment_count, null]);
    if (o.cash_refunds_iqd !== 0) rows.push([labels.outsideOut(station), o.cash_refunds_iqd, o.refund_count, null]);
  }
  if (day.earlierDaysCashRefundsIqd !== 0) rows.push([labels.crossDay, day.earlierDaysCashRefundsIqd, null, null]);
  return rows;
}
