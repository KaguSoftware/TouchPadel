import { describe, expect, it } from 'vitest';
import { t, type MessageKey, type TParams } from '@touch/i18n';
import { makeFormatters } from '../format';
import { groupName, keptPct, oldTillNotices, oldTillTakeaway, parseOldTill, parseOldTillTotals, productLabel, sharePct } from './history';

const tr = (key: MessageKey, params?: TParams) => t('en', key, params);
const f = makeFormatters('en');

/** October 2026 as `app.analytics_cafe_history` answers it, cut to three products. */
const payload = {
  totals: { days: 31, from: '2026-10-01', to: '2026-10-31', gross: 23_386_500, discounts: 0, net: 23_386_500, orders: 5240, units: 12_852, discountUnknownDays: 31 },
  months: [{ month: '2026-10-01', days: 31, gross_iqd: 23_386_500, discount_iqd: 0, net_iqd: 23_386_500, orders: 5240, units: 12_852, discount_unknown_days: 31 }],
  groups: [
    { key: 'dessert_food', units: 100, gross_iqd: 300_000, cost_known_gross_iqd: 200_000, cost_iqd: 80_000 },
    { key: 'water_ice', units: 400, gross_iqd: 100_000, cost_known_gross_iqd: 0, cost_iqd: 0 },
  ],
  products: [
    { product: 'كوكيز', unit_price_iqd: 2000, group: 'dessert_food', units: 60, gross_iqd: 120_000, unit_cost_iqd: 1250, cost_iqd: 75_000 },
    { product: 'ماء', unit_price_iqd: 250, group: 'water_ice', units: 400, gross_iqd: 100_000, unit_cost_iqd: null, cost_iqd: null },
    { product: 'كوكيز', unit_price_iqd: 3000, group: 'dessert_food', units: 10, gross_iqd: 30_000, unit_cost_iqd: 1750, cost_iqd: 17_500 },
  ],
  items: { gross_iqd: 400_000, cost_known_gross_iqd: 200_000, cost_iqd: 80_000 },
};

describe('the old café till on Analytics (0412)', () => {
  it('reads the server payload', () => {
    const h = parseOldTill(payload)!;
    expect(h.totals).toEqual({ days: 31, from: '2026-10-01', to: '2026-10-31', grossIqd: 23_386_500, discountIqd: 0, netIqd: 23_386_500, orders: 5240, units: 12_852, discountUnknownDays: 31 });
    expect(h.months[0]).toMatchObject({ month: '2026-10-01', netIqd: 23_386_500, discountUnknownDays: 31 });
    expect(h.groups.map((g) => g.key)).toEqual(['dessert_food', 'water_ice']);
    expect(h.products[1]).toEqual({ product: 'ماء', unitPriceIqd: 250, group: 'water_ice', units: 400, grossIqd: 100_000, unitCostIqd: null });
    expect(h.items).toEqual({ grossIqd: 400_000, costKnownGrossIqd: 200_000, costIqd: 80_000 });
  });

  it('is nothing when the range holds no old-till day, or the answer is not there', () => {
    expect(parseOldTill({ ...payload, totals: { ...payload.totals, days: 0, from: null, to: null } })).toBeNull();
    expect(parseOldTill(undefined)).toBeNull();
    expect(parseOldTill([])).toBeNull();
    expect(parseOldTillTotals(undefined)).toBeNull();
    expect(parseOldTillTotals(payload.totals)?.netIqd).toBe(23_386_500);
  });

  it('an unknown cost stays unknown, never zero', () => {
    expect(keptPct(0, 0)).toBeNull();
    expect(keptPct(200_000, 80_000)).toBe(60);
    expect(sharePct(100_000, 0)).toBeNull();
    expect(sharePct(100_000, 400_000)).toBe(25);
  });

  it('names a group, and a group the app does not know as Other', () => {
    expect(groupName('mojito', tr)).toBe('Mojitos');
    expect(groupName('something_new', tr)).toBe('Other');
  });

  it('a name the old till sold at two prices carries its price', () => {
    const h = parseOldTill(payload)!;
    expect(productLabel(h.products[0]!, h.products, f)).toBe('كوكيز (2,000)');
    expect(productLabel(h.products[1]!, h.products, f)).toBe('ماء');
  });

  it('the notices say which days are the old till\'s and that their discounts are unknown', () => {
    const h = parseOldTill(payload)!;
    const cafe = oldTillNotices(h.totals, 'cafe', tr, f);
    expect(cafe.map((n) => n.key)).toEqual(['old-till', 'old-till-discounts']);
    expect(cafe[0]!.text).toContain('1 Oct 2026 to 31 Oct 2026');
    expect(cafe[0]!.text).toContain(f.money(23_386_500));
    expect(cafe[1]!.text).toContain('31 of those days');
    const panel = oldTillNotices({ ...h.totals, discountUnknownDays: 0 }, 'panel', tr, f);
    expect(panel).toHaveLength(1);
    expect(panel[0]!.text).toContain('Cash and card do not');
    expect(oldTillNotices(null, 'cafe', tr, f)).toEqual([]);
  });

  it('the section opens with what was taken, what sold most and what the known costs leave', () => {
    const line = oldTillTakeaway(parseOldTill(payload)!, tr, f);
    expect(line).toBe(
      `The old till took ${f.money(23_386_500)} over 31 trading days. Desserts and food sold most, 75% of item sales. A cost is known for 50% of item sales, and on those the café kept 60% of the price.`,
    );
  });
});
