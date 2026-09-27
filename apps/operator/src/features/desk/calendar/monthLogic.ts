/**
 * Month-calendar arithmetic shared by the desk calendar and Management's
 * observe boards.
 *
 * The zoomed-out level of both is a month of days, each shaded by how busy it
 * was. Two parts of that go wrong silently and so live here, pure and tested:
 *
 *   * WHICH DAY an instant belongs to. Touch trades 09:00 → 02:00, so a 01:00
 *     booking is the PREVIOUS night's. Bucketing by calendar date would move
 *     every late booking onto the wrong square and make Friday look quiet and
 *     Saturday busy.
 *   * HOW DARK a square is. The shade is relative to the busiest day shown (an
 *     owner call, 2026-09-13), so a quiet month still has contrast — and a day
 *     with one booking must still read as "not empty".
 */
import { tradingSpan, wallTimeToUtc, type DayKey } from '@touch/core';
import type { VenueSettingsRow } from '../../../lib/queries';
import { localDateOf, localMinutesOf, shiftIsoDate, startOfWeek, WEEK_LENGTH } from '../weekLogic';

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'YYYY-MM-01' for the month containing `iso`. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Number of days in the month containing `iso`. */
export function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The same day-of-month `months` away, clamped to the target month's length:
 * 31 Jan + 1 month is 28/29 Feb, not 3 Mar.
 */
export function shiftMonth(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const first = `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-01`;
  const day = Math.min(d, daysInMonth(first));
  return `${first.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/**
 * The month as whole Sunday-first weeks. Leading and trailing days of the
 * neighbouring months are included so the grid is a rectangle; callers mark
 * them with `iso.slice(0, 7) !== month`.
 */
export function monthWeeks(iso: string): string[][] {
  const first = monthStart(iso);
  const last = shiftIsoDate(first, daysInMonth(first) - 1);
  const weeks: string[][] = [];
  let cursor = startOfWeek(first);
  while (cursor <= last) {
    weeks.push(Array.from({ length: WEEK_LENGTH }, (_, i) => shiftIsoDate(cursor, i)));
    cursor = shiftIsoDate(cursor, WEEK_LENGTH);
  }
  return weeks;
}

/** The first and last date the month grid shows (inclusive). */
export function monthGridBounds(iso: string): { first: string; last: string } {
  const weeks = monthWeeks(iso);
  return { first: weeks[0]![0]!, last: weeks[weeks.length - 1]![WEEK_LENGTH - 1]! };
}

export type OpeningHours = VenueSettingsRow['opening_hours'] | null | undefined;

/**
 * Minutes past midnight on `date` that the PREVIOUS trading night still runs
 * into. 120 for a 09:00 → 02:00 venue; 0 when the night before closed by
 * midnight or did not open.
 */
export function inheritedTailMin(date: string, hours: OpeningHours): number {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const prevKey = DAY_KEYS[(dow + 6) % 7]!;
  const key = DAY_KEYS[dow]!;
  const { endMin } = tradingSpan(hours?.[prevKey] ?? [], hours?.[key] ?? []);
  return Math.max(0, endMin - 24 * 60);
}

/** The trading date (the night) an instant belongs to, in the venue's zone. */
export function tradingDateOf(iso: string, timeZone: string, hours: OpeningHours): string {
  const local = localDateOf(iso, timeZone);
  const minutes = localMinutesOf(iso, timeZone);
  return minutes < inheritedTailMin(local, hours) ? shiftIsoDate(local, -1) : local;
}

/**
 * A wall-clock time on a trading NIGHT as an instant. Times inside the
 * night's after-midnight tail (01:00 on a 09:00 → 02:00 night) are on the next
 * calendar date. The booking detail's move form wrote them on the night's own
 * date instead, so moving a 01:00 booking "to 23:00 the same night" landed a
 * full day later, and the past-time check did not catch it.
 */
export function nightTimeToUtc(night: string, minutesOfDay: number, timeZone: string, hours: OpeningHours): Date {
  const tail = inheritedTailMin(shiftIsoDate(night, 1), hours);
  return wallTimeToUtc(night, minutesOfDay < tail ? minutesOfDay + 24 * 60 : minutesOfDay, timeZone);
}

/** How many items fall on each trading date. Dates with none are absent. */
export function countByTradingDate(
  items: readonly { at: string }[],
  timeZone: string,
  hours: OpeningHours,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = tradingDateOf(item.at, timeZone, hours);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The floor a non-empty day is shaded at, so one booking never reads as none. */
export const HEAT_FLOOR = 0.12;

/**
 * 0 for an empty day, otherwise HEAT_FLOOR..1 in proportion to the busiest day
 * shown. `max` is that busiest count; a max of 0 means nothing is shaded.
 */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return HEAT_FLOOR + (1 - HEAT_FLOOR) * Math.min(1, count / max);
}

/** The busiest count among `dates` (only the dates actually shown). */
export function busiestCount(counts: ReadonlyMap<string, number>, dates: readonly string[]): number {
  let max = 0;
  for (const d of dates) max = Math.max(max, counts.get(d) ?? 0);
  return max;
}
