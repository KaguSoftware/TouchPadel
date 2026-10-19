import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  addMonths,
  monthCells,
  monthTouches,
  openRangeText,
  orderedRange,
  rangeText,
  stepDay,
  yearPage,
} from './dateRangeLogic';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const name = (m: number) => MON[m] ?? '';
// The field joins day, month and year with no-break spaces; compare on plain ones.
const plain = (s: string) => s.replace(/ /g, ' ');

describe('rangeText', () => {
  it('leaves the year off inside the current year, across months too', () => {
    expect(plain(rangeText({ from: '2026-09-20', to: '2026-10-19' }, 2026, name))).toBe('20 Sep – 19 Oct');
  });

  it('shows one date for a single day', () => {
    expect(plain(rangeText({ from: '2026-10-19', to: '2026-10-19' }, 2026, name))).toBe('19 Oct');
    expect(plain(rangeText({ from: '2025-03-01', to: '2025-03-01' }, 2026, name))).toBe('1 Mar 2025');
  });

  // Sait, 2026-10-19: "1 Jan 2025 – 19 Oct" read as if both ends were this year.
  it('names both years when the range crosses into another year', () => {
    expect(plain(rangeText({ from: '2025-01-01', to: '2026-10-19' }, 2026, name))).toBe('1 Jan 2025 – 19 Oct 2026');
  });

  it('shows the year on both ends of a range in a past year', () => {
    expect(plain(rangeText({ from: '2025-03-01', to: '2025-03-31' }, 2026, name))).toBe('1 Mar 2025 – 31 Mar 2025');
  });

  it('writes the half-picked range with an open end', () => {
    expect(plain(openRangeText('2026-09-20', 2026, name))).toBe('20 Sep – …');
  });
});

describe('calendar arithmetic', () => {
  it('puts the 1st under its weekday, Sunday first', () => {
    // 1 Oct 2026 is a Thursday: four blanks (Su Mo Tu We) before it.
    const cells = monthCells({ year: 2026, month: 9 });
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
    expect(cells.at(-1)).toBe('2026-10-31');
  });

  it('knows leap years', () => {
    expect(monthCells({ year: 2028, month: 1 }).at(-1)).toBe('2028-02-29');
  });

  it('rolls months and days across years', () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('orders the two ends whichever is picked first', () => {
    expect(orderedRange('2026-10-15', '2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-15' });
  });

  it('says which months a range touches', () => {
    const r = { from: '2026-09-20', to: '2026-10-19' };
    expect(monthTouches({ year: 2026, month: 8 }, r)).toBe(true);
    expect(monthTouches({ year: 2026, month: 10 }, r)).toBe(false);
  });

  it('pages years without passing the last pickable one', () => {
    expect(yearPage(2026, 2026)).toEqual([2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(yearPage(2010).at(-1)).toBe(2015);
  });

  it('moves the keyboard day with the reading direction', () => {
    expect(stepDay('2026-10-19', 'ArrowRight', false)).toBe('2026-10-20');
    expect(stepDay('2026-10-19', 'ArrowRight', true)).toBe('2026-10-18');
    expect(stepDay('2026-10-19', 'ArrowUp', false)).toBe('2026-10-12');
    expect(stepDay('2026-10-19', 'Enter', false)).toBeNull();
  });
});
