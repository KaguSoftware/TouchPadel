import { describe, expect, it } from 'vitest';
import { presetPeriod } from './kit';

describe('presetPeriod', () => {
  const wed = new Date(2026, 8, 2, 15, 30); // Wed 2 Sep 2026, local
  it('today / yesterday are single days', () => {
    expect(presetPeriod('today', wed)).toEqual({ from: '2026-09-02', to: '2026-09-02' });
    expect(presetPeriod('yesterday', wed)).toEqual({ from: '2026-09-01', to: '2026-09-01' });
  });
  it('weeks start on Sunday and last week is a full seven days', () => {
    expect(presetPeriod('thisWeek', wed)).toEqual({ from: '2026-08-30', to: '2026-09-02' });
    expect(presetPeriod('lastWeek', wed)).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });
  it('months and the trailing thirty days', () => {
    expect(presetPeriod('thisMonth', wed)).toEqual({ from: '2026-09-01', to: '2026-09-02' });
    expect(presetPeriod('lastMonth', wed)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(presetPeriod('last30', wed)).toEqual({ from: '2026-08-04', to: '2026-09-02' });
  });
});
