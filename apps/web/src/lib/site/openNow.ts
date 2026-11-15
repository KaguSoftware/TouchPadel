// Subpath import, not '@touch/i18n': the package index re-exports both full message
// catalogs, and this module ships to the browser inside the open-now pill.
import { VENUE_TZ } from '@touch/i18n/formatting';
import { localParts } from '@touch/core/time/tz';

/**
 * "Open now", computed in the browser on the venue's own clock (Asia/Baghdad), so a
 * cached or slow page never shows yesterday's answer and a visitor abroad still sees
 * the venue's state, not their phone's.
 *
 * CLIENT-SAFE: imports nothing that carries the catalogs (see the note on the import).
 */
export type OpeningHoursBlob = Record<string, unknown> | null | undefined;

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type DayKey = (typeof DAY_KEYS)[number];
/** localParts' dayOfWeek (0 = Sunday) to the blob's day key. */
const BY_DAY_OF_WEEK: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The stored windows of one day, defensively parsed (the blob is operator-edited JSON). */
function rawWindows(raw: unknown): [string, string][] {
  if (!Array.isArray(raw)) return [];
  const out: [string, string][] = [];
  for (const w of raw) {
    if (Array.isArray(w) && typeof w[0] === 'string' && typeof w[1] === 'string') {
      out.push([w[0], w[1]]);
    }
  }
  return out;
}

/** The venue's wall clock: its ISO date, day key and `HH:MM`, all in Asia/Baghdad. */
export function venueClock(now: Date): { isoDate: string; dayKey: DayKey; hhmm: string } {
  const p = localParts(now, VENUE_TZ); // @touch/core: the same clock the app and the till read
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    isoDate: p.date,
    dayKey: BY_DAY_OF_WEEK[p.dayOfWeek] ?? 'mon',
    hhmm: `${pad(Math.floor(p.minutesOfDay / 60))}:${pad(p.minutesOfDay % 60)}`,
  };
}

export interface OpenState {
  open: boolean;
  /** When closed: the next opening time (`HH:MM`), or null when none is known. */
  opensAt: string | null;
}

function nextDay(key: DayKey): DayKey {
  return DAY_KEYS[(DAY_KEYS.indexOf(key) + 1) % DAY_KEYS.length] as DayKey;
}

/**
 * Open right now? Answered from the STORED windows, not the display ones: the
 * overnight format stores 09:00-02:00 as `[["00:00","02:00"],["09:00","24:00"]]` on each
 * day, so the raw windows of the venue's calendar day are exactly the intervals it is
 * open on that day, the small hours included. `HH:MM` strings compare in time order,
 * and "24:00" sorts after every real minute.
 */
export function openState(
  openingHours: OpeningHoursBlob,
  closedDates: readonly string[] | null | undefined,
  now: Date,
): OpenState {
  const { isoDate, dayKey, hhmm } = venueClock(now);
  const closedToday = closedDates?.includes(isoDate) ?? false;
  const today = closedToday ? [] : rawWindows(openingHours?.[dayKey]);
  if (today.some(([from, to]) => from <= hhmm && hhmm < to)) return { open: true, opensAt: null };
  const later = today.find(([from]) => from > hhmm);
  if (later) return { open: false, opensAt: later[0] };
  // Tomorrow's first real opening: skip its leading "00:00" tail, which is tonight's
  // late session carried over, not an opening.
  const tomorrow = rawWindows(openingHours?.[nextDay(dayKey)]).find(([from]) => from !== '00:00');
  return { open: false, opensAt: tomorrow?.[0] ?? null };
}
