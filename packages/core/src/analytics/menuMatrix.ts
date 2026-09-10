/**
 * Menu engineering — the Kasavana–Smith matrix, from `menu_item_cost`.
 *
 *                 │ high margin        │ low margin
 *   ──────────────┼────────────────────┼──────────────────────────
 *   popular       │ STAR               │ PLOWHORSE
 *                 │ protect, never     │ raise price or cut
 *                 │ discount           │ portion cost
 *   ──────────────┼────────────────────┼──────────────────────────
 *   unpopular     │ PUZZLE             │ DOG
 *                 │ promote harder     │ cut from the menu
 *
 * Both axes are RELATIVE to this menu: popularity = share of units vs 70 % of an even split
 * (`1/N × 0.7`, the menu-mix rule); margin = unit contribution vs the WEIGHTED average
 * contribution margin (total profit ÷ total units), so one pricey rarity can't raise the bar.
 *
 * Two honesty rules:
 *  1. A missing cost is unknown, never zero — the item is left out and `coverage` says how
 *     much of the period's revenue the matrix speaks for.
 *  2. The selling price comes from real revenue ÷ quantity (discounts included); the list
 *     price is only the fallback for rows carrying no revenue.
 *
 * Money: inputs are integer IQD (asserted). `profitIqd` and totals are exact signed integers
 * (revenue − cost × qty). `unitPriceIqd` / `unitMarginIqd` are per-unit AVERAGES and may be
 * fractional — they are analysis figures, never bill amounts; round for display only.
 */
import { iqd } from '../money/iqd';
import { pickLocale, type Locale } from '../i18n/pickLocale';
import { assertCount, type ItemRef } from './compare';

export type MenuQuadrant = 'star' | 'plowhorse' | 'puzzle' | 'dog';

/** Fixed display order — matrix reading order, best quadrant first. */
export const QUADRANTS: readonly MenuQuadrant[] = ['star', 'plowhorse', 'puzzle', 'dog'];

/** Classic menu-mix rule: "popular" starts at 70 % of an even share. */
export const DEFAULT_POPULARITY_RULE = 0.7;

/** Below this share of costed revenue the matrix is a sample, not the menu. */
export const RELIABLE_COST_COVERAGE = 0.6;

export type SoldItemTotals = { id: string; qty: number; revenueIqd: number };

export type CostedMenuItem = ItemRef & {
  defaultPriceIqd: number;
  /** null = not entered (unknown), never 0. */
  costIqd: number | null;
};

export type MenuEngineeringItem = ItemRef & {
  qty: number;
  /** Real revenue in the range (integer IQD). */
  revenueIqd: number;
  /** What a unit actually sold for: revenue ÷ qty (may be fractional), else the list price. */
  unitPriceIqd: number;
  unitCostIqd: number;
  /** Contribution margin per unit — can be negative, which is a real finding. */
  unitMarginIqd: number;
  /** Contribution margin as a share of the selling price, percent. */
  marginPct: number;
  /** Total contribution for the period: revenue − cost × qty (signed integer IQD). */
  profitIqd: number;
  /** Share of the matrix's total profit, 0–1 (signed; a loss reads negative). */
  profitShare: number;
  /** Share of the matrix's total units — the "menu mix", 0–1. */
  qtyShare: number;
  /** qtyShare ÷ an even split; 1 = exactly average popularity. */
  popularityIndex: number;
  popular: boolean;
  highMargin: boolean;
  quadrant: MenuQuadrant;
  /** Sold below cost — always worth surfacing regardless of quadrant. */
  losingMoney: boolean;
};

export type MenuEngineering = {
  /** Costed, sold items — strongest profit contribution first. */
  items: MenuEngineeringItem[];
  /** The margin axis: weighted-average contribution margin per unit. */
  avgUnitMarginIqd: number;
  /** The popularity axis, as a share of total units. */
  popularityThreshold: number;
  totals: {
    qty: number;
    /** Revenue of the costed items only — the base every margin refers to. */
    revenueIqd: number;
    costIqd: number;
    profitIqd: number;
    /** profit ÷ revenue over the costed items, percent. */
    marginPct: number;
  };
  counts: Record<MenuQuadrant, number>;
  coverage: {
    /** Distinct sold items that have a cost. */
    costedItems: number;
    /** Distinct sold items in the range (after the exclusion filter). */
    soldItems: number;
    /** Real revenue of every sold item, costed or not. */
    totalRevenueIqd: number;
    /** 0–1 share of that revenue the matrix covers. */
    revenueRatio: number;
    /** True when enough of the money is costed to read the matrix as the menu. */
    reliable: boolean;
  };
  /** False when nothing sold has a cost — the UI shows a setup prompt instead. */
  hasData: boolean;
};

export type MenuEngineeringOptions = {
  popularityRule?: number;
  reliableCoverage?: number;
};

const EMPTY_COUNTS = (): Record<MenuQuadrant, number> => ({ star: 0, plowhorse: 0, puzzle: 0, dog: 0 });

/**
 * Build the matrix. `sold` is EVERY sold item in the range (not a top-N — dogs and puzzles
 * never reach a top list), already passed through the owner's exclusion filter. Rows for the
 * same id are summed.
 */
export function buildMenuEngineering(
  sold: readonly SoldItemTotals[],
  items: readonly CostedMenuItem[],
  opts: MenuEngineeringOptions = {},
): MenuEngineering {
  const popularityRule = opts.popularityRule ?? DEFAULT_POPULARITY_RULE;
  const reliableCoverage = opts.reliableCoverage ?? RELIABLE_COST_COVERAGE;

  const byId = new Map<string, CostedMenuItem>();
  for (const it of items) {
    iqd(it.defaultPriceIqd);
    if (it.costIqd !== null) iqd(it.costIqd);
    byId.set(it.id, it);
  }

  const totals = new Map<string, { qty: number; revenue: number }>();
  for (const s of sold) {
    const qty = assertCount(s.qty, 'qty');
    const revenue = iqd(s.revenueIqd);
    if (qty <= 0) continue;
    const cur = totals.get(s.id) ?? { qty: 0, revenue: 0 };
    cur.qty += qty;
    cur.revenue += revenue;
    totals.set(s.id, cur);
  }
  const totalRevenue = [...totals.values()].reduce((sum, t) => sum + t.revenue, 0);

  type Row = Omit<
    MenuEngineeringItem,
    'qtyShare' | 'popularityIndex' | 'popular' | 'highMargin' | 'quadrant' | 'profitShare'
  >;
  const rows: Row[] = [];
  for (const [id, t] of totals) {
    const entry = byId.get(id);
    if (!entry || entry.costIqd === null) continue; // unknown margin → left out
    const unitPrice = t.revenue > 0 ? t.revenue / t.qty : entry.defaultPriceIqd;
    if (unitPrice <= 0) continue; // nothing to compute a margin against
    const revenue = t.revenue > 0 ? t.revenue : entry.defaultPriceIqd * t.qty;
    const unitMargin = unitPrice - entry.costIqd;
    const profit = revenue - entry.costIqd * t.qty;
    rows.push({
      id,
      nameEn: entry.nameEn,
      nameAr: entry.nameAr,
      qty: t.qty,
      revenueIqd: revenue,
      unitPriceIqd: unitPrice,
      unitCostIqd: entry.costIqd,
      unitMarginIqd: unitMargin,
      marginPct: Math.round((unitMargin / unitPrice) * 100),
      profitIqd: profit,
      losingMoney: unitMargin < 0,
    });
  }

  const empty: MenuEngineering = {
    items: [],
    avgUnitMarginIqd: 0,
    popularityThreshold: 0,
    totals: { qty: 0, revenueIqd: 0, costIqd: 0, profitIqd: 0, marginPct: 0 },
    counts: EMPTY_COUNTS(),
    coverage: {
      costedItems: 0,
      soldItems: totals.size,
      totalRevenueIqd: totalRevenue,
      revenueRatio: 0,
      reliable: false,
    },
    hasData: false,
  };
  if (rows.length === 0) return empty;

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profitIqd, 0);
  const totalCovered = rows.reduce((s, r) => s + r.revenueIqd, 0);
  const totalCost = rows.reduce((s, r) => s + r.unitCostIqd * r.qty, 0);
  if (totalQty <= 0) return empty;

  const avgUnitMargin = totalProfit / totalQty;
  const popularityThreshold = (1 / rows.length) * popularityRule;

  const list: MenuEngineeringItem[] = rows
    .map((r) => {
      const qtyShare = r.qty / totalQty;
      const popular = qtyShare >= popularityThreshold;
      const highMargin = r.unitMarginIqd >= avgUnitMargin;
      const quadrant: MenuQuadrant = popular
        ? highMargin
          ? 'star'
          : 'plowhorse'
        : highMargin
          ? 'puzzle'
          : 'dog';
      return {
        ...r,
        qtyShare,
        popularityIndex: qtyShare * rows.length,
        popular,
        highMargin,
        quadrant,
        profitShare: totalProfit !== 0 ? r.profitIqd / totalProfit : 0,
      };
    })
    .sort((a, b) => b.profitIqd - a.profitIqd || b.qty - a.qty || a.id.localeCompare(b.id));

  const counts = EMPTY_COUNTS();
  for (const i of list) counts[i.quadrant] += 1;
  const revenueRatio = totalRevenue > 0 ? totalCovered / totalRevenue : 0;

  return {
    items: list,
    avgUnitMarginIqd: avgUnitMargin,
    popularityThreshold,
    totals: {
      qty: totalQty,
      revenueIqd: totalCovered,
      costIqd: totalCost,
      profitIqd: totalProfit,
      marginPct: totalCovered > 0 ? Math.round((totalProfit / totalCovered) * 100) : 0,
    },
    counts,
    coverage: {
      costedItems: list.length,
      soldItems: totals.size,
      totalRevenueIqd: totalRevenue,
      revenueRatio,
      reliable: revenueRatio >= reliableCoverage,
    },
    hasData: true,
  };
}

/** Compact, pre-rounded, model-facing serialization — the judgement is already made here. */
export type MenuEngineeringForModel = {
  covered: { items: number; ofItems: number; revenueSharePct: number; reliable: boolean };
  totals: { profitIqd: number; revenueIqd: number; marginPct: number };
  avgUnitMarginIqd: number;
  items: {
    id: string;
    name: string;
    quadrant: MenuQuadrant;
    qty: number;
    revenueIqd: number;
    profitIqd: number;
    marginPct: number;
    unitMarginIqd: number;
    /** 1 = average popularity for this menu. */
    popularityIndex: number;
  }[];
};

/** Trim the matrix for the LLM prompt — top contributors plus every problem item. */
export function menuEngineeringForModel(
  me: MenuEngineering,
  limit = 24,
  locale: Locale = 'en',
): MenuEngineeringForModel | null {
  if (!me.hasData) return null;
  const head = me.items.slice(0, limit);
  const seen = new Set(head.map((i) => i.id));
  const problems = me.items.filter(
    (i) => !seen.has(i.id) && (i.losingMoney || i.quadrant === 'dog' || i.quadrant === 'plowhorse'),
  );
  return {
    covered: {
      items: me.coverage.costedItems,
      ofItems: me.coverage.soldItems,
      revenueSharePct: Math.round(me.coverage.revenueRatio * 100),
      reliable: me.coverage.reliable,
    },
    totals: {
      profitIqd: Math.round(me.totals.profitIqd),
      revenueIqd: Math.round(me.totals.revenueIqd),
      marginPct: me.totals.marginPct,
    },
    avgUnitMarginIqd: Math.round(me.avgUnitMarginIqd),
    items: [...head, ...problems].map((i) => ({
      id: i.id,
      name: pickLocale({ en: i.nameEn, ar: i.nameAr }, locale),
      quadrant: i.quadrant,
      qty: i.qty,
      revenueIqd: Math.round(i.revenueIqd),
      profitIqd: Math.round(i.profitIqd),
      marginPct: i.marginPct,
      unitMarginIqd: Math.round(i.unitMarginIqd),
      popularityIndex: Math.round(i.popularityIndex * 10) / 10,
    })),
  };
}
