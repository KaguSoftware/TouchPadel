import { describe, expect, it } from 'vitest';
import {
  buildCourtsBasis,
  describeCourtsBasis,
  isThinCourtsPeriod,
  MIN_ATTACH_BOOKINGS,
  MIN_CELL_OPEN_DAYS,
  MIN_IDENTITIES,
  MIN_PLAYERS_KNOWN_SHARE,
  MIN_RATE_DENOM,
  rateOrCount,
  thinCourtWeekdays,
  toFindingBasis,
} from './courtsBasis';
import { dropLowConfidenceClaims, MIN_WEEKDAY_DAYS, THIN_PERIOD_DAYS } from './insightsText';

const RANGE = { from: '2026-09-01', to: '2026-09-30' };

describe('buildCourtsBasis', () => {
  it('counts weekday occurrences among distinct booking dates', () => {
    const basis = buildCourtsBasis({
      range: RANGE,
      // Fridays: 09-04, 09-11, 09-18, 09-25; Sunday 09-06 twice (deduped)
      bookingDates: ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-09-06', '2026-09-06'],
      bookings: 212,
      bookedTotal: 240,
      identities: 48,
      linkedBookings: 90,
    });
    expect(basis.rangeDays).toBe(30);
    expect(basis.bookingDays).toBe(5);
    expect(basis.weekdayCounts.map((w) => w.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(basis.weekdayCounts[5]).toEqual({ day: 5, days: 4 });
    expect(basis.weekdayCounts[0]).toEqual({ day: 0, days: 1 });
    expect(basis).toMatchObject({ bookings: 212, bookedTotal: 240, identities: 48, linkedBookings: 90 });
  });

  it('flags thin periods and thin weekdays with the shared thresholds', () => {
    const thin = buildCourtsBasis({
      range: RANGE,
      bookingDates: ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'],
      bookings: 0,
      bookedTotal: 0,
      identities: 0,
      linkedBookings: 0,
    });
    expect(thin.bookingDays).toBeLessThan(THIN_PERIOD_DAYS);
    expect(isThinCourtsPeriod(thin)).toBe(true);
    // Friday has 4 (= MIN_WEEKDAY_DAYS) occurrences; every other weekday has 0.
    expect(MIN_WEEKDAY_DAYS).toBe(4);
    expect(thinCourtWeekdays(thin)).toEqual([0, 1, 2, 3, 4, 6]);

    const full = buildCourtsBasis({
      range: RANGE,
      bookingDates: Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
      bookings: 1,
      bookedTotal: 1,
      identities: 1,
      linkedBookings: 0,
    });
    expect(isThinCourtsPeriod(full)).toBe(false);
    expect(thinCourtWeekdays(full)).toEqual([]);
  });
});

describe('toFindingBasis', () => {
  it('maps bookingDays onto salesDays so the shared confidence gate runs unchanged', () => {
    const basis = buildCourtsBasis({
      range: RANGE,
      bookingDates: ['2026-09-04', '2026-09-11'],
      bookings: 3,
      bookedTotal: 3,
      identities: 2,
      linkedBookings: 0,
    });
    const fb = toFindingBasis(basis);
    expect(fb).toEqual({ salesDays: 2, weekdayCounts: basis.weekdayCounts });
    // Two Fridays cannot carry a Friday claim; a plain count survives.
    const { kept, dropped } = dropLowConfidenceClaims(
      ['Friday evenings are the busiest.', 'Court 1 took 40 bookings.'],
      fb,
      { en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] },
    );
    expect(kept).toEqual(['Court 1 took 40 bookings.']);
    expect(dropped).toEqual(['Friday evenings are the busiest.']);
  });
});

describe('rateOrCount', () => {
  it('hides the percentage under the denominator floor and on zero', () => {
    expect(MIN_RATE_DENOM).toBe(20);
    expect(rateOrCount(3, 0)).toEqual({ pct: null, n: 3, d: 0 });
    expect(rateOrCount(3, 19)).toEqual({ pct: null, n: 3, d: 19 });
    expect(rateOrCount(3, 20)).toEqual({ pct: 15, n: 3, d: 20 });
    expect(rateOrCount(1, 30)).toEqual({ pct: 3.3, n: 1, d: 30 });
  });
});

describe('floors and describe', () => {
  it('exports the plan floors', () => {
    expect([MIN_CELL_OPEN_DAYS, MIN_IDENTITIES, MIN_ATTACH_BOOKINGS, MIN_PLAYERS_KNOWN_SHARE]).toEqual([4, 15, 10, 0.5]);
  });

  it('describes the sample in one line, dropping zero parts', () => {
    const basis = buildCourtsBasis({
      range: RANGE,
      bookingDates: ['2026-09-04'],
      bookings: 1200,
      bookedTotal: 1300,
      identities: 0,
      linkedBookings: 0,
    });
    expect(describeCourtsBasis(basis)).toBe('1/30 days with bookings · 1,200 bookings');
  });
});
