/**
 * Menu position vs real sales — does being near the top actually sell more?
 *
 * Spearman's ρ between an item's slot and its units sold, computed WITHIN a category (a
 * starter's slot 3 against a dessert's slot 40 measures courses, not position) and pooled,
 * item-count weighted. Copy must say "related", never causal.
 *
 * Honesty: `sort_order` is the position NOW, sales are historical, and there is no position
 * history table. Nothing here can detect a past reorder, so `positionAsOf` travels with the
 * result and the card states the assumption.
 */
import { iqd } from '../money/iqd';
import { assertCount, type ItemRef } from './compare';
import type { SoldItemTotals } from './menuMatrix';

/** One menu item's current slot, as shown to guests. */
export type MenuSlot = ItemRef & {
  categoryId: string | null;
  categoryNameEn: string;
  categoryNameAr: string;
  /** 1-based rank WITHIN its category, in the order guests see. */
  rank: number;
  /** How many items share this item's category — rank N of `categorySize`. */
  categorySize: number;
  priceIqd: number;
};

export type PositionItem = MenuSlot & {
  qty: number;
  revenueIqd: number;
  /** Units as a share of its category's units, 0–1. */
  shareOfCategory: number;
  /** Units relative to the category's MEDIAN item (1 = typical). */
  vsCategoryMedian: number;
  /** Rank by units WITHIN the category, 1 = best seller of that section. */
  salesRank: number;
  /** salesRank − rank. Negative = outsells its slot; positive = underperforms its slot. */
  rankGap: number;
};

export type CategoryPosition = {
  categoryId: string | null;
  categoryNameEn: string;
  categoryNameAr: string;
  /** In slot order. */
  items: PositionItem[];
  /** Spearman's ρ, −1…1. Negative = higher on the menu sells more. */
  rho: number;
  /** Two-sided p-value for ρ. */
  pValue: number;
  significant: boolean;
  /** Units sold by the top third of slots vs the bottom third. */
  topThirdQty: number;
  bottomThirdQty: number;
};

export type MenuPositionAnalysis = {
  /** Largest categories first. */
  categories: CategoryPosition[];
  /** Pooled ρ across categories, weighted by item count. */
  overallRho: number;
  overallP: number;
  significant: boolean;
  /** 'top-sells' = higher on the menu → more units; 'bottom-sells' = the reverse. */
  direction: 'top-sells' | 'bottom-sells' | 'none';
  /** Items that sell far better than their slot — the promote-by-moving list. */
  buriedWinners: PositionItem[];
  /** Items holding prime slots they don't earn — the demote candidates. */
  squatters: PositionItem[];
  /** The date the POSITIONS were read vs the sales range. */
  positionAsOf: string;
  coverage: {
    matchedItems: number;
    soldItems: number;
    usableCategories: number;
    revenueRatio: number;
    reliable: boolean;
  };
  hasData: boolean;
};

/** Below 4 items ρ can only take a handful of values and hits ±1 by coincidence. */
export const MIN_ITEMS_PER_CATEGORY = 4;
/** 4 items is enough to COMPUTE ρ, not to believe it: 24 orderings, a perfect one ~8 % by chance. */
export const MIN_ITEMS_FOR_SIGNIFICANCE = 6;
/** Pooled sample below this is reported, never called significant. */
export const MIN_TOTAL_ITEMS = 8;
export const ALPHA = 0.05;
/** Below this share of range revenue the reading is a sample, not the menu. */
export const RELIABLE_POSITION_COVERAGE = 0.5;
/** An item this far ahead of its slot is worth surfacing by name… */
export const GAP_THRESHOLD = 3;
/** …if it ALSO clears a material distance from its category's median (rank alone is jitter). */
export const WINNER_MEDIAN_RATIO = 1.35;
export const SQUATTER_MEDIAN_RATIO = 0.75;

/** Tie-corrected ranks (1-based; tied values share their average rank). */
function ranks(vals: readonly number[]): number[] {
  const n = vals.length;
  const order = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = avg;
    i = j + 1;
  }
  return out;
}

/** Spearman's ρ over two equal-length arrays with tie-corrected ranks; 0 on degenerate input. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return 0;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Two-sided p-value for ρ via the t approximation, t = ρ√((n−2)/(1−ρ²)). 1 for n < 4. */
export function spearmanP(rho: number, n: number): number {
  if (n < 4) return 1;
  const r = Math.min(0.999999, Math.max(-0.999999, rho));
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - studentTCdf(t, n - 2));
}

function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(x, df / 2, 0.5);
}

/**
 * Regularized incomplete beta I_x(a,b) — Lentz continued fraction. Mirrors BEFORE evaluating
 * (strict `>` on the symmetric boundary, else it recurses forever at x = 0.5, a = b).
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta) / a;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 200; i++) {
    const m = Math.floor(i / 2);
    let num: number;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -(((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  return front * (f - 1);
}

/** Lanczos approximation for log Γ(z). */
function logGamma(z: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = z;
  let tmp = z + 5.5;
  tmp -= (z + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const gj of g) ser += gj / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / z);
}

export type MenuSnapshotItem = ItemRef & {
  categoryId: string | null;
  categoryNameEn: string;
  categoryNameAr: string;
  sortOrder: number;
  priceIqd: number;
};

/**
 * Current menu slots from the snapshot, ranked within category by `sortOrder` then English
 * name. Pass only items a guest can actually reach (active, not sold out) — an unreachable
 * item occupies no slot, and counting it would shift every position below it.
 */
export function buildMenuSlots(items: readonly MenuSnapshotItem[]): MenuSlot[] {
  const byCat = new Map<string, MenuSnapshotItem[]>();
  for (const it of items) {
    iqd(it.priceIqd);
    const key = it.categoryId ?? '';
    const list = byCat.get(key) ?? [];
    list.push(it);
    byCat.set(key, list);
  }
  const slots: MenuSlot[] = [];
  for (const rows of byCat.values()) {
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn) || a.id.localeCompare(b.id));
    rows.forEach((r, i) => {
      slots.push({
        id: r.id,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        categoryId: r.categoryId,
        categoryNameEn: r.categoryNameEn,
        categoryNameAr: r.categoryNameAr,
        rank: i + 1,
        categorySize: rows.length,
        priceIqd: r.priceIqd,
      });
    });
  }
  return slots;
}

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const EMPTY: MenuPositionAnalysis = {
  categories: [],
  overallRho: 0,
  overallP: 1,
  significant: false,
  direction: 'none',
  buriedWinners: [],
  squatters: [],
  positionAsOf: '',
  coverage: { matchedItems: 0, soldItems: 0, usableCategories: 0, revenueRatio: 0, reliable: false },
  hasData: false,
};

/**
 * Correlate current menu position against real sales. `sold` is the full sold list (already
 * exclusion-filtered); `positionAsOf` is the 'YYYY-MM-DD' the slots were read.
 */
export function analyzeMenuPosition(
  slots: readonly MenuSlot[],
  sold: readonly SoldItemTotals[],
  positionAsOf: string,
): MenuPositionAnalysis {
  const soldById = new Map<string, { qty: number; revenue: number }>();
  for (const s of sold) {
    const qty = assertCount(s.qty, 'qty');
    const revenue = iqd(s.revenueIqd);
    if (qty <= 0) continue;
    const cur = soldById.get(s.id) ?? { qty: 0, revenue: 0 };
    cur.qty += qty;
    cur.revenue += revenue;
    soldById.set(s.id, cur);
  }
  const totalRevenue = [...soldById.values()].reduce((sum, t) => sum + t.revenue, 0);
  if (!slots.length || !soldById.size) {
    return { ...EMPTY, positionAsOf, coverage: { ...EMPTY.coverage, soldItems: soldById.size } };
  }

  // A menu item with no sales row is left OUT rather than entered as 0: "absent" and "sold
  // zero" are indistinguishable and zero would fabricate the strongest datapoint.
  const matched: PositionItem[] = [];
  let matchedRevenue = 0;
  for (const slot of slots) {
    const hit = soldById.get(slot.id);
    if (!hit) continue;
    matchedRevenue += hit.revenue;
    matched.push({
      ...slot,
      qty: hit.qty,
      revenueIqd: hit.revenue,
      shareOfCategory: 0,
      vsCategoryMedian: 0,
      salesRank: 0,
      rankGap: 0,
    });
  }
  const revenueRatio = totalRevenue > 0 ? matchedRevenue / totalRevenue : 0;

  if (matched.length < MIN_TOTAL_ITEMS) {
    return {
      ...EMPTY,
      positionAsOf,
      coverage: {
        matchedItems: matched.length,
        soldItems: soldById.size,
        usableCategories: 0,
        revenueRatio,
        reliable: false,
      },
    };
  }

  const byCat = new Map<string, PositionItem[]>();
  for (const m of matched) {
    const key = m.categoryId ?? '';
    const list = byCat.get(key) ?? [];
    list.push(m);
    byCat.set(key, list);
  }

  const categories: CategoryPosition[] = [];
  for (const items of byCat.values()) {
    const catQty = items.reduce((s, i) => s + i.qty, 0);
    const med = median(items.map((i) => i.qty));
    const bySales = [...items].sort((a, b) => b.qty - a.qty || a.rank - b.rank);
    bySales.forEach((i, idx) => {
      i.salesRank = idx + 1;
    });
    for (const i of items) {
      i.shareOfCategory = catQty > 0 ? i.qty / catQty : 0;
      i.vsCategoryMedian = med > 0 ? i.qty / med : 0;
      i.rankGap = i.salesRank - i.rank;
    }
    if (items.length < MIN_ITEMS_PER_CATEGORY) continue;

    const rho = spearman(
      items.map((i) => i.rank),
      items.map((i) => i.qty),
    );
    const p = spearmanP(rho, items.length);
    const bySlot = [...items].sort((a, b) => a.rank - b.rank);
    const third = Math.max(1, Math.floor(bySlot.length / 3));
    const first = bySlot[0]!;
    categories.push({
      categoryId: first.categoryId,
      categoryNameEn: first.categoryNameEn,
      categoryNameAr: first.categoryNameAr,
      items: bySlot,
      rho,
      pValue: p,
      significant: p < ALPHA && items.length >= MIN_ITEMS_FOR_SIGNIFICANCE,
      topThirdQty: bySlot.slice(0, third).reduce((s, i) => s + i.qty, 0),
      bottomThirdQty: bySlot.slice(-third).reduce((s, i) => s + i.qty, 0),
    });
  }

  const pooledN = categories.reduce((s, c) => s + c.items.length, 0);
  const overallRho =
    pooledN > 0 ? categories.reduce((s, c) => s + c.rho * c.items.length, 0) / pooledN : 0;
  const overallP = spearmanP(overallRho, pooledN);
  const significant = categories.length > 0 && pooledN >= MIN_TOTAL_ITEMS && overallP < ALPHA;

  // Named lists only from categories big enough for "up" and "down" to mean something.
  const usable = categories
    .filter((c) => c.items.length >= MIN_ITEMS_FOR_SIGNIFICANCE)
    .flatMap((c) => c.items);
  const buriedWinners = usable
    .filter((i) => i.rankGap <= -GAP_THRESHOLD && i.vsCategoryMedian >= WINNER_MEDIAN_RATIO)
    .sort((a, b) => a.rankGap - b.rankGap || b.qty - a.qty || a.id.localeCompare(b.id))
    .slice(0, 5);
  const squatters = usable
    .filter(
      (i) =>
        i.rankGap >= GAP_THRESHOLD &&
        i.rank <= Math.ceil(i.categorySize / 2) &&
        i.vsCategoryMedian <= SQUATTER_MEDIAN_RATIO,
    )
    .sort((a, b) => b.rankGap - a.rankGap || a.qty - b.qty || a.id.localeCompare(b.id))
    .slice(0, 5);

  return {
    categories: categories.sort((a, b) => b.items.length - a.items.length),
    overallRho,
    overallP,
    significant,
    direction: !significant ? 'none' : overallRho < 0 ? 'top-sells' : 'bottom-sells',
    buriedWinners,
    squatters,
    positionAsOf,
    coverage: {
      matchedItems: matched.length,
      soldItems: soldById.size,
      usableCategories: categories.length,
      revenueRatio,
      reliable: revenueRatio >= RELIABLE_POSITION_COVERAGE && significant,
    },
    hasData: categories.length > 0,
  };
}
