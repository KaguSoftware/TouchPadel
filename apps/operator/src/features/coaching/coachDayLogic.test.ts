import { describe, expect, it } from 'vitest';
import { wallTimeToUtc } from '@touch/core';
import {
  coachBands,
  hourMarks,
  hoursIntervals,
  lessonsOfCoach,
  mergeIntervals,
  nextDate,
  previousDate,
  typeForCoach,
  worksInSpan,
} from './coachDayLogic';
import type { DeskLesson, DeskLessonType, ScheduleCoach } from './lessonPayloads';

const TZ = 'Asia/Baghdad';
// 2026-10-25 is a Sunday (weekday 0).
const DATE = '2026-10-25';
const at = (date: string, hh: number, mm = 0) => wallTimeToUtc(date, hh * 60 + mm, TZ).getTime();
const SPAN = { fromMs: at(DATE, 9), toMs: at(DATE, 26) };

function coach(p: Partial<ScheduleCoach> = {}): ScheduleCoach {
  return {
    coach_id: 'c1',
    display_name_en: 'Coach One',
    display_name_ar: 'المدرّب',
    status: 'active',
    photo_path: null,
    hours: [],
    time_off: [],
    busy: [],
    ...p,
  };
}

describe('dates', () => {
  it('steps a day forward and back across a month end', () => {
    expect(nextDate('2026-10-31')).toBe('2026-11-01');
    expect(previousDate('2026-11-01')).toBe('2026-10-31');
  });
});

describe('mergeIntervals', () => {
  it('joins touching and overlapping spans and drops empty ones', () => {
    expect(
      mergeIntervals([
        { fromMs: 5, toMs: 8 },
        { fromMs: 1, toMs: 3 },
        { fromMs: 3, toMs: 4 },
        { fromMs: 7, toMs: 9 },
        { fromMs: 10, toMs: 10 },
      ]),
    ).toEqual([
      { fromMs: 1, toMs: 4 },
      { fromMs: 5, toMs: 9 },
    ]);
  });
});

describe('hoursIntervals', () => {
  it("reads the night's weekday and the next day's, joining at midnight", () => {
    const c = coach({
      hours: [
        { weekday: 0, start_time: '18:00', end_time: '24:00' },
        { weekday: 1, start_time: '00:00', end_time: '01:00' },
        { weekday: 3, start_time: '10:00', end_time: '12:00' },
      ],
    });
    expect(hoursIntervals(c, DATE, TZ)).toEqual([{ fromMs: at(DATE, 18), toMs: at('2026-10-26', 1) }]);
  });
});

describe('coachBands', () => {
  const c = coach({
    hours: [{ weekday: 0, start_time: '08:00', end_time: '14:00' }],
    time_off: [{ starts_at: new Date(at(DATE, 12)).toISOString(), ends_at: new Date(at(DATE, 13)).toISOString() }],
    busy: [
      { lesson_id: 'l1', here: true, start_at: new Date(at(DATE, 10)).toISOString(), end_at: new Date(at(DATE, 11)).toISOString() },
      { lesson_id: null, here: false, start_at: new Date(at(DATE, 20)).toISOString(), end_at: new Date(at(DATE, 21)).toISOString() },
    ],
  });
  const bands = coachBands(c, DATE, TZ, SPAN);

  it('clips hours to the span and places every band as a fraction of it', () => {
    const hours = bands.find((b) => b.kind === 'hours')!;
    expect(hours.fromMs).toBe(at(DATE, 9));
    expect(hours.start).toBe(0);
    expect(hours.size).toBeCloseTo(5 / 17);
  });

  it('keeps the lesson id only for a lesson here, and lists time off', () => {
    expect(bands.filter((b) => b.kind === 'busy').map((b) => b.lessonId)).toEqual(['l1', null]);
    expect(bands.filter((b) => b.kind === 'off')).toHaveLength(1);
    expect(worksInSpan(bands)).toBe(true);
  });

  it('says a coach with no hours that night does not work', () => {
    expect(worksInSpan(coachBands(coach(), DATE, TZ, SPAN))).toBe(false);
  });
});

describe('hourMarks', () => {
  it('marks every whole hour from open to close', () => {
    const marks = hourMarks(DATE, 9 * 60, 26 * 60, TZ, SPAN);
    expect(marks).toHaveLength(18);
    expect(marks[0]!.at).toBe(0);
    expect(marks[marks.length - 1]!.at).toBe(1);
  });
});

describe('lessons and types', () => {
  const lesson = (id: string, coachId: string, hh: number, status = 'scheduled'): DeskLesson =>
    ({ lesson_id: id, coach_id: coachId, start_at: new Date(at(DATE, hh)).toISOString(), status }) as DeskLesson;

  it("lists one coach's live lessons in start order", () => {
    const list = lessonsOfCoach(
      [lesson('b', 'c1', 15), lesson('a', 'c1', 11), lesson('x', 'c2', 10), lesson('z', 'c1', 9, 'cancelled')],
      'c1',
    );
    expect(list.map((l) => l.lesson_id)).toEqual(['a', 'b']);
  });

  it('picks the chosen private type when the coach teaches it, else their first', () => {
    const t = (id: string, kind: DeskLessonType['kind']) => ({ lesson_type_id: id, kind }) as DeskLessonType;
    const types = [t('g', 'group'), t('p1', 'private'), t('p2', 'private')];
    expect(typeForCoach(types, ['p1', 'p2', 'g'], 'p2')?.lesson_type_id).toBe('p2');
    expect(typeForCoach(types, ['p1', 'g'], 'p2')?.lesson_type_id).toBe('p1');
    expect(typeForCoach(types, ['g'], null)).toBeNull();
  });
});
