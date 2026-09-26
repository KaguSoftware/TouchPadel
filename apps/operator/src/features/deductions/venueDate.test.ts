import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, monthLabel, monthOf, shiftMonth, venueToday, venueWallValue, wallValueToDate } from './venueDate';

// The venue's calendar and wall clock for the wave-5 people-record forms: a
// form's bounds and defaults, never the browser's zone (the venue is Baghdad,
// UTC+3 all year).

const TZ = 'Asia/Baghdad';

describe('venue calendar', () => {
  it('reads today on the venue’s calendar, not UTC’s', () => {
    // 22:30 UTC on the 25th is 01:30 on the 26th in Baghdad.
    expect(venueToday(new Date('2026-09-25T22:30:00Z'), TZ)).toBe('2026-09-26');
    expect(venueToday(new Date('2026-09-25T20:30:00Z'), TZ)).toBe('2026-09-25');
  });

  it('moves days and months across their ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-26', -60)).toBe('2026-07-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(monthOf('2026-09-17')).toBe('2026-09-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    // Anything that is not a day comes back untouched.
    expect(addDays('soon', 1)).toBe('soon');
    expect(shiftMonth('', 1)).toBe('');
  });

  it('prints a day and a month in both languages without a zone shifting them', () => {
    expect(dayLabel('2026-09-01', 'en')).toMatch(/1/);
    expect(dayLabel('2026-09-01', 'en')).toMatch(/Sep/);
    expect(monthLabel('2026-09-01', 'en')).toMatch(/September 2026/);
    expect(monthLabel('2026-09-01', 'ar')).not.toBe('2026-09-01');
    expect(dayLabel('not a day', 'en')).toBe('not a day');
  });
});

describe('venue wall clock', () => {
  it('writes now as a datetime-local value on the venue’s clock', () => {
    expect(venueWallValue(new Date('2026-09-25T22:30:00Z'), TZ)).toBe('2026-09-26T01:30');
    expect(venueWallValue(new Date('2026-09-26T09:05:00Z'), TZ)).toBe('2026-09-26T12:05');
  });

  it('reads a datetime-local value back as the instant it names at the venue', () => {
    expect(wallValueToDate('2026-09-26T01:30', TZ)?.toISOString()).toBe('2026-09-25T22:30:00.000Z');
    expect(wallValueToDate('2026-09-26T24:00', TZ)).toBeNull();
    expect(wallValueToDate('', TZ)).toBeNull();
    expect(wallValueToDate('2026-09-26', TZ)).toBeNull();
  });
});
