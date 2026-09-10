/**
 * Shape raw analytics payloads into typed objects.
 *  - SQL RPCs (migration 0034) return jsonb arrays/objects of snake_case rows.
 *  - PostHog batch results are `{columns, rows: unknown[][]}` — column lists are
 *    documented in functions/analytics-posthog/index.ts and mirrored here.
 * Pure, defensive (garbage → zeros/empty), unit-tested.
 */
import type { ItemRef } from '@touch/core';
import type { PosthogQueryResult } from '../../lib/analyticsApi';

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
export interface DailySalesRow {
  date: string;
  revenueIqd: number;
  cashIqd: number;
  cardIqd: number;
  tabs: number;
  orders: number;
  itemsQty: number;
  discountIqd: number;
  visits: number;
  guestOrders: number;
  tillOrders: number;
  waiterCalls: number;
}

export function parseDailySales(json: unknown): DailySalesRow[] {
  return arr(json).map((r) => {
    const o = obj(r);
    return {
      date: str(o.business_date),
      revenueIqd: num(o.revenue_iqd),
      cashIqd: num(o.cash_iqd),
      cardIqd: num(o.card_iqd),
      tabs: num(o.tabs_settled),
      orders: num(o.orders),
      itemsQty: num(o.items_qty),
      discountIqd: num(o.discount_iqd),
      visits: num(o.visits),
      guestOrders: num(o.guest_orders),
      tillOrders: num(o.till_orders),
      waiterCalls: num(o.waiter_calls),
    };
  });
}

export interface SoldItemRow {
  date: string;
  id: string;
  nameEn: string;
  nameAr: string;
  categoryId: string | null;
  qty: number;
  revenueIqd: number;
  discountIqd: number;
}

export function parseSoldItems(json: unknown): SoldItemRow[] {
  return arr(json)
    .map((r) => {
      const o = obj(r);
      return {
        date: str(o.business_date),
        id: str(o.menu_item_id),
        nameEn: str(o.name_en),
        nameAr: str(o.name_ar),
        categoryId: o.category_id ? str(o.category_id) : null,
        qty: num(o.qty),
        revenueIqd: num(o.revenue_iqd),
        discountIqd: num(o.discount_iqd),
      };
    })
    .filter((r) => r.id !== '');
}

export interface BestSellerRow extends ItemRef {
  categoryId: string | null;
  qty: number;
  revenueIqd: number;
  sharePct: number;
  orders: number;
}

export function parseBestSellers(json: unknown): BestSellerRow[] {
  return arr(json)
    .map((r) => {
      const o = obj(r);
      return {
        id: str(o.menu_item_id),
        nameEn: str(o.name_en),
        nameAr: str(o.name_ar),
        categoryId: o.category_id ? str(o.category_id) : null,
        qty: num(o.qty),
        revenueIqd: num(o.revenue_iqd),
        sharePct: num(o.share_pct),
        orders: num(o.orders),
      };
    })
    .filter((r) => r.id !== '');
}

export interface BoughtTogetherRow {
  a: string;
  b: string;
  aNameEn: string;
  aNameAr: string;
  bNameEn: string;
  bNameAr: string;
  both: number;
  countA: number;
  countB: number;
  confidenceAb: number;
  confidenceBa: number;
  lift: number;
  orders: number;
}

export function parseBoughtTogether(json: unknown): BoughtTogetherRow[] {
  return arr(json)
    .map((r) => {
      const o = obj(r);
      return {
        a: str(o.item_a),
        b: str(o.item_b),
        aNameEn: str(o.name_a_en),
        aNameAr: str(o.name_a_ar),
        bNameEn: str(o.name_b_en),
        bNameAr: str(o.name_b_ar),
        both: num(o.both),
        countA: num(o.count_a),
        countB: num(o.count_b),
        confidenceAb: num(o.confidence_ab),
        confidenceBa: num(o.confidence_ba),
        lift: num(o.lift),
        orders: num(o.orders_total),
      };
    })
    .filter((r) => r.a !== '' && r.b !== '');
}

export interface ItemMarginRow extends ItemRef {
  categoryId: string | null;
  qty: number;
  revenueIqd: number;
  avgPriceIqd: number;
  costIqd: number | null;
  marginIqd: number | null;
  marginPct: number | null;
  hasCost: boolean;
}

export interface ItemMargins {
  basis: string;
  costAsOf: string;
  items: ItemMarginRow[];
  coverage: { revenueWithCostPct: number; itemsWithCost: number; itemsTotal: number };
}

export function parseItemMargins(json: unknown): ItemMargins {
  const o = obj(json);
  const cov = obj(o.coverage);
  return {
    basis: str(o.basis),
    costAsOf: str(o.cost_as_of),
    items: arr(o.items)
      .map((r) => {
        const i = obj(r);
        const hasCost = i.has_cost === true && i.cost_iqd !== null && i.cost_iqd !== undefined;
        return {
          id: str(i.menu_item_id),
          nameEn: str(i.name_en),
          nameAr: str(i.name_ar),
          categoryId: i.category_id ? str(i.category_id) : null,
          qty: num(i.qty),
          revenueIqd: num(i.revenue_iqd),
          avgPriceIqd: num(i.avg_price_iqd),
          costIqd: hasCost ? num(i.cost_iqd) : null,
          marginIqd: hasCost ? num(i.margin_iqd) : null,
          marginPct: hasCost ? num(i.margin_pct) : null,
          hasCost,
        };
      })
      .filter((r) => r.id !== ''),
    coverage: {
      revenueWithCostPct: num(cov.revenue_with_cost_pct),
      itemsWithCost: num(cov.items_with_cost),
      itemsTotal: num(cov.items_total),
    },
  };
}

export interface PromoSales {
  qty: number;
  listRevenueIqd: number;
  revenueIqd: number;
  discountIqd: number;
  orders: number;
}

export function parsePromoSales(json: unknown): PromoSales {
  const o = obj(json);
  return {
    qty: num(o.qty),
    listRevenueIqd: num(o.list_revenue_iqd),
    revenueIqd: num(o.revenue_iqd),
    discountIqd: num(o.discount_iqd),
    orders: num(o.orders),
  };
}

export interface MenuSnapshotRow extends ItemRef {
  categoryId: string | null;
  categoryNameEn: string;
  categoryNameAr: string;
  categorySort: number;
  itemSort: number;
  priceIqd: number;
  costIqd: number | null;
  isActive: boolean;
  soldOut: boolean;
}

export function parseMenuSnapshot(json: unknown): MenuSnapshotRow[] {
  return arr(json)
    .map((r) => {
      const o = obj(r);
      return {
        id: str(o.menu_item_id),
        nameEn: str(o.name_en),
        nameAr: str(o.name_ar),
        categoryId: o.category_id ? str(o.category_id) : null,
        categoryNameEn: str(o.category_name_en),
        categoryNameAr: str(o.category_name_ar),
        categorySort: num(o.category_sort),
        itemSort: num(o.item_sort),
        priceIqd: num(o.price_iqd),
        costIqd: o.cost_iqd === null || o.cost_iqd === undefined ? null : num(o.cost_iqd),
        isActive: o.is_active !== false,
        soldOut: o.sold_out === true,
      };
    })
    .filter((r) => r.id !== '');
}

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------
/** `{columns, rows}` → objects keyed by column name (a failed query yields []). */
export function rowsToObjects(result: PosthogQueryResult | undefined): Record<string, unknown>[] {
  if (!result || result.error || !Array.isArray(result.rows)) return [];
  const cols = result.columns;
  return result.rows.map((row) => {
    const o: Record<string, unknown> = {};
    const cells = Array.isArray(row) ? row : [];
    cols.forEach((c, i) => {
      o[c] = cells[i];
    });
    return o;
  });
}

export interface DailyEngagementRow {
  date: string;
  pageviews: number;
  views: number;
  carts: number;
  sessions: number;
  waiterCalls: number;
  orders: number;
}
export const parseDailyEngagement = (r?: PosthogQueryResult): DailyEngagementRow[] =>
  rowsToObjects(r).map((o) => ({
    date: str(o.business_date).slice(0, 10),
    pageviews: num(o.pageviews),
    views: num(o.views),
    carts: num(o.carts),
    sessions: num(o.sessions),
    waiterCalls: num(o.waiter_calls),
    orders: num(o.orders),
  }));

export interface TopItemRow {
  id: string;
  name: string;
  sessions: number;
  views: number;
}
export const parseTopViewed = (r?: PosthogQueryResult): TopItemRow[] =>
  rowsToObjects(r)
    .map((o) => ({ id: str(o.item_id), name: str(o.item_name), sessions: num(o.sessions), views: num(o.views) }))
    .filter((x) => x.id !== '');

export const parseTopCarted = (r?: PosthogQueryResult): TopItemRow[] =>
  rowsToObjects(r)
    .map((o) => ({ id: str(o.item_id), name: str(o.item_name), sessions: num(o.sessions), views: num(o.adds) }))
    .filter((x) => x.id !== '');

export interface AbandonedRow {
  id: string;
  date: string;
  b5to10: number;
  b10to20: number;
  b20plus: number;
}
export const parseAbandoned = (r?: PosthogQueryResult): AbandonedRow[] =>
  rowsToObjects(r)
    .map((o) => ({
      id: str(o.item_id),
      date: str(o.business_date).slice(0, 10),
      b5to10: num(o.b5_10),
      b10to20: num(o.b10_20),
      b20plus: num(o.b20_plus),
    }))
    .filter((x) => x.id !== '');

export interface FunnelStep {
  step: string;
  sessions: number;
}
export const parseFunnel = (r?: PosthogQueryResult): FunnelStep[] =>
  rowsToObjects(r).map((o) => ({ step: str(o.step), sessions: num(o.sessions) }));

export interface BasketToCall {
  baskets: number;
  called: number;
  ordered: number;
  converted: number;
  pct: number;
}
export function parseBasketToCall(r?: PosthogQueryResult): BasketToCall {
  const o = rowsToObjects(r)[0] ?? {};
  return {
    baskets: num(o.baskets),
    called: num(o.called),
    ordered: num(o.ordered),
    converted: num(o.converted),
    pct: num(o.pct),
  };
}

export interface TableActivityRow {
  table: string;
  sessions: number;
  views: number;
  waiterCalls: number;
  orders: number;
}
export const parseTableActivity = (r?: PosthogQueryResult): TableActivityRow[] =>
  rowsToObjects(r).map((o) => ({
    table: str(o.table_number),
    sessions: num(o.sessions),
    views: num(o.views),
    waiterCalls: num(o.waiter_calls),
    orders: num(o.orders),
  }));

export interface HeatCell {
  dow: number;
  hour: number;
  views: number;
  sessions: number;
}
export const parseHeatmap = (r?: PosthogQueryResult): HeatCell[] =>
  rowsToObjects(r).map((o) => ({
    dow: num(o.dow),
    hour: num(o.hour),
    views: num(o.views),
    sessions: num(o.sessions),
  }));

export interface PeakHourRow {
  hour: number;
  views: number;
  sessions: number;
}
export function parsePeakHours(r?: PosthogQueryResult): PeakHourRow[] {
  const by = new Map(rowsToObjects(r).map((o) => [num(o.hour), o]));
  return Array.from({ length: 24 }, (_, h) => {
    const o = by.get(h);
    return { hour: h, views: o ? num(o.views) : 0, sessions: o ? num(o.sessions) : 0 };
  });
}

export interface PromoSurface {
  kind: 'featured' | 'suggested';
  clicks: number;
  sessions: number;
  sessionsAdded: number;
  sessionsOrdered: number;
  topItems: { id: string; clicks: number }[];
}
export function parsePromoEngagement(r?: PosthogQueryResult): PromoSurface[] {
  return rowsToObjects(r)
    .filter((o) => o.kind === 'featured' || o.kind === 'suggested')
    .map((o) => ({
      kind: o.kind as 'featured' | 'suggested',
      clicks: num(o.clicks),
      sessions: num(o.sessions),
      sessionsAdded: num(o.sessions_added),
      sessionsOrdered: num(o.sessions_ordered),
      topItems: arr(o.top_item_ids).map((t) => {
        const x = obj(t);
        return { id: str(x.item_id), clicks: num(x.clicks) };
      }),
    }));
}

export interface ItemViewWithPrice {
  id: string;
  name: string;
  priceIqd: number | null;
  maxDiscountPct: number;
  sessions: number;
  views: number;
}
export const parseItemViewsWithPrice = (r?: PosthogQueryResult): ItemViewWithPrice[] =>
  rowsToObjects(r)
    .map((o) => ({
      id: str(o.item_id),
      name: str(o.item_name),
      priceIqd: num(o.price_iqd) > 0 ? Math.round(num(o.price_iqd)) : null,
      maxDiscountPct: num(o.max_discount_pct),
      sessions: num(o.sessions),
      views: num(o.views),
    }))
    .filter((x) => x.id !== '');

export interface SessionStats {
  visitors: number;
  visits: number;
  sessions: number;
  medianSeconds: number;
}
export function parseSessionStats(r?: PosthogQueryResult): SessionStats {
  const o = rowsToObjects(r)[0] ?? {};
  return {
    visitors: num(o.visitors),
    visits: num(o.visits),
    sessions: num(o.sessions),
    medianSeconds: num(o.median_seconds),
  };
}

export interface CategoryPopRow {
  id: string;
  nameEn: string;
  selections: number;
  sessions: number;
}
export const parseCategoryPopularity = (r?: PosthogQueryResult): CategoryPopRow[] =>
  rowsToObjects(r)
    .map((o) => ({
      id: str(o.category_id),
      nameEn: str(o.category_name_en),
      selections: num(o.selections),
      sessions: num(o.sessions),
    }))
    .filter((x) => x.id !== '');

export interface LocalePref {
  locale: string;
  sessions: number;
  medianSeconds: number;
  topItems: { id: string; name: string; sessions: number; rate: number }[];
}
export const parseLocalePreferences = (r?: PosthogQueryResult): LocalePref[] =>
  rowsToObjects(r).map((o) => ({
    locale: str(o.locale),
    sessions: num(o.sessions),
    medianSeconds: num(o.median_seconds),
    topItems: arr(o.top_items).map((t) => {
      const x = obj(t);
      return { id: str(x.item_id), name: str(x.item_name), sessions: num(x.sessions), rate: num(x.rate) };
    }),
  }));
