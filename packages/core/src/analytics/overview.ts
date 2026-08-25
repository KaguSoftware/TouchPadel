/**
 * Deterministic "AI overview" card. NO model call: it reads the numbers already computed for
 * the page and turns them into a plain-language verdict, so it can never invent a metric.
 *
 * Profit lines lead wherever cost data exists (the menu-engineering quadrants are the
 * highest-value lines this card can carry); revenue-only lines fall in behind. With no cost
 * entered, margin is simply never mentioned — an un-costed item is unknown, not free.
 *
 * All copy comes in through `OverviewCopy` (the operator adapts its `tr()`); the English
 * default below lets tests and the first render start without the i18n package.
 */
import { pickLocale, type Locale } from '../i18n/pickLocale';
import type { ItemRef } from './compare';
import type { MenuEngineering } from './menuMatrix';

/** A KPI has to move at least this many percent vs the comparison window to be called out. */
export const MOVE = 5;
/** Don't judge an individual item on a handful of views. */
export const MIN_VIEWS = 5;

export type OverviewTone = 'good' | 'mixed' | 'weak' | 'neutral';

export type Overview = {
  tone: OverviewTone;
  headline: string;
  /** What's going well. */
  strengths: string[];
  /** Lean into these (promote). */
  push: string[];
  /** Look at these (review / pull back). */
  watch: string[];
};

/** Metrics where "up" is unambiguously good — the ones tallied for the verdict. Dwell and waiter calls are excluded on purpose (ambiguous direction). */
export type OverviewMetricKey =
  | 'totalSales'
  | 'avgSpendPerCover'
  | 'totalCovers'
  | 'basketConversion'
  | 'views'
  | 'sessions';

export const OVERVIEW_METRICS: readonly OverviewMetricKey[] = [
  'totalSales',
  'avgSpendPerCover',
  'totalCovers',
  'basketConversion',
  'views',
  'sessions',
];

export type OverviewInput = {
  preset: string;
  kpis: {
    totalSalesIqd: number;
    /** Estimated (visits × covers multiplier) — shown with "~", never fed into deltas by the caller. */
    totalCovers: number;
    avgSpendPerCoverIqd: number;
    sessions: number;
    medianSeconds: number;
    waiterCalls: number;
    views: number;
    basketConversionPct: number;
  };
  /** Percent deltas vs the comparison window; null = no baseline. */
  deltas: Record<OverviewMetricKey, number | null>;
  itemConversion: readonly (ItemRef & { views: number; carts: number; sold: number; convPct: number })[];
  abandonedViews: readonly (ItemRef & { b5to10: number; b10to20: number; b20plus: number; total: number })[];
  bestSellers: readonly (ItemRef & { qty: number; revenueIqd: number })[];
  /** Absent / `hasData: false` when no cost has been entered — every margin line is then skipped. */
  menuEngineering?: MenuEngineering | null;
};

export type OverviewCopy = {
  locale: Locale;
  metric: Record<OverviewMetricKey, string>;
  /** "in the last 30 days" — the period phrase the headline templates receive. */
  period: (preset: string) => string;
  headline: Record<OverviewTone, (period: string) => string>;
  metricUp: (label: string, pct: number) => string;
  metricDown: (label: string, pct: number) => string;
  bestSeller: (name: string, qty: number, revenueIqd: number) => string;
  pushWinner: (name: string) => string;
  pushHighIntent: (name: string, salesPerTenViews: number) => string;
  abandonedLongReads: (name: string, total: number, longReaders: number) => string;
  abandonedQuickClose: (name: string, total: number) => string;
  deadItem: (name: string, views: number) => string;
  profitSummary: (marginPct: number, profitIqd: number, partial: { revenuePct: number; costedItems: number } | null) => string;
  belowCostOne: (name: string, unitMarginIqd: number, lostIqd: number) => string;
  belowCostMany: (count: number, names: string[], lostIqd: number) => string;
  plowhorse: (name: string, unitMarginIqd: number, avgUnitMarginIqd: number, partial: boolean) => string;
  puzzle: (name: string, unitMarginIqd: number, qty: number) => string;
  dogs: (count: number, profitIqd: number) => string;
};

const en = new Intl.NumberFormat('en');
const money = (n: number) => `${en.format(Math.round(n))} IQD`;
const capFirst = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const DEFAULT_OVERVIEW_COPY_EN: OverviewCopy = {
  locale: 'en',
  metric: {
    totalSales: 'Sales',
    avgSpendPerCover: 'Spend per person',
    totalCovers: 'Covers',
    basketConversion: 'Basket → call/order conversion',
    views: 'Menu views',
    sessions: 'Visits',
  },
  period: (preset) => {
    switch (preset) {
      case 'today':
        return 'today';
      case '7d':
        return 'in the last 7 days';
      case '30d':
        return 'in the last 30 days';
      case '90d':
        return 'in the last 90 days';
      default:
        return 'in the selected period';
    }
  },
  headline: {
    good: (p) => `Things look good ${p} — most indicators are up.`,
    weak: (p) => `${capFirst(p)} some indicators slipped — worth a look at the items below.`,
    mixed: (p) => `${capFirst(p)} the picture is mixed — some things are working, others need attention.`,
    neutral: (p) => `${capFirst(p)} the picture is steady — no clear rise or fall.`,
  },
  metricUp: (label, pct) => `${label} up ${pct}%.`,
  metricDown: (label, pct) => `${label} down ${pct}%.`,
  bestSeller: (name, qty, revenueIqd) =>
    `Best seller: ${name} (${en.format(qty)} sold${revenueIqd > 0 ? `, ${money(revenueIqd)}` : ''}).`,
  pushWinner: (name) => `${name} sells strongly — keep it featured on the menu and in suggestions.`,
  pushHighIntent: (name, perTen) =>
    `${name} converts when seen (about ${perTen} sales per 10 views) — try moving it higher on the menu.`,
  abandonedLongReads: (name, total, long) =>
    `${name} gets looked at but not ordered (${en.format(total)} times); ${en.format(long)} people read it for 20 s+ and gave up — the description or price may be the issue.`,
  abandonedQuickClose: (name, total) =>
    `${name} gets looked at but not ordered (${en.format(total)} times); most close it within seconds — the photo or first impression may be weak.`,
  deadItem: (name, views) => `${name} was viewed ${en.format(views)} times but never sold — review how it is presented.`,
  profitSummary: (marginPct, profitIqd, partial) =>
    `Gross margin ${marginPct}% — ${money(profitIqd)} gross profit${
      partial ? `, across ${partial.costedItems} costed items covering ${partial.revenuePct}% of revenue` : ''
    }.`,
  belowCostOne: (name, unitMargin, lost) =>
    `${name} sells below cost (${money(unitMargin)} per unit) — ${money(lost)} lost over the period; fix the price or portion cost now.`,
  belowCostMany: (count, names, lost) =>
    `${count} items sell below cost (${names.join(', ')}…) — ${money(lost)} lost over the period; fix price/portion cost now.`,
  plowhorse: (name, unitMargin, avg, partial) =>
    `${name} sells a lot but earns little: ${money(unitMargin)} per unit vs a menu average of ${money(avg)}${
      partial ? ' (among costed items)' : ''
    } — trim its portion cost or nudge the price up.`,
  puzzle: (name, unitMargin, qty) =>
    `${name} earns ${money(unitMargin)} per unit but sells little (${en.format(qty)}) — move it up the menu and remind staff; the cheapest profit gain is here.`,
  dogs: (count, profit) =>
    `${count} items sell little and earn little (${money(profit)} total) — consider dropping them; the kitchen gets simpler too.`,
};

export function buildOverview(data: OverviewInput, copy: OverviewCopy = DEFAULT_OVERVIEW_COPY_EN): Overview {
  const { deltas, itemConversion, abandonedViews, bestSellers, preset } = data;
  const name = (ref: ItemRef) => pickLocale({ en: ref.nameEn, ar: ref.nameAr }, copy.locale);

  const strengths: string[] = [];
  const push: string[] = [];
  const watch: string[] = [];
  const metricDeclines: string[] = [];
  /** Item ids already named, so nothing is flagged twice. */
  const mentioned = new Set<string>();

  // ---- profit first: the quadrant lines outrank every revenue-only line ----
  const me = data.menuEngineering?.hasData ? data.menuEngineering : null;
  const partial = me != null && !me.coverage.reliable;

  if (me) {
    strengths.push(
      copy.profitSummary(
        me.totals.marginPct,
        me.totals.profitIqd,
        partial ? { revenuePct: Math.round(me.coverage.revenueRatio * 100), costedItems: me.coverage.costedItems } : null,
      ),
    );

    // Sold below cost — the single most urgent thing this card can say.
    const below = me.items.filter((i) => i.losingMoney).sort((a, b) => a.profitIqd - b.profitIqd);
    if (below.length) {
      for (const i of below.slice(0, 2)) mentioned.add(i.id);
      const lost = Math.abs(below.reduce((s, i) => s + i.profitIqd, 0));
      const first = below[0]!;
      watch.push(
        below.length === 1
          ? copy.belowCostOne(name(first), first.unitMarginIqd, lost)
          : copy.belowCostMany(below.length, below.slice(0, 2).map(name), lost),
      );
    }

    // Plowhorse: carries the traffic, earns little.
    const plowhorse = me.items
      .filter((i) => i.quadrant === 'plowhorse' && !i.losingMoney && !mentioned.has(i.id))
      .sort((a, b) => b.qty - a.qty)[0];
    if (plowhorse) {
      mentioned.add(plowhorse.id);
      watch.push(copy.plowhorse(name(plowhorse), plowhorse.unitMarginIqd, me.avgUnitMarginIqd, partial));
    }

    // Puzzles: profitable but nobody finds them — the cheapest lever on the page.
    const puzzles = me.items
      .filter((i) => i.quadrant === 'puzzle' && !mentioned.has(i.id))
      .sort((a, b) => b.unitMarginIqd - a.unitMarginIqd)
      .slice(0, 2);
    for (const p of puzzles) {
      mentioned.add(p.id);
      push.push(copy.puzzle(name(p), p.unitMarginIqd, p.qty));
    }

    // Dogs: only as a group, and only when there are enough to matter.
    const dogs = me.items.filter((i) => i.quadrant === 'dog' && !i.losingMoney);
    if (dogs.length >= 3) {
      watch.push(copy.dogs(dogs.length, dogs.reduce((s, d) => s + d.profitIqd, 0)));
    }
  }

  // 1. Period-over-period movement — the backbone of the verdict.
  let ups = 0;
  let downs = 0;
  for (const key of OVERVIEW_METRICS) {
    const d = deltas[key];
    if (d == null) continue;
    if (d >= MOVE) {
      ups++;
      strengths.push(copy.metricUp(copy.metric[key], d));
    } else if (d <= -MOVE) {
      downs++;
      metricDeclines.push(copy.metricDown(copy.metric[key], Math.abs(d)));
    }
  }

  // 2. Real best seller — a fact, not a projection.
  const top = bestSellers[0];
  if (top && top.qty > 0) strengths.push(copy.bestSeller(name(top), top.qty, top.revenueIqd));

  // Only trust sales-based judgements when the period actually has item sales.
  const hasSalesData = itemConversion.some((r) => r.sold > 0) || bestSellers.some((b) => b.qty > 0);

  // 3. Push: proven winners, then items that convert views into real sales.
  for (const b of bestSellers.slice(0, 2)) {
    if (b.qty <= 0) continue;
    mentioned.add(b.id);
    push.push(copy.pushWinner(name(b)));
  }
  const highIntent = itemConversion
    .filter((r) => r.views >= MIN_VIEWS && r.sold > 0 && r.convPct >= 40 && !mentioned.has(r.id))
    .sort((a, b) => b.convPct - a.convPct)
    .slice(0, 2);
  for (const r of highIntent) {
    mentioned.add(r.id);
    push.push(copy.pushHighIntent(name(r), Math.round(r.convPct / 10)));
  }

  // 4. Watch: declining KPIs first (capped), then problem items.
  for (const line of metricDeclines.slice(0, 2)) watch.push(line);

  for (const a of abandonedViews.slice(0, 2)) {
    if (a.total < 3 || mentioned.has(a.id)) continue;
    mentioned.add(a.id);
    watch.push(
      a.b20plus >= 2 ? copy.abandonedLongReads(name(a), a.total, a.b20plus) : copy.abandonedQuickClose(name(a), a.total),
    );
  }

  const dead = hasSalesData
    ? itemConversion
        .filter((r) => r.views >= MIN_VIEWS && r.sold === 0 && !mentioned.has(r.id))
        .sort((a, b) => b.views - a.views)
    : [];
  for (const r of dead) {
    if (watch.length >= 4) break;
    mentioned.add(r.id);
    watch.push(copy.deadItem(name(r), r.views));
  }

  // 5. Verdict tone from the tally, then a matching headline.
  let tone: OverviewTone;
  if (ups >= 2 && ups - downs >= 2) tone = 'good';
  else if (downs >= 2 && downs - ups >= 2) tone = 'weak';
  else if (ups > 0 || downs > 0) tone = 'mixed';
  else tone = 'neutral';

  // Rising revenue with items sold below cost is not "going well".
  if (tone === 'good' && me?.items.some((i) => i.losingMoney)) tone = 'mixed';

  return {
    tone,
    headline: copy.headline[tone](copy.period(preset)),
    strengths: strengths.slice(0, 4),
    push: push.slice(0, 3),
    watch: watch.slice(0, 4),
  };
}
