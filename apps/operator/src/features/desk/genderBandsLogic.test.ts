import { describe, expect, it } from 'vitest';
import { wallTimeToUtc, type GenderRuleLike } from '@touch/core';
import { genderBands } from './genderBandsLogic';

const TZ = 'Asia/Baghdad';
// 2026-10-23 is a Friday (5).
const DATE = '2026-10-23';
const grid = (openMin: number, closeMin: number) => [wallTimeToUtc(DATE, openMin, TZ), wallTimeToUtc(DATE, closeMin, TZ)] as const;

function rule(over: Partial<GenderRuleLike> & { id: string }): GenderRuleLike {
  return {
    gender: 'female',
    court_id: null,
    days_of_week: [5],
    start_time: '09:00:00',
    end_time: '12:00:00',
    valid_from: null,
    valid_to: null,
    is_active: true,
    ...over,
  };
}

describe('genderBands', () => {
  const [start, end] = grid(8 * 60, 26 * 60); // 08:00 to 02:00 next day

  it('draws nothing without rules, for an off rule, or on another weekday', () => {
    expect(genderBands([], 'c1', DATE, start, end, TZ)).toEqual([]);
    expect(genderBands([rule({ id: 'r', is_active: false })], 'c1', DATE, start, end, TZ)).toEqual([]);
    expect(genderBands([rule({ id: 'r', days_of_week: [4] })], 'c1', DATE, start, end, TZ)).toEqual([]);
  });

  it('places a same-day window in minutes from the grid start', () => {
    expect(genderBands([rule({ id: 'r' })], 'c1', DATE, start, end, TZ)).toEqual([{ fromMin: 60, minutes: 180, kept: 'female' }]);
  });

  it('keeps every court for an every-court rule, and only its court for a court rule', () => {
    const courtRule = rule({ id: 'r', court_id: 'c2', gender: 'male' });
    expect(genderBands([courtRule], 'c1', DATE, start, end, TZ)).toEqual([]);
    expect(genderBands([courtRule], 'c2', DATE, start, end, TZ)).toEqual([{ fromMin: 60, minutes: 180, kept: 'male' }]);
  });

  it('runs an overnight window past midnight on the night it starts', () => {
    const night = rule({ id: 'r', start_time: '22:00', end_time: '02:00' });
    expect(genderBands([night], 'c1', DATE, start, end, TZ)).toEqual([{ fromMin: 14 * 60, minutes: 240, kept: 'female' }]);
  });

  it("shows the previous night's tail at the top of a grid that opens before it ends", () => {
    // Thursday 22:00–10:00 keeps Friday until 10:00.
    const thursday = rule({ id: 'r', days_of_week: [4], start_time: '22:00', end_time: '10:00' });
    expect(genderBands([thursday], 'c1', DATE, start, end, TZ)).toEqual([{ fromMin: 0, minutes: 120, kept: 'female' }]);
  });

  it('merges touching windows of one gender and marks a clash as both', () => {
    const a = rule({ id: 'a', start_time: '09:00', end_time: '11:00' });
    const b = rule({ id: 'b', start_time: '11:00', end_time: '13:00' });
    expect(genderBands([a, b], 'c1', DATE, start, end, TZ)).toEqual([{ fromMin: 60, minutes: 240, kept: 'female' }]);

    const men = rule({ id: 'm', gender: 'male', start_time: '10:00', end_time: '14:00' });
    expect(genderBands([a, men], 'c1', DATE, start, end, TZ)).toEqual([
      { fromMin: 60, minutes: 60, kept: 'female' },
      { fromMin: 120, minutes: 60, kept: 'both' },
      { fromMin: 180, minutes: 180, kept: 'male' },
    ]);
  });

  it('clips a window to the grid and honours the valid dates', () => {
    const early = rule({ id: 'r', start_time: '06:00', end_time: '09:30' });
    expect(genderBands([early], 'c1', DATE, start, end, TZ)).toEqual([{ fromMin: 0, minutes: 90, kept: 'female' }]);
    expect(genderBands([rule({ id: 'r', valid_from: '2026-10-24' })], 'c1', DATE, start, end, TZ)).toEqual([]);
    expect(genderBands([rule({ id: 'r', valid_to: '2026-10-23' })], 'c1', DATE, start, end, TZ)).toHaveLength(1);
  });
});
