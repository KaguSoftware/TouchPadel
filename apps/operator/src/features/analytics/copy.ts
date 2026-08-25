/**
 * Adapters from the operator's `tr()` to the copy shapes the pure core modules
 * take (`OverviewCopy`, `BasisCopy`, `PatternsCopy`). The core never imports
 * @touch/i18n — it receives sentences, so a template change is a catalog change.
 *
 * `analytics.overview.copy.*` and `analytics.insights.basisCopy.*` exist in BOTH
 * catalogs and are mapped 1:1 below. `PatternsCopy.fallback.*` has no catalog
 * counterpart yet (those sentences are normally written by the edge function);
 * the English core defaults stand in, with the labels/samples localised.
 */
import {
  DEFAULT_PATTERNS_COPY_EN,
  type BasisCopy,
  type OverviewCopy,
  type PatternsCopy,
  type PriceBandBounds,
} from '@touch/core';
import type { Locale, MessageKey, TParams } from '@touch/i18n';
import type { Formatters } from './format';

export type Tr = (key: MessageKey, params?: TParams) => string;

const PERIOD_KEY: Record<string, MessageKey> = {
  today: 'analytics.overview.copy.periodToday',
  '7d': 'analytics.overview.copy.period7d',
  '30d': 'analytics.overview.copy.period30d',
  '90d': 'analytics.overview.copy.period90d',
};

const WEEKDAY_KEYS: readonly MessageKey[] = [
  'analytics.weekdays.sun',
  'analytics.weekdays.mon',
  'analytics.weekdays.tue',
  'analytics.weekdays.wed',
  'analytics.weekdays.thu',
  'analytics.weekdays.fri',
  'analytics.weekdays.sat',
];

/** Weekday name from a JS day index (0 = Sunday), in the operator locale. */
export function weekdayName(tr: Tr, dow: number): string {
  return tr(WEEKDAY_KEYS[((dow % 7) + 7) % 7]!);
}

export function overviewCopy(tr: Tr, f: Formatters, locale: Locale): OverviewCopy {
  const c = (k: string) => `analytics.overview.copy.${k}` as MessageKey;
  return {
    locale,
    metric: {
      totalSales: tr('analytics.kpi.sales'),
      avgSpendPerCover: tr('analytics.kpi.perPerson'),
      totalCovers: tr('analytics.kpi.covers'),
      basketConversion: tr('analytics.kpi.basketToCall'),
      views: tr('analytics.kpi.views'),
      sessions: tr('analytics.kpi.visits'),
    },
    period: (preset) => tr(PERIOD_KEY[preset] ?? 'analytics.overview.copy.periodCustom'),
    headline: {
      good: (period) => tr(c('headlineGood'), { period }),
      weak: (period) => tr(c('headlineWeak'), { period }),
      mixed: (period) => tr(c('headlineMixed'), { period }),
      neutral: (period) => tr(c('headlineNeutral'), { period }),
    },
    metricUp: (label, pct) => tr(c('metricUp'), { label, pct: f.num(pct) }),
    metricDown: (label, pct) => tr(c('metricDown'), { label, pct: f.num(pct) }),
    bestSeller: (name, qty, revenueIqd) =>
      tr(c('bestSeller'), { name, qty: f.num(qty), money: revenueIqd > 0 ? `, ${f.money(revenueIqd)}` : '' }),
    pushWinner: (name) => tr(c('pushWinner'), { name }),
    pushHighIntent: (name, perTen) => tr(c('pushHighIntent'), { name, perTen: f.num(perTen) }),
    abandonedLongReads: (name, total, long) =>
      tr(c('abandonedLongReads'), { name, total: f.num(total), long: f.num(long) }),
    abandonedQuickClose: (name, total) => tr(c('abandonedQuickClose'), { name, total: f.num(total) }),
    deadItem: (name, views) => tr(c('deadItem'), { name, views: f.num(views) }),
    profitSummary: (marginPct, profitIqd, partial) =>
      tr(c('profitSummary'), {
        pct: f.num(marginPct),
        money: f.money(profitIqd),
        partial: partial ? tr(c('profitPartial'), { items: f.num(partial.costedItems), pct: f.num(partial.revenuePct) }) : '',
      }),
    belowCostOne: (name, unitMargin, lost) =>
      tr(c('belowCostOne'), { name, money: f.money(unitMargin), lost: f.money(lost) }),
    belowCostMany: (count, names, lost) =>
      tr(c('belowCostMany'), { count: f.num(count), names: names.join(', '), lost: f.money(lost) }),
    plowhorse: (name, unitMargin, avg, partial) =>
      tr(c('plowhorse'), {
        name,
        money: f.money(unitMargin),
        avg: f.money(avg),
        partial: partial ? tr(c('plowhorsePartial')) : '',
      }),
    puzzle: (name, unitMargin, qty) => tr(c('puzzle'), { name, money: f.money(unitMargin), qty: f.num(qty) }),
    dogs: (count, profit) => tr(c('dogs'), { count: f.num(count), money: f.money(profit) }),
  };
}

export function basisCopy(tr: Tr, f: Formatters): BasisCopy {
  return {
    salesDays: (s, r) => tr('analytics.insights.basisCopy.salesDays', { s: f.num(s), r: f.num(r) }),
    sessions: (n) => tr('analytics.insights.basisCopy.sessions', { n: f.num(n) }),
    items: (n) => tr('analytics.insights.basisCopy.items', { n: f.num(n) }),
    separator: ' · ',
  };
}

export function patternsCopy(tr: Tr, f: Formatters, locale: Locale): PatternsCopy {
  const bandLabel = (b: PriceBandBounds) =>
    b.maxIqd === null ? `${f.num(b.minIqd)}+ ${localeUnit(locale)}` : `${f.num(b.minIqd)}–${f.num(b.maxIqd - 1)} ${localeUnit(locale)}`;
  return {
    ...DEFAULT_PATTERNS_COPY_EN,
    locale,
    weekday: (d) => weekdayName(tr, d),
    bandLabel,
    localeLabel: (l) => (l === 'ar' ? tr('settings.arabic') : l === 'en' ? tr('settings.english') : l),
    sample: {
      ...DEFAULT_PATTERNS_COPY_EN.sample,
      days: (n) => tr('analytics.patterns.sample.days', { n: f.num(n) }),
      coOrders: (count) => tr('analytics.patterns.sample.coOrders', { n: f.num(count) }),
      weekdays: (n, wd) => tr('analytics.patterns.sample.weekdays', { n: f.num(n), day: wd }),
      views: (n) => tr('analytics.patterns.sample.views', { n: f.num(n) }),
    },
  };
}

function localeUnit(locale: Locale): string {
  return locale === 'ar' ? 'د.ع' : 'IQD';
}
