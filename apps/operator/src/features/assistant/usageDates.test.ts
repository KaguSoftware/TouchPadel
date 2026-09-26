import { describe, expect, it } from 'vitest';
import { currentYm, monthBounds, monthSoFar, venueDate } from './usageDates';

const TZ = 'Asia/Baghdad';

describe('usage dates in venue time', () => {
  it('rolls into the new month at local midnight, not UTC midnight', () => {
    const now = new Date('2026-09-30T22:30:00Z'); // 01:30 on 1 Oct in Baghdad
    expect(venueDate(TZ, now)).toBe('2026-10-01');
    expect(currentYm(TZ, now)).toEqual({ y: 2026, m: 9 });
    expect(monthSoFar(TZ, now)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });

  it('is still the old month before local midnight', () => {
    const now = new Date('2026-09-30T20:30:00Z'); // 23:30 on 30 Sep in Baghdad
    expect(currentYm(TZ, now)).toEqual({ y: 2026, m: 8 });
    expect(monthSoFar(TZ, now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('rolls the year over on New Year local time', () => {
    const now = new Date('2026-12-31T21:15:00Z');
    expect(currentYm(TZ, now)).toEqual({ y: 2027, m: 0 });
  });

  it('bounds a calendar month, February included', () => {
    expect(monthBounds(2026, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthBounds(2028, 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthBounds(2026, 11)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
