/**
 * Build the `data` block the `analytics-insights` edge function reads. The model
 * never sees a raw payload: it sees the SAME numbers the cards render, already
 * exclusion-filtered and id-joined, so a finding can always be traced to a card.
 * The shape is `CafeInsightsPayload` from @touch/core, byte-shared with the
 * edge function: a key added here without the contract is a compile error.
 */
import { pickLocale, type Locale } from '@touch/core';
import type { CafeInsightsPayload, PatternCandidateWire } from '../../lib/analyticsApi';
import { avgOrderValue, sumBy, type Derived, type RawAnalytics } from './derive';

const name = (derived: Derived, id: string, locale: Locale): string => {
  const ref = derived.names.get(id);
  return ref ? pickLocale({ en: ref.nameEn, ar: ref.nameAr }, locale) || id : id;
};

/** How many item rows each block carries: enough to reason over, small enough to read. */
const TOP_ITEMS = 15;
const TOP_MARGIN_ITEMS = 20;
const TOP_CONVERSION = 25;
const TOP_ABANDONED = 10;

export function buildInsightsData(
  raw: RawAnalytics,
  derived: Derived,
  locale: Locale,
  extras: { priorInsights?: string[]; rejections: string[]; patterns?: PatternCandidateWire[] } = { rejections: [] },
): CafeInsightsPayload {
  const k = derived.kpis;
  const me = derived.menuEngineering;
  const meById = new Map(me.items.map((i) => [i.id, i]));
  const prev = raw.dailyPrev;

  return {
    kpis: {
      total_sales_iqd: k.salesIqd,
      tabs: k.tabs,
      orders: sumBy(raw.daily, (d) => d.orders),
      items_qty: sumBy(raw.daily, (d) => d.itemsQty),
      cash_iqd: k.cashIqd,
      card_iqd: k.cardIqd,
      discount_iqd: k.discountIqd,
      refunds_iqd: k.refundsIqd,
      waste_iqd: k.wasteIqd,
      cafe_gross_iqd: k.cafeGrossIqd,
      avg_order_value_iqd: k.avgOrderValueIqd,
      qr_orders: k.qrOrders,
      till_orders: k.tillOrders,
      qr_share_pct: k.qrShare.pct,
      sessions: k.sessions,
      views: k.views,
      median_seconds: k.medianSeconds,
      waiter_calls: k.waiterCalls,
      basket_to_call_pct: k.basketToCallPct,
    },
    daily: raw.daily.map((d) => ({
      date: d.date,
      revenue_iqd: d.revenueIqd,
      tabs: d.tabs,
      orders: d.orders,
      items_qty: d.itemsQty,
      discount_iqd: d.discountIqd,
      refunds_iqd: d.refundsIqd,
      waste_iqd: d.wasteIqd,
      waiter_calls: d.waiterCalls,
    })),
    best_sellers: raw.bestSellers
      .filter((b) => derived.keep(b.id))
      .slice(0, TOP_ITEMS)
      .map((b) => ({ name: name(derived, b.id, locale), qty: b.qty, revenue_iqd: b.revenueIqd, share_pct: b.sharePct })),
    // The SERVER margin rows (net revenue, the cost snapshotted on each line)
    // with the matrix's verdict per item; the model reads the same rows the
    // menu matrix does.
    margins:
      raw.margins.items.length > 0
        ? {
            cost_basis: raw.margins.costBasis,
            coverage: {
              revenue_with_cost_pct: raw.margins.coverage.revenueWithCostPct,
              items_with_cost: raw.margins.coverage.itemsWithCost,
              items_total: raw.margins.coverage.itemsTotal,
            },
            margin_pct: me.hasData ? me.totals.marginPct : null,
            profit_iqd: me.hasData ? me.totals.profitIqd : null,
            avg_unit_margin_iqd: me.hasData ? me.avgUnitMarginIqd : null,
            items: raw.margins.items
              .filter((i) => derived.keep(i.id))
              .slice(0, TOP_MARGIN_ITEMS)
              .map((i) => ({
                name: name(derived, i.id, locale),
                qty: i.qty,
                revenue_iqd: i.revenueIqd,
                has_cost: i.hasCost,
                cost_iqd: i.costIqd,
                margin_iqd: i.marginIqd,
                margin_pct: i.marginPct,
                quadrant: meById.get(i.id)?.quadrant ?? null,
                losing_money: meById.get(i.id)?.losingMoney ?? false,
              })),
          }
        : null,
    bought_together: derived.pairs.map((p) => ({
      a: name(derived, p.a, locale),
      b: name(derived, p.b, locale),
      both: p.count,
      confidence_pct: p.confidencePct,
      lift: p.lift,
    })),
    price_bands: derived.priceBands.map((b) => ({
      min_iqd: b.minIqd,
      max_iqd: b.maxIqd,
      views: b.views,
      sold: b.sold,
      conv_pct: b.convPctCapped,
      sold_without_view: b.soldWithoutView,
    })),
    promo:
      raw.promoSales.qty > 0
        ? {
            qty: raw.promoSales.qty,
            list_revenue_iqd: raw.promoSales.listRevenueIqd,
            revenue_iqd: raw.promoSales.revenueIqd,
            discount_iqd: raw.promoSales.discountIqd,
            orders: raw.promoSales.orders,
          }
        : null,
    engagement: raw.posthog
      ? {
          funnel: raw.posthog.funnel.map((s) => ({ step: s.step, sessions: s.sessions })),
          item_conversion: derived.itemConversion.slice(0, TOP_CONVERSION).map((c) => ({
            name: pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || c.id,
            views: c.views,
            carts: c.carts,
            sold: c.sold,
            conv_pct: c.convPct,
          })),
          abandoned: derived.abandoned.slice(0, TOP_ABANDONED).map((a) => ({
            name: name(derived, a.id, locale),
            total: a.total,
            dwell_under_10s: a.b5to10,
            dwell_10_20s: a.b10to20,
            dwell_over_20s: a.b20plus,
          })),
        }
      : undefined,
    prior_insights: extras.priorInsights,
    rejections: extras.rejections,
    patterns: extras.patterns,
    basis: { salesDays: derived.basis.salesDays, weekdayCounts: derived.basis.weekdayCounts },
    excluded_names: raw.excludedIds.map((id) => name(derived, id, locale)),
    compare: {
      from: raw.compareRange.from,
      to: raw.compareRange.to,
      basis: raw.compareBasis,
      reliable: derived.salesDeltaReliable,
      kpis: {
        total_sales_iqd: sumBy(prev, (d) => d.revenueIqd),
        tabs: sumBy(prev, (d) => d.tabs),
        orders: sumBy(prev, (d) => d.orders),
        items_qty: sumBy(prev, (d) => d.itemsQty),
        cash_iqd: sumBy(prev, (d) => d.cashIqd),
        card_iqd: sumBy(prev, (d) => d.cardIqd),
        discount_iqd: sumBy(prev, (d) => d.discountIqd),
        refunds_iqd: sumBy(prev, (d) => d.refundsIqd),
        waste_iqd: sumBy(prev, (d) => d.wasteIqd),
        cafe_gross_iqd: sumBy(prev, (d) => d.cafeGrossIqd),
        avg_order_value_iqd: avgOrderValue(sumBy(prev, (d) => d.cafeGrossIqd), sumBy(prev, (d) => d.orders)),
        waiter_calls: sumBy(prev, (d) => d.waiterCalls),
      },
      deltas: { ...derived.deltas },
    },
    coverage: {
      days: derived.coverage.days,
      days_with_data: derived.coverage.daysWithData,
      ratio: derived.coverage.ratio,
      cost_revenue_pct: Math.round(me.coverage.revenueRatio * 100),
    },
  };
}
