import { describe, it, expect } from 'vitest';
import {
  busiestCount,
  countByTradingDate,
  daysInMonth,
  heatLevel,
  HEAT_FLOOR,
  inheritedTailMin,
  monthGridBounds,
  monthStart,
  monthWeeks,
  shiftMonth,
  tradingDateOf,
  type OpeningHours,
} from './monthLogic';

const BAGHDAD = 'Asia/Baghdad'; // UTC+3, no DST

/** Touch's real configuration: 09:00 → 02:00, every day. */
const TOUCH_DAY = [
  ['00:00', '02:00'],
  ['09:00', '24:00'],
] as const;
const TOUCH_HOURS = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((k) => [k, TOUCH_DAY]),
) as unknown as OpeningHours;

describe('month arithmetic', () => {
  it('finds the first of the month and its length', () => {
    expect(monthStart('2026-09-13')).toBe('2026-09-01');
    expect(daysInMonth('2026-09-13')).toBe(30);
    expect(daysInMonth('2028-02-10')).toBe(29);
  });

  it('shifts months and clamps the day to the target month', () => {
    expect(shiftMonth('2026-09-13', 1)).toBe('2026-10-13');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-15');
    expect(shiftMonth('2027-01-15', -1)).toBe('2026-12-15');
  });

  it('lays a month out as whole Sunday-first weeks', () => {
    // 1 Sep 2026 is a Tuesday; 30 Sep is a Wednesday.
    const weeks = monthWeeks('2026-09-13');
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]).toBe('2026-08-30');
    expect(weeks[0]![2]).toBe('2026-09-01');
    expect(monthGridBounds('2026-09-13')).toEqual({ first: '2026-08-30', last: '2026-10-03' });
  });
});

describe('tradingDateOf', () => {
  it('knows the previous night runs two hours past midnight', () => {
    expect(inheritedTailMin('2026-09-13', TOUCH_HOURS)).toBe(120);
    expect(inheritedTailMin('2026-09-13', {} as OpeningHours)).toBe(0);
  });

  it('puts a 01:00 booking on the night before, not the calendar day', () => {
    // 01:00 Baghdad on the 13th = 22:00 UTC on the 12th.
    expect(tradingDateOf('2026-09-12T22:00:00Z', BAGHDAD, TOUCH_HOURS)).toBe('2026-09-12');
  });

  it('keeps an evening booking on its own date even when UTC has rolled over', () => {
    // 23:30 Baghdad on the 12th = 20:30 UTC — and 02:30 Baghdad is past the tail.
    expect(tradingDateOf('2026-09-12T20:30:00Z', BAGHDAD, TOUCH_HOURS)).toBe('2026-09-12');
    expect(tradingDateOf('2026-09-12T23:30:00Z', BAGHDAD, TOUCH_HOURS)).toBe('2026-09-13');
  });

  it('counts per trading date', () => {
    const counts = countByTradingDate(
      [{ at: '2026-09-12T16:00:00Z' }, { at: '2026-09-12T22:00:00Z' }, { at: '2026-09-13T16:00:00Z' }],
      BAGHDAD,
      TOUCH_HOURS,
    );
    expect(counts.get('2026-09-12')).toBe(2);
    expect(counts.get('2026-09-13')).toBe(1);
  });
});

describe('heatLevel', () => {
  it('leaves an empty day unshaded', () => {
    expect(heatLevel(0, 30)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it('shades the busiest day fully and a light day visibly', () => {
    expect(heatLevel(30, 30)).toBe(1);
    expect(heatLevel(1, 30)).toBeGreaterThan(HEAT_FLOOR);
    // 30 bookings is far darker than 6.
    expect(heatLevel(30, 30) - heatLevel(6, 30)).toBeGreaterThan(0.6);
  });

  it('measures against the busiest day SHOWN, ignoring others', () => {
    const counts = new Map([
      ['2026-09-01', 4],
      ['2026-10-20', 90],
    ]);
    expect(busiestCount(counts, ['2026-09-01', '2026-09-02'])).toBe(4);
  });
});
