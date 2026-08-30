import { parseHHMM } from './tz';
import type { DayKey, OpeningHours } from '../availability/slotGrid';

/**
 * The overnight-hours representation, in one place.
 *
 * `venue_settings.opening_hours` is a per-day list of windows measured from that day's local
 * midnight: `{"mon":[["09:00","23:00"]], …}` (0006). Nothing in that shape can express a window
 * that runs past midnight — `app.assert_bookable` splits a booking into per-calendar-day segments
 * and fits each one inside a single window OF THAT DAY, and `buildSlotGrid` throws on
 * `close <= open`.
 *
 * Touch trades 09:00 → 02:00, seven days a week. That night is therefore stored as TWO windows on
 * ADJACENT calendar days:
 *
 *     { "sat": [["00:00","02:00"], ["09:00","24:00"]], … }
 *               └ tail of Friday night ┘  └ Saturday evening ┘
 *
 * Both halves are already understood by every layer (`'24:00'::interval` in SQL, `parseHHMM`
 * returning 1440 in TS, and `buildSlotGrid`'s existing split-window support). What was missing was
 * one implementation of the CONVERSION, so the operator hours editor, the desk grid and the public
 * footer could not each invent their own and drift apart.
 *
 * Pure and dependency-free, so the day-boundary arithmetic — the part that goes wrong — is
 * testable without a database or a browser.
 */

/** A window as stored: `[open, close]`, both 'HH:MM', close exclusive. */
export type Window = readonly [string, string];

/** Minutes from local midnight to the end of the calendar day. */
export const DAY_MINUTES = 1440;

const MIDNIGHT = '00:00';
const END_OF_DAY = '24:00';

/** Minutes-from-midnight to 'HH:MM', wrapping past a day boundary (1560 → '02:00'). */
export function gridLabel(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** True when this window is the post-midnight tail of the PREVIOUS day's trading night. */
export function isOvernightTail(win: Window): boolean {
  return parseHHMM(win[0]) === 0 && parseHHMM(win[1]) < DAY_MINUTES;
}

/** True when this window runs to midnight, i.e. it continues into the next calendar day. */
export function runsToMidnight(win: Window): boolean {
  return parseHHMM(win[1]) === DAY_MINUTES;
}

/**
 * Split one human open/close pair into the windows each calendar day carries.
 *
 * A same-day pair yields one window on the day itself and nothing on the next. An overnight pair
 * (`close <= open`) yields the evening window on the day and the post-midnight tail on the NEXT
 * day — hence both halves are returned separately: the tail does not belong to the day the manager
 * typed it against.
 *
 * A close of '00:00' means midnight, not a zero-length day, so it is normalised to '24:00'.
 */
export function splitOvernight(
  open: string,
  close: string,
): { sameDay: Window[]; nextDay: Window[] } {
  const normalisedClose = close === MIDNIGHT ? END_OF_DAY : close;
  const openMin = parseHHMM(open);
  const closeMin = parseHHMM(normalisedClose);

  if (closeMin > openMin) return { sameDay: [[open, normalisedClose]], nextDay: [] };
  if (closeMin === openMin) {
    throw new RangeError(
      `opening and closing time are identical ('${open}'); use 00:00-24:00 for a full day`,
    );
  }
  return { sameDay: [[open, END_OF_DAY]], nextDay: [[MIDNIGHT, normalisedClose]] };
}

export interface DayPair {
  open: string;
  /** As the venue says it — '02:00' for a venue that closes at 2am. */
  close: string;
  /** The close falls on the NEXT calendar day. */
  overnight: boolean;
  /** This day carries windows one open/close pair cannot describe (e.g. a siesta split). */
  split: boolean;
  closed: boolean;
}

/**
 * Read the whole blob into one editable pair per day.
 *
 * The human-facing close for an overnight day lives on the NEXT day's tail window, so this has to
 * look across days to recover it — a single day's windows are not enough.
 *
 * `split` is set when a day carries more than one window of its own (a genuine siesta close).
 * Callers that can only render one pair MUST check it and refuse to save rather than silently
 * discard windows: flattening is exactly how the editor used to destroy the overnight tail.
 */
export function readOpeningHours(
  hours: OpeningHours | undefined,
  dayKeys: readonly DayKey[],
): Record<DayKey, DayPair> {
  const out = {} as Record<DayKey, DayPair>;
  const windowsOf = (key: DayKey): Window[] => ((hours?.[key] ?? []) as Window[]).slice();

  for (let i = 0; i < dayKeys.length; i += 1) {
    const key = dayKeys[i] as DayKey;
    const next = dayKeys[(i + 1) % dayKeys.length] as DayKey;
    const own = windowsOf(key).filter((w) => !isOvernightTail(w));
    const first = own[0];

    if (!first) {
      out[key] = { open: '09:00', close: '02:00', overnight: true, split: false, closed: true };
      continue;
    }
    const overnight = runsToMidnight(first);
    const tail = windowsOf(next).find(isOvernightTail);
    out[key] = {
      open: first[0],
      // No tail on the next day means the evening simply ends at midnight. Report
      // that as '00:00', not '24:00': it is what a human means, it is a valid
      // <input type="time"> value, and `splitOvernight` normalises it straight
      // back to '24:00' on write, so the round trip is exact either way.
      close: overnight ? (tail ? tail[1] : MIDNIGHT) : first[1],
      overnight,
      split: own.length > 1,
      closed: false,
    };
  }
  return out;
}

/**
 * Serialise one editable pair per day back into the stored blob.
 *
 * Every day's tail is contributed by the PREVIOUS day, so this is a two-pass build: place each
 * day's own evening window, then push overnight tails onto the following day. Windows are sorted
 * within a day so a tail always precedes the evening window, matching how the fixtures read.
 */
export function writeOpeningHours(
  pairs: Readonly<Record<DayKey, { open: string; close: string; closed: boolean }>>,
  dayKeys: readonly DayKey[],
): Record<string, Window[]> {
  const out: Record<string, Window[]> = {};
  for (const key of dayKeys) out[key] = [];

  for (let i = 0; i < dayKeys.length; i += 1) {
    const key = dayKeys[i] as DayKey;
    const next = dayKeys[(i + 1) % dayKeys.length] as DayKey;
    const pair = pairs[key];
    if (!pair || pair.closed) continue;
    const { sameDay, nextDay } = splitOvernight(pair.open, pair.close);
    out[key]?.push(...sameDay);
    out[next]?.push(...nextDay);
  }

  for (const key of dayKeys) out[key]?.sort((a, b) => parseHHMM(a[0]) - parseHHMM(b[0]));
  return out;
}

/**
 * The windows to PRINT for a day, with the overnight tail folded back into the evening window.
 *
 * `[["00:00","02:00"],["09:00","24:00"]]` displays as a single `09:00 – 02:00` instead of two
 * bewildering rows. The inherited tail is dropped rather than shown: a guest reading "Saturday"
 * wants Saturday night's hours, not the small hours Saturday inherited from Friday.
 *
 * `nextDayWindows` is what supplies the real closing time; without it an overnight evening window
 * prints as `09:00 – 24:00`, which is at least honest rather than wrong.
 */
export function displayWindows(
  windows: readonly Window[] | undefined,
  nextDayWindows?: readonly Window[],
): Window[] {
  const own = (windows ?? []).filter((w) => !isOvernightTail(w));
  const tail = (nextDayWindows ?? []).find(isOvernightTail);
  return own.map((w) => (runsToMidnight(w) && tail ? ([w[0], tail[1]] as Window) : w));
}

/**
 * The span a calendar grid should render for a day, in minutes from that day's midnight.
 *
 * An overnight day returns an end PAST 1440 (09:00 → 02:00 is 540 → 1560) so the grid draws one
 * continuous trading night. Taking min(open)/max(close) across the raw stored windows instead
 * gives 0 → 1440: a grid with a dead 02:00–09:00 band down the middle of it.
 */
export function tradingSpan(
  windows: readonly Window[] | undefined,
  nextDayWindows?: readonly Window[],
): { startMin: number; endMin: number } {
  const shown = displayWindows(windows, nextDayWindows);
  if (shown.length === 0) return { startMin: 0, endMin: 0 };
  const startMin = Math.min(...shown.map((w) => parseHHMM(w[0])));
  const endMin = Math.max(
    ...shown.map((w) => {
      const open = parseHHMM(w[0]);
      const close = parseHHMM(w[1]);
      return close <= open ? close + DAY_MINUTES : close;
    }),
  );
  return { startMin, endMin };
}
