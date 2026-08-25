/**
 * Build the `data` block the `analytics-insights` edge function reads. The model
 * never sees a raw payload: it sees the SAME numbers the cards render, already
 * exclusion-filtered and id-joined, so a finding can always be traced to a card.
 */
import { pickLocale, type Locale } from '@touch/core';
import type { InsightsData, PatternCandidateWire } from '../../lib/analyticsApi';
import type { Derived } from './derive';
import type { RawAnalytics } from './derive';

const name = (derived: Derived, id: string, locale: Locale): string => {
  const ref = derived.names.get(id);
  return ref ? pickLocale({ en: ref.nameEn, ar: ref.nameAr }, locale) || id : id;
};

export function buildInsightsData(
  raw: RawAnalytics,
  derived: Derived,
  locale: Locale,
  extras: { priorInsights?: string[]; rejections: string[]; patterns?: PatternCandidateWire[] } = { rejections: [] },
): InsightsData {
  const k = derived.kpis;
  const me = derived.menuEngineering;

  return {
    kpis: {
      total_sales_iqd: k.salesIqd,
      tabs: k.tabs,
      covers_estimated: k.coversEstimated,
      per_person_iqd: k.perPersonIqd,
      visits: k.visits,
      sessions: k.sessions,
      views: k.views,
      median_seconds: k.medianSeconds,
      waiter_calls: k.waiterCalls,
      basket_to_call_pct: k.basketToCallPct,
    },
    daily: raw.daily.map((d) => ({ date: d.date, revenue_iqd: d.revenueIqd, tabs: d.tabs, orders: d.orders, waiter_calls: d.waiterCalls })),
    best_sellers: raw.bestSellers
      .filter((b) => derived.keep(b.id))
      .slice(0, 15)
      .map((b) => ({ name: name(derived, b.id, locale), qty: b.qty, revenue_iqd: b.revenueIqd, share_pct: b.sharePct })),
    margins: me.hasData
      ? {
          margin_pct: me.totals.marginPct,
          profit_iqd: me.totals.profitIqd,
          avg_unit_margin_iqd: me.avgUnitMarginIqd,
          items: me.items.slice(0, 20).map((i) => ({
            name: name(derived, i.id, locale),
            qty: i.qty,
            unit_margin_iqd: i.unitMarginIqd,
            margin_pct: i.marginPct,
            quadrant: i.quadrant,
            losing_money: i.losingMoney,
          })),
        }
      : null,
    bought_together: derived.pairs.map((p) => ({
      a: name(derived, p.a, locale),
      b: name(derived, p.b, locale),
      count: p.count,
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
    promo: raw.promoSales.qty > 0 ? { ...raw.promoSales } : null,
    engagement: raw.posthog
      ? {
          funnel: raw.posthog.funnel.map((s) => ({ step: s.step, sessions: s.sessions })),
          locale_split: raw.posthog.localePreferences.map((l) => ({ locale: l.locale, sessions: l.sessions })),
          abandoned: derived.abandoned.slice(0, 10).map((a) => ({ name: name(derived, a.id, locale), total: a.total, long: a.b20plus })),
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
      deltas: derived.deltas as unknown as Record<string, unknown>,
      reliable: derived.salesDeltaReliable,
    },
    coverage: {
      days: derived.coverage.days,
      days_with_data: derived.coverage.daysWithData,
      ratio: derived.coverage.ratio,
      cost_revenue_pct: Math.round(me.coverage.revenueRatio * 100),
    },
  };
}
