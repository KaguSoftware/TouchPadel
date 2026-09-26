/**
 * The venue's calendar day and wall clock, for the three wave-5 people-record
 * screens (deductions, incidents, content; wave5-addendum-2026-09-25 §2.5-§2.7).
 *
 * The servers check every date against the venue's business date and every
 * time against now; these only set a form's bounds and defaults, so a station
 * whose clock or zone is off gets the server's refusal rather than a silent
 * wrong row. The venue zone is fixed (VENUE_TZ), never the browser's.
 */
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ, formatDate, formatMonthYear } from '@touch/i18n';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' of `now` on the venue's calendar. en-CA is the one common locale whose short date is that shape. */
export function venueToday(now: Date = new Date(), tz: string = VENUE_TZ): string {
  return now.toLocaleDateString('en-CA', { timeZone: tz });
}

/** A calendar day moved by whole days, with no timezone involved. */
export function addDays(day: string, days: number): string {
  const m = DAY_RE.exec(day);
  if (!m) return day;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** The first of the month a day falls in: '2026-09-17' → '2026-09-01'. */
export function monthOf(day: string): string {
  return DAY_RE.test(day) ? `${day.slice(0, 7)}-01` : day;
}

/** A month ('YYYY-MM-01') moved by whole months. */
export function shiftMonth(month: string, by: number): string {
  const m = DAY_RE.exec(month);
  if (!m) return month;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + by, 1));
  return d.toISOString().slice(0, 10);
}

/** A 'YYYY-MM-DD' printed as a date, at noon UTC so no zone can shift it a day. */
export function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return DAY_RE.test(day) ? formatDate(new Date(`${day}T12:00:00Z`), locale, 'UTC') : day;
}

/** A month ('YYYY-MM-01') as "September 2026". */
export function monthLabel(month: string, locale: 'en' | 'ar'): string {
  return DAY_RE.test(month) ? formatMonthYear(new Date(`${month}T12:00:00Z`), locale, 'UTC') : month;
}

/** `now` as the value of an <input type="datetime-local"> on the venue's wall clock: 'YYYY-MM-DDTHH:mm'. */
export function venueWallValue(now: Date = new Date(), tz: string = VENUE_TZ): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const WALL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** A datetime-local value read on the venue's wall clock, as a Date; null when it is not one. */
export function wallValueToDate(value: string, tz: string = VENUE_TZ): Date | null {
  const m = WALL_RE.exec(value);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return null;
  try {
    return wallTimeToUtc(m[1]!, hours * 60 + minutes, tz);
  } catch {
    return null;
  }
}
