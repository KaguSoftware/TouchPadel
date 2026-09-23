/**
 * Pure helpers for the day-close screen (spec 06.22). No money arithmetic:
 * expected, counted and variance arrive from `app.close_day` and the
 * `v_day_close_summary` view; this file only decides which state to render
 * and how to lay the server figures out for a CSV.
 */
import type { MutationType } from '@touch/core/schemas/mutations';
import { errorStringCode } from '../../lib/queueResults';
import type { CsvBundle, CsvCell, CsvTable } from '../analytics/csv';
import { cellText, momentCells, shortId } from '../analytics/csvFormat';

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
  /** 01-figures.csv */
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
  /** 02-adjustments.csv */
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
): CsvBundle {
  return [figuresTable(labels, close, summary, joinNames), adjustmentsTable(labels, adjustments, words)];
}

function figuresTable(labels: CsvLabels, close: CloseResult | null, summary: DaySummaryRow | null, joinNames: (names: readonly string[]) => string): CsvTable {
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
  return { name: 'figures', headers: [labels.figure, labels.value, labels.count, labels.authorisers, labels.note], rows };
}

function adjustmentsTable(labels: CsvLabels, adjustments: readonly DayAdjustmentRow[], words: AdjustmentWords): CsvTable {
  return {
    name: 'adjustments',
    headers: [labels.date, labels.time, labels.what, labels.appliesTo, labels.reason, labels.amount, labels.appliedBy, labels.authorisedBy, labels.tab],
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
