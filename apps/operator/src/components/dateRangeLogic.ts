/**
 * The date arithmetic behind DateRangePicker, kept free of React and the DOM
 * so it runs under node.
 *
 * Every date is a 'YYYY-MM-DD' string: a business date, never a moment. The
 * arithmetic goes through UTC so a date can never slip across midnight on a
 * station whose clock is in another zone. Months are 0-based (0 = January),
 * as in `Date`.
 */

export interface Period {
  from: string;
  to: string;
}

export interface YearMonth {
  year: number;
  month: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Year, 0-based month and day of an ISO date; throws on anything else. */
export function isoParts(iso: string): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`expected 'YYYY-MM-DD', got '${iso}'`);
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/** The ISO date for a year, 0-based month and day. Out-of-range parts roll over, as `Date.UTC` does. */
export function isoOf(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const { year, month, day } = isoParts(iso);
  return isoOf(year, month, day + days);
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const d = new Date(Date.UTC(ym.year, ym.month + n, 1, 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

export function yearMonthOf(iso: string): YearMonth {
  const { year, month } = isoParts(iso);
  return { year, month };
}

/** -1, 0 or 1, comparing months only. */
export function compareMonths(a: YearMonth, b: YearMonth): number {
  return Math.sign(a.year * 12 + a.month - (b.year * 12 + b.month));
}

/** A UTC-noon Date for formatting an ISO date with `timeZone: 'UTC'`. */
export function isoToDate(iso: string): Date {
  const { year, month, day } = isoParts(iso);
  return new Date(Date.UTC(year, month, day, 12));
}

/** 0 = Sunday. */
export function weekdayOf(iso: string): number {
  return isoToDate(iso).getUTCDay();
}

/**
 * One month as calendar cells: `null` for the blanks before the first day so
 * the 1st lands under its weekday, then every date of the month. `weekStart`
 * is the weekday of the first column (0 = Sunday, the week the presets use).
 */
export function monthCells(ym: YearMonth, weekStart = 0): (string | null)[] {
  const first = isoOf(ym.year, ym.month, 1);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const length = new Date(Date.UTC(ym.year, ym.month + 1, 0, 12)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= length; d += 1) cells.push(isoOf(ym.year, ym.month, d));
  return cells;
}

/** The two ends in order, whichever was picked first. */
export function orderedRange(a: string, b: string): Period {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function inRange(iso: string, range: Period | null): boolean {
  return range !== null && iso >= range.from && iso <= range.to;
}

export function samePeriod(a: Period | null, b: Period | null): boolean {
  return a !== null && b !== null && a.from === b.from && a.to === b.to;
}

/** True when any day of the month falls inside the range. */
export function monthTouches(ym: YearMonth, range: Period | null): boolean {
  if (!range) return false;
  const first = isoOf(ym.year, ym.month, 1);
  const last = isoOf(ym.year, ym.month + 1, 0);
  return last >= range.from && first <= range.to;
}

export function yearTouches(year: number, range: Period | null): boolean {
  if (!range) return false;
  return year >= isoParts(range.from).year && year <= isoParts(range.to).year;
}

/**
 * The twelve years the year grid shows around `year`: up to five after it,
 * never past `maxYear` when there is one.
 */
export function yearPage(year: number, maxYear?: number): number[] {
  const top = maxYear === undefined ? year + 5 : Math.min(maxYear, year + 5);
  return Array.from({ length: 12 }, (_, i) => top - 11 + i);
}

/**
 * The field's words for a range, e.g. "20 Sep – 19 Oct".
 *
 * The year is left off while it is the current one. A range that crosses into
 * another year names BOTH years ("20 Dec 2025 – 19 Jan 2026"), because naming
 * only one reads as if the other end were this year. `monthName` gives the
 * short month name in the screen's language.
 */
export function rangeText(range: Period, currentYear: number, monthName: (month: number) => string): string {
  const a = isoParts(range.from);
  const b = isoParts(range.to);
  const day = (p: { year: number; month: number; day: number }, withYear: boolean) =>
    `${p.day} ${monthName(p.month).replace(/ /g, ' ')}${withYear ? ` ${p.year}` : ''}`;
  if (range.from === range.to) return day(a, a.year !== currentYear);
  if (a.year !== b.year) return `${day(a, true)} – ${day(b, true)}`;
  const withYear = a.year !== currentYear;
  return `${day(a, withYear)} – ${day(b, withYear)}`;
}

/** The field's words while only the first end is picked: "20 Sep – …". */
export function openRangeText(from: string, currentYear: number, monthName: (month: number) => string): string {
  const a = isoParts(from);
  return `${a.day} ${monthName(a.month).replace(/ /g, ' ')}${a.year !== currentYear ? ` ${a.year}` : ''} – …`;
}

/**
 * The day a keyboard arrow moves to: a day either way, or a week up or down.
 * In a right-to-left layout the left arrow moves forward in time.
 */
export function stepDay(iso: string, key: string, rtl: boolean): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDaysIso(iso, rtl ? 1 : -1);
    case 'ArrowRight':
      return addDaysIso(iso, rtl ? -1 : 1);
    case 'ArrowUp':
      return addDaysIso(iso, -7);
    case 'ArrowDown':
      return addDaysIso(iso, 7);
    default:
      return null;
  }
}
