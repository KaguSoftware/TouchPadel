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
}

/** v_day_close_adjustments (0020) — one row per PIN-authorised adjustment. */
export interface DayAdjustmentRow {
  adjustment_id: string;
  tab_id: string;
  kind: string;
  value: number | null;
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
): { headers: string[]; rows: CsvCell[][] } {
  const headers = [labels.figure, labels.value, labels.count, labels.authorisers];
  const rows: CsvCell[][] = [];
  if (summary) {
    rows.push([labels.openingFloat, summary.opening_float_iqd, null, null]);
    rows.push([labels.cashPayments, summary.cash_payments_iqd, null, null]);
    rows.push([labels.cardPayments, summary.card_payments_iqd, null, null]);
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
      `${a.kind}${a.reason_code ? ` (${a.reason_code})` : ''}`,
      a.amount_iqd,
      1,
      a.authorized_by_name ?? a.applied_by_name ?? null,
    ]);
  }
  return { headers, rows };
}
