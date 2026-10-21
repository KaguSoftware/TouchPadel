import { describe, expect, it } from 'vitest';
import { addSeries, dayLabeler, daySeries, fillTrendDays, monthSeries } from './spark';

const id = (s: string) => s;
const fmt = (n: number) => String(n);

describe('daySeries', () => {
  it('fills the days without a row with 0 and sums repeated days', () => {
    const s = daySeries(
      { from: '2026-10-01', to: '2026-10-04' },
      [
        { date: '2026-10-01', n: 2 },
        { date: '2026-10-03', n: 1 },
        { date: '2026-10-03', n: 4 },
      ],
      (r) => r.n,
      id,
      fmt,
    );
    expect(s?.values).toEqual([2, 0, 5, 0]);
    expect(s?.labels).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('draws no line for one day, or before the rows arrive', () => {
    expect(daySeries({ from: '2026-10-01', to: '2026-10-01' }, [], () => 0, id, fmt)).toBeNull();
    expect(daySeries({ from: '2026-10-01', to: '2026-10-09' }, null, () => 0, id, fmt)).toBeNull();
    expect(daySeries({ from: '', to: '' }, [], () => 0, id, fmt)).toBeNull();
  });
});

describe('monthSeries', () => {
  const label = { month: (iso: string) => `M ${iso}`, days: (from: string, to: string) => `${from}..${to}` };

  it('sums each month and adds its report figure; a month the range cuts is named by its days', () => {
    const s = monthSeries(
      { from: '2026-07-24', to: '2026-10-21' },
      [
        { date: '2026-07-25', n: 2 },
        { date: '2026-09-30', n: 1 },
        { date: '2026-10-01', n: 4 },
        { date: '2026-10-21', n: 1 },
        { date: '2026-10-22', n: 100 }, // past the range
      ],
      (r) => r.n,
      new Map([
        ['2026-08', 203],
        ['2026-09', 242],
      ]),
      label,
      fmt,
    );
    expect(s?.values).toEqual([2, 203, 243, 5]);
    expect(s?.byMonth).toBe(true);
    expect(s?.labels).toEqual(['2026-07-24..2026-07-31', 'M 2026-08-01', 'M 2026-09-01', '2026-10-01..2026-10-21']);
  });

  it('crosses a year, and draws no line for a single month', () => {
    const s = monthSeries({ from: '2025-12-01', to: '2026-01-31' }, [], () => 0, new Map([['2026-01', 7]]), label, fmt);
    expect(s?.values).toEqual([0, 7]);
    expect(s?.labels).toEqual(['M 2025-12-01', 'M 2026-01-01']);
    expect(monthSeries({ from: '2026-08-01', to: '2026-08-31' }, [], () => 0, new Map([['2026-08', 5]]), label, fmt)).toBeNull();
    expect(monthSeries({ from: '2026-08-01', to: '2026-10-31' }, null, () => 0, new Map(), label, fmt)).toBeNull();
  });
});

describe('dayLabeler', () => {
  const date = (iso: string, withYear?: boolean) => (withYear ? `${iso.slice(5)} ${iso.slice(0, 4)}` : iso.slice(5));

  it('adds the year only once the period crosses into another year', () => {
    expect(dayLabeler({ from: '2026-03-01', to: '2026-06-23' }, date)('2026-03-01')).toBe('03-01');
    const across = dayLabeler({ from: '2025-10-21', to: '2026-10-21' }, date);
    expect(across('2025-10-21')).not.toBe(across('2026-10-21'));
  });
});

describe('addSeries', () => {
  it('adds two series of the same days, and keeps the one there is', () => {
    const a = { values: [1, 2], labels: ['a', 'b'], format: fmt };
    const b = { values: [10, 20], labels: ['a', 'b'], format: fmt };
    expect(addSeries(a, b)?.values).toEqual([11, 22]);
    expect(addSeries(null, b)).toBe(b);
    expect(addSeries(a, null)).toBe(a);
  });
});

describe('fillTrendDays', () => {
  it('puts every day of the period in order, a day without a row as the empty one', () => {
    const rows = [
      { date: '2026-10-03', v: 3 as number | null },
      { date: '2026-10-01', v: 1 as number | null },
    ];
    const out = fillTrendDays({ from: '2026-10-01', to: '2026-10-04' }, rows, (date) => ({ date, v: null }));
    expect(out.map((r) => r.v)).toEqual([1, null, 3, null]);
  });

  it('leaves the rows alone when the range is not two dates', () => {
    const rows = [{ date: '2026-10-03', v: 3 }];
    expect(fillTrendDays({ from: '', to: '' }, rows, (date) => ({ date, v: 0 }))).toEqual(rows);
  });
});
