/**
 * "When does a business day start?" — the setting that re-slices every daily and
 * day-of-week figure on the analytics page.
 *
 * A cafe serving past midnight books a 01:30 order on the calendar day it happened while the
 * shift and the cash-up call it the previous night. Every daily bucket changes with the
 * convention, so it is explicit: `analytics_business_day_start_hour` in `cafe_settings`.
 * 0 (the default) means plain venue-local calendar days.
 *
 * The SQL twin is `app.business_date(timestamptz)` = (instant at venue tz − start hours)::date;
 * `businessDayOf` computes the same date for the same instant.
 */
import { localParts } from '../time/tz';

/** Offered in the UI. 0 = calendar day (midnight). */
export const BUSINESS_DAY_START_OPTIONS = [0, 4, 5, 6, 7, 8] as const;

export const BUSINESS_DAY_START_DEFAULT = 0;

/** Past this the "day" would swallow the next lunch service — anything larger is garbage. */
export const MAX_BUSINESS_DAY_START_HOUR = 12;

/** Clamp any stored/submitted value to a usable whole hour (0..12); anything odd → default. */
export function normalizeBusinessDayStart(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= MAX_BUSINESS_DAY_START_HOUR
    ? n
    : BUSINESS_DAY_START_DEFAULT;
}

/**
 * The business date ('YYYY-MM-DD') an instant belongs to: shift back by the start hour, then
 * take the venue-local calendar date. `startHour` is normalised first, so a bad setting can
 * never throw here.
 */
export function businessDayOf(instant: Date, startHour: number, tz: string): string {
  const hours = normalizeBusinessDayStart(startHour);
  const shifted = new Date(instant.getTime() - hours * 3_600_000);
  return localParts(shifted, tz).date;
}
