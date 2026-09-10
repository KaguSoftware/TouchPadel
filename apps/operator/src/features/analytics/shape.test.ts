import { describe, expect, it } from 'vitest';
import {
  parseBasketToCall,
  parseBoughtTogether,
  parseDailySales,
  parseItemMargins,
  parseMenuSnapshot,
  parsePeakHours,
  parsePromoEngagement,
  parseSessionStats,
  parseTopViewed,
  rowsToObjects,
} from './shape';

describe('shape - SQL', () => {
  it('parses daily sales and tolerates garbage', () => {
    const rows = parseDailySales([
      { business_date: '2026-08-01', revenue_iqd: '12500', tabs_settled: 3, waiter_calls: null },
      'junk',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-01', revenueIqd: 12500, tabs: 3, waiterCalls: 0 });
    expect(rows[1]!.date).toBe('');
    expect(parseDailySales(null)).toEqual([]);
  });

  it('keeps null cost as unknown (never 0) in margins', () => {
    const m = parseItemMargins({
      basis: 'settled',
      items: [
        { menu_item_id: 'a', name_en: 'A', name_ar: 'A', qty: 4, revenue_iqd: 20000, cost_iqd: null, has_cost: false },
        { menu_item_id: 'b', name_en: 'B', name_ar: 'B', qty: 2, revenue_iqd: 10000, cost_iqd: 3000, margin_iqd: 4000, margin_pct: 40, has_cost: true },
      ],
      coverage: { revenue_with_cost_pct: 33.3, items_with_cost: 1, items_total: 2 },
    });
    expect(m.items[0]!.costIqd).toBeNull();
    expect(m.items[0]!.hasCost).toBe(false);
    expect(m.items[1]).toMatchObject({ costIqd: 3000, marginPct: 40, hasCost: true });
    expect(m.coverage.itemsWithCost).toBe(1);
  });

  it('drops pair rows without both ids', () => {
    const pairs = parseBoughtTogether([
      { item_a: 'a', item_b: 'b', both: 5, count_a: 8, count_b: 20, lift: 1.4, orders_total: 50 },
      { item_a: 'a', item_b: null, both: 1 },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'a', b: 'b', both: 5, countA: 8, orders: 50 });
  });

  it('parses the menu snapshot flags', () => {
    const rows = parseMenuSnapshot([
      { menu_item_id: 'x', name_en: 'X', name_ar: 'X', category_id: 'c', item_sort: 2, price_iqd: 5000, cost_iqd: null, is_active: true, sold_out: false },
    ]);
    expect(rows[0]).toMatchObject({ id: 'x', priceIqd: 5000, costIqd: null, isActive: true, soldOut: false });
  });
});

describe('shape - PostHog', () => {
  it('maps columns to keys and skips errored results', () => {
    expect(rowsToObjects({ columns: ['a', 'b'], rows: [[1, 'x']] })).toEqual([{ a: 1, b: 'x' }]);
    expect(rowsToObjects({ columns: [], rows: [], error: 'boom' })).toEqual([]);
    expect(rowsToObjects(undefined)).toEqual([]);
  });

  it('parses top viewed, session stats and basket to call', () => {
    const top = parseTopViewed({ columns: ['item_id', 'item_name', 'sessions', 'views'], rows: [['i1', 'Latte', 12, 30], ['', 'x', 1, 1]] });
    expect(top).toEqual([{ id: 'i1', name: 'Latte', sessions: 12, views: 30 }]);
    expect(parseSessionStats({ columns: ['visitors', 'visits', 'sessions', 'median_seconds'], rows: [[10, 12, 15, 95]] })).toEqual({
      visitors: 10, visits: 12, sessions: 15, medianSeconds: 95,
    });
    expect(parseBasketToCall(undefined).pct).toBe(0);
  });

  it('fills 24 peak hours and reads promo surfaces', () => {
    const hours = parsePeakHours({ columns: ['hour', 'views', 'sessions'], rows: [[20, 40, 12]] });
    expect(hours).toHaveLength(24);
    expect(hours[20]).toEqual({ hour: 20, views: 40, sessions: 12 });
    const promo = parsePromoEngagement({
      columns: ['kind', 'clicks', 'sessions', 'sessions_added', 'sessions_ordered', 'top_item_ids'],
      rows: [['featured', 9, 7, 3, 2, [{ item_id: 'i1', clicks: 5 }]], ['bogus', 1, 1, 1, 1, []]],
    });
    expect(promo).toHaveLength(1);
    expect(promo[0]!.topItems[0]).toEqual({ id: 'i1', clicks: 5 });
  });
});
