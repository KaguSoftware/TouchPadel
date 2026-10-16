import { describe, expect, it } from 'vitest';
import { fillShopDays, parseShop, shopDelta, shopLead } from './shop';
import { shopJson, shopPrevJson } from './shopFixtures';

describe('parseShop', () => {
  it('maps the 0346 payload to camelCase', () => {
    const s = parseShop(shopJson);
    expect(s.kpis).toEqual({
      sales: 6,
      netIqd: 300000,
      grossIqd: 325000,
      refundsIqd: 25000,
      discountIqd: 0,
      refundedSales: 1,
      units: 9,
      avgSaleIqd: 50000,
      costedUnits: 8,
      costIqd: 160000,
      marginIqd: 115000,
      marginPct: 41.8,
      cashIqd: 200000,
      cardIqd: 100000,
    });
    expect(s.byDay).toEqual([
      { date: '2026-10-02', sales: 2, netIqd: 100000, units: 3 },
      { date: '2026-10-05', sales: 4, netIqd: 200000, units: 6 },
    ]);
    expect(s.byHour[0]).toEqual({ hour: 17, sales: 4, netIqd: 180000 });
    expect(s.items[1]).toEqual({
      itemId: 'i-balls',
      variantId: 'v-balls',
      nameEn: 'Balls',
      nameAr: 'كرات',
      variantEn: 'Tube',
      variantAr: 'علبة',
      units: 8,
      sales: 5,
      netIqd: 150000,
      costedUnits: 7,
      marginIqd: 65000,
    });
    expect(s.categories).toEqual([{ categoryId: 'c-gear', nameEn: 'Gear', nameAr: 'معدات', units: 9, netIqd: 300000 }]);
  });

  it('keeps a margin the server left null as null, and yields empties for garbage', () => {
    expect(parseShop(shopPrevJson).kpis.marginIqd).toBeNull();
    expect(parseShop(shopPrevJson).kpis.marginPct).toBeNull();
    const empty = parseShop(undefined);
    expect(empty.kpis.sales).toBe(0);
    expect(empty.kpis.avgSaleIqd).toBeNull();
    expect(empty.byDay).toEqual([]);
    expect(empty.items).toEqual([]);
    expect(parseShop('nonsense').kpis.netIqd).toBe(0);
  });
});

describe('fillShopDays', () => {
  it('lists every day of the range, a day without a sale as zero', () => {
    const days = fillShopDays('2026-10-01', '2026-10-07', parseShop(shopJson).byDay);
    expect(days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    expect(days.map((d) => d.netIqd)).toEqual([0, 100000, 0, 0, 200000, 0, 0]);
  });

  it('stays finite on a backwards range', () => {
    expect(fillShopDays('2026-10-07', '2026-10-01', [])).toEqual([]);
  });
});

describe('shopDelta', () => {
  const cur = parseShop(shopJson);
  const prev = parseShop(shopPrevJson);
  const many = (s: typeof cur, sales: number) => ({ ...s, kpis: { ...s.kpis, sales } });

  it('is null without a baseline or when both windows are under the twenty-sale floor', () => {
    expect(shopDelta(cur, null, (k) => k.netIqd)).toBeNull();
    expect(shopDelta(cur, prev, (k) => k.netIqd)).toBeNull();
  });

  it('is the percent change once either window has twenty sales', () => {
    expect(shopDelta(many(cur, 25), prev, (k) => k.netIqd)).toBe(50);
    expect(shopDelta(many(cur, 25), many(prev, 25), (k) => k.marginIqd)).toBeNull();
  });
});

describe('shopLead', () => {
  it('says nothing for no sales, and counts one sale in the singular', () => {
    const k = parseShop(shopJson).kpis;
    expect(shopLead({ ...k, sales: 0 })).toBeNull();
    expect(shopLead({ ...k, sales: 1, netIqd: 40000, avgSaleIqd: 40000 })?.key).toBe('leadOne');
    expect(shopLead(k)).toEqual({ key: 'lead', net: 300000, n: 6, avg: 50000 });
  });
});
