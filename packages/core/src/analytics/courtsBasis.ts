/**
 * How much data a claim about the COURTS side of the venue may rest on.
 *
 * The cafe twin of this file is ./confidence.ts (`DataBasis`): same idea, different
 * denominators. A cafe claim rests on days with sales; a court claim rests on days with
 * bookings, on the booked total (live + cancelled + no-show) behind every rate, on distinct
 * guest identities (counts only, never who) and on the bookings the till linked a tab to.
 * The floors below are the honesty gates the Courts tab and `mineCourtPatterns` share.
 * Pure arithmetic, no I/O.
 */
import { dayOfWeekOfDate } from '../time/tz';
import {
  MIN_ATTACH_BOOKINGS,
  MIN_CELL_OPEN_DAYS,
  MIN_ENDING_N,
  MIN_IDENTITIES,
  MIN_RATE_DENOM,
} from './insightsContract';
import { type FindingBasis, MIN_WEEKDAY_DAYS, THIN_PERIOD_DAYS } from './insightsText';
import { datesInRange, type DateRange } from './range';

// The floors live in ./insightsContract.ts (shared byte-for-byte with the edge
// function) and are re-exported here so every court reader keeps one import.
export { MIN_ATTACH_BOOKINGS, MIN_CELL_OPEN_DAYS, MIN_ENDING_N, MIN_IDENTITIES, MIN_RATE_DENOM };

export type CourtsBasis = {
  /** Days in the picked range. */
  rangeDays: number;
  /** Days that actually have bookings (any status), the real denominator. */
  bookingDays: number;
  /**
   * Occurrences of each weekday among the days WITH bookings. `day` is the JS weekday index
   * (0 = Sunday .. 6 = Saturday), listed in index order; the same shape as `DataBasis`.
   */
  weekdayCounts: { day: number; days: number }[];
  /** Live bookings (confirmed / arrived / completed). */
  bookings: number;
  /** Live + cancelled + no-show: the denominator of every reliability rate. */
  bookedTotal: number;
  /** Distinct guest identities behind the bookings; a count, never a list. */
  identities: number;
  /** Live bookings the till linked a cafe tab to. */
  linkedBookings: number;
};

export function buildCourtsBasis(input: {
  range: DateRange;
  /** Business dates ('YYYY-MM-DD') that have bookings. Duplicates are fine. */
  bookingDates: readonly string[];
  bookings: number;
  bookedTotal: number;
  identities: number;
  linkedBookings: number;
}): CourtsBasis {
  const unique = [...new Set(input.bookingDates)];
  const counts = new Array<number>(7).fill(0);
  for (const d of unique) counts[dayOfWeekOfDate(d)]! += 1;
  return {
    rangeDays: datesInRange(input.range).length,
    bookingDays: unique.length,
    weekdayCounts: counts.map((days, day) => ({ day, days })),
    bookings: input.bookings,
    bookedTotal: input.bookedTotal,
    identities: input.identities,
    linkedBookings: input.linkedBookings,
  };
}

/** True while the period is too thin for its findings to be read as settled. */
export function isThinCourtsPeriod(basis: CourtsBasis): boolean {
  return basis.bookingDays < THIN_PERIOD_DAYS;
}

/** JS weekday indexes too rare in this period to support a claim. */
export function thinCourtWeekdays(basis: CourtsBasis): number[] {
  return basis.weekdayCounts.filter((w) => w.days < MIN_WEEKDAY_DAYS).map((w) => w.day);
}

/**
 * The slice the confidence gate in ./insightsText.ts reads, so `dropLowConfidenceClaims`
 * can run over court findings unchanged. Explicit on purpose: `salesDays` there means
 * "days with data", which for courts is the booking-day count.
 */
export function toFindingBasis(basis: CourtsBasis): FindingBasis {
  return { salesDays: basis.bookingDays, weekdayCounts: basis.weekdayCounts };
}

/**
 * A rate the UI may show as a percentage, or only as "n of N" when the denominator is too
 * small to carry one. `pct` is null below `MIN_RATE_DENOM` (and on a zero denominator),
 * otherwise rounded to one decimal.
 */
export function rateOrCount(n: number, d: number): { pct: number | null; n: number; d: number } {
  if (d === 0 || d < MIN_RATE_DENOM) return { pct: null, n, d };
  return { pct: Math.round((n / d) * 1000) / 10, n, d };
}

/** Copy for `describeCourtsBasis`; the operator adapts its `tr()` into this shape. */
export type CourtsBasisCopy = {
  bookingDays: (bookingDays: number, rangeDays: number) => string;
  bookings: (n: number) => string;
  identities: (n: number) => string;
  separator: string;
};

export const DEFAULT_COURTS_BASIS_COPY_EN: CourtsBasisCopy = {
  bookingDays: (b, r) => `${b}/${r} days with bookings`,
  bookings: (n) => `${n.toLocaleString('en')} bookings`,
  identities: (n) => `${n.toLocaleString('en')} guests`,
  separator: ' · ',
};

/**
 * One-line summary of the sample for the AI card footer, e.g. "16/30 days with bookings ·
 * 212 bookings · 48 guests". Printed, not hidden behind a tooltip.
 */
export function describeCourtsBasis(basis: CourtsBasis, copy: CourtsBasisCopy = DEFAULT_COURTS_BASIS_COPY_EN): string {
  const parts = [copy.bookingDays(basis.bookingDays, basis.rangeDays)];
  if (basis.bookings > 0) parts.push(copy.bookings(basis.bookings));
  if (basis.identities > 0) parts.push(copy.identities(basis.identities));
  return parts.join(copy.separator);
}
