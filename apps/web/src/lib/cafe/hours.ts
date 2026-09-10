import { VENUE_TZ } from '@touch/i18n';
import { displayWindows } from '@touch/core';
import type { VenueOpeningHours } from '../menu';

/**
 * Opening-hours helpers shared by the hero strapline and the footer table.
 * `venue_settings.opening_hours` is a config blob keyed by short day name:
 * `{"mon":[["09:00","23:00"]], …}` (0006). Days may have several windows, or
 * none at all (closed).
 *
 * "Today" is the VENUE's day (Asia/Baghdad), never the phone's timezone — a
 * guest whose device clock is on another continent must still see the cafe's
 * own schedule.
 *
 * OVERNIGHT. Touch trades 09:00 → 02:00, which is stored as two windows on
 * adjacent days: `[["00:00","02:00"],["09:00","24:00"]]`. Printed literally that
 * is two baffling rows, one of which belongs to the night before. Everything
 * below therefore returns DISPLAY windows — `@touch/core displayWindows` drops
 * the inherited tail and folds the next day's tail back into the evening, so a
 * guest reads a single `09:00 – 02:00`.
 */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** en-CA is the ISO-ish `YYYY-MM-DD` locale — used to read the venue's date. */
function venueParts(now: Date): { isoDate: string; dayKey: DayKey } {
  let isoDate: string;
  let weekday: string;
  try {
    isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TZ }).format(now);
    weekday = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TZ, weekday: 'short' }).format(now);
  } catch {
    isoDate = now.toISOString().slice(0, 10);
    weekday = now.toUTCString().slice(0, 3);
  }
  const key = weekday.slice(0, 3).toLowerCase() as DayKey;
  return { isoDate, dayKey: DAY_KEYS.includes(key) ? key : 'mon' };
}

export interface TodayHours {
  dayKey: DayKey;
  /** [] = closed today (no window, or an explicit closed date) */
  windows: [string, string][];
  closed: boolean;
}

/** The day after `dayKey`, whose leading window carries tonight's closing time. */
function nextKey(dayKey: DayKey): DayKey {
  return DAY_KEYS[(DAY_KEYS.indexOf(dayKey) + 1) % DAY_KEYS.length] as DayKey;
}

export function todayHours(
  venue: VenueOpeningHours | null | undefined,
  now: Date = new Date(),
): TodayHours {
  const { isoDate, dayKey } = venueParts(now);
  if (!venue) return { dayKey, windows: [], closed: true };
  if (venue.closed_dates?.includes(isoDate)) return { dayKey, windows: [], closed: true };
  const windows = displayWindows(
    normaliseWindows(venue.opening_hours?.[dayKey]),
    normaliseWindows(venue.opening_hours?.[nextKey(dayKey)]),
  ) as [string, string][];
  return { dayKey, windows, closed: windows.length === 0 };
}

/** Defensive parse: the blob is operator-editable JSON, not a typed column. */
export function normaliseWindows(raw: unknown): [string, string][] {
  if (!Array.isArray(raw)) return [];
  const out: [string, string][] = [];
  for (const w of raw) {
    if (Array.isArray(w) && typeof w[0] === 'string' && typeof w[1] === 'string') {
      out.push([w[0], w[1]]);
    }
  }
  return out;
}

/** Every day in week order with its display windows — the footer's table. */
export function weekHours(
  venue: VenueOpeningHours | null | undefined,
): { dayKey: DayKey; windows: [string, string][] }[] {
  return DAY_KEYS.map((dayKey) => ({
    dayKey,
    windows: displayWindows(
      normaliseWindows(venue?.opening_hours?.[dayKey]),
      normaliseWindows(venue?.opening_hours?.[nextKey(dayKey)]),
    ) as [string, string][],
  }));
}
