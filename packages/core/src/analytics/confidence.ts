/**
 * How much data a claim about this period is allowed to rest on.
 *
 * Every other module computes what the numbers SAY; this one computes what they can support.
 * The same object is (1) handed to the model as its data basis, (2) enforced in code after the
 * model answers (`dropLowConfidenceClaims` in ./insightsText.ts), and (3) printed on the AI
 * card so the reader sees the sample next to the claim. Pure arithmetic — no queries.
 */
import { dayOfWeekOfDate } from '../time/tz';
import { MIN_TREND_DAYS, MIN_WEEKDAY_DAYS, THIN_PERIOD_DAYS } from './insightsText';
import { datesInRange, type DateRange } from './range';

export { MIN_TREND_DAYS, MIN_WEEKDAY_DAYS, THIN_PERIOD_DAYS };

export type DataBasis = {
  /** Days in the picked range. */
  rangeDays: number;
  /** Days that actually have sales data — the real denominator. */
  salesDays: number;
  /**
   * Occurrences of each weekday among the days WITH sales data. `day` is the JS weekday index
   * (0 = Sunday … 6 = Saturday), listed in index order; the UI maps indexes to names and
   * reorders for the venue's week start.
   */
  weekdayCounts: { day: number; days: number }[];
  sessions: number;
  /** Days of engagement data (the tracking floor can make this < rangeDays). */
  engagementDays: number;
  /** Distinct items with at least one real sale. */
  itemsWithSales: number;
};

export function buildDataBasis(input: {
  range: DateRange;
  /** Dates ('YYYY-MM-DD') that have sales. Duplicates are fine. */
  salesDates: readonly string[];
  sessions: number;
  engagementDays: number;
  itemsWithSales: number;
}): DataBasis {
  const unique = [...new Set(input.salesDates)];
  const counts = new Array<number>(7).fill(0);
  for (const d of unique) counts[dayOfWeekOfDate(d)]! += 1;
  return {
    rangeDays: datesInRange(input.range).length,
    salesDays: unique.length,
    weekdayCounts: counts.map((days, day) => ({ day, days })),
    sessions: input.sessions,
    engagementDays: input.engagementDays,
    itemsWithSales: input.itemsWithSales,
  };
}

/** True while the period is too thin for its findings to be read as settled. */
export function isThinPeriod(basis: DataBasis): boolean {
  return basis.salesDays < THIN_PERIOD_DAYS;
}

/** JS weekday indexes too rare in this period to support a claim. */
export function thinWeekdays(basis: DataBasis): number[] {
  return basis.weekdayCounts.filter((w) => w.days < MIN_WEEKDAY_DAYS).map((w) => w.day);
}

/** Copy for `describeBasis`; the operator adapts its `tr()` into this shape. */
export type BasisCopy = {
  salesDays: (salesDays: number, rangeDays: number) => string;
  sessions: (n: number) => string;
  items: (n: number) => string;
  separator: string;
};

export const DEFAULT_BASIS_COPY_EN: BasisCopy = {
  salesDays: (s, r) => `${s}/${r} days with sales`,
  sessions: (n) => `${n.toLocaleString('en')} sessions`,
  items: (n) => `${n} items`,
  separator: ' · ',
};

/**
 * One-line summary of the sample for the AI card footer, e.g. "16/30 days with sales ·
 * 412 sessions · 38 items". Printed, not hidden behind a tooltip.
 */
export function describeBasis(basis: DataBasis, copy: BasisCopy = DEFAULT_BASIS_COPY_EN): string {
  const parts = [copy.salesDays(basis.salesDays, basis.rangeDays)];
  if (basis.sessions > 0) parts.push(copy.sessions(basis.sessions));
  if (basis.itemsWithSales > 0) parts.push(copy.items(basis.itemsWithSales));
  return parts.join(copy.separator);
}
