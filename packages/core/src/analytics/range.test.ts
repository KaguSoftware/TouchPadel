import { describe, expect, it } from 'vitest';
import { dayOfWeekOfDate } from '../time/tz';
import {
  addDays,
  businessTodayISO,
  datesInRange,
  engagementComparable,
  engagementWindow,
  isIsoDate,
  isLiveRange,
  previousRange,
  rangeLength,
  resolveCompare,
  resolveRange,
  salesCoverage,
  shiftRange,
} from './range';

const TZ = 'Asia/Baghdad';

describe('businessTodayISO', () => {
  // 22:30Z on Sat 05 Sep = 01:30 Sun 06 Sep in Baghdad.
  const lateNight = new Date('2026-09-05T22:30:00Z');

  it('follows the calendar date at start hour 0', () => {
    expect(businessTodayISO(lateNight, 0, TZ)).toBe('2026-09-06');
  });

  it('is still "yesterday" at 01:30 with a 06:00 business day', () => {
    expect(businessTodayISO(lateNight, 6, TZ)).toBe('2026-09-05');
  });

  it('rolls over exactly at the start hour', () => {
    // 06:00 Baghdad = 03:00Z
    expect(businessTodayISO(new Date('2026-09-06T02:59:00Z'), 6, TZ)).toBe('2026-09-05');
    expect(businessTodayISO(new Date('2026-09-06T03:00:00Z'), 6, TZ)).toBe('2026-09-06');
  });
});

describe('date arithmetic', () => {
  it('validates real dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026/02/01')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(() => rangeLength({ from: '2026-02-30', to: '2026-03-01' })).toThrow(RangeError);
  });

  it('counts inclusive days and lists them', () => {
    expect(rangeLength({ from: '2026-09-01', to: '2026-09-01' })).toBe(1);
    expect(rangeLength({ from: '2026-09-01', to: '2026-09-07' })).toBe(7);
    expect(rangeLength({ from: '2026-09-07', to: '2026-09-01' })).toBe(0);
    expect(datesInRange({ from: '2026-02-27', to: '2026-03-02' })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(datesInRange({ from: '2026-09-07', to: '2026-09-01' })).toEqual([]);
  });

  it('shifts across month and year boundaries', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(() => addDays('2026-01-01', 1.5)).toThrow(RangeError);
  });

  it('previousRange is the equal-length window immediately before', () => {
    expect(previousRange({ from: '2026-09-08', to: '2026-09-14' })).toEqual({ from: '2026-09-01', to: '2026-09-07' });
    expect(previousRange({ from: '2026-09-14', to: '2026-09-14' })).toEqual({ from: '2026-09-13', to: '2026-09-13' });
  });

  it('shiftRange preserves length', () => {
    const r = shiftRange({ from: '2026-09-08', to: '2026-09-14' }, 28);
    expect(r).toEqual({ from: '2026-08-11', to: '2026-08-17' });
    expect(rangeLength(r)).toBe(7);
  });
});

describe('resolveRange', () => {
  const today = '2026-09-14';

  it('defaults to the last 30 days ending on the business today', () => {
    expect(resolveRange({}, today)).toEqual({ preset: '30d', range: { from: '2026-08-16', to: today } });
    expect(resolveRange({ range: 'bogus' }, today).preset).toBe('30d');
  });

  it('handles every preset', () => {
    expect(resolveRange({ range: 'today' }, today).range).toEqual({ from: today, to: today });
    expect(resolveRange({ range: '7d' }, today).range).toEqual({ from: '2026-09-08', to: today });
    expect(resolveRange({ range: '90d' }, today).range).toEqual({ from: '2026-06-17', to: today });
    expect(rangeLength(resolveRange({ range: '90d' }, today).range)).toBe(90);
  });

  it('accepts a valid custom range and swaps a reversed one', () => {
    expect(resolveRange({ range: 'custom', from: '2026-08-01', to: '2026-08-10' }, today)).toEqual({
      preset: 'custom',
      range: { from: '2026-08-01', to: '2026-08-10' },
    });
    expect(resolveRange({ range: 'custom', from: '2026-08-10', to: '2026-08-01' }, today).range).toEqual({
      from: '2026-08-01',
      to: '2026-08-10',
    });
  });

  it('falls back to the default when a custom range is malformed', () => {
    expect(resolveRange({ range: 'custom', from: '2026-08-01' }, today).preset).toBe('30d');
    expect(resolveRange({ range: 'custom', from: '2026-02-30', to: '2026-03-01' }, today).preset).toBe('30d');
  });
});

describe('resolveCompare', () => {
  const range = { from: '2026-09-08', to: '2026-09-14' }; // Tue..Mon

  it('defaults to the previous period', () => {
    expect(resolveCompare(undefined, range)).toEqual({ basis: 'prev', range: { from: '2026-09-01', to: '2026-09-07' } });
    expect(resolveCompare('nonsense', range).basis).toBe('prev');
  });

  it('4w and 52w land on the same weekdays', () => {
    for (const cmp of ['4w', '52w'] as const) {
      const { basis, range: cmpRange } = resolveCompare(cmp, range);
      expect(basis).toBe(cmp);
      expect(rangeLength(cmpRange)).toBe(7);
      expect(dayOfWeekOfDate(cmpRange.from)).toBe(dayOfWeekOfDate(range.from));
      expect(dayOfWeekOfDate(cmpRange.to)).toBe(dayOfWeekOfDate(range.to));
    }
    expect(resolveCompare('4w', range).range).toEqual({ from: '2026-08-11', to: '2026-08-17' });
    expect(resolveCompare('52w', range).range).toEqual({ from: '2025-09-09', to: '2025-09-15' });
  });
});

describe('isLiveRange', () => {
  it('is live while the range reaches the business today', () => {
    expect(isLiveRange({ from: '2026-09-01', to: '2026-09-14' }, '2026-09-14')).toBe(true);
    expect(isLiveRange({ from: '2026-09-01', to: '2026-09-13' }, '2026-09-14')).toBe(false);
    expect(isLiveRange({ from: '2026-09-01', to: '2026-09-20' }, '2026-09-14')).toBe(true);
  });
});

describe('salesCoverage', () => {
  it('names the missing days and computes the ratio', () => {
    const c = salesCoverage({ from: '2026-09-01', to: '2026-09-10' }, ['2026-09-01', '2026-09-02', '2026-09-02', '2026-09-05']);
    expect(c.days).toBe(10);
    expect(c.daysWithData).toBe(3);
    expect(c.missing).toEqual(['2026-09-03', '2026-09-04', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
    expect(c.ratio).toBeCloseTo(0.3);
  });

  it('ignores dates outside the range', () => {
    const c = salesCoverage({ from: '2026-09-01', to: '2026-09-02' }, ['2026-08-31', '2026-09-01', '2026-09-02']);
    expect(c).toEqual({ days: 2, daysWithData: 2, missing: [], ratio: 1 });
  });
});

describe('engagementWindow', () => {
  const range = { from: '2026-09-01', to: '2026-09-10' };

  it('covers the whole range without a floor', () => {
    expect(engagementWindow(range, null)).toEqual({ from: '2026-09-01', to: '2026-09-10', days: 10, clipped: false, empty: false });
  });

  it('clips at the floor', () => {
    expect(engagementWindow(range, '2026-09-06')).toEqual({ from: '2026-09-06', to: '2026-09-10', days: 5, clipped: true, empty: false });
  });

  it('is empty when the range predates the floor', () => {
    const w = engagementWindow(range, '2026-09-11');
    expect(w.empty).toBe(true);
    expect(w.days).toBe(0);
  });

  it('only compares windows of equal tracked length', () => {
    const now = engagementWindow(range, null);
    expect(engagementComparable(now, engagementWindow(previousRange(range), null))).toBe(true);
    expect(engagementComparable(now, engagementWindow(previousRange(range), '2026-08-25'))).toBe(false);
    expect(engagementComparable(now, engagementWindow(previousRange(range), '2026-09-01'))).toBe(false);
  });
});
