/**
 * Set hours (0442): the week editor's pure side. A person's week is a flat list of WeekShift
 * (app.staff_shifts_get / app.set_staff_shifts); the editor shows it day by day, joins touching
 * shifts into one block ("switches to Cashier at 14:00, no scan needed") and names the gaps as
 * time off. The server's own rules are `weekProblem` (@touch/core/staff/clock).
 */
import { shiftMinutes, weekProblem, type WeekShift } from '@touch/core/staff/clock';

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** The server's cap on one week. */
export const MAX_SHIFTS = 42;
export const MAX_SHIFT_MINUTES = 16 * 60;

export interface ShiftsPayload {
  staffId: string;
  /** Main job first, then second jobs. */
  roles: string[];
  canEdit: boolean;
  shifts: WeekShift[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function hhmm(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.slice(0, 5);
  return HHMM.test(t) ? t : null;
}

export function readShifts(payload: unknown): ShiftsPayload {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const roles = Array.isArray(p.roles) ? p.roles.filter((r): r is string => typeof r === 'string') : [];
  const shifts: WeekShift[] = [];
  if (Array.isArray(p.shifts)) {
    for (const raw of p.shifts) {
      if (typeof raw !== 'object' || raw === null) continue;
      const s = raw as Record<string, unknown>;
      const weekday = typeof s.weekday === 'number' ? s.weekday : Number(s.weekday);
      const starts = hhmm(s.starts_at);
      const ends = hhmm(s.ends_at);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !starts || !ends) continue;
      shifts.push({ weekday, starts_at: starts, ends_at: ends, role: typeof s.role === 'string' && s.role !== '' ? s.role : null });
    }
  }
  return { staffId: typeof p.staff_id === 'string' ? p.staff_id : '', roles, canEdit: p.can_edit === true, shifts: sortWeek(shifts) };
}

export function minutesOf(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timeOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function crossesMidnight(s: Pick<WeekShift, 'starts_at' | 'ends_at'>): boolean {
  return minutesOf(s.ends_at) <= minutesOf(s.starts_at);
}

export function sortWeek(week: readonly WeekShift[]): WeekShift[] {
  return [...week].sort((a, b) => a.weekday - b.weekday || minutesOf(a.starts_at) - minutesOf(b.starts_at));
}

/** The same week, whatever order it was written in (null role and the main job read alike). */
export function sameWeek(a: readonly WeekShift[], b: readonly WeekShift[], mainRole: string | null): boolean {
  if (a.length !== b.length) return false;
  const norm = (s: WeekShift) => `${s.weekday}|${s.starts_at}|${s.ends_at}|${s.role === mainRole ? '' : (s.role ?? '')}`;
  const x = sortWeek(a).map(norm);
  const y = sortWeek(b).map(norm);
  return x.every((v, i) => v === y[i]);
}

/** A day's shifts with their place in the week list, earliest first. */
export function dayShifts(week: readonly WeekShift[], day: number): { shift: WeekShift; index: number }[] {
  return week
    .map((shift, index) => ({ shift, index }))
    .filter((x) => x.shift.weekday === day)
    .sort((a, b) => minutesOf(a.shift.starts_at) - minutesOf(b.shift.starts_at));
}

/** What sits between one shift of a day and the next. */
export type Between =
  /** They touch: one block, the job may change, no scan. */
  | { kind: 'switch'; at: string; roleChanges: boolean }
  /** A gap: time off, never counted against anyone. */
  | { kind: 'gap'; from: string; to: string; minutes: number }
  /** They overlap (weekProblem will say so too). */
  | { kind: 'overlap' };

export function between(a: WeekShift, b: WeekShift): Between {
  const aEnd = crossesMidnight(a) ? minutesOf(a.ends_at) + 1440 : minutesOf(a.ends_at);
  const bStart = minutesOf(b.starts_at);
  if (aEnd === bStart) return { kind: 'switch', at: b.starts_at, roleChanges: (a.role ?? '') !== (b.role ?? '') };
  if (aEnd < bStart) return { kind: 'gap', from: a.ends_at, to: b.starts_at, minutes: bStart - aEnd };
  return { kind: 'overlap' };
}

/** The day's working span in blocks (touching shifts joined): for the summary line. */
export function dayBlocks(week: readonly WeekShift[], day: number): { starts: string; ends: string; shifts: number }[] {
  const out: { starts: string; ends: string; shifts: number }[] = [];
  for (const { shift } of dayShifts(week, day)) {
    const last = out[out.length - 1];
    if (last && last.ends === shift.starts_at && minutesOf(last.ends) > minutesOf(last.starts)) {
      last.ends = shift.ends_at;
      last.shifts += 1;
    } else {
      out.push({ starts: shift.starts_at, ends: shift.ends_at, shifts: 1 });
    }
  }
  return out;
}

/** Planned minutes in the week (for "40 h a week"). */
export function weekMinutes(week: readonly WeekShift[]): number {
  return week.reduce((n, s) => n + shiftMinutes(s), 0);
}

/** A sensible new shift for a day: after the day's last one, else 09:00 to 17:00. */
export function newShift(week: readonly WeekShift[], day: number): WeekShift {
  const shifts = dayShifts(week, day);
  const last = shifts[shifts.length - 1]?.shift;
  if (!last || crossesMidnight(last)) return { weekday: day, starts_at: '09:00', ends_at: '17:00', role: null };
  const start = minutesOf(last.ends_at);
  const end = Math.min(start + 4 * 60, 24 * 60);
  return { weekday: day, starts_at: last.ends_at, ends_at: end >= 1440 ? '00:00' : timeOf(end), role: null };
}

/** Copy one day's shifts onto other days (replacing what those days had). */
export function copyDay(week: readonly WeekShift[], from: number, to: readonly number[]): WeekShift[] {
  const source = dayShifts(week, from).map((x) => x.shift);
  const targets = new Set(to.filter((d) => d !== from));
  const kept = week.filter((s) => !targets.has(s.weekday));
  const copies = [...targets].flatMap((d) => source.map((s) => ({ ...s, weekday: d })));
  return sortWeek([...kept, ...copies]);
}

/** The editor's problem with the week, by shift index, or null when it can be saved. */
export type WeekIssue = { index: number; reason: 'empty' | 'too_long' | 'overlap' | 'too_many' };

export function weekIssue(week: readonly WeekShift[]): WeekIssue | null {
  if (week.length > MAX_SHIFTS) return { index: MAX_SHIFTS, reason: 'too_many' };
  return weekProblem(week);
}

/** set_staff_shifts' INVALID_ARGUMENT / FORBIDDEN hints, as the line the editor shows. */
export type ShiftsRefusal = 'overlap' | 'shift_length' | 'role' | 'shifts' | 'own' | 'not_here' | null;

export function shiftsRefusal(code: string | null, hint: string | null): ShiftsRefusal {
  if (code === 'INVALID_ARGUMENT') {
    if (hint === 'overlap' || hint === 'shift_length' || hint === 'role') return hint;
    return 'shifts';
  }
  if (code === 'FORBIDDEN' && hint === 'staff_id') return 'own';
  if (code === 'REF_NOT_FOUND' && hint === 'staff_id') return 'not_here';
  return null;
}

/** What set_staff_shifts takes: the main job is sent as null, as the server stores it. */
export function shiftsForSave(week: readonly WeekShift[], mainRole: string | null): WeekShift[] {
  return sortWeek(week).map((s) => ({ ...s, role: s.role === mainRole ? null : s.role }));
}
