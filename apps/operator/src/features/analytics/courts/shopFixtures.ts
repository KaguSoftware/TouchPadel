/**
 * `app.analytics_shop` payloads (0346) for the shop parser, the Courts tab and
 * useVenueRevenue tests: the current window and its compare window.
 */
import type { Json } from '@touch/db';

export const shopJson = {
  range: { from: '2026-10-01', to: '2026-10-07' },
  kpis: {
    sales: 6,
    net_iqd: 300000,
    gross_iqd: 325000,
    refunds_iqd: 25000,
    discount_iqd: 0,
    refunded_sales: 1,
    units: 9,
    avg_sale_iqd: 50000,
    costed_units: 8,
    cost_iqd: 160000,
    margin_iqd: 115000,
    margin_pct: 41.8,
    cash_iqd: 200000,
    card_iqd: 100000,
  },
  by_day: [
    { business_date: '2026-10-02', sales: 2, net_iqd: 100000, gross_iqd: 100000, refunds_iqd: 0, discount_iqd: 0, units: 3 },
    { business_date: '2026-10-05', sales: 4, net_iqd: 200000, gross_iqd: 225000, refunds_iqd: 25000, discount_iqd: 0, units: 6 },
  ],
  by_hour: [
    { hour: 17, sales: 4, net_iqd: 180000 },
    { hour: 20, sales: 2, net_iqd: 120000 },
  ],
  items: [
    { menu_item_id: 'i-racket', variant_id: 'v-racket', name_en: 'Racket', name_ar: 'مضرب', variant_en: 'Pro', variant_ar: 'احترافي', units: 1, sales: 1, net_iqd: 150000, costed_units: 1, margin_iqd: 50000 },
    { menu_item_id: 'i-balls', variant_id: 'v-balls', name_en: 'Balls', name_ar: 'كرات', variant_en: 'Tube', variant_ar: 'علبة', units: 8, sales: 5, net_iqd: 150000, costed_units: 7, margin_iqd: 65000 },
  ],
  categories: [
    { category_id: 'c-gear', name_en: 'Gear', name_ar: 'معدات', units: 9, net_iqd: 300000 },
  ],
} satisfies Json;

export const shopPrevJson = {
  range: { from: '2026-09-24', to: '2026-09-30' },
  kpis: {
    sales: 4,
    net_iqd: 200000,
    gross_iqd: 200000,
    refunds_iqd: 0,
    discount_iqd: 0,
    refunded_sales: 0,
    units: 6,
    avg_sale_iqd: 50000,
    costed_units: 0,
    cost_iqd: 0,
    margin_iqd: null,
    margin_pct: null,
    cash_iqd: 200000,
    card_iqd: 0,
  },
  by_day: [{ business_date: '2026-09-26', sales: 4, net_iqd: 200000, gross_iqd: 200000, refunds_iqd: 0, discount_iqd: 0, units: 6 }],
  by_hour: [{ hour: 18, sales: 4, net_iqd: 200000 }],
  items: [],
  categories: [],
} satisfies Json;
