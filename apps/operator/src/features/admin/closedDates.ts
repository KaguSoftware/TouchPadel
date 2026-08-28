/**
 * Closed dates — the days the venue does not trade at all (SOW L319,
 * "Opening hours and closed days").
 *
 * `venue_settings.closed_dates` has existed since 0006, `assert_bookable`
 * refuses bookings on those days, and `DeskCalendar` greys them out — but
 * nothing in any of the three apps could WRITE the list, so the only way to
 * close the venue for Eid was a SQL statement. `app.set_opening_hours` already
 * takes `p_closed_dates date[]`; the gap was purely the screen.
 *
 * Pure helpers so the ordering, de-duplication and past-date rules are testable
 * without a database.
 */

/** `YYYY-MM-DD`, the shape Postgres `date[]` round-trips through PostgREST. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // Rejects 2026-02-31: Date normalises it, so compare the round trip.
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Sorted, de-duplicated, invalid entries dropped. */
export function normalizeClosedDates(dates: readonly string[]): string[] {
  return [...new Set(dates.filter(isIsoDate))].sort();
}

export function addClosedDate(dates: readonly string[], date: string): string[] {
  if (!isIsoDate(date)) return normalizeClosedDates(dates);
  return normalizeClosedDates([...dates, date]);
}

export function removeClosedDate(dates: readonly string[], date: string): string[] {
  return normalizeClosedDates(dates.filter((d) => d !== date));
}

/**
 * Split into what is still ahead and what has already passed, relative to the
 * venue's own today.
 *
 * Past closures are kept rather than pruned: `closed_dates` is also the record
 * of why a day has no takings, and silently dropping last Eid would make the
 * day-close history unexplainable. They are just shown separately, because the
 * list a manager is editing is the one that has not happened yet.
 */
export function splitClosedDates(
  dates: readonly string[],
  todayIso: string,
): { upcoming: string[]; past: string[] } {
  const sorted = normalizeClosedDates(dates);
  return {
    upcoming: sorted.filter((d) => d >= todayIso),
    past: sorted.filter((d) => d < todayIso),
  };
}

/** Two lists hold the same closures, whatever order they arrived in. */
export function sameClosedDates(a: readonly string[], b: readonly string[]): boolean {
  const na = normalizeClosedDates(a);
  const nb = normalizeClosedDates(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}
