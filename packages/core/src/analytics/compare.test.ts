import { describe, expect, it } from 'vitest';
import { MoneyError } from '../money/iqd';
import {
  abandonedViewsNet,
  buildItemConversion,
  hiddenGems,
  itemMomentum,
  type ItemRef,
  pctDelta,
  saleRatio,
  salesVsEngagement,
} from './compare';
import { engagementWindow } from './range';

const names = new Map<string, ItemRef>([
  ['e001', { id: 'e001', nameEn: 'Espresso', nameAr: 'إسبريسو' }],
  ['e002', { id: 'e002', nameEn: 'Cappuccino', nameAr: 'كابتشينو' }],
  ['e003', { id: 'e003', nameEn: 'Kahi', nameAr: 'كاهي' }],
]);

describe('pctDelta', () => {
  it('rounds and returns null without a baseline', () => {
    expect(pctDelta(110, 100)).toBe(10);
    expect(pctDelta(50, 200)).toBe(-75);
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(0, 0)).toBeNull();
  });
});

describe('buildItemConversion', () => {
  it('joins on id and SUMS duplicate rows', () => {
    const rows = buildItemConversion(
      [
        { id: 'e001', count: 10 },
        { id: 'e001', count: 5 },
        { id: 'e002', count: 40 },
      ],
      [{ id: 'e001', count: 3 }],
      [
        { id: 'e001', qty: 6 },
        { id: 'e002', qty: 8 },
        { id: 'e999', qty: 2 },
      ],
      names,
    );
    expect(rows.map((r) => r.id)).toEqual(['e002', 'e001', 'e999']);
    const espresso = rows.find((r) => r.id === 'e001')!;
    expect(espresso).toMatchObject({ nameEn: 'Espresso', nameAr: 'إسبريسو', views: 15, carts: 3, sold: 6, convPct: 40 });
    expect(rows.find((r) => r.id === 'e002')!.convPct).toBe(20);
    // Unknown id (deleted item) keeps its row with empty names and convPct 0 (no views).
    expect(rows.find((r) => r.id === 'e999')).toMatchObject({ nameEn: '', nameAr: '', views: 0, sold: 2, convPct: 0 });
  });

  it('can exceed 100 % and respects the limit', () => {
    const rows = buildItemConversion([{ id: 'e001', count: 4 }], [], [{ id: 'e001', qty: 10 }], names, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.convPct).toBe(250);
  });

  it('rejects non-integer counts', () => {
    expect(() => buildItemConversion([{ id: 'e001', count: 1.5 }], [], [], names)).toThrow(RangeError);
    expect(() => buildItemConversion([], [], [{ id: 'e001', qty: -1 }], names)).toThrow(RangeError);
  });
});

describe('saleRatio', () => {
  it('classifies the index for display', () => {
    expect(saleRatio(0, 0)).toEqual({ kind: 'none' });
    expect(saleRatio(5, 0)).toEqual({ kind: 'none' });
    expect(saleRatio(0, 10)).toEqual({ kind: 'zero' });
    expect(saleRatio(1, 100)).toEqual({ kind: 'lt', value: 0.1 });
    expect(saleRatio(15, 10)).toEqual({ kind: 'ratio', value: 1.5 });
    expect(saleRatio(1, 3)).toEqual({ kind: 'ratio', value: 0.3 });
  });
});

describe('abandonedViewsNet', () => {
  it('suppresses (item, day) pairs the item sold on and re-aggregates', () => {
    const out = abandonedViewsNet(
      [
        { id: 'e001', date: '2026-09-01', b5to10: 3, b10to20: 1, b20plus: 2 },
        { id: 'e001', date: '2026-09-02', b5to10: 1, b10to20: 0, b20plus: 0 },
        { id: 'e002', date: '2026-09-01', b5to10: 2, b10to20: 2, b20plus: 2 },
        { id: 'e003', date: '2026-09-01', b5to10: 0, b10to20: 0, b20plus: 0 },
      ],
      [
        { id: 'e001', date: '2026-09-01', qty: 4 }, // suppresses e001 on 09-01 only
        { id: 'e002', date: '2026-09-02', qty: 1 }, // different day — no effect
        { id: 'e003', date: '2026-09-01', qty: 0 }, // qty 0 does not suppress
      ],
      names,
    );
    expect(out.map((v) => [v.id, v.total])).toEqual([
      ['e002', 6],
      ['e001', 1],
    ]);
    expect(out[0]).toMatchObject({ nameEn: 'Cappuccino', b5to10: 2, b10to20: 2, b20plus: 2 });
  });
});

describe('hiddenGems', () => {
  it('finds high-converting, under-exposed items', () => {
    const rows = buildItemConversion(
      [
        { id: 'star', count: 100 },
        { id: 'gem', count: 10 },
        { id: 'thin', count: 2 },
        { id: 'exposed', count: 50 },
      ],
      [],
      [
        { id: 'star', qty: 60 },
        { id: 'gem', qty: 7 },
        { id: 'thin', qty: 2 },
        { id: 'exposed', qty: 45 },
      ],
      names,
    );
    const gems = hiddenGems(rows);
    expect(gems.map((g) => g.id)).toEqual(['gem']);
    expect(gems[0]).toEqual({ id: 'gem', nameEn: '', nameAr: '', views: 10, sold: 7, convPct: 70 });
  });
});

describe('itemMomentum', () => {
  const range = { from: '2026-09-08', to: '2026-09-14' };
  const prev = { from: '2026-09-01', to: '2026-09-07' };
  const now = engagementWindow(range, null);

  it('is not comparable when the windows differ in tracked length', () => {
    const r = itemMomentum([{ id: 'e001', count: 30 }], [{ id: 'e001', count: 5 }], now, engagementWindow(prev, '2026-09-04'), names);
    expect(r.comparable).toBe(false);
    expect(r.rising).toEqual([]);
    expect(r.currentDays).toBe(7);
    expect(r.previousDays).toBe(4);
  });

  it('is not comparable when the previous window has no views', () => {
    expect(itemMomentum([{ id: 'e001', count: 30 }], [], now, engagementWindow(prev, null), names).comparable).toBe(false);
  });

  it('lists rising (incl. new) and fading (incl. vanished) items', () => {
    const r = itemMomentum(
      [
        { id: 'e001', count: 30 },
        { id: 'e002', count: 8 },
        { id: 'e003', count: 4 },
        { id: 'flat', count: 20 },
      ],
      [
        { id: 'e001', count: 10 },
        { id: 'gone', count: 12 },
        { id: 'flat', count: 21 },
        { id: 'tiny', count: 2 },
      ],
      now,
      engagementWindow(prev, null),
      names,
    );
    expect(r.comparable).toBe(true);
    expect(r.rising.map((i) => [i.id, i.deltaPct, i.isNew])).toEqual([
      ['e002', null, true],
      ['e001', 200, false],
    ]);
    expect(r.fading.map((i) => [i.id, i.current, i.previous, i.deltaPct])).toEqual([['gone', 0, 12, -100]]);
    expect(r.rising[0]).toMatchObject({ nameEn: 'Cappuccino' });
  });
});

describe('salesVsEngagement', () => {
  it('leaves revenue null on engagement-only days and zeros on sales-only days', () => {
    const out = salesVsEngagement(
      [
        { date: '2026-09-02', revenueIqd: 150000, tabs: 12 },
        { date: '2026-09-02', revenueIqd: 50000, tabs: 3 },
        { date: '2026-09-03', revenueIqd: 90000, tabs: 7 },
      ],
      [
        { date: '2026-09-01', views: 40, waiterCalls: 2 },
        { date: '2026-09-02', views: 55, waiterCalls: 4 },
      ],
    );
    expect(out).toEqual([
      { date: '2026-09-01', revenue: null, tabs: null, views: 40, waiterCalls: 2 },
      { date: '2026-09-02', revenue: 200000, tabs: 15, views: 55, waiterCalls: 4 },
      { date: '2026-09-03', revenue: 90000, tabs: 7, views: 0, waiterCalls: 0 },
    ]);
  });

  it('rejects fractional money', () => {
    expect(() => salesVsEngagement([{ date: '2026-09-02', revenueIqd: 10.5, tabs: 1 }], [])).toThrow(MoneyError);
  });
});
