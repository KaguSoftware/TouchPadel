/**
 * The dates the usage meter and the usage page ask for, in VENUE time.
 *
 * The server buckets usage and the monthly cap by `(now() at time zone
 * venue_settings.timezone)::date` (0079, 0111). Reading the month in UTC put
 * Baghdad's 00:00–03:00 on yesterday, and the 1st of the month on last month,
 * so the meter disagreed with the cap the server enforces.
 */

/** The venue's calendar date, YYYY-MM-DD. */
export function venueDate(tz: string, now = new Date()): string {
  // en-CA is the one common locale whose short date IS YYYY-MM-DD.
  return now.toLocaleDateString('en-CA', { timeZone: tz });
}

/** The venue's current month: year and 0-based month index. */
export function currentYm(tz: string, now = new Date()): { y: number; m: number } {
  const [y, m] = venueDate(tz, now).split('-');
  return { y: Number(y), m: Number(m) - 1 };
}

/** The month so far — the meter's Today and This month slots read from it. */
export function monthSoFar(tz: string, now = new Date()): { from: string; to: string } {
  const to = venueDate(tz, now);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** First and last date of a calendar month; no timezone involved. */
export function monthBounds(year: number, month0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month0, 1));
  const to = new Date(Date.UTC(year, month0 + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
