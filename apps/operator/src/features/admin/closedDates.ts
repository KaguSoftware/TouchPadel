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

/**
 * 0390 (F-51): the dates the draft closes that the saved list does not. Only
 * these are checked for bookings: a date already closed, or one taken off the
 * list, never blocks the save (app.set_opening_hours applies the same rule).
 */
export function addedClosedDates(draft: readonly string[], saved: readonly string[]): string[] {
  const before = new Set(normalizeClosedDates(saved));
  return normalizeClosedDates(draft).filter((d) => !before.has(d));
}

/** One booking on a newly closed date, as app.closed_day_bookings answers it. */
export interface ClosedDayBooking {
  id: string;
  day: string;
  courtNameEn: string | null;
  courtNameAr: string | null;
  startAt: string;
  endAt: string;
  status: string;
  guestName: string | null;
  remainingIqd: number | null;
  started: boolean;
}

/** app.closed_day_bookings → rows; anything malformed is skipped, never invented. */
export function readClosedDayBookings(raw: unknown): ClosedDayBooking[] {
  const list = raw && typeof raw === 'object' ? (raw as { bookings?: unknown }).bookings : null;
  if (!Array.isArray(list)) return [];
  const out: ClosedDayBooking[] = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.start_at !== 'string' || typeof r.end_at !== 'string') continue;
    out.push({
      id: r.id,
      day: typeof r.day === 'string' ? r.day : '',
      courtNameEn: typeof r.court_name_en === 'string' ? r.court_name_en : null,
      courtNameAr: typeof r.court_name_ar === 'string' ? r.court_name_ar : null,
      startAt: r.start_at,
      endAt: r.end_at,
      status: typeof r.status === 'string' ? r.status : '',
      guestName: typeof r.guest_name === 'string' && r.guest_name.trim() !== '' ? r.guest_name : null,
      remainingIqd: typeof r.remaining_iqd === 'number' ? r.remaining_iqd : null,
      started: r.started === true,
    });
  }
  return out;
}

/**
 * Why Save cannot run yet because of the closed days: 'checking' while the
 * list for the new dates is loading, 'error' when it failed, 'bookings' while
 * any is left, else null. No new date: never blocked.
 */
export type ClosedDayBlock = 'checking' | 'error' | 'bookings' | null;
export function closedDayBlock(added: readonly string[], q: { loading: boolean; error: boolean; count: number }): ClosedDayBlock {
  if (added.length === 0) return null;
  if (q.loading) return 'checking';
  if (q.error) return 'error';
  return q.count > 0 ? 'bookings' : null;
}

/** No-show needs the booking to have started (the server refuses RESERVATION_NOT_STARTED); pending cannot be paid. */
export function closedDayActions(b: Pick<ClosedDayBooking, 'status' | 'started' | 'remainingIqd'>): {
  cancel: boolean;
  noShow: boolean;
  pay: boolean;
} {
  return {
    cancel: true,
    noShow: b.started && b.status !== 'pending',
    pay: b.status !== 'pending' && (b.remainingIqd ?? 0) > 0,
  };
}
