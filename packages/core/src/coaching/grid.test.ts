import { describe, expect, it } from 'vitest';
import { localParts, parseHHMM, wallTimeToUtc } from '../time/tz';
import {
  LESSON_GRID_MINUTES,
  ceilToLessonGrid,
  isLessonGridTime,
  isOnLessonGrid,
  weeklyLessonStarts,
} from './grid';

const BAGHDAD = 'Asia/Baghdad'; // UTC+3 all year: no daylight saving
const at = (date: string, hhmm: string, tz = BAGHDAD): Date =>
  wallTimeToUtc(date, parseHHMM(hhmm), tz);
const plusMs = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

const DAY = 86_400_000;
const WEEK = 7 * DAY;

describe('isOnLessonGrid (C-20, R9; twin of app.lesson_on_grid)', () => {
  it('the grid is 30 minutes', () => {
    expect(LESSON_GRID_MINUTES).toBe(30);
  });

  it('accepts :00 and :30 local time in Baghdad, and nothing in between', () => {
    expect(isOnLessonGrid(at('2026-10-04', '18:00'), BAGHDAD)).toBe(true);
    expect(isOnLessonGrid(at('2026-10-04', '18:30'), BAGHDAD)).toBe(true);
    expect(isOnLessonGrid(at('2026-10-04', '00:00'), BAGHDAD)).toBe(true);
    expect(isOnLessonGrid(at('2026-10-04', '23:30'), BAGHDAD)).toBe(true);
    for (const off of ['18:01', '18:15', '18:29', '18:31', '18:45', '18:59', '23:59']) {
      expect(isOnLessonGrid(at('2026-10-04', off), BAGHDAD)).toBe(false);
    }
  });

  it('needs the exact minute: a second or a millisecond past is off the grid', () => {
    const six = at('2026-10-04', '18:00');
    expect(isOnLessonGrid(plusMs(six, 1_000), BAGHDAD)).toBe(false);
    expect(isOnLessonGrid(plusMs(six, 1), BAGHDAD)).toBe(false);
    expect(isOnLessonGrid(plusMs(six, -1), BAGHDAD)).toBe(false);
    expect(isOnLessonGrid(plusMs(six, 30 * 60_000), BAGHDAD)).toBe(true);
  });

  it('Baghdad has no daylight saving: 18:00 local is 15:00 UTC on every month of the year', () => {
    for (let m = 1; m <= 12; m++) {
      const date = `2026-${String(m).padStart(2, '0')}-15`;
      const six = at(date, '18:00');
      expect(six.getUTCHours()).toBe(15);
      expect(six.getUTCMinutes()).toBe(0);
      expect(isOnLessonGrid(six, BAGHDAD)).toBe(true);
      expect(isOnLessonGrid(plusMs(six, 15 * 60_000), BAGHDAD)).toBe(false);
    }
  });

  it('is judged in the branch’s local time, not UTC (half- and quarter-hour zones)', () => {
    // Asia/Kolkata is UTC+05:30: 04:30Z is 10:00 local, 04:15Z is 09:45 local.
    expect(isOnLessonGrid(new Date('2026-10-04T04:30:00Z'), 'Asia/Kolkata')).toBe(true);
    expect(isOnLessonGrid(new Date('2026-10-04T04:15:00Z'), 'Asia/Kolkata')).toBe(false);
    // Asia/Kathmandu is UTC+05:45: a UTC :00 is local :45, off the grid there, on it in Baghdad.
    const utcHour = new Date('2026-10-04T15:00:00Z');
    expect(isOnLessonGrid(utcHour, BAGHDAD)).toBe(true);
    expect(isOnLessonGrid(utcHour, 'Asia/Kathmandu')).toBe(false);
    expect(isOnLessonGrid(new Date('2026-10-04T04:15:00Z'), 'Asia/Kathmandu')).toBe(true); // 10:00
  });

  it('depends only on the instant and the zone, never on how it was written (RTL or LTR, any locale)', () => {
    const forms = [
      new Date('2026-10-04T18:00:00+03:00'),
      new Date('2026-10-04T15:00:00.000Z'),
      new Date(Date.UTC(2026, 9, 4, 15, 0, 0)),
    ];
    for (const d of forms) expect(isOnLessonGrid(d, BAGHDAD)).toBe(true);
    // The zone's formatter is fixed h23 (tz.ts), so midnight and noon read as 00:00 and 12:00,
    // never as a 12-hour locale clock's 12:00 AM / 24:00.
    expect(isOnLessonGrid(new Date('2026-10-04T00:00:00+03:00'), BAGHDAD)).toBe(true);
    expect(isOnLessonGrid(new Date('2026-10-04T12:00:00+03:00'), BAGHDAD)).toBe(true);
    // An Arabic, right-to-left formatter used elsewhere in the process changes nothing.
    new Intl.DateTimeFormat('ar-IQ', {
      timeZone: BAGHDAD,
      hour: 'numeric',
      minute: 'numeric',
    }).format(forms[0] as Date);
    expect(isOnLessonGrid(forms[0] as Date, BAGHDAD)).toBe(true);
    expect(localParts(forms[0] as Date, BAGHDAD).minutesOfDay).toBe(18 * 60);
  });

  it('an invalid Date is not on the grid', () => {
    expect(isOnLessonGrid(new Date(Number.NaN), BAGHDAD)).toBe(false);
  });
});

describe('isLessonGridTime (coach hours windows, db.md §4.6.5)', () => {
  it('accepts HH:00 and HH:30, and 24:00 as the end of the day (CD-10)', () => {
    for (const t of ['00:00', '00:30', '09:00', '09:30', '23:30', '24:00']) {
      expect(isLessonGridTime(t)).toBe(true);
    }
  });

  it('refuses other minutes and malformed text without throwing', () => {
    for (const t of ['09:15', '09:59', '23:45', '24:30', '9:00', '09:00:00', '', '25:00', 'nine']) {
      expect(isLessonGridTime(t)).toBe(false);
    }
  });
});

describe('ceilToLessonGrid', () => {
  it('returns a grid instant unchanged (a fresh Date)', () => {
    const six = at('2026-10-04', '18:00');
    const out = ceilToLessonGrid(six, BAGHDAD);
    expect(out.getTime()).toBe(six.getTime());
    expect(out).not.toBe(six);
  });

  it('moves up to the next :00 or :30', () => {
    expect(ceilToLessonGrid(at('2026-10-04', '18:10'), BAGHDAD).getTime()).toBe(
      at('2026-10-04', '18:30').getTime(),
    );
    expect(ceilToLessonGrid(at('2026-10-04', '18:31'), BAGHDAD).getTime()).toBe(
      at('2026-10-04', '19:00').getTime(),
    );
    // 18:30 and one second, or half a second past 18:00, is no longer on the grid.
    expect(ceilToLessonGrid(plusMs(at('2026-10-04', '18:30'), 1_000), BAGHDAD).getTime()).toBe(
      at('2026-10-04', '19:00').getTime(),
    );
    expect(ceilToLessonGrid(plusMs(at('2026-10-04', '18:00'), 500), BAGHDAD).getTime()).toBe(
      at('2026-10-04', '18:30').getTime(),
    );
  });

  it('crosses local midnight into the next local day', () => {
    const out = ceilToLessonGrid(at('2026-10-04', '23:40'), BAGHDAD);
    expect(out.toISOString()).toBe('2026-10-04T21:00:00.000Z'); // 00:00 on 5 Oct in Baghdad
    expect(localParts(out, BAGHDAD).date).toBe('2026-10-05');
  });

  it('works on the local grid of a quarter-hour zone', () => {
    const tz = 'Asia/Kathmandu';
    const out = ceilToLessonGrid(at('2026-10-04', '10:05', tz), tz);
    expect(out.getTime()).toBe(at('2026-10-04', '10:30', tz).getTime());
    expect(isOnLessonGrid(out, tz)).toBe(true);
  });

  it('always lands on the grid, never before the input', () => {
    const start = at('2026-10-04', '00:00').getTime();
    for (let m = 0; m < 24 * 60; m += 7) {
      const t = new Date(start + m * 60_000 + 13_000);
      const out = ceilToLessonGrid(t, BAGHDAD);
      expect(isOnLessonGrid(out, BAGHDAD)).toBe(true);
      expect(out.getTime()).toBeGreaterThanOrEqual(t.getTime());
      expect(out.getTime() - t.getTime()).toBeLessThan(30 * 60_000);
    }
  });

  it('refuses an invalid Date', () => {
    expect(() => ceilToLessonGrid(new Date(Number.NaN), BAGHDAD)).toThrowError(RangeError);
  });
});

describe('weeklyLessonStarts (GL-6: a course repeats weekly at the same local time)', () => {
  it('lists one start a week, seven days apart in Baghdad, first start first', () => {
    const first = at('2026-10-04', '18:00');
    const starts = weeklyLessonStarts(first, 4, BAGHDAD);
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-10-04T15:00:00.000Z',
      '2026-10-11T15:00:00.000Z',
      '2026-10-18T15:00:00.000Z',
      '2026-10-25T15:00:00.000Z',
    ]);
    expect(starts.every((d) => isOnLessonGrid(d, BAGHDAD))).toBe(true);
  });

  it('crosses a month end and a year end on the local calendar', () => {
    const starts = weeklyLessonStarts(at('2026-12-24', '20:30'), 3, BAGHDAD);
    expect(starts.map((d) => localParts(d, BAGHDAD).date)).toEqual([
      '2026-12-24',
      '2026-12-31',
      '2027-01-07',
    ]);
    expect(starts.every((d) => localParts(d, BAGHDAD).minutesOfDay === 20 * 60 + 30)).toBe(true);
  });

  it('handles the bounds a course type allows (2 and 52 sessions) and a single start', () => {
    const first = at('2026-10-04', '09:30');
    expect(weeklyLessonStarts(first, 1, BAGHDAD)).toEqual([first]);
    expect(weeklyLessonStarts(first, 2, BAGHDAD)[1]?.getTime()).toBe(first.getTime() + WEEK);
    const year = weeklyLessonStarts(first, 52, BAGHDAD);
    expect(year).toHaveLength(52);
    expect(year[51]?.getTime()).toBe(first.getTime() + 51 * WEEK);
    for (let k = 1; k < year.length; k++) {
      expect((year[k] as Date).getTime() - (year[k - 1] as Date).getTime()).toBe(WEEK);
    }
  });

  it('keeps the local wall-clock time across a daylight-saving change', () => {
    // Europe/London leaves GMT for BST on 29 March 2026: 18:00 local is 18:00Z, then 17:00Z.
    const tz = 'Europe/London';
    const starts = weeklyLessonStarts(at('2026-03-22', '18:00', tz), 2, tz);
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-03-22T18:00:00.000Z',
      '2026-03-29T17:00:00.000Z',
    ]);
    expect(starts.every((d) => localParts(d, tz).minutesOfDay === 18 * 60)).toBe(true);
  });

  it('refuses a count below 1, a fractional count and an invalid Date', () => {
    const first = at('2026-10-04', '18:00');
    expect(() => weeklyLessonStarts(first, 0, BAGHDAD)).toThrowError(RangeError);
    expect(() => weeklyLessonStarts(first, 2.5, BAGHDAD)).toThrowError(RangeError);
    expect(() => weeklyLessonStarts(new Date(Number.NaN), 2, BAGHDAD)).toThrowError(RangeError);
  });
});
