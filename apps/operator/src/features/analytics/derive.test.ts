import { describe, expect, it } from 'vitest';
import { MIN_RATE_DENOM } from '@touch/core';
import { derive, type RawAnalytics } from './derive';
import { COMPARE_RANGE, ITEM_KAHI, ITEM_LATTE, ITEM_WATER, RANGE, bestSellersJson, boughtTogetherJson, dailySalesJson, dailySalesPrevJson, hourlyJson, itemMarginsJson, menuSnapshotJson, promoJson, soldItemsJson } from './fixtures';
import { parseBestSellers, parseBoughtTogether, parseDailySales, parseHourly, parseItemMargins, parseMenuSnapshot, parsePromoSales, parseSoldItems } from './shape';

// The cafe derivation over the 0095 shapes: the pulse figures come straight
// from the settle-day rows, the menu matrix reads the SERVER margins (net
// revenue, snapshotted cost) and the price bands exist without guest analytics.

function raw(over: Partial<RawAnalytics> = {}): RawAnalytics {
  return {
    preset: '7d',
    range: RANGE,
    compareRange: COMPARE_RANGE,
    compareBasis: 'prev',
    todayISO: '2026-09-14',
    excludedIds: [],
    daily: parseDailySales(dailySalesJson),
    dailyPrev: parseDailySales(dailySalesPrevJson),
    soldByDay: parseSoldItems(soldItemsJson),
    bestSellers: parseBestSellers(bestSellersJson),
    boughtTogether: parseBoughtTogether(boughtTogetherJson),
    margins: parseItemMargins(itemMarginsJson),
    promoSales: parsePromoSales(promoJson),
    menu: parseMenuSnapshot(menuSnapshotJson),
    hourly: parseHourly(hourlyJson),
    engagementStatus: 'unconfigured',
    floor: null,
    posthog: null,
    posthogPrev: null,
    ...over,
  };
}

describe('derive: pulse figures', () => {
  it('sums the settle-day money rows: net sales, cash and card, discounts, refunds, waste', () => {
    const d = derive(raw());
    expect(d.kpis).toMatchObject({ salesIqd: 700000, tabs: 70, cashIqd: 630000, cardIqd: 350000, discountIqd: 35000, refundsIqd: 70000, wasteIqd: 21000, waiterCalls: 14 });
    // cash + card = gross + court fees − refunds, per day and so in total.
    expect(d.kpis.cashIqd + d.kpis.cardIqd).toBe(7 * (110000 + 40000 - 10000));
    expect(d.deltas.sales).toBe(25);
    expect(d.deltas.cashCard).toBe(25);
    expect(d.deltas.discounts).toBe(25);
    expect(d.deltas.refunds).toBe(25);
    expect(d.deltas.waste).toBe(25);
    // The panel's cafe figures: gross before refunds, orders, and gross over orders.
    expect(d.kpis).toMatchObject({ cafeGrossIqd: 770000, orders: 84, avgOrderValueIqd: 9167 });
    expect(d.deltas.orders).toBe(0);
    expect(d.deltas.avgOrderValue).toBe(25);
  });

  it('reports the QR share as a rate above the twenty-order floor and as a count below it', () => {
    const d = derive(raw());
    expect(d.kpis.qrOrders).toBe(28);
    expect(d.kpis.tillOrders).toBe(56);
    expect(d.kpis.qrShare).toEqual({ pct: 33.3, n: 28, d: 84 });
    expect(d.deltas.qrShare).toBe(0);
    const thin = derive(raw({ daily: parseDailySales([dailySalesJson[0]]) }));
    expect(thin.kpis.qrShare.d).toBeLessThan(MIN_RATE_DENOM);
    expect(thin.kpis.qrShare).toEqual({ pct: null, n: 4, d: 12 });
    expect(thin.deltas.qrShare).toBeNull();
  });
});

describe('derive: menu engineering from the server margins', () => {
  it('costs an item from its line snapshot, never from the menu snapshot', () => {
    // The menu snapshot says the water costs 300 today; the margin rows say the
    // same — but the kahi has no snapshot even though a cost could be entered later.
    const d = derive(raw());
    const me = d.menuEngineering;
    expect(me.hasData).toBe(true);
    expect(me.items.map((i) => i.id).sort()).toEqual([ITEM_LATTE, ITEM_WATER].sort());
    const latte = me.items.find((i) => i.id === ITEM_LATTE)!;
    expect(latte.unitCostIqd).toBe(1000);
    expect(latte.unitPriceIqd).toBe(4000);
    expect(latte.profitIqd).toBe(280000 - 70 * 1000);
    expect(me.items.some((i) => i.id === ITEM_KAHI)).toBe(false);
    expect(d.marginsCoverage).toEqual({ revenueWithCostPct: 60, itemsWithCost: 2, itemsTotal: 3 });
  });

  it('ignores a menu cost when the margin row has no snapshot', () => {
    const margins = parseItemMargins({ ...itemMarginsJson, items: (itemMarginsJson.items as Record<string, unknown>[]).map((i) => ({ ...i, cost_iqd: null, has_cost: false, margin_iqd: null })) });
    const d = derive(raw({ margins }));
    expect(d.menuEngineering.hasData).toBe(false);
  });
});

describe('derive: price bands without guest analytics', () => {
  it('still bands what sold, with empty views', () => {
    const d = derive(raw());
    expect(d.priceBands).toHaveLength(4);
    expect(d.priceBands.every((b) => b.views === 0)).toBe(true);
    // Water (1,000) in the first band, latte (4,000) in the second, kahi (8,000) in the third.
    expect(d.priceBands.map((b) => b.sold)).toEqual([140, 70, 35, 0]);
    expect(d.priceBands[1]?.items.map((i) => i.id)).toEqual([ITEM_LATTE]);
  });
});
