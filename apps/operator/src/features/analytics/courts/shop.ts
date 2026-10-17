/**
 * The Touch Shop block of the Courts tab (migration 0346,
 * `app.analytics_shop`): the analysed branch's shop sales for a business-day
 * range. Shop sales are padel revenue, so the Courts tab adds them to court
 * bookings, and `analytics_daily_sales` leaves them out of the cafe; a sale
 * is never counted twice. Owner-only on the server (app.analytics_guard).
 *
 * The parser is pure and defensive like ./shape.ts: garbage becomes zeros or
 * empty, and a figure the server left null (no costed line, no sale) stays
 * null so the UI prints a dash and never a misleading 0.
 */
import { addDays, MIN_RATE_DENOM, pctDelta } from '@touch/core';
import type { Json } from '@touch/db';
import { appRpc } from '../../../lib/appRpc';

export function shopRpc({ from, to }: { from: string; to: string }): Promise<Json> {
  return appRpc<Json>('analytics_shop', { p_from: from, p_to: to });
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export interface ShopKpis {
  sales: number;
  /** Total less refunds, the amount padel revenue counts. */
  netIqd: number;
  grossIqd: number;
  refundsIqd: number;
  discountIqd: number;
  refundedSales: number;
  units: number;
  avgSaleIqd: number | null;
  /** Units whose line carried a cost snapshot: the margin covers these only. */
  costedUnits: number;
  costIqd: number;
  marginIqd: number | null;
  marginPct: number | null;
  cashIqd: number;
  cardIqd: number;
}

export interface ShopDay {
  date: string;
  sales: number;
  netIqd: number;
  units: number;
}

export interface ShopHour {
  hour: number;
  sales: number;
  netIqd: number;
}

export interface ShopItem {
  itemId: string;
  variantId: string;
  nameEn: string;
  nameAr: string;
  variantEn: string;
  variantAr: string;
  units: number;
  sales: number;
  netIqd: number;
  costedUnits: number;
  marginIqd: number | null;
}

export interface ShopCategory {
  categoryId: string;
  nameEn: string;
  nameAr: string;
  units: number;
  netIqd: number;
}

export interface ShopSummary {
  kpis: ShopKpis;
  byDay: ShopDay[];
  byHour: ShopHour[];
  items: ShopItem[];
  categories: ShopCategory[];
}

export function parseShop(raw: Json | undefined | null): ShopSummary {
  const o = obj(raw);
  const k = obj(o.kpis);
  return {
    kpis: {
      sales: num(k.sales),
      netIqd: num(k.net_iqd),
      grossIqd: num(k.gross_iqd),
      refundsIqd: num(k.refunds_iqd),
      discountIqd: num(k.discount_iqd),
      refundedSales: num(k.refunded_sales),
      units: num(k.units),
      avgSaleIqd: numOrNull(k.avg_sale_iqd),
      costedUnits: num(k.costed_units),
      costIqd: num(k.cost_iqd),
      marginIqd: numOrNull(k.margin_iqd),
      marginPct: numOrNull(k.margin_pct),
      cashIqd: num(k.cash_iqd),
      cardIqd: num(k.card_iqd),
    },
    byDay: arr(o.by_day).map((r) => {
      const d = obj(r);
      return { date: str(d.business_date), sales: num(d.sales), netIqd: num(d.net_iqd), units: num(d.units) };
    }),
    byHour: arr(o.by_hour).map((r) => {
      const h = obj(r);
      return { hour: num(h.hour), sales: num(h.sales), netIqd: num(h.net_iqd) };
    }),
    items: arr(o.items).map((r) => {
      const i = obj(r);
      return {
        itemId: str(i.menu_item_id),
        variantId: str(i.variant_id),
        nameEn: str(i.name_en),
        nameAr: str(i.name_ar),
        variantEn: str(i.variant_en),
        variantAr: str(i.variant_ar),
        units: num(i.units),
        sales: num(i.sales),
        netIqd: num(i.net_iqd),
        costedUnits: num(i.costed_units),
        marginIqd: numOrNull(i.margin_iqd),
      };
    }),
    categories: arr(o.categories).map((r) => {
      const c = obj(r);
      return { categoryId: str(c.category_id), nameEn: str(c.name_en), nameAr: str(c.name_ar), units: num(c.units), netIqd: num(c.net_iqd) };
    }),
  };
}

/**
 * Every business day of the range, a day without a sale as zero: a bar chart
 * of the selling days alone would read a quiet week as a busy one.
 */
export function fillShopDays(from: string, to: string, byDay: readonly ShopDay[]): ShopDay[] {
  const seen = new Map(byDay.map((d) => [d.date, d]));
  const out: ShopDay[] = [];
  // analytics_bounds caps a range at 400 days; the guard keeps a bad range finite.
  for (let d = from, i = 0; d <= to && i <= 400; d = addDays(d, 1), i++) {
    out.push(seen.get(d) ?? { date: d, sales: 0, netIqd: 0, units: 0 });
  }
  return out;
}

/**
 * The change against the compare window, or null when it would be noise:
 * no baseline, or both windows under the twenty-sale floor (the courts' own
 * rule for bookings, MIN_RATE_DENOM).
 */
export function shopDelta(cur: ShopSummary | null, prev: ShopSummary | null, pick: (k: ShopKpis) => number | null): number | null {
  if (!cur || !prev) return null;
  if (cur.kpis.sales < MIN_RATE_DENOM && prev.kpis.sales < MIN_RATE_DENOM) return null;
  const a = pick(cur.kpis);
  const b = pick(prev.kpis);
  return a == null || b == null ? null : pctDelta(a, b);
}

/** Which sentence leads the section, with its values; null when there is nothing to say. */
export function shopLead(k: ShopKpis): { key: 'lead' | 'leadOne'; net: number; n: number; avg: number } | null {
  if (k.sales <= 0) return null;
  return { key: k.sales === 1 ? 'leadOne' : 'lead', net: k.netIqd, n: k.sales, avg: k.avgSaleIqd ?? Math.round(k.netIqd / k.sales) };
}
