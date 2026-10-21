import { describe, expect, it } from 'vitest';
import { drillKindKey, drillTone, splitShares, summarizeDrill, venueDay } from './drillView';

describe('venueDay', () => {
  it('files a transaction under the venue date, not UTC', () => {
    // 22:30 UTC on the 18th is 01:30 on the 19th in Baghdad (UTC+3).
    expect(venueDay('2026-10-18T22:30:00Z')).toBe('2026-10-19');
    expect(venueDay('2026-10-18T20:59:00Z')).toBe('2026-10-18');
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
