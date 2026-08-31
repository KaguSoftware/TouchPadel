import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDayNumber,
  formatIQD,
  formatMonthShort,
  formatNumber,
  formatTime,
  formatTimeRange,
  formatWeekdayShort,
} from '../formatting';

describe('formatIQD', () => {
  it('formats integer IQD with grouping and no decimals (en)', () => {
    const out = formatIQD(15000, 'en');
    expect(out).toContain('15,000');
    expect(out).toMatch(/IQD|د\.ع/);
    expect(out).not.toContain('.00');
  });

  it('uses Western digits in Arabic (nu-latn)', () => {
    const out = formatIQD(1234567, 'ar');
    expect(out).toContain('1');
    // no Eastern Arabic-Indic digits
    expect(out).not.toMatch(/[٠-٩]/);
  });

  it('throws on non-integer amounts — money is integer IQD, never floats', () => {
    expect(() => formatIQD(10.5, 'en')).toThrow(TypeError);
    expect(() => formatIQD(0.1 + 0.2, 'ar')).toThrow(TypeError);
  });

  it('formats zero', () => {
    expect(formatIQD(0, 'en')).toContain('0');
  });

  // House style: the unit trails the amount in BOTH languages. CLDR already
  // does that for Arabic but would print "IQD 15,000" in English.
  it('puts the currency after the amount', () => {
    expect(formatIQD(15000, 'en')).toBe('15,000 IQD');
    expect(formatIQD(15000, 'ar')).toMatch(/15,000\s*د\.ع/);
  });
});

describe('formatDate / formatTime', () => {
  // 2026-08-24T18:30:00Z = 21:30 in Asia/Baghdad (UTC+3)
  const d = new Date('2026-08-24T18:30:00Z');

  it('renders in Asia/Baghdad by default', () => {
    expect(formatTime(d, 'en')).toMatch(/9:30|21:30/);
    expect(formatDate(d, 'en')).toContain('24');
    expect(formatDate(d, 'en')).toContain('2026');
  });

  it('Arabic dates use Latin digits', () => {
    const out = formatDate(d, 'ar');
    expect(out).toContain('24');
    expect(out).not.toMatch(/[٠-٩]/);
  });

  it('respects an explicit timezone', () => {
    expect(formatTime(d, 'en', 'UTC')).toMatch(/6:30|18:30/);
  });
});

describe('formatNumber', () => {
  it('groups and keeps Latin digits in both locales', () => {
    expect(formatNumber(1000000, 'en')).toContain('1');
    expect(formatNumber(1000000, 'ar')).not.toMatch(/[٠-٩]/);
  });
});

describe('day-strip / badge / range formatters', () => {
  // 2026-09-01T07:00:00Z = 10:00 Tuesday in Asia/Baghdad
  const d = new Date('2026-09-01T07:00:00Z');
  const e = new Date('2026-09-01T08:00:00Z');

  it('pin the venue timezone and Latin digits in both locales', () => {
    expect(formatWeekdayShort(d, 'en')).toMatch(/Tue/);
    expect(formatDayNumber(d, 'en')).toBe('1');
    expect(formatDayNumber(d, 'ar')).toBe('1');
    expect(formatMonthShort(d, 'en')).toMatch(/Sep/);
    expect(formatWeekdayShort(d, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('formatDateTime carries date and time together', () => {
    const out = formatDateTime(d, 'en');
    expect(out).toContain('2026');
    expect(out).toMatch(/10:00/);
  });

  it('formatTimeRange isolates the Latin run for bidi', () => {
    const out = formatTimeRange(d, e, 'ar');
    expect(out.startsWith('⁨')).toBe(true);
    expect(out.endsWith('⁩')).toBe(true);
    expect(out).toContain('–');
  });
});
