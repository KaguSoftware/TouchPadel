import { describe, expect, it } from 'vitest';
import { dayOfWeekOfDate, localParts, parseHHMM, wallTimeToUtc } from './tz';

const TZ = 'Asia/Baghdad'; // UTC+3, no DST

describe('parseHHMM', () => {
  it('parses valid times', () => {
    expect(parseHHMM('00:00')).toBe(0);
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('23:59')).toBe(1439);
  });

  it("accepts '24:00' as end-of-day (the overnight window's exclusive close)", () => {
    expect(parseHHMM('24:00')).toBe(1440);
  });

  it('rejects malformed input', () => {
    expect(() => parseHHMM('24:01')).toThrow(); // 1440 is a boundary, not an hour
    expect(() => parseHHMM('24:30')).toThrow();
    expect(() => parseHHMM('25:00')).toThrow();
    expect(() => parseHHMM('9:00')).toThrow();
    expect(() => parseHHMM('09:60')).toThrow();
    expect(() => parseHHMM('0900')).toThrow();
  });

  it('24:00 maps to the next local midnight through wallTimeToUtc', () => {
    // Saturday 24:00 Baghdad IS Sunday 00:00 Baghdad = Saturday 21:00 UTC.
    expect(wallTimeToUtc('2026-09-05', parseHHMM('24:00'), TZ).toISOString()).toBe(
      '2026-09-05T21:00:00.000Z',
    );
  });
});

describe('dayOfWeekOfDate', () => {
  it('0=Sun..6=Sat', () => {
    expect(dayOfWeekOfDate('2026-09-06')).toBe(0); // Sunday
    expect(dayOfWeekOfDate('2026-09-07')).toBe(1); // Monday
    expect(dayOfWeekOfDate('2026-09-12')).toBe(6); // Saturday
  });
});

describe('localParts / wallTimeToUtc round-trip', () => {
  it('maps Baghdad wall time to UTC (-3h)', () => {
    const d = wallTimeToUtc('2026-09-07', parseHHMM('09:00'), TZ);
    expect(d.toISOString()).toBe('2026-09-07T06:00:00.000Z');
  });

  it('decomposes an instant into venue-local parts, crossing the date line', () => {
    // 22:30 UTC Saturday = 01:30 Sunday in Baghdad
    const p = localParts(new Date('2026-09-05T22:30:00Z'), TZ);
    expect(p.date).toBe('2026-09-06');
    expect(p.dayOfWeek).toBe(0);
    expect(p.minutesOfDay).toBe(90);
  });

  it('round-trips arbitrary wall times', () => {
    for (const [date, hhmm] of [
      ['2026-01-01', '00:00'],
      ['2026-06-15', '13:45'],
      ['2026-12-31', '23:59'],
    ] as const) {
      const instant = wallTimeToUtc(date, parseHHMM(hhmm), TZ);
      const p = localParts(instant, TZ);
      expect(p.date).toBe(date);
      expect(p.minutesOfDay).toBe(parseHHMM(hhmm));
    }
  });

  it('validates inputs', () => {
    expect(() => wallTimeToUtc('2026/09/07', 0, TZ)).toThrow();
    expect(() => wallTimeToUtc('2026-09-07', -1, TZ)).toThrow();
    expect(() => wallTimeToUtc('2026-09-07', 30.5, TZ)).toThrow();
  });
});

/**
 * `localParts` memoises by (zone, exact instant) so the availability grid stops
 * paying for ~600 ICU calls per trading night (see tz.ts). These pin the two
 * ways a cache like that goes wrong: keyed too loosely, or stale across a
 * transition.
 */
describe('localParts memoisation', () => {
  it('keeps zones apart for the same instant', () => {
    const instant = new Date('2026-09-05T22:30:00Z');
    expect(localParts(instant, TZ).minutesOfDay).toBe(90); // 01:30 Baghdad
    expect(localParts(instant, 'UTC').minutesOfDay).toBe(22 * 60 + 30);
    expect(localParts(instant, TZ).minutesOfDay).toBe(90); // still Baghdad's answer
  });

  it('returns an equal decomposition on the second ask', () => {
    const instant = new Date('2026-06-15T10:45:00Z');
    expect(localParts(instant, TZ)).toEqual(localParts(instant, TZ));
  });

  it('follows a DST transition instant by instant', () => {
    const NY = 'America/New_York';
    // 2026-03-08: 02:00 EST -> 03:00 EDT. Either side of 07:00 UTC.
    const before = localParts(new Date('2026-03-08T06:59:00Z'), NY);
    const after = localParts(new Date('2026-03-08T07:01:00Z'), NY);
    expect(before.minutesOfDay).toBe(1 * 60 + 59); // 01:59 EST
    expect(after.minutesOfDay).toBe(3 * 60 + 1); // 03:01 EDT
  });

  it('stays correct once the cache has evicted (bounded at 512)', () => {
    const first = new Date('2026-04-01T00:00:00Z');
    const seen = localParts(first, TZ);
    for (let i = 1; i <= 600; i++) {
      localParts(new Date(first.getTime() + i * 60_000), TZ);
    }
    expect(localParts(first, TZ)).toEqual(seen);
  });
});
