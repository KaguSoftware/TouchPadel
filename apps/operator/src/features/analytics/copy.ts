/**
 * Adapters from the operator's `tr()` to the copy shapes the pure core modules
 * take (`BasisCopy`, `PatternsCopy`). The core never imports @touch/i18n — it
 * receives sentences, so a template change is a catalog change.
 *
 * `analytics.insights.basisCopy.*` exists in BOTH catalogs and is mapped 1:1
 * below. `PatternsCopy.fallback.*` has no catalog
 * counterpart yet (those sentences are normally written by the edge function);
 * the English core defaults stand in, with the labels/samples localised.
 */
import {
  DEFAULT_PATTERNS_COPY_EN,
  type BasisCopy,
  type PatternsCopy,
  type PriceBandBounds,
} from '@touch/core';
import type { Locale, MessageKey, TParams } from '@touch/i18n';
import type { Formatters } from './format';

export type Tr = (key: MessageKey, params?: TParams) => string;

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
