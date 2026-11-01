import { describe, expect, it } from 'vitest';
import { drillCardSummary, drillDayTotal, drillKindKey, drillTone, splitShares, summarizeDrill, venueDay } from './drillView';
import { readDrillAnswer } from './reportPayloads';
import { csvTypeForKey, csvValueForKey, minutesToHours } from './exportCells';

describe('venueDay', () => {
  it('files a transaction under the venue BUSINESS day, not UTC and not the calendar date (F-14)', () => {
    // 22:30 UTC on the 18th is 01:30 on the 19th in Baghdad (UTC+3): the night of the 18th (day start 04:00).
    expect(venueDay('2026-10-18T22:30:00Z')).toBe('2026-10-18');
    // 04:00 Baghdad on the 19th opens the 19th.
    expect(venueDay('2026-10-19T01:00:00Z')).toBe('2026-10-19');
    expect(venueDay('2026-10-18T20:59:00Z')).toBe('2026-10-18');
    // A venue that counts calendar days (start 0).
    expect(venueDay('2026-10-18T22:30:00Z', 0)).toBe('2026-10-19');
  });

  it('has no day for a missing or broken time', () => {
    expect(venueDay(null)).toBeNull();
    expect(venueDay('not a date')).toBeNull();
  });
});

describe('drill kinds', () => {
  it('files by detail sub first, then the server kind', () => {
    expect(drillKindKey('booking', 'reservation')).toBe('booking');
    expect(drillKindKey(null, 'tab')).toBe('tab');
    expect(drillKindKey(null, null)).toBe('other');
  });

  it('colours bookings green and the cafe violet, as the Breakdown does', () => {
    expect(drillTone('booking')).toBe('green');
    expect(drillTone('settledTab')).toBe('violet');
    expect(drillTone('refund')).toBe('rose');
  });
});

describe('summarizeDrill', () => {
  const rows = [
    { kind: 'booking', amount: 40000, staff: 'hussein' },
    { kind: 'settledTab', amount: 0, staff: 'hussein' },
    { kind: 'booking', amount: 70000, staff: 'hussein' },
  ];

  it('totals, counts per kind in first-seen order, and names the one person who took them all', () => {
    expect(summarizeDrill(rows)).toEqual({
      total: 110000,
      count: 3,
      kinds: [
        { key: 'booking', count: 2, sum: 110000 },
        { key: 'settledTab', count: 1, sum: 0 },
      ],
      soleStaff: 'hussein',
    });
  });

  it('names nobody when more than one person, or nobody, took them', () => {
    expect(summarizeDrill([...rows, { kind: 'booking', amount: 1, staff: 'ali' }]).soleStaff).toBeNull();
    expect(summarizeDrill([{ kind: 'booking', amount: 1, staff: null }]).soleStaff).toBeNull();
  });

  it('shares the bar by money moved, refunds included', () => {
    expect(splitShares([{ key: 'a', count: 1, sum: 300 }, { key: 'b', count: 1, sum: -100 }])).toEqual([
      { key: 'a', share: 0.75 },
      { key: 'b', share: 0.25 },
    ]);
    expect(splitShares([{ key: 'a', count: 1, sum: 0 }])).toEqual([{ key: 'a', share: 0 }]);
  });
});

describe('the drill window past 500 rows (F-14, 0388)', () => {
  const answer = readDrillAnswer({
    transactions: [{ id: 'a', at: '2026-10-18T10:00:00Z', day: '2026-10-18', kind: 'reservation', amountIqd: 10000 }],
    totals: { count: 503, amountIqd: 5030000, kinds: [{ key: 'booking', count: 503, sum: 5030000 }], days: { '2026-10-18': { count: 18, sum: 180000 } } },
    capped: true,
  });
  const local = summarizeDrill([{ kind: 'booking', amount: 10000, staff: null }]);

  it('reads the totals and each row\'s business day', () => {
    expect(answer.capped).toBe(true);
    expect(answer.totals?.count).toBe(503);
    expect(answer.rows[0]!.day).toBe('2026-10-18');
    expect(readDrillAnswer({ transactions: [] })).toEqual({ rows: [], totals: null, capped: false });
  });

  it('the card reads the server totals when capped, the rows when narrowed or not capped', () => {
    expect(drillCardSummary(local, answer, { kind: null, narrowed: false })).toMatchObject({ total: 5030000, count: 503 });
    expect(drillCardSummary(local, answer, { kind: 'booking', narrowed: false })).toMatchObject({ total: 5030000, count: 503 });
    expect(drillCardSummary(local, answer, { kind: null, narrowed: true })).toBe(local);
    expect(drillCardSummary(local, { ...answer, capped: false }, { kind: null, narrowed: false })).toBe(local);
  });

  it("a day's total is the server's when capped and unfiltered", () => {
    expect(drillDayTotal('2026-10-18', [{ amount: 10000 }], answer, false)).toBe(180000);
    expect(drillDayTotal('2026-10-18', [{ amount: 10000 }], answer, true)).toBe(10000);
    expect(drillDayTotal('2026-10-17', [{ amount: 10000 }], answer, false)).toBe(10000);
  });
});

describe('report export cells (F-14)', () => {
  it('writes hours in an hours column and percents as percents', () => {
    expect(minutesToHours(930)).toBe(15.5);
    expect(minutesToHours(null)).toBeNull();
    expect(csvValueForKey('bookedMinutes', 90)).toBe(1.5);
    expect(csvValueForKey('availableMinutes', 600)).toBe(10);
    expect(csvValueForKey('revenueIqd', 90)).toBe(90);
    expect(csvTypeForKey('occupancyPct')).toBe('percent');
    expect(csvTypeForKey('cancellationRatePct')).toBe('percent');
    expect(csvTypeForKey('bookedMinutes')).toBe('decimal');
    expect(csvTypeForKey('revenueIqd')).toBeUndefined();
  });
});
