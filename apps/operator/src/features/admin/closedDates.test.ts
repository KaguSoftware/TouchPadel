import { describe, it, expect } from 'vitest';
import {
  addClosedDate,
  addedClosedDates,
  closedDayActions,
  closedDayBlock,
  readClosedDayBookings,
  isIsoDate,
  normalizeClosedDates,
  removeClosedDate,
  sameClosedDates,
  splitClosedDates,
} from './closedDates';

// SOW L319: "Opening hours and closed days". The column has existed since 0006,
// `assert_bookable` refuses bookings on those days and the desk calendar greys
// them out — but nothing could WRITE the list, so closing the venue for Eid
// meant a SQL statement.

describe('isIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isIsoDate('2026-09-16')).toBe(true);
  });

  it('rejects a date that does not exist', () => {
    // `new Date('2026-02-31')` silently becomes 3 March; the round-trip check
    // is what catches it.
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    for (const v of ['', '2026-9-16', '16/09/2026', '2026-09-16T00:00:00Z', 'tomorrow']) {
      expect(isIsoDate(v), v).toBe(false);
    }
  });
});

describe('normalizeClosedDates', () => {
  it('sorts, de-duplicates and drops junk', () => {
    expect(normalizeClosedDates(['2026-12-25', '2026-01-01', '2026-12-25', 'nope'])).toEqual([
      '2026-01-01',
      '2026-12-25',
    ]);
  });

  it('handles an empty list', () => {
    expect(normalizeClosedDates([])).toEqual([]);
  });
});

describe('addClosedDate / removeClosedDate', () => {
  it('adds in order', () => {
    expect(addClosedDate(['2026-12-25'], '2026-06-01')).toEqual(['2026-06-01', '2026-12-25']);
  });

  it('adding the same day twice changes nothing', () => {
    expect(addClosedDate(['2026-12-25'], '2026-12-25')).toEqual(['2026-12-25']);
  });

  it('ignores an invalid date rather than corrupting the list', () => {
    // The column is `date[]`; one bad element makes the whole write fail.
    expect(addClosedDate(['2026-12-25'], '2026-02-31')).toEqual(['2026-12-25']);
  });

  it('removes a day', () => {
    expect(removeClosedDate(['2026-06-01', '2026-12-25'], '2026-06-01')).toEqual(['2026-12-25']);
  });

  it('removing an absent day is a no-op', () => {
    expect(removeClosedDate(['2026-12-25'], '2026-01-01')).toEqual(['2026-12-25']);
  });

  it('can empty the list, which is how a venue reopens', () => {
    // Distinct from null: app.set_opening_hours COALESCEs null to "unchanged",
    // so clearing has to send an empty array.
    expect(removeClosedDate(['2026-12-25'], '2026-12-25')).toEqual([]);
  });
});

describe('splitClosedDates', () => {
  it('separates what is still ahead from what has passed', () => {
    const { upcoming, past } = splitClosedDates(
      ['2026-01-01', '2026-08-28', '2026-12-25'],
      '2026-08-28',
    );
    // Today counts as upcoming: the venue is closed today, and that is the most
    // operationally relevant row on the screen.
    expect(upcoming).toEqual(['2026-08-28', '2026-12-25']);
    expect(past).toEqual(['2026-01-01']);
  });

  it('keeps past closures rather than pruning them', () => {
    // closed_dates is also the record of why a day has no takings; dropping
    // last Eid would make the day-close history unexplainable.
    const { past } = splitClosedDates(['2020-01-01'], '2026-08-28');
    expect(past).toEqual(['2020-01-01']);
  });
});

describe('sameClosedDates', () => {
  it('ignores order and duplicates', () => {
    expect(sameClosedDates(['2026-12-25', '2026-01-01'], ['2026-01-01', '2026-12-25'])).toBe(true);
    expect(sameClosedDates(['2026-12-25', '2026-12-25'], ['2026-12-25'])).toBe(true);
  });

  it('sees a real difference', () => {
    expect(sameClosedDates(['2026-12-25'], ['2026-12-26'])).toBe(false);
    expect(sameClosedDates(['2026-12-25'], [])).toBe(false);
  });
});

describe('0390 (F-51): bookings on a newly closed day', () => {
  it('checks only the dates the draft adds', () => {
    expect(addedClosedDates(['2031-03-05', '2031-03-04', 'x'], ['2031-03-05'])).toEqual(['2031-03-04']);
    expect(addedClosedDates([], ['2031-03-05'])).toEqual([]);
    expect(addedClosedDates(['2031-03-05'], ['2031-03-05'])).toEqual([]);
  });

  it('blocks Save while the list loads, fails or holds a booking; never with no new date', () => {
    const none = { loading: false, error: false, count: 0 };
    expect(closedDayBlock([], { ...none, count: 3 })).toBeNull();
    expect(closedDayBlock(['2031-03-04'], { ...none, loading: true })).toBe('checking');
    expect(closedDayBlock(['2031-03-04'], { ...none, error: true })).toBe('error');
    expect(closedDayBlock(['2031-03-04'], { ...none, count: 2 })).toBe('bookings');
    expect(closedDayBlock(['2031-03-04'], none)).toBeNull();
  });

  it('reads the server rows and skips malformed ones', () => {
    const rows = readClosedDayBookings({
      bookings: [
        { id: 'b1', day: '2031-03-04', court_name_en: 'Court 1', court_name_ar: 'ملعب 1', start_at: '2031-03-04T09:00:00Z', end_at: '2031-03-04T10:30:00Z', status: 'confirmed', guest_name: ' ', remaining_iqd: 30000, started: false },
        { id: 'b2' },
        null,
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'b1', guestName: null, remainingIqd: 30000, started: false });
    expect(readClosedDayBookings(null)).toEqual([]);
  });

  it('offers no-show only once started, and payment only when something is owed', () => {
    expect(closedDayActions({ status: 'confirmed', started: false, remainingIqd: 40000 })).toEqual({ cancel: true, noShow: false, pay: true });
    expect(closedDayActions({ status: 'confirmed', started: true, remainingIqd: 0 })).toEqual({ cancel: true, noShow: true, pay: false });
    expect(closedDayActions({ status: 'pending', started: true, remainingIqd: 40000 })).toEqual({ cancel: true, noShow: false, pay: false });
  });
});
