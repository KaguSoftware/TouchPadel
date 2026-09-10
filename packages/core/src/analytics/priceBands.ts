/**
 * Price-band performance measured on REAL SALES: views → actually sold, never views → cart
 * (the guest menu has no checkout, so the cart is an optional scratchpad).
 *
 * Bands match the SQL `app.analytics_price_bands`: `<3000 / 3000–5999 / 6000–9999 / ≥10000`
 * IQD on the default-variant price. Every item is banded ONCE by a single price, so its views
 * and its sales always land in the same band:
 *   1. the menu's own price (`prices`) — the authority;
 *   2. else the price carried on the view event — for items off the menu now;
 *   3. else revenue ÷ qty from the sales rows — for items sold but never viewed.
 */
import { iqd } from '../money/iqd';
import { assertCount, type ItemNames, type ItemRef, refOf } from './compare';
import type { SoldItemTotals } from './menuMatrix';

/** Ascending band edges in IQD; N edges → N + 1 bands. */
export const PRICE_BAND_EDGES_IQD = [3000, 6000, 10000] as const;

export type PriceBandIndex = 0 | 1 | 2 | 3;

/** Index of the band a price falls in: the count of edges ≤ price. */
export function bandOf(priceIqd: number, edges: readonly number[] = PRICE_BAND_EDGES_IQD): number {
  let i = 0;
  while (i < edges.length && priceIqd >= edges[i]!) i++;
  return i;
}

export type PriceBandBounds = {
  band: number;
  /** Inclusive lower bound (0 for the first band). */
  minIqd: number;
  /** Exclusive upper bound; null for the open-ended last band. */
  maxIqd: number | null;
};

/** The bands an edge list defines, in display order — a band with no data still renders. */
export function priceBandBounds(edges: readonly number[] = PRICE_BAND_EDGES_IQD): PriceBandBounds[] {
  const out: PriceBandBounds[] = [];
  for (let i = 0; i <= edges.length; i++) {
    out.push({ band: i, minIqd: i === 0 ? 0 : edges[i - 1]!, maxIqd: i < edges.length ? edges[i]! : null });
  }
  return out;
}

/** One product inside a band — the drill-down behind the band's summary row. */
export type PriceBandItem = ItemRef & { priceIqd: number; views: number; sold: number; revenueIqd: number };

export type PriceBandSales = PriceBandBounds & {
  /** Distinct-session item views of every item in the band. */
  views: number;
  /** Real quantity sold. */
  sold: number;
  revenueIqd: number;
  /** sold ÷ views as a percentage, CAPPED at 100 — the honest display figure. */
  convPctCapped: number;
  /** Units sold beyond the number of views (staples ordered without a scan) — the "sold without a view" chip. */
  soldWithoutView: number;
  /** Best-selling first. */
  items: PriceBandItem[];
};

/**
 * Views and real sales per band. `keep` is the owner's exclusion filter (an excluded upsell
 * would otherwise dominate whichever band it falls in). `prices` = item id → default price.
 */
export function buildPriceBands(
  views: readonly { id: string; priceIqd: number | null; views: number }[],
  sold: readonly SoldItemTotals[],
  prices: ReadonlyMap<string, number>,
  keep: (id: string) => boolean = () => true,
  opts: { edges?: readonly number[]; names?: ItemNames } = {},
): PriceBandSales[] {
  const edges = opts.edges ?? PRICE_BAND_EDGES_IQD;
  const names: ItemNames = opts.names ?? new Map();

  // One price per item, menu first, so views and sales can't split across bands.
  const priceOf = new Map<string, number>();
  for (const [id, p] of prices) if (iqd(p) > 0) priceOf.set(id, p);
  for (const v of views) {
    if (v.priceIqd !== null && iqd(v.priceIqd) > 0 && !priceOf.has(v.id)) priceOf.set(v.id, v.priceIqd);
  }
  const soldTotals = new Map<string, { qty: number; revenue: number }>();
  for (const s of sold) {
    const qty = assertCount(s.qty, 'qty');
    const revenue = iqd(s.revenueIqd);
    const cur = soldTotals.get(s.id) ?? { qty: 0, revenue: 0 };
    cur.qty += qty;
    cur.revenue += revenue;
    soldTotals.set(s.id, cur);
  }
  for (const [id, t] of soldTotals) {
    if (!priceOf.has(id) && t.qty > 0 && t.revenue > 0) priceOf.set(id, t.revenue / t.qty);
  }

  const bands: PriceBandSales[] = priceBandBounds(edges).map((b) => ({
    ...b,
    views: 0,
    sold: 0,
    revenueIqd: 0,
    convPctCapped: 0,
    soldWithoutView: 0,
    items: [],
  }));
  const itemRows = new Map<string, PriceBandItem>();
  const itemRow = (id: string, price: number): PriceBandItem => {
    let row = itemRows.get(id);
    if (!row) {
      row = { ...refOf(id, names), priceIqd: price, views: 0, sold: 0, revenueIqd: 0 };
      itemRows.set(id, row);
    }
    return row;
  };

  for (const v of views) {
    if (!keep(v.id)) continue;
    const price = priceOf.get(v.id);
    if (!price) continue; // unbandable — never guessed into a band
    const count = assertCount(v.views, 'views');
    bands[bandOf(price, edges)]!.views += count;
    itemRow(v.id, price).views += count;
  }
  for (const [id, t] of soldTotals) {
    if (!keep(id)) continue;
    const price = priceOf.get(id);
    if (!price) continue;
    const band = bands[bandOf(price, edges)]!;
    band.sold += t.qty;
    band.revenueIqd += t.revenue;
    const row = itemRow(id, price);
    row.sold += t.qty;
    row.revenueIqd += t.revenue;
  }

  for (const row of itemRows.values()) bands[bandOf(row.priceIqd, edges)]!.items.push(row);
  for (const b of bands) {
    b.items.sort((x, y) => y.sold - x.sold || y.views - x.views || x.id.localeCompare(y.id));
    b.convPctCapped = b.views > 0 ? Math.min(100, Math.round((b.sold / b.views) * 100)) : 0;
    b.soldWithoutView = Math.max(0, b.sold - b.views);
  }
  return bands;
}
