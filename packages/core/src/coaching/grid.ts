import { addDays } from '../analytics/range';
import { localParts, parseHHMM, wallTimeToUtc } from '../time/tz';

/**
 * The lesson start grid (C-20, R9; docs/design/coaching/db.md §4.6.2).
 *
 * Every lesson start (private, group and every course session, on booking, creation and
 * reschedule) falls on `:00` or `:30` of the branch's local time, to the second. The server's twin
 * is `app.lesson_on_grid(p_start_at, p_venue)`:
 *
 *   l := p_start_at at time zone <branch tz>;
 *   date_trunc('minute', l) = l and extract(minute from l)::int in (0, 30)
 *
 * The server refuses an off-grid start with `SLOT_NOT_ON_GRID`; these helpers let a form check
 * first and build starts the server will accept. Coach hours windows sit on the same grid
 * (db.md §4.3.4, §4.6.5: `HOURS_INVALID` for a time off :00/:30), so every grid start fits a window
 * exactly.
 *
 * Everything is computed from the instant and the IANA zone only (`../time/tz.ts` reads Intl with a
 * fixed 'en-US', h23 formatter): the caller's locale, digits and text direction never change an
 * answer.
 */

/** Minutes between two lesson grid starts (C-20). */
export const LESSON_GRID_MINUTES = 30;

function msOfSecond(instant: Date): number {
  const t = instant.getTime();
  return ((t % 1000) + 1000) % 1000;
}

/**
 * True when `startAt` is on the lesson grid of `timeZone`: local minute 0 or 30, second 0,
 * millisecond 0. An invalid Date is not on the grid.
 */
export function isOnLessonGrid(startAt: Date, timeZone: string): boolean {
  if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) return false;
  const p = localParts(startAt, timeZone);
  return p.seconds === 0 && msOfSecond(startAt) === 0 && p.minutesOfDay % LESSON_GRID_MINUTES === 0;
}

/**
 * True when a wall-clock 'HH:MM' (as coach hours store it; `24:00` is the end of the day,
 * CD-10) sits on the grid. Malformed text is false, never a throw.
 */
export function isLessonGridTime(hhmm: string): boolean {
  let minutes: number;
  try {
    minutes = parseHHMM(hhmm);
  } catch {
    return false;
  }
  return minutes % LESSON_GRID_MINUTES === 0;
}

/**
 * The first grid start at or after `instant` in `timeZone` (an instant already on the grid is
 * returned as it is). 23:40 local becomes 00:00 of the next local day.
 *
 * For zones with daylight saving (not Asia/Baghdad), a grid time that the clock skips lands where
 * `wallTimeToUtc` puts it, deterministically.
 */
export function ceilToLessonGrid(instant: Date, timeZone: string): Date {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new RangeError('ceilToLessonGrid needs a valid Date');
  }
  if (isOnLessonGrid(instant, timeZone)) return new Date(instant.getTime());
  const p = localParts(instant, timeZone);
  const next = (Math.floor(p.minutesOfDay / LESSON_GRID_MINUTES) + 1) * LESSON_GRID_MINUTES;
  return wallTimeToUtc(p.date, next, timeZone);
}

/**
 * GL-6 (guest.md §4.13, operator.md §5.9): a course's session starts, one a week at the same
 * local wall-clock time as `firstStart` (minute precision), `count` of them, `firstStart`'s own
 * start first. The local time is kept across a daylight-saving change (the UTC instants move); in
 * Asia/Baghdad every gap is exactly seven days.
 *
 * The clients show these as editable rows; the server checks each one (grid, hours, the coach, a
 * court; `COURSE_STARTS_INVALID`, per-start `SLOT_NOT_ON_GRID`).
 */
export function weeklyLessonStarts(firstStart: Date, count: number, timeZone: string): Date[] {
  if (!(firstStart instanceof Date) || !Number.isFinite(firstStart.getTime())) {
    throw new RangeError('weeklyLessonStarts needs a valid Date');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${String(count)}`);
  }
  const p = localParts(firstStart, timeZone);
  const starts: Date[] = [];
  for (let k = 0; k < count; k++) {
    starts.push(wallTimeToUtc(addDays(p.date, 7 * k), p.minutesOfDay, timeZone));
  }
  return starts;
}
