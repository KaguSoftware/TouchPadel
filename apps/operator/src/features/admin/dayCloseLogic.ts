/**
 * Pure helpers for the day-close screen (spec 06.22). No money arithmetic:
 * expected, counted and variance arrive from `app.close_day` and the
 * `v_day_close_summary` view; this file only decides which state to render
 * and how to lay the server figures out for a CSV.
 */
import type { CsvCell } from '../analytics/csv';

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
}

/**
 * Rows for the client-side CSV export: the close figures, then the
 * discounts / voids / refunds / waste summary with the authoriser names, then
 * one row per authorised adjustment. Everything is a server figure.
 */
export function dayCloseCsv(
  labels: CsvLabels,
  close: CloseResult | null,
  summary: DaySummaryRow | null,
  adjustments: readonly DayAdjustmentRow[],
  joinNames: (names: readonly string[]) => string,
  /** The words the screen shows for an adjustment ("10% off · whole bill · Complimentary"). */
  describe: (a: DayAdjustmentRow) => string,
): { headers: string[]; rows: CsvCell[][] } {
  const headers = [labels.figure, labels.value, labels.count, labels.authorisers];
  const rows: CsvCell[][] = [];
  if (summary) {
    rows.push([labels.openingFloat, summary.opening_float_iqd, null, null]);
    rows.push([labels.cashPayments, summary.cash_payments_iqd, null, null]);
    // Parts of the two lines above, not additions to them.
    if (summary.desk_cash_iqd != null) rows.push([labels.deskCash, summary.desk_cash_iqd, null, null]);
    rows.push([labels.cardPayments, summary.card_payments_iqd, null, null]);
    if (summary.desk_card_iqd != null) rows.push([labels.deskCard, summary.desk_card_iqd, null, null]);
  }
  if (close) {
    rows.push([labels.cashExpected, close.cash_expected_iqd, null, null]);
    rows.push([labels.cashCounted, close.cash_counted_iqd, null, null]);
    rows.push([labels.variance, close.cash_variance_iqd, null, null]);
    rows.push([labels.cardExpected, close.card_expected_iqd, null, null]);
    rows.push([labels.cardBatch, close.card_terminal_batch_iqd, null, null]);
  }
  if (summary) {
    const names = joinNames(summary.authorizer_names ?? []);
    rows.push([labels.discounts, summary.discounts_iqd, summary.adjustment_count, names]);
    rows.push([labels.voids, summary.voided_lines_iqd, summary.voided_line_count, null]);
    rows.push([labels.refunds, summary.refunds_iqd, summary.refund_count, null]);
    rows.push([labels.waste, summary.waste_cost_iqd, null, null]);
  }
  for (const a of adjustments) {
    rows.push([
      describe(a),
      a.amount_iqd,
      1,
      a.authorized_by_name ?? a.applied_by_name ?? null,
    ]);
  }
  return { headers, rows };
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
} as const satisfies Record<string, string>;
export type QueueWriteKey = (typeof QUEUE_WRITE_KEY)[keyof typeof QUEUE_WRITE_KEY] | 'other';

export function queueWriteKey(mutationType: string): QueueWriteKey {
  return (QUEUE_WRITE_KEY as Record<string, QueueWriteKey>)[mutationType] ?? 'other';
}

/** The leading error code of a queue row's last error ("ITEM_UNAVAILABLE: …"), if it has one. */
export function queueErrorCode(lastError: string | null): string | null {
  const m = lastError?.match(/^[A-Z][A-Z0-9_]+/);
  return m ? m[0] : null;
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
