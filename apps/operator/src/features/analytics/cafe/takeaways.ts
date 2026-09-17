/**
 * Each Cafe section's answer, as the sentence read before any chart — the
 * counterpart of courts/takeaways.ts, on the same rules: built only from what
 * the section's cards show, counts printed as counts, and null when the
 * section's own empty state already says there is nothing.
 */
import { pickLocale } from '@touch/core';
import type { Locale } from '@touch/i18n';
import { weekdayName, type Tr } from '../copy';
import type { Derived, RawAnalytics } from '../derive';
import type { Formatters } from '../format';

const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' ') || null;
const itemName = (i: { id: string; nameEn: string; nameAr: string }, locale: Locale) => pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || i.id;

/** Menu: what makes the most money, and what sells below cost. */
export function menuTakeaway(derived: Derived, tr: Tr, f: Formatters, locale: Locale): string | null {
  const items = derived.menuEngineering.items;
  if (items.length === 0) return null;
  const top = items.reduce((b, i) => (i.profitIqd > b.profitIqd ? i : b));
  const below = items.filter((i) => i.losingMoney);
  return join(
    top.profitIqd > 0 ? tr('analytics.lead.menuTop', { item: itemName(top, locale), money: f.money(top.profitIqd), qty: f.num(top.qty) }) : null,
    below.length > 0 ? tr('analytics.lead.menuBelowCost', { n: f.num(below.length) }) : null,
  );
}

/** Sales: the best seller and the best day. */
export function salesTakeaway(raw: RawAnalytics, derived: Derived, tr: Tr, f: Formatters, locale: Locale): string | null {
  const best = raw.bestSellers.find((b) => derived.keep(b.id));
  const days = derived.salesVsEngagement.filter((d) => d.revenue != null && d.revenue > 0);
  const bestDay = days.reduce<(typeof days)[number] | null>((b, d) => (b === null || d.revenue! > b.revenue! ? d : b), null);
  return join(
    best ? tr('analytics.lead.salesBest', { item: itemName(best, locale), money: f.money(best.revenueIqd), qty: f.num(best.qty) }) : null,
    bestDay && days.length > 1 ? tr('analytics.lead.salesDay', { date: f.date(bestDay.date), money: f.money(bestDay.revenue!) }) : null,
  );
}

/**
 * Busy times: the weekday-hour with the most orders. The heatmap counts orders
 * on SETTLED tabs (app.analytics_hourly), so it will not add up to the Orders
 * figure, which counts every order placed; the sentence says which it counts.
 */
export function timeTakeaway(raw: RawAnalytics, tr: Tr, f: Formatters): string | null {
  const cells = raw.hourly.filter((c) => c.orders > 0);
  if (cells.length === 0) return null;
  const peak = cells.reduce((b, c) => (c.orders > b.orders ? c : b));
  return tr('analytics.lead.timePeak', { slot: `${weekdayName(tr, peak.dow)} ${f.hour(peak.hour)}`, n: f.num(peak.orders) });
}
