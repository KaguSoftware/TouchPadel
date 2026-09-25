// Subpath import: the '@touch/i18n' index carries both message catalogs, and the café
// footer (a client component) formats its hours through this module too.
import { isolateLtr } from '@touch/i18n/bidi';
import type { Locale } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { weekHours } from '@/lib/cafe/hours';

/**
 * Hours as every public page prints them: the landing, the site footer, the legal pages
 * and the café menu's footer (server and client; the live "open now" state is computed
 * in the browser, see openNow.ts).
 *
 * ONE CONVENTION FOR THE ORDER OF A WINDOW (fix pass 2026-09-24). Each time is its own
 * left-to-right isolate and the en dash between them is not isolated, so the dash takes
 * the direction of the sentence around it: in English the window reads 09:00–02:00, and
 * in Arabic, read from the right, 09:00 comes first too (it sits on the right, 02:00 on
 * the left). Wrapping the whole window in one LTR isolate, as the site did, put 09:00 on
 * the LEFT of an Arabic line, so an Arabic reader met 02:00 first, while the café menu
 * showed the same hours the other way round: one of the two read as 2am to 9am.
 *
 * The site's copy promises "open every day {hours}", so it may only print one window
 * when the venue really keeps one window every day. Touch does (09:00-02:00, both
 * client packs), but the value is operator-editable: the day it stops being true the
 * site falls back to the `*NoHours` copy, which claims nothing about days or hours.
 */

export type HoursWindow = readonly [from: string, to: string];

/** One window for display: `⁦09:00⁩–⁦02:00⁩`, each time LTR-isolated, en dash between. */
export function formatWindow([from, to]: HoursWindow): string {
  return `${isolateLtr(from)}–${isolateLtr(to)}`;
}

/** A day's windows for display, joined the page's way ("، " in Arabic). */
export function formatWindows(windows: readonly HoursWindow[], locale: Locale): string {
  return windows.map(formatWindow).join(locale === 'ar' ? '، ' : ', ');
}

/**
 * The one window the venue keeps every day, e.g. `['09:00', '02:00']`, or null when the
 * venue read failed, a day is closed, a day is split, or the days differ.
 */
export function everyDayWindow(venue: VenueOpeningHours | null | undefined): HoursWindow | null {
  if (!venue) return null;
  const week = weekHours(venue);
  const first = week[0]?.windows[0];
  if (!first) return null;
  const same = week.every(
    ({ windows }) =>
      windows.length === 1 && windows[0]![0] === first[0] && windows[0]![1] === first[1],
  );
  return same ? [first[0], first[1]] : null;
}

/** `everyDayWindow`, formatted for display (already isolated: do not isolate it again). */
export function everyDayHours(venue: VenueOpeningHours | null | undefined): string | null {
  const every = everyDayWindow(venue);
  return every ? formatWindow(every) : null;
}

/** True when the window closes after midnight (09:00–02:00), never for 09:00–24:00. */
export function crossesMidnight([from, to]: HoursWindow): boolean {
  return to !== '24:00' && to < from;
}
