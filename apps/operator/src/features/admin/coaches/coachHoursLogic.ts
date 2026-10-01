/**
 * A coach's weekly hours and time off at this branch, as the Hours tab edits
 * them (docs/design/coaching/operator.md §5.13.3; app.set_coach_hours,
 * app.add_coach_time_off, 0279; CD-10, R73). Pure; no React.
 *
 * - A window lies inside one local day: a start and an end on the half hour,
 *   00:00..24:00, the start before the end (CD-10). "24:00" is a real end,
 *   which a native time input cannot hold, hence the Selects.
 * - Weekdays run Sunday = 0 .. Saturday = 6, as `extract(dow …)` in the
 *   branch's time zone (§1.2 `coach_hours.weekday`).
 * - Windows on one day here may not overlap; a window overlapping the coach's
 *   hours at another branch is only a warning, because the server decides
 *   (HOURS_OVERLAP) and its detail is mapped back to the window it names.
 * - The windows are sent in weekday order, each day in the order on screen,
 *   so the server's 0-based index (R73) finds the window it refused.
 */
import { wallTimeToUtc, localParts } from '@touch/core';
import type { HoursElsewhere, HoursWindow, TimeOff } from '../../coaching/lessonPayloads';

/** Sunday first, as `weekday` 0..6. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** The `op.days.*` key of each weekday. */
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export function dayKeyOf(weekday: number): DayKey | null {
  return DAY_KEYS[weekday] ?? null;
}

/** One window as the form holds it: 'HH:MM', an end may be '24:00'. */
export interface DraftWindow {
  start: string;
  end: string;
}

/** Seven days, index = weekday. */
export type HoursDraft = DraftWindow[][];

/** One window as set_coach_hours takes it (§5.7). */
export interface SentWindow {
  weekday: number;
  start: string;
  end: string;
}

const DAY_MINUTES = 24 * 60;

/** 'HH:MM:SS' or 'HH:MM' as 'HH:MM' ('24:00:00' → '24:00'). */
export function hhmm(t: string): string {
  return t.length >= 5 ? t.slice(0, 5) : t;
}

/** Minutes since local midnight for 'HH:MM' (00:00..24:00), or null. */
export function minutesOf(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm(t));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function timeOfMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Every half hour from 00:00 to 24:00. */
export const HALF_HOURS: readonly string[] = Array.from({ length: 49 }, (_, i) =>
  timeOfMinutes(i * 30),
);

/** A window's start: 00:00..23:30. */
export const START_OPTIONS: readonly string[] = HALF_HOURS.slice(0, -1);
/** A window's end: 00:30..24:00 (CD-10: 24:00 is offered). */
export const END_OPTIONS: readonly string[] = HALF_HOURS.slice(1);

export function emptyHours(): HoursDraft {
  return WEEKDAYS.map(() => []);
}

/** The stored windows, by weekday, each day in start order. */
export function draftFromHours(hours: readonly HoursWindow[]): HoursDraft {
  const draft = emptyHours();
  for (const w of hours) {
    if (w.weekday < 0 || w.weekday > 6) continue;
    draft[w.weekday]!.push({ start: hhmm(w.start_time), end: hhmm(w.end_time) });
  }
  for (const day of draft)
    day.sort((a, b) => (minutesOf(a.start) ?? 0) - (minutesOf(b.start) ?? 0));
  return draft;
}

/** What set_coach_hours is sent: weekday order, each day in the order on screen. */
export function toWindows(draft: HoursDraft): SentWindow[] {
  const out: SentWindow[] = [];
  draft.forEach((day, weekday) => {
    for (const w of day) out.push({ weekday, start: w.start, end: w.end });
  });
  return out;
}

export function sameHours(a: HoursDraft, b: HoursDraft): boolean {
  return JSON.stringify(toWindows(a)) === JSON.stringify(toWindows(b));
}

/** A new window after the day's last one (or 09:00–13:00 on an empty day). */
export function addWindow(draft: HoursDraft, weekday: number): HoursDraft {
  const day = draft[weekday] ?? [];
  const last = day[day.length - 1];
  let next: DraftWindow = { start: '09:00', end: '13:00' };
  if (last) {
    const from = Math.min(minutesOf(last.end) ?? 0, DAY_MINUTES - 60);
    const to = Math.min(from + 120, DAY_MINUTES);
    next = { start: timeOfMinutes(from), end: timeOfMinutes(to) };
  }
  return draft.map((d, i) => (i === weekday ? [...d, next] : d));
}

export function removeWindow(draft: HoursDraft, weekday: number, position: number): HoursDraft {
  return draft.map((d, i) => (i === weekday ? d.filter((_, j) => j !== position) : d));
}

export function setWindow(
  draft: HoursDraft,
  weekday: number,
  position: number,
  patch: Partial<DraftWindow>,
): HoursDraft {
  return draft.map((d, i) =>
    i === weekday ? d.map((w, j) => (j === position ? { ...w, ...patch } : w)) : d,
  );
}

/** "Copy to every day": every weekday gets this day's windows. */
export function copyToEveryDay(draft: HoursDraft, weekday: number): HoursDraft {
  const source = draft[weekday] ?? [];
  return draft.map(() => source.map((w) => ({ ...w })));
}

export type HoursError = 'order' | 'grid' | 'overlap';

export interface WindowProblem {
  weekday: number;
  /** The window's place in its day, as on screen. */
  position: number;
  error: HoursError;
}

/**
 * The checks before Save: start before end, on the half hour, end ≤ 24:00, no
 * overlap with another window on the same day here (touching is fine). One
 * problem per window, the first that applies.
 */
export function hoursErrors(draft: HoursDraft): WindowProblem[] {
  const out: WindowProblem[] = [];
  draft.forEach((day, weekday) => {
    const flagged = new Set<number>();
    day.forEach((w, position) => {
      const s = minutesOf(w.start);
      const e = minutesOf(w.end);
      if (s === null || e === null || s % 30 !== 0 || e % 30 !== 0) {
        out.push({ weekday, position, error: 'grid' });
        flagged.add(position);
      } else if (s >= e || e > DAY_MINUTES) {
        out.push({ weekday, position, error: 'order' });
        flagged.add(position);
      }
    });
    day.forEach((w, position) => {
      if (flagged.has(position)) return;
      const s = minutesOf(w.start)!;
      const e = minutesOf(w.end)!;
      const clash = day.some((o, j) => {
        if (j === position || flagged.has(j)) return false;
        const os = minutesOf(o.start)!;
        const oe = minutesOf(o.end)!;
        return s < oe && os < e;
      });
      if (clash) out.push({ weekday, position, error: 'overlap' });
    });
  });
  return out;
}

/** The coach's windows at other branches, by weekday, in start order (shown muted under each day). */
export function elsewhereByDay(elsewhere: readonly HoursElsewhere[]): HoursElsewhere[][] {
  const out: HoursElsewhere[][] = WEEKDAYS.map(() => []);
  for (const w of elsewhere) if (w.weekday >= 0 && w.weekday <= 6) out[w.weekday]!.push(w);
  for (const day of out)
    day.sort((a, b) => (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0));
  return out;
}

export interface ElsewhereClash {
  weekday: number;
  position: number;
  other: HoursElsewhere;
}

/** A window here that overlaps the coach's hours at another branch: a warning, the server decides. */
export function elsewhereOverlaps(
  draft: HoursDraft,
  elsewhere: readonly HoursElsewhere[],
): ElsewhereClash[] {
  const out: ElsewhereClash[] = [];
  draft.forEach((day, weekday) => {
    day.forEach((w, position) => {
      const s = minutesOf(w.start);
      const e = minutesOf(w.end);
      if (s === null || e === null || s >= e) return;
      const other = elsewhere.find((o) => {
        if (o.weekday !== weekday) return false;
        const os = minutesOf(o.start_time);
        const oe = minutesOf(o.end_time);
        return os !== null && oe !== null && s < oe && os < e;
      });
      if (other) out.push({ weekday, position, other });
    });
  });
  return out;
}

export type OverlapTarget =
  { kind: 'window'; index: number; weekday: number; position: number } | { kind: 'timeOff' };

/**
 * HOURS_OVERLAP / HOURS_INVALID's detail mapped back to the window the
 * operator sent (R73): the 0-based index of the clashing window ("3"), the
 * form "<index>:<weekday>", or `time_off`. Null when it names nothing sent.
 */
export function overlapWindow(
  detail: string | null | undefined,
  sent: readonly SentWindow[],
): OverlapTarget | null {
  const d = (detail ?? '').trim();
  if (d === 'time_off') return { kind: 'timeOff' };
  const m = /^(\d+)(?::(\d))?$/.exec(d);
  if (!m) return null;
  const index = Number(m[1]);
  const w = sent[index];
  if (!w) return null;
  const weekday = m[2] !== undefined ? Number(m[2]) : w.weekday;
  let position = 0;
  for (let i = 0; i < index; i++) if (sent[i]!.weekday === w.weekday) position += 1;
  return { kind: 'window', index, weekday, position };
}

// ---------------------------------------------------------------------------
// Time off
// ---------------------------------------------------------------------------

export interface TimeOffDraft {
  /** 'YYYY-MM-DD' in the branch's time zone. */
  fromDate: string;
  /** 'HH:MM' on the half hour. */
  fromTime: string;
  toDate: string;
  /** 'HH:MM'; '24:00' ends the day. */
  toTime: string;
  reason: string;
}

export const TIME_OFF_REASON_MAX = 200;

export function emptyTimeOff(): TimeOffDraft {
  return { fromDate: '', fromTime: '00:00', toDate: '', toTime: '24:00', reason: '' };
}

/** A local date and time in the branch's zone, as an ISO instant; null when unreadable. */
export function localToIso(date: string, time: string, tz: string): string | null {
  const minutes = minutesOf(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || minutes === null) return null;
  try {
    return wallTimeToUtc(date, minutes, tz).toISOString();
  } catch {
    return null;
  }
}

export type TimeOffError = 'needBoth' | 'endBeforeStart';

export function timeOffErrors(d: TimeOffDraft, tz: string): TimeOffError | null {
  const from = localToIso(d.fromDate, d.fromTime, tz);
  const to = localToIso(d.toDate, d.toTime, tz);
  if (!from || !to) return 'needBoth';
  if (Date.parse(to) <= Date.parse(from)) return 'endBeforeStart';
  return null;
}

/** add_coach_time_off's arguments, less the coach. */
export function timeOffArgs(
  d: TimeOffDraft,
  tz: string,
): { p_starts_at: string; p_ends_at: string; p_reason: string } | null {
  if (timeOffErrors(d, tz) !== null) return null;
  return {
    p_starts_at: localToIso(d.fromDate, d.fromTime, tz)!,
    p_ends_at: localToIso(d.toDate, d.toTime, tz)!,
    p_reason: d.reason.trim().slice(0, TIME_OFF_REASON_MAX),
  };
}

/**
 * An instant as the branch's wall clock. An end that falls on local midnight
 * reads as 24:00 of the day before ("Wed 15 Oct 24:00"), as the coach set it.
 */
export function wallClockOf(
  iso: string,
  tz: string,
  isEnd = false,
): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = localParts(new Date(ms), tz);
  if (isEnd && p.minutesOfDay === 0 && p.seconds === 0) {
    const prev = localParts(new Date(ms - 60_000), tz);
    return { date: prev.date, time: '24:00' };
  }
  return { date: p.date, time: timeOfMinutes(p.minutesOfDay) };
}

/** Time off still to come (or under way), earliest first. */
export function upcomingTimeOff(list: readonly TimeOff[], nowMs: number): TimeOff[] {
  return list
    .filter((t) => {
      const end = Date.parse(t.ends_at);
      return Number.isNaN(end) || end > nowMs;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
