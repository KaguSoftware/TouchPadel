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

/** The first day of the month after `iso`'s. */
function nextMonth(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * The same line by calendar month, for a range that holds a pre-system
 * monthly report (0349, 0355): a report has no days, so a day line leaves its
 * month empty while the tile's figure counts it. Each point is a month's
 * days plus `extra` for that month (keyed 'YYYY-MM', the report's figure);
 * nothing is split into days. A month the range cuts is labelled with the
 * days it covers, so a short edge month never reads as a whole quiet one.
 */
export function monthSeries<T extends { date: string }>(
  range: { from: string; to: string },
  rows: readonly T[] | null | undefined,
  pick: (row: T) => number,
  extra: ReadonlyMap<string, number>,
  label: { month: (iso: string) => string; days: (from: string, to: string) => string },
  format: (n: number) => string,
): SparkSeries | null {
  if (!rows || !ISO.test(range.from) || !ISO.test(range.to) || range.from > range.to) return null;
  const values: number[] = [];
  const labels: string[] = [];
  // analytics_bounds caps a range at 400 days, fourteen months at most; the guard keeps a bad range finite.
  for (let start = `${range.from.slice(0, 7)}-01`, i = 0; start <= range.to && i < 15; start = nextMonth(start), i++) {
    const key = start.slice(0, 7);
    const lo = start < range.from ? range.from : start;
    const end = addDays(nextMonth(start), -1);
    const hi = end > range.to ? range.to : end;
    let sum = extra.get(key) ?? 0;
    for (const r of rows) if (r.date >= lo && r.date <= hi) sum += pick(r);
    values.push(sum);
    labels.push(lo === start && hi === end ? label.month(start) : label.days(lo, hi));
  }
  return values.length < 2 ? null : { values, labels, format, byMonth: true };
}

/**
 * A day's label on a chart of the period: the year joins it once the period
 * crosses into another year, so two days a year apart never share a label
 * (a chart's axis keys on it).
 */
export function dayLabeler(range: { from: string; to: string }, date: (iso: string, withYear?: boolean) => string): (iso: string) => string {
  const withYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
  return (iso) => date(iso, withYear);
}

/** Two series of the same points added point by point (court bookings plus the shop): the first one's points and labels. */
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
