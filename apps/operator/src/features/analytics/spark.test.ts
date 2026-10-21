import { describe, expect, it } from 'vitest';
import { addSeries, daySeries, fillTrendDays } from './spark';

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
