/**
 * The Coaches tab's pure rules (0356, Sait 2026-10-21): one coach's trading
 * night as bands on a timeline. Hours are the coach's weekly windows at this
 * branch on the night's date and the next one (a night runs past midnight);
 * busy is their lessons, time off is the coach's own. Everything is clipped to
 * the timeline's span and placed as a fraction of it, so the screen only
 * draws. The free starts themselves come from app.coach_slots (the server
 * also checks opening hours and a free court), never from these bands.
 */
import { wallTimeToUtc } from '@touch/core';
import type { DeskLesson, DeskLessonType, ScheduleCoach } from './lessonPayloads';

export type BandKind = 'hours' | 'busy' | 'off';

export interface Band {
  kind: BandKind;
  fromMs: number;
  toMs: number;
  /** Placement on the timeline, 0..1, in inline-start terms. */
  start: number;
  size: number;
  /** A lesson at this branch the desk can open; null otherwise. */
  lessonId: string | null;
}

export interface Span {
  fromMs: number;
  toMs: number;
}

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The weekday (0 = Sunday) of a 'YYYY-MM-DD' date. */
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The date after a 'YYYY-MM-DD' date. */
export function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The date before a 'YYYY-MM-DD' date. */
export function previousDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Touching or overlapping intervals joined, in order. */
export function mergeIntervals(list: readonly Span[]): Span[] {
  const sorted = [...list].filter((s) => s.toMs > s.fromMs).sort((a, b) => a.fromMs - b.fromMs);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, s.toMs);
    else out.push({ ...s });
  }
  return out;
}

/** The coach's working windows on `date` and the next day, as instants, joined. */
export function hoursIntervals(coach: ScheduleCoach, date: string, tz: string): Span[] {
  const days = [date, nextDate(date)];
  const spans: Span[] = [];
  for (const day of days) {
    const wd = weekdayOf(day);
    for (const h of coach.hours) {
      if (h.weekday !== wd) continue;
      const from = minutesOf(h.start_time);
      const to = minutesOf(h.end_time);
      if (from === null || to === null || to <= from) continue;
      spans.push({
        fromMs: wallTimeToUtc(day, from, tz).getTime(),
        toMs: wallTimeToUtc(day, to, tz).getTime(),
      });
    }
  }
  return mergeIntervals(spans);
}

function place(kind: BandKind, fromMs: number, toMs: number, span: Span, lessonId: string | null): Band | null {
  const len = span.toMs - span.fromMs;
  const a = Math.max(fromMs, span.fromMs);
  const b = Math.min(toMs, span.toMs);
  if (len <= 0 || b <= a) return null;
  return { kind, fromMs: a, toMs: b, start: (a - span.fromMs) / len, size: (b - a) / len, lessonId };
}

/**
 * The bands of one coach on one night's timeline: hours first (the ground),
 * then time off, then lessons on top, each clipped to `span`.
 */
export function coachBands(coach: ScheduleCoach, date: string, tz: string, span: Span): Band[] {
  const out: Band[] = [];
  for (const h of hoursIntervals(coach, date, tz)) {
    const b = place('hours', h.fromMs, h.toMs, span, null);
    if (b) out.push(b);
  }
  for (const t of coach.time_off) {
    const b = place('off', Date.parse(t.starts_at), Date.parse(t.ends_at), span, null);
    if (b) out.push(b);
  }
  for (const l of coach.busy) {
    const b = place('busy', Date.parse(l.start_at), Date.parse(l.end_at), span, l.here ? l.lesson_id : null);
    if (b) out.push(b);
  }
  return out;
}

/** Whether the coach works at all inside the span (any hours band). */
export function worksInSpan(bands: readonly Band[]): boolean {
  return bands.some((b) => b.kind === 'hours');
}

/** The hour marks of the timeline: every whole local hour from `openMin` to `closeMin`. */
export function hourMarks(date: string, openMin: number, closeMin: number, tz: string, span: Span): { ms: number; at: number }[] {
  const out: { ms: number; at: number }[] = [];
  const len = span.toMs - span.fromMs;
  if (len <= 0) return out;
  for (let m = Math.ceil(openMin / 60) * 60; m <= closeMin; m += 60) {
    const ms = wallTimeToUtc(date, m, tz).getTime();
    out.push({ ms, at: (ms - span.fromMs) / len });
  }
  return out;
}

/** This branch's lessons of one coach on the night, in start order. */
export function lessonsOfCoach(lessons: readonly DeskLesson[], coachId: string): DeskLesson[] {
  return lessons
    .filter((l) => l.coach_id === coachId && l.status !== 'cancelled' && l.status !== 'expired')
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
}

/** The private lesson types a coach teaches here, among those on sale. */
export function privateTypesOf(types: readonly DeskLessonType[], lessonTypeIds: readonly string[]): DeskLessonType[] {
  return types.filter((t) => t.kind === 'private' && lessonTypeIds.includes(t.lesson_type_id));
}

/** The private type to show free times for: the picked one when taught, else the first taught. */
export function typeForCoach(
  types: readonly DeskLessonType[],
  lessonTypeIds: readonly string[],
  picked: string | null,
): DeskLessonType | null {
  const taught = privateTypesOf(types, lessonTypeIds);
  return taught.find((t) => t.lesson_type_id === picked) ?? taught[0] ?? null;
}
