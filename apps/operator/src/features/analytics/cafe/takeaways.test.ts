import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { derive, type RawAnalytics } from '../derive';
import { makeFormatters } from '../format';
import { COMPARE_RANGE, RANGE, bestSellersJson, boughtTogetherJson, dailySalesJson, dailySalesPrevJson, hourlyJson, itemMarginsJson, menuSnapshotJson, promoJson, soldItemsJson } from '../fixtures';
import { parseBestSellers, parseBoughtTogether, parseDailySales, parseHourly, parseItemMargins, parseMenuSnapshot, parsePromoSales, parseSoldItems } from '../shape';
import { menuTakeaway, salesTakeaway, timeTakeaway } from './takeaways';

const tr = makeT('en');
const f = makeFormatters('en');

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

describe('cafe section sentences', () => {
  it('leads the menu with the item that made the most profit', () => {
    expect(menuTakeaway(derive(raw()), tr, f, 'en')).toBe('Latte made the most profit: 210,000 IQD from 70 sold.');
  });

  it('leads sales with the best seller and the best day', () => {
    const r = raw();
    expect(salesTakeaway(r, derive(r), tr, f, 'en')).toBe('Best seller: Water, 140,000 IQD from 140 sold. Best day: 1 Sept, 100,000 IQD.');
  });

  it('skips an excluded best seller, as the chart does', () => {
    const r = raw({ excludedIds: [parseBestSellers(bestSellersJson)[0]!.id] });
    expect(salesTakeaway(r, derive(r), tr, f, 'en')).not.toMatch(/Best seller: Water/);
  });

  it('says which orders the busy-hour sentence counts, and nothing without orders', () => {
    expect(timeTakeaway(raw(), tr, f)).toBe('Busiest hour: Friday 20:00, with 12 orders on settled tabs over the period.');
    expect(timeTakeaway(raw({ hourly: [] }), tr, f)).toBeNull();
  });
});
