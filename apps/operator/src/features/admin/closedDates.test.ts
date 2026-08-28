import { describe, it, expect } from 'vitest';
import {
  addClosedDate,
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
