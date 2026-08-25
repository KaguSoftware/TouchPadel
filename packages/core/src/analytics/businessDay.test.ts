import { describe, expect, it } from 'vitest';
import {
  BUSINESS_DAY_START_DEFAULT,
  BUSINESS_DAY_START_OPTIONS,
  businessDayOf,
  normalizeBusinessDayStart,
} from './businessDay';

const TZ = 'Asia/Baghdad';

describe('normalizeBusinessDayStart', () => {
  it('keeps whole hours 0..12', () => {
    for (const h of BUSINESS_DAY_START_OPTIONS) expect(normalizeBusinessDayStart(h)).toBe(h);
    expect(normalizeBusinessDayStart(12)).toBe(12);
    expect(normalizeBusinessDayStart('6')).toBe(6);
    expect(normalizeBusinessDayStart(6.9)).toBe(6);
  });

  it('falls back to the default on garbage', () => {
    expect(normalizeBusinessDayStart(13)).toBe(BUSINESS_DAY_START_DEFAULT);
    expect(normalizeBusinessDayStart(-1)).toBe(BUSINESS_DAY_START_DEFAULT);
    expect(normalizeBusinessDayStart('abc')).toBe(BUSINESS_DAY_START_DEFAULT);
    expect(normalizeBusinessDayStart(null)).toBe(BUSINESS_DAY_START_DEFAULT);
    expect(normalizeBusinessDayStart(undefined)).toBe(BUSINESS_DAY_START_DEFAULT);
    expect(normalizeBusinessDayStart(Number.POSITIVE_INFINITY)).toBe(BUSINESS_DAY_START_DEFAULT);
  });
});

describe('businessDayOf', () => {
  it('is the venue-local calendar date at start hour 0', () => {
    // 22:30Z Sat = 01:30 Sun in Baghdad
    expect(businessDayOf(new Date('2026-09-05T22:30:00Z'), 0, TZ)).toBe('2026-09-06');
    expect(businessDayOf(new Date('2026-09-05T20:59:00Z'), 0, TZ)).toBe('2026-09-05');
  });

  it('assigns the small hours to the previous business day', () => {
    const at0130 = new Date('2026-09-05T22:30:00Z');
    expect(businessDayOf(at0130, 6, TZ)).toBe('2026-09-05');
    expect(businessDayOf(at0130, 4, TZ)).toBe('2026-09-05');
    expect(businessDayOf(at0130, 1, TZ)).toBe('2026-09-06');
  });

  it('crosses month boundaries and tolerates a bad start hour', () => {
    // 01:00 Baghdad on 1 Oct = 22:00Z 30 Sep
    expect(businessDayOf(new Date('2026-09-30T22:00:00Z'), 6, TZ)).toBe('2026-09-30');
    expect(businessDayOf(new Date('2026-09-30T22:00:00Z'), 99, TZ)).toBe('2026-10-01');
  });
});
