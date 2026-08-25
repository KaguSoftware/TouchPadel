import { describe, expect, it } from 'vitest';
import {
  buildDataBasis,
  describeBasis,
  isThinPeriod,
  MIN_TREND_DAYS,
  MIN_WEEKDAY_DAYS,
  THIN_PERIOD_DAYS,
  thinWeekdays,
} from './confidence';
import * as insightsText from './insightsText';

describe('buildDataBasis', () => {
  it('counts weekday occurrences among distinct sales dates', () => {
    const basis = buildDataBasis({
      range: { from: '2026-09-01', to: '2026-09-30' },
      // Fridays: 09-04, 09-11, 09-18, 09-25; Sunday 09-06 twice (deduped)
      salesDates: ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-09-06', '2026-09-06'],
      sessions: 412,
      engagementDays: 20,
      itemsWithSales: 38,
    });
    expect(basis.rangeDays).toBe(30);
    expect(basis.salesDays).toBe(5);
    expect(basis.weekdayCounts).toHaveLength(7);
    expect(basis.weekdayCounts.map((w) => w.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(basis.weekdayCounts[5]).toEqual({ day: 5, days: 4 });
    expect(basis.weekdayCounts[0]).toEqual({ day: 0, days: 1 });
    expect(basis.sessions).toBe(412);
    expect(basis.itemsWithSales).toBe(38);
  });

  it('flags thin periods and thin weekdays', () => {
    const basis = buildDataBasis({
      range: { from: '2026-09-01', to: '2026-09-30' },
      salesDates: ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'],
      sessions: 0,
      engagementDays: 0,
      itemsWithSales: 0,
    });
    expect(isThinPeriod(basis)).toBe(true);
    // Friday (5) has 4 occurrences = MIN_WEEKDAY_DAYS; every other day is thin.
    expect(thinWeekdays(basis)).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it('shares its constants with insightsText (the edge function copy)', () => {
    expect(MIN_WEEKDAY_DAYS).toBe(insightsText.MIN_WEEKDAY_DAYS);
    expect(MIN_TREND_DAYS).toBe(insightsText.MIN_TREND_DAYS);
    expect(THIN_PERIOD_DAYS).toBe(insightsText.THIN_PERIOD_DAYS);
    expect(MIN_WEEKDAY_DAYS).toBe(4);
    expect(MIN_TREND_DAYS).toBe(7);
    expect(THIN_PERIOD_DAYS).toBe(10);
  });
});

describe('describeBasis', () => {
  it('prints the sample, omitting zero parts', () => {
    const full = buildDataBasis({
      range: { from: '2026-09-01', to: '2026-09-30' },
      salesDates: Array.from({ length: 16 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
      sessions: 1412,
      engagementDays: 16,
      itemsWithSales: 38,
    });
    expect(describeBasis(full)).toBe('16/30 days with sales · 1,412 sessions · 38 items');
    expect(describeBasis({ ...full, sessions: 0, itemsWithSales: 0 })).toBe('16/30 days with sales');
  });
});
