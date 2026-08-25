/**
 * Pure derivation: raw SQL + PostHog payloads → everything the cards render,
 * through the core analytics modules (id-keyed joins, integer IQD).
 * No React, no I/O — `useAnalyticsData` memoises one call per data change.
 */
import {
  abandonedViewsNet,
  analyzeMenuPosition,
  buildDataBasis,
  buildItemConversion,
  buildMenuEngineering,
  buildMenuSlots,
  buildPriceBands,
  engagementComparable,
  engagementWindow,
  hiddenGems,
  itemMomentum,
  makeKeepFilter,
  pctDelta,
  rankPairs,
  salesCoverage,
  salesVsEngagement,
  RELIABLE_COVERAGE,
  type AbandonedView,
  type CompareBasis,
  type DataBasis,
  type DateRange,
  type EngagementWindow,
  type HiddenGem,
  type ItemConversion,
  type ItemNames,
  type ItemPair,
  type ItemRef,
  type MenuEngineering,
  type MenuPositionAnalysis,
  type MomentumResult,
  type PriceBandSales,
  type RangePreset,
  type SalesCoverage,
  type SalesVsEngagementDay,
  type SoldItemTotals,
} from '@touch/core';
import type {
  AbandonedRow,
  BasketToCall,
  BestSellerRow,
  BoughtTogetherRow,
  CategoryPopRow,
  DailyEngagementRow,
  DailySalesRow,
  FunnelStep,
  HeatCell,
  ItemMargins,
  ItemViewWithPrice,
  LocalePref,
  MenuSnapshotRow,
  PeakHourRow,
  PromoSales,
  PromoSurface,
  SessionStats,
  SoldItemRow,
  TableActivityRow,
  TopItemRow,
} from './shape';

export type EngagementStatus = 'loading' | 'ready' | 'unconfigured' | 'error';

export interface PosthogWindow {
  dailyEngagement: DailyEngagementRow[];
  topViewed: TopItemRow[];
  topCarted: TopItemRow[];
  abandoned: AbandonedRow[];
  funnel: FunnelStep[];
  basketToCall: BasketToCall;
  tableActivity: TableActivityRow[];
  heatmap: HeatCell[];
  peakHours: PeakHourRow[];
  promo: PromoSurface[];
  itemViewsWithPrice: ItemViewWithPrice[];
  sessionStats: SessionStats;
  categoryPopularity: CategoryPopRow[];
  localePreferences: LocalePref[];
}

export interface PosthogCompareWindow {
  topViewed: TopItemRow[];
  sessionStats: SessionStats;
  dailyEngagement: DailyEngagementRow[];
  basketToCall: BasketToCall;
}

export interface RawAnalytics {
  preset: RangePreset;
  range: DateRange;
  compareBasis: CompareBasis;
  compareRange: DateRange;
  todayISO: string;
  coversMultiplier: number;
  excludedIds: readonly string[];
  daily: DailySalesRow[];
  dailyPrev: DailySalesRow[];
  soldByDay: SoldItemRow[];
  bestSellers: BestSellerRow[];
  boughtTogether: BoughtTogetherRow[];
  margins: ItemMargins;
  promoSales: PromoSales;
  menu: MenuSnapshotRow[];
  engagementStatus: EngagementStatus;
  floor: string | null;
  posthog: PosthogWindow | null;
  posthogPrev: PosthogCompareWindow | null;
}

export interface Kpis {
  salesIqd: number;
  tabs: number;
  coversEstimated: number | null;
  perPersonIqd: number | null;
  visits: number;
  sessions: number;
  views: number;
  medianSeconds: number;
  waiterCalls: number;
  basketToCallPct: number;
  basketToCallSample: number;
}

export type KpiKey = 'sales' | 'tabs' | 'visits' | 'views' | 'median' | 'calls' | 'basket';

export interface Derived {
  names: ItemNames;
  keep: (id: string) => boolean;
  coverage: SalesCoverage;
  coveragePrev: SalesCoverage;
  salesDeltaReliable: boolean;
  engNow: EngagementWindow;
  engPrev: EngagementWindow;
  engComparable: boolean;
  kpis: Kpis;
  deltas: Record<KpiKey, number | null>;
  soldTotals: SoldItemTotals[];
  itemConversion: ItemConversion[];
  hiddenGems: HiddenGem[];
  momentum: MomentumResult;
  abandoned: AbandonedView[];
  menuEngineering: MenuEngineering;
  menuPosition: MenuPositionAnalysis;
  priceBands: PriceBandSales[];
  pairs: ItemPair[];
  salesVsEngagement: SalesVsEngagementDay[];
  basis: DataBasis;
  categoryNames: Map<string, { nameEn: string; nameAr: string }>;
}

export function sumBy<T>(rows: readonly T[], pick: (r: T) => number): number {
  let s = 0;
  for (const r of rows) s += pick(r);
  return s;
}

export function buildNames(menu: readonly MenuSnapshotRow[], sold: readonly SoldItemRow[]): ItemNames {
  const names = new Map<string, ItemRef>();
  for (const m of menu) names.set(m.id, { id: m.id, nameEn: m.nameEn, nameAr: m.nameAr });
  for (const s of sold) if (!names.has(s.id)) names.set(s.id, { id: s.id, nameEn: s.nameEn, nameAr: s.nameAr });
  return names;
}

/** Sum day-grain sold rows into per-item totals (exclusion-filtered). */
export function soldTotalsOf(sold: readonly SoldItemRow[], keep: (id: string) => boolean): SoldItemTotals[] {
  const by = new Map<string, SoldItemTotals>();
  for (const r of sold) {
    if (!keep(r.id)) continue;
    const cur = by.get(r.id) ?? { id: r.id, qty: 0, revenueIqd: 0 };
    cur.qty += r.qty;
    cur.revenueIqd += r.revenueIqd;
    by.set(r.id, cur);
  }
  return [...by.values()];
}

function salesWithin(daily: readonly DailySalesRow[], win: EngagementWindow): number {
  if (win.empty) return 0;
  return sumBy(
    daily.filter((d) => d.date >= win.from && d.date <= win.to),
    (d) => d.revenueIqd,
  );
}

export function derive(raw: RawAnalytics): Derived {
  const names = buildNames(raw.menu, raw.soldByDay);
  const keep = makeKeepFilter(new Set(raw.excludedIds));

  const datesWithSales = raw.daily.filter((d) => d.revenueIqd > 0 || d.orders > 0).map((d) => d.date);
  const coverage = salesCoverage(raw.range, datesWithSales);
  const coveragePrev = salesCoverage(
    raw.compareRange,
    raw.dailyPrev.filter((d) => d.revenueIqd > 0 || d.orders > 0).map((d) => d.date),
  );
  const salesDeltaReliable = coverage.ratio >= RELIABLE_COVERAGE && coveragePrev.ratio >= RELIABLE_COVERAGE;

  const engNow = engagementWindow(raw.range, raw.floor);
  const engPrev = engagementWindow(raw.compareRange, raw.floor);
  const engComparable = engagementComparable(engNow, engPrev);

  const ph = raw.posthog;
  const prev = raw.posthogPrev;
  const hasEng = raw.engagementStatus === 'ready' && ph !== null;

  const salesIqd = sumBy(raw.daily, (d) => d.revenueIqd);
  const salesPrev = sumBy(raw.dailyPrev, (d) => d.revenueIqd);
  const tabs = sumBy(raw.daily, (d) => d.tabs);
  const tabsPrev = sumBy(raw.dailyPrev, (d) => d.tabs);
  const waiterCalls = sumBy(raw.daily, (d) => d.waiterCalls);
  const waiterCallsPrev = sumBy(raw.dailyPrev, (d) => d.waiterCalls);

  const visits = hasEng ? ph.sessionStats.visits : 0;
  const views = hasEng ? sumBy(ph.dailyEngagement, (d) => d.views) : 0;
  const coversEstimated = hasEng && visits > 0 ? Math.round(visits * raw.coversMultiplier) : null;
  const perPersonIqd =
    coversEstimated && coversEstimated > 0 ? Math.round(salesWithin(raw.daily, engNow) / coversEstimated) : null;

  const kpis: Kpis = {
    salesIqd,
    tabs,
    coversEstimated,
    perPersonIqd,
    visits,
    sessions: hasEng ? ph.sessionStats.sessions : 0,
    views,
    medianSeconds: hasEng ? ph.sessionStats.medianSeconds : 0,
    waiterCalls,
    basketToCallPct: hasEng ? ph.basketToCall.pct : 0,
    basketToCallSample: hasEng ? ph.basketToCall.baskets : 0,
  };

  const engDelta = (cur: number, prevV: number | undefined) =>
    hasEng && prev && engComparable && prevV !== undefined ? pctDelta(cur, prevV) : null;
  const deltas: Record<KpiKey, number | null> = {
    sales: pctDelta(salesIqd, salesPrev),
    tabs: pctDelta(tabs, tabsPrev),
    visits: engDelta(visits, prev?.sessionStats.visits),
    views: engDelta(views, prev ? sumBy(prev.dailyEngagement, (d) => d.views) : undefined),
    median: engDelta(kpis.medianSeconds, prev?.sessionStats.medianSeconds),
    calls: pctDelta(waiterCalls, waiterCallsPrev),
    basket: engDelta(kpis.basketToCallPct, prev?.basketToCall.pct),
  };

  const soldTotals = soldTotalsOf(raw.soldByDay, keep);
  const soldByDayKept = raw.soldByDay.filter((r) => keep(r.id));

  const viewsById = hasEng ? ph.topViewed.filter((v) => keep(v.id)).map((v) => ({ id: v.id, count: v.sessions })) : [];
  const cartsById = hasEng ? ph.topCarted.filter((v) => keep(v.id)).map((v) => ({ id: v.id, count: v.sessions })) : [];
  const itemConversion = hasEng ? buildItemConversion(viewsById, cartsById, soldTotals, names, 500) : [];
  const gems = hasEng ? hiddenGems(itemConversion) : [];
  const momentum = itemMomentum(
    viewsById,
    prev ? prev.topViewed.filter((v) => keep(v.id)).map((v) => ({ id: v.id, count: v.sessions })) : [],
    engNow,
    engPrev,
    names,
  );
  const abandoned = hasEng
    ? abandonedViewsNet(
        ph.abandoned.filter((a) => keep(a.id)),
        soldByDayKept.map((r) => ({ id: r.id, date: r.date, qty: r.qty })),
        names,
      )
    : [];

  const costed = raw.menu
    .filter((m) => keep(m.id))
    .map((m) => ({ id: m.id, nameEn: m.nameEn, nameAr: m.nameAr, defaultPriceIqd: m.priceIqd, costIqd: m.costIqd }));
  const menuEngineering = buildMenuEngineering(soldTotals, costed, { popularityRule: 0.7, reliableCoverage: 0.6 });

  const slots = buildMenuSlots(
    raw.menu
      .filter((m) => m.isActive && !m.soldOut && keep(m.id))
      .map((m) => ({
        id: m.id,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        categoryId: m.categoryId,
        categoryNameEn: m.categoryNameEn,
        categoryNameAr: m.categoryNameAr,
        sortOrder: m.itemSort,
        priceIqd: m.priceIqd,
      })),
  );
  const menuPosition = analyzeMenuPosition(slots, soldTotals, raw.todayISO);

  const prices = new Map<string, number>();
  for (const m of raw.menu) if (m.priceIqd > 0) prices.set(m.id, m.priceIqd);
  const priceBands = hasEng
    ? buildPriceBands(
        ph.itemViewsWithPrice.map((v) => ({ id: v.id, priceIqd: v.priceIqd, views: v.sessions })),
        soldTotals,
        prices,
        keep,
        { names },
      )
    : [];

  const pairs = rankPairs(
    raw.boughtTogether
      .filter((p) => keep(p.a) && keep(p.b))
      .map((p) => ({ a: p.a, b: p.b, count: p.both, aCount: p.countA, bCount: p.countB, orders: p.orders })),
    8,
  );

  // Views from PostHog; waiter calls from the DB (truth) — merged on the business date.
  const engByDate = new Map<string, { date: string; views: number; waiterCalls: number }>();
  for (const d of raw.daily) engByDate.set(d.date, { date: d.date, views: 0, waiterCalls: d.waiterCalls });
  if (hasEng) {
    for (const e of ph.dailyEngagement) {
      const cur = engByDate.get(e.date) ?? { date: e.date, views: 0, waiterCalls: 0 };
      cur.views += e.views;
      engByDate.set(e.date, cur);
    }
  }
  const salesVsEng = salesVsEngagement(
    raw.daily.map((d) => ({ date: d.date, revenueIqd: d.revenueIqd, tabs: d.tabs })),
    [...engByDate.values()],
  );

  const basis = buildDataBasis({
    range: raw.range,
    salesDates: datesWithSales,
    sessions: kpis.sessions,
    engagementDays: hasEng ? engNow.days : 0,
    itemsWithSales: soldTotals.filter((s) => s.qty > 0).length,
  });

  const categoryNames = new Map<string, { nameEn: string; nameAr: string }>();
  for (const m of raw.menu) if (m.categoryId) categoryNames.set(m.categoryId, { nameEn: m.categoryNameEn, nameAr: m.categoryNameAr });

  return {
    names,
    keep,
    coverage,
    coveragePrev,
    salesDeltaReliable,
    engNow,
    engPrev,
    engComparable,
    kpis,
    deltas,
    soldTotals,
    itemConversion,
    hiddenGems: gems,
    momentum,
    abandoned,
    menuEngineering,
    menuPosition,
    priceBands,
    pairs,
    salesVsEngagement: salesVsEng,
    basis,
    categoryNames,
  };
}
