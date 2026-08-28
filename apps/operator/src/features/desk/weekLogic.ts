/**
 * Week-view arithmetic for the desk calendar.
 *
 * SOW L307 asks for a "Day and week calendar across all courts"; the desk has
 * been day-only since day 1, so a court-desk clerk answering "are we free
 * Saturday afternoon?" had to step through seven days one arrow at a time.
 *
 * Pure, so the parts that decide which day a booking lands in — the part that
 * goes wrong across a timezone boundary — are testable without a database.
 */

/** Sunday-first, matching `DAY_KEYS` and Postgres `dow` (0 = Sunday). */
export const WEEK_LENGTH = 7;

/** The date `days` after `iso`, in plain calendar days (no timezone maths). */
export function shiftIsoDate(iso: string, days: number): string {
  // Noon UTC: far enough from either midnight that adding whole days can never
  // land on the wrong date through a DST shift.
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Sunday on or before `iso`. */
export function startOfWeek(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return shiftIsoDate(iso, -dow);
}

/** The seven ISO dates of the week containing `iso`, Sunday first. */
export function weekDates(iso: string): string[] {
  const start = startOfWeek(iso);
  return Array.from({ length: WEEK_LENGTH }, (_, i) => shiftIsoDate(start, i));
}

/**
 * The venue-local calendar date an instant falls on.
 *
 * `en-CA` because it is the one common locale whose short date format IS
 * `YYYY-MM-DD`; `toISOString()` would give the UTC date, which is a different
 * day for any evening booking in Baghdad.
 */
export function localDateOf(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone });
}

/** Minutes past venue-local midnight for an instant. */
export function localMinutesOf(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Intl renders midnight as 24 in some ICU versions of en-GB h23/h24 handling.
  return (hour % 24) * 60 + minute;
}

export interface WeekBucketable {
  start_at: string;
}

/**
 * Group items by venue-local date, keyed by every date in the week so a day
 * with nothing booked still renders as an empty column rather than vanishing.
 */
export function bucketByLocalDate<T extends WeekBucketable>(
  items: readonly T[],
  dates: readonly string[],
  timeZone: string,
): Map<string, T[]> {
  const byDate = new Map<string, T[]>(dates.map((d) => [d, []]));
  for (const item of items) {
    const key = localDateOf(item.start_at, timeZone);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(item);
  }
  for (const bucket of byDate.values()) {
    bucket.sort((a, b) => a.start_at.localeCompare(b.start_at));
  }
  return byDate;
}

/**
 * The row band an instant belongs to, or -1 when it falls outside the grid.
 * Bookings that start before opening are clamped into the first row rather than
 * dropped — a booking the desk cannot see is worse than one drawn slightly early.
 */
export function rowIndexFor(
  minutesFromMidnight: number,
  openMin: number,
  slotMin: number,
  rowCount: number,
): number {
  if (rowCount <= 0) return -1;
  const idx = Math.floor((minutesFromMidnight - openMin) / slotMin);
  if (idx < 0) return 0;
  if (idx >= rowCount) return -1;
  return idx;
}
