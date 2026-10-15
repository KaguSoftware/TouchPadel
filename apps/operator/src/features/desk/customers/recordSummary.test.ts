import { describe, expect, it } from 'vitest';
import { cafeSpark, initials, keptShare, lastOrderAt, nextBooking, tierColour, untilStart } from './recordSummary';
import type { CustomerReservationRow } from '../deskTypes';

describe('keptShare', () => {
  it('measures bookings only: open-match seat no-shows are taken out of the no-shows', () => {
    expect(keptShare({ bookings: 4, cancellations: 0, noShows: 3, matchNoShows: 1 })).toEqual({ kept: 4, cancelled: 0, noShows: 2, pct: 67 });
  });

  it('counts cancellations against the share', () => {
    expect(keptShare({ bookings: 42, cancellations: 3, noShows: 2 })).toEqual({ kept: 42, cancelled: 3, noShows: 2, pct: 89 });
  });

  it('is null with nothing to measure, including a customer whose only no-shows were match seats', () => {
    expect(keptShare({ bookings: 0, cancellations: 0, noShows: 0 })).toBeNull();
    expect(keptShare({ bookings: 0, cancellations: 0, noShows: 2, matchNoShows: 2 })).toBeNull();
  });
});

describe('nextBooking', () => {
  const row = (id: string, start_at: string): CustomerReservationRow => ({ id, court_id: 'k1', start_at, end_at: start_at, status: 'confirmed', kind: 'booking', price_iqd: 0 });

  it('takes the soonest, whatever the order', () => {
    expect(nextBooking([row('b', '2026-10-20T15:00:00Z'), row('a', '2026-10-15T15:00:00Z')])?.id).toBe('a');
  });

  it('is null with nothing upcoming', () => {
    expect(nextBooking([])).toBeNull();
  });
});

describe('initials', () => {
  it('first and last word', () => {
    expect(initials('Yousif Al-Rawi')).toBe('YA');
    expect(initials('  sara  ')).toBe('S');
    expect(initials('سارة كريم')).toBe('سك');
    expect(initials('')).toBe('?');
  });
});

describe('untilStart', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('reads in the largest sensible unit', () => {
    expect(untilStart('2026-10-14T15:20:00Z', now)).toEqual({ unit: 'hours', hours: 3, minutes: 20 });
    expect(untilStart('2026-10-14T12:25:00Z', now)).toEqual({ unit: 'minutes', minutes: 25 });
    expect(untilStart('2026-10-16T15:00:00Z', now)).toEqual({ unit: 'days', days: 2, hours: 3 });
  });
  it('a booking already under way reads as now', () => {
    expect(untilStart('2026-10-14T11:30:00Z', now)).toEqual({ unit: 'now' });
  });
});

describe('cafe card', () => {
  const o = (opened_at: string, total_iqd: number | null) => ({ opened_at, total_iqd });
  it('spark: the newest orders, oldest first, a missing total as 0', () => {
    expect(cafeSpark([o('2026-10-03', 5), o('2026-10-01', 1), o('2026-10-02', null)], 2)).toEqual([0, 5]);
  });
  it('last order', () => {
    expect(lastOrderAt([o('2026-10-01', 1), o('2026-10-03', 1)])).toBe('2026-10-03');
    expect(lastOrderAt([])).toBeNull();
  });
});

describe('tierColour', () => {
  it('reads the metal from the tier name; any other tier is the brand green (null)', () => {
    expect(tierColour('Gold')).toBe('gold');
    expect(tierColour('Silver club')).toBe('silver');
    expect(tierColour('PLATINUM')).toBe('platinum');
    expect(tierColour('Bronze')).toBe('bronze');
    expect(tierColour('Member')).toBeNull();
    expect(tierColour(null)).toBeNull();
  });
});
