/**
 * A lead tile's sparkline series: one value per day of the period, in order,
 * a day with no row counted as 0 (no booking, no sale) so the line's spacing
 * is the calendar's. A period of one day, or one longer than the 400 days
 * analytics_bounds allows, gets no line: a single point is not a shape, and
 * neither does a range that is not two dates yet.
 */
import { addDays } from '@touch/core';
import type { SparkSeries } from './charts/Sparkline';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function daySeries<T extends { date: string }>(
  range: { from: string; to: string },
  rows: readonly T[] | null | undefined,
  pick: (row: T) => number,
  label: (iso: string) => string,
  format: (n: number) => string,
): SparkSeries | null {
  if (!rows || !ISO.test(range.from) || !ISO.test(range.to)) return null;
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.date, (sums.get(r.date) ?? 0) + pick(r));
  const dates: string[] = [];
  for (let d = range.from, i = 0; d <= range.to && i <= 400; d = addDays(d, 1), i++) dates.push(d);
  if (dates.length < 2 || dates.length > 400) return null;
  return { values: dates.map((d) => sums.get(d) ?? 0), labels: dates.map(label), format };
}

/** Two day series added day by day (court bookings plus the shop): the first one's days and labels. */
export function addSeries(a: SparkSeries | null, b: SparkSeries | null): SparkSeries | null {
  if (!a) return b;
  if (!b || b.values.length !== a.values.length) return a;
  return { ...a, values: a.values.map((v, i) => v + (b.values[i] ?? 0)) };
}

/**
 * The café trend's rows, one per calendar day of the period (2026-10-19). The
 * core series holds only the days that have a row, which a column chart hid
 * but a line does not: it drew a straight run across a month with nothing in
 * it. A day without a row is a gap (null) in every series, sales and
 * engagement alike, so the two synced charts keep the same days in the same
 * places. A range that is not two dates, or runs past 400 days, is left as is.
 */
export function fillTrendDays<T extends { date: string }>(range: { from: string; to: string }, rows: readonly T[], empty: (date: string) => T): T[] {
  if (!ISO.test(range.from) || !ISO.test(range.to)) return [...rows];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: T[] = [];
  for (let d = range.from, i = 0; d <= range.to; d = addDays(d, 1), i++) {
    if (i > 400) return [...rows];
    out.push(byDate.get(d) ?? empty(d));
  }
  return out;
}
