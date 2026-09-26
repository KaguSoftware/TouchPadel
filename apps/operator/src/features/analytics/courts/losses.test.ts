import { describe, expect, it } from 'vitest';
import { MIN_RATE_DENOM } from '@touch/core';
import { lossChartRows, lossRates, segmentKeys } from './losses';

const cancelled = [
  { key: '18', n: 6, bookingsTotal: 40 },
  { key: '19', n: 1, bookingsTotal: 5 },
];
const noShows = [
  { key: '18', n: 2, bookingsTotal: 40 },
  { key: '20', n: 3, bookingsTotal: 30 },
];

describe('lossRates', () => {
  it('rates each segment over its own booked total and keeps the fixed key order with zeros', () => {
    const rows = lossRates(cancelled, noShows, ['18', '19', '20', '21'], (k) => `${k}:00`);
    expect(rows.map((r) => [r.key, r.cancelled, r.noShow, r.total, r.cancelledPct, r.noShowPct, r.thin])).toEqual([
      ['18', 6, 2, 40, 15, 5, false],
      ['19', 1, 0, 5, null, null, true],
      ['20', 0, 3, 30, 0, 10, false],
      ['21', 0, 0, 0, null, null, true],
    ]);
    expect(rows[0]?.label).toBe('18:00');
  });

  it('is thin exactly below the twenty-booking floor', () => {
    const rows = lossRates([{ key: 'a', n: 1, bookingsTotal: MIN_RATE_DENOM }, { key: 'b', n: 1, bookingsTotal: MIN_RATE_DENOM - 1 }], [], ['a', 'b'], (k) => k);
    expect(rows.map((r) => r.thin)).toEqual([false, true]);
    expect(rows[0]?.cancelledPct).toBe(5);
    expect(rows[1]?.cancelledPct).toBeNull();
  });

  it('plots the share even for thin rows and never a rate from an empty segment', () => {
    const rows = lossChartRows(lossRates(cancelled, noShows, ['18', '19', '21'], (k) => k));
    expect(rows).toEqual([
      { label: '18', cancelled: 15, noShow: 5, thin: false },
      { label: '19', cancelled: 20, noShow: 0, thin: true },
      { label: '21', cancelled: 0, noShow: 0, thin: true },
    ]);
  });

  it('collects the keys of both sides once, in server order', () => {
    expect(segmentKeys(cancelled, noShows)).toEqual(['18', '19', '20']);
  });
});
