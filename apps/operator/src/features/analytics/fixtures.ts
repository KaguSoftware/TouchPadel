/**
 * Shared fixtures for the cafe analytics tests: the snake_case JSON the
 * `app.analytics_*` RPCs return (migrations 0034 + 0095), small but shaped
 * like production. Seven days of settled-day money (net, gross, refunds,
 * court fees, cash and card), three menu items (one costed), one basket
 * pair (lift 3.3, well over the 1.3 floor), no promo, a few till hours. Test-only: nothing here is imported by
 * the app.
 */
import type { SqlKey } from './shape';

export const ITEM_LATTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ITEM_KAHI = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const ITEM_WATER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const CAT_DRINKS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const CAT_FOOD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

export const RANGE = { from: '2026-09-01', to: '2026-09-07' } as const;
export const COMPARE_RANGE = { from: '2026-08-25', to: '2026-08-31' } as const;

type Json = Record<string, unknown>;

/** One business day: cafe net 100,000; gross 110,000; refunds 10,000; court fees 40,000; cash + card = 140,000; waste 3,000. */
function day(date: string, scale = 1): Json {
  return {
    business_date: date,
    revenue_iqd: 100000 * scale,
    cafe_gross_iqd: 110000 * scale,
    cafe_net_iqd: 100000 * scale,
    goods_iqd: 110000 * scale,
    court_fees_iqd: 40000 * scale,
    refunds_iqd: 10000 * scale,
    item_refunds_iqd: 10000 * scale,
    promo_discount_iqd: 0,
    cash_iqd: 90000 * scale,
    card_iqd: 50000 * scale,
    tabs_settled: 10,
    orders: 12,
    items_qty: 30,
    discount_iqd: 5000 * scale,
    tax_iqd: 0,
    visits: 10,
    guest_orders: 4,
    till_orders: 8,
    waiter_calls: 2,
    waste_iqd: 3000 * scale,
  };
}

export const dailySalesJson: Json[] = Array.from({ length: 7 }, (_, i) => day(`2026-09-0${i + 1}`));
export const dailySalesPrevJson: Json[] = Array.from({ length: 7 }, (_, i) => day(`2026-08-${25 + i}`, 0.8));

export const soldItemsJson: Json[] = dailySalesJson.flatMap((d) => [
  { business_date: d.business_date, menu_item_id: ITEM_LATTE, name_en: 'Latte', name_ar: 'لاتيه', category_id: CAT_DRINKS, qty: 10, revenue_iqd: 40000, list_revenue_iqd: 40000, discount_iqd: 0, refund_iqd: 0 },
  { business_date: d.business_date, menu_item_id: ITEM_KAHI, name_en: 'Kahi', name_ar: 'كاهي', category_id: CAT_FOOD, qty: 5, revenue_iqd: 40000, list_revenue_iqd: 40000, discount_iqd: 0, refund_iqd: 0 },
  { business_date: d.business_date, menu_item_id: ITEM_WATER, name_en: 'Water', name_ar: 'ماء', category_id: CAT_DRINKS, qty: 20, revenue_iqd: 20000, list_revenue_iqd: 20000, discount_iqd: 0, refund_iqd: 0 },
]);

export const bestSellersJson: Json[] = [
  { menu_item_id: ITEM_WATER, name_en: 'Water', name_ar: 'ماء', category_id: CAT_DRINKS, qty: 140, revenue_iqd: 140000, share_pct: 57.1, orders: 70 },
  { menu_item_id: ITEM_LATTE, name_en: 'Latte', name_ar: 'لاتيه', category_id: CAT_DRINKS, qty: 70, revenue_iqd: 280000, share_pct: 28.6, orders: 60 },
  { menu_item_id: ITEM_KAHI, name_en: 'Kahi', name_ar: 'كاهي', category_id: CAT_FOOD, qty: 35, revenue_iqd: 280000, share_pct: 14.3, orders: 30 },
];

export const boughtTogetherJson: Json[] = [
  { item_a: ITEM_LATTE, item_b: ITEM_KAHI, name_a_en: 'Latte', name_a_ar: 'لاتيه', name_b_en: 'Kahi', name_b_ar: 'كاهي', both: 20, count_a: 60, count_b: 30, confidence_ab: 0.333, confidence_ba: 0.667, lift: 3.333, orders_total: 300 },
];

/** Margins on the 0095 basis: the latte carries a cost snapshot, the kahi does not. */
export const itemMarginsJson: Json = {
  basis: 'settled',
  cost_basis: 'line_snapshot',
  items: [
    { menu_item_id: ITEM_LATTE, name_en: 'Latte', name_ar: 'لاتيه', category_id: CAT_DRINKS, qty: 70, costed_qty: 70, revenue_iqd: 280000, avg_price_iqd: 4000, cost_iqd: 1000, cost_total_iqd: 70000, margin_iqd: 210000, margin_pct: 75, has_cost: true },
    { menu_item_id: ITEM_WATER, name_en: 'Water', name_ar: 'ماء', category_id: CAT_DRINKS, qty: 140, costed_qty: 140, revenue_iqd: 140000, avg_price_iqd: 1000, cost_iqd: 300, cost_total_iqd: 42000, margin_iqd: 98000, margin_pct: 70, has_cost: true },
    { menu_item_id: ITEM_KAHI, name_en: 'Kahi', name_ar: 'كاهي', category_id: CAT_FOOD, qty: 35, costed_qty: 0, revenue_iqd: 280000, avg_price_iqd: 8000, cost_iqd: null, cost_total_iqd: null, margin_iqd: null, margin_pct: null, has_cost: false },
  ],
  coverage: { revenue_with_cost_pct: 60, items_with_cost: 2, items_total: 3 },
};

export const promoJson: Json = { qty: 0, list_revenue_iqd: 0, revenue_iqd: 0, discount_iqd: 0, orders: 0, by_day: [] };

export const menuSnapshotJson: Json[] = [
  { menu_item_id: ITEM_LATTE, name_en: 'Latte', name_ar: 'لاتيه', category_id: CAT_DRINKS, category_name_en: 'Drinks', category_name_ar: 'مشروبات', category_sort: 1, item_sort: 1, price_iqd: 4000, cost_iqd: 1000, is_active: true, sold_out: false, highlight: 'none', has_photo: true },
  { menu_item_id: ITEM_WATER, name_en: 'Water', name_ar: 'ماء', category_id: CAT_DRINKS, category_name_en: 'Drinks', category_name_ar: 'مشروبات', category_sort: 1, item_sort: 2, price_iqd: 1000, cost_iqd: 300, is_active: true, sold_out: false, highlight: 'none', has_photo: false },
  { menu_item_id: ITEM_KAHI, name_en: 'Kahi', name_ar: 'كاهي', category_id: CAT_FOOD, category_name_en: 'Food', category_name_ar: 'طعام', category_sort: 2, item_sort: 1, price_iqd: 8000, cost_iqd: null, is_active: true, sold_out: false, highlight: 'none', has_photo: true },
];

export const hourlyJson: Json[] = [
  { dow: 1, hour: 18, orders: 6, qty: 15, revenue_iqd: 60000 },
  { dow: 5, hour: 20, orders: 12, qty: 40, revenue_iqd: 150000 },
];

/** The payload each SQL query returns, as the tab's data hook would receive it. */
export function cafeFixtureFor(name: SqlKey): Json | Json[] {
  switch (name) {
    case 'dailySales':
      return dailySalesJson;
    case 'dailySalesPrev':
      return dailySalesPrevJson;
    case 'soldItems':
      return soldItemsJson;
    case 'bestSellers':
      return bestSellersJson;
    case 'boughtTogether':
      return boughtTogetherJson;
    case 'itemMargins':
      return itemMarginsJson;
    case 'promo':
      return promoJson;
    case 'menuSnapshot':
      return menuSnapshotJson;
    case 'hourly':
      return hourlyJson;
  }
}
