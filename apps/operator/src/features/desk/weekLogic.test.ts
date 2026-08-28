import { describe, it, expect } from 'vitest';
import {
  bucketByLocalDate,
  localDateOf,
  localMinutesOf,
  rowIndexFor,
  shiftIsoDate,
  startOfWeek,
  weekDates,
} from './weekLogic';

// SOW L307 asks for a "Day and week calendar across all courts". The desk has
// been day-only since day 1. The interesting part is not the layout — it is
// deciding which venue-local day an instant belongs to, which is exactly where
// a UTC shortcut puts every evening booking in Baghdad on the wrong day.

const BAGHDAD = 'Asia/Baghdad'; // UTC+3, no DST

describe('shiftIsoDate', () => {
  it('adds and subtracts whole days', () => {
    expect(shiftIsoDate('2026-08-28', 1)).toBe('2026-08-29');
    expect(shiftIsoDate('2026-08-28', -1)).toBe('2026-08-27');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftIsoDate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIsoDate('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(shiftIsoDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftIsoDate('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is anchored at noon so a DST jump cannot move the date', () => {
    // Anchoring at midnight is the classic bug: in a zone that springs forward
    // at 00:00, +1 day lands back on the same date.
    expect(shiftIsoDate('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('startOfWeek / weekDates', () => {
  it('starts on Sunday, matching DAY_KEYS and Postgres dow', () => {
    // 2026-08-28 is a Friday.
    expect(startOfWeek('2026-08-28')).toBe('2026-08-23');
  });

  it('is a no-op on a Sunday', () => {
    expect(startOfWeek('2026-08-23')).toBe('2026-08-23');
  });

  it('returns seven consecutive days', () => {
    const week = weekDates('2026-08-28');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-08-23');
    expect(week[6]).toBe('2026-08-29');
    for (let i = 1; i < week.length; i++) {
      expect(week[i]).toBe(shiftIsoDate(week[i - 1]!, 1));
    }
  });
});

describe('localDateOf', () => {
  it('uses the venue day, not the UTC day', () => {
    // 21:30 UTC on the 28th is 00:30 on the 29th in Baghdad. A late booking is
    // the next day for the venue, and the desk must see it there.
    expect(localDateOf('2026-08-28T21:30:00Z', BAGHDAD)).toBe('2026-08-29');
  });

  it('agrees with UTC when the instant is mid-afternoon', () => {
    expect(localDateOf('2026-08-28T12:00:00Z', BAGHDAD)).toBe('2026-08-28');
  });
});

describe('localMinutesOf', () => {
  it('reports minutes past venue-local midnight', () => {
    expect(localMinutesOf('2026-08-28T12:00:00Z', BAGHDAD)).toBe(15 * 60);
    expect(localMinutesOf('2026-08-28T06:30:00Z', BAGHDAD)).toBe(9 * 60 + 30);
  });

  it('reports local midnight as 0, not 1440', () => {
    expect(localMinutesOf('2026-08-28T21:00:00Z', BAGHDAD)).toBe(0);
  });
});

describe('bucketByLocalDate', () => {
  const dates = weekDates('2026-08-28');

  it('keeps a key for every day, including empty ones', () => {
    const buckets = bucketByLocalDate([], dates, BAGHDAD);
    expect([...buckets.keys()]).toEqual(dates);
    expect([...buckets.values()].every((v) => v.length === 0)).toBe(true);
  });

  it('files each item under its venue-local day', () => {
    const items = [
      { id: 'a', start_at: '2026-08-28T12:00:00Z' }, // Fri 15:00 local
      { id: 'b', start_at: '2026-08-28T21:30:00Z' }, // Sat 00:30 local
    ];
    const buckets = bucketByLocalDate(items, dates, BAGHDAD);
    expect(buckets.get('2026-08-28')?.map((i) => i.id)).toEqual(['a']);
    expect(buckets.get('2026-08-29')?.map((i) => i.id)).toEqual(['b']);
  });

  it('drops anything outside the week rather than mis-filing it', () => {
    const buckets = bucketByLocalDate(
      [{ id: 'x', start_at: '2026-09-05T12:00:00Z' }],
      dates,
      BAGHDAD,
    );
    expect([...buckets.values()].flat()).toHaveLength(0);
  });

  it('sorts each day by start time', () => {
    const items = [
      { id: 'late', start_at: '2026-08-28T15:00:00Z' },
      { id: 'early', start_at: '2026-08-28T09:00:00Z' },
    ];
    const buckets = bucketByLocalDate(items, dates, BAGHDAD);
    expect(buckets.get('2026-08-28')?.map((i) => i.id)).toEqual(['early', 'late']);
  });
});

describe('rowIndexFor', () => {
  // Opening 09:00, 30-minute slots, 14 rows -> 09:00 to 16:00.
  const open = 9 * 60;
  const slot = 30;
  const rows = 14;

  it('maps a time to its band', () => {
    expect(rowIndexFor(9 * 60, open, slot, rows)).toBe(0);
    expect(rowIndexFor(9 * 60 + 45, open, slot, rows)).toBe(1);
    expect(rowIndexFor(15 * 60 + 30, open, slot, rows)).toBe(13);
  });

  it('clamps something starting before opening into the first row', () => {
    // A booking the desk cannot see is worse than one drawn slightly early.
    expect(rowIndexFor(8 * 60, open, slot, rows)).toBe(0);
  });

  it('reports -1 past the end of the grid', () => {
    expect(rowIndexFor(16 * 60, open, slot, rows)).toBe(-1);
  });

  it('reports -1 when the venue is closed and there are no rows', () => {
    expect(rowIndexFor(10 * 60, open, slot, 0)).toBe(-1);
  });
});
