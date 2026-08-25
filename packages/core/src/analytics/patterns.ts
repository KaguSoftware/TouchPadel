/**
 * Deterministic pattern miner for the analytics "Patterns" card.
 *
 * This file does the MATH — never an LLM. It computes statistically-grounded candidate
 * patterns (share correlation, market-basket lift, weekday over-indexing, segment skews,
 * margin drift), each with its supporting numbers, sample size and a strength score. The
 * model's only job downstream (the `analytics-insights` edge function) is to reject the
 * obvious ones and phrase the survivors; without it, `fallbackText` renders.
 *
 * Two guards run through every family:
 *  - the BUSY-DAY confound: co-movement is measured on each item's daily SHARE of sales, so
 *    "both were up because Saturday was packed" does not survive;
 *  - SAMPLE SIZE by disclosure: thin candidates are still surfaced, but labelled with their
 *    sample, tiered `low`, sorted beneath better-supported ones and phrased as hypotheses.
 *
 * Inputs are pre-aggregated by the caller (SQL RPCs + PostHog edge queries); everything is
 * keyed by item id and copy comes in via `PatternsCopy`.
 */
import { iqd } from '../money/iqd';
import { pickLocale, type Locale } from '../i18n/pickLocale';
import { dayOfWeekOfDate } from '../time/tz';
import { tallyBaskets } from './basket';
import { assertCount, type ItemNames, refOf } from './compare';
import type { PriceBandBounds, PriceBandSales } from './priceBands';

export type PatternKind = 'co-move' | 'basket' | 'time' | 'segment' | 'margin';

export type PatternConfidence = 'high' | 'medium' | 'low';

export type PatternLevel = 0 | 1 | 2;

export type PatternCandidate = {
  /** Stable key from kind + subject ids — dedupes across widening cycles and persisted sets. */
  id: string;
  kind: PatternKind;
  /** Display names / dimension labels the pattern is about (in the copy's locale). */
  subjects: string[];
  /** Item ids behind `subjects` (empty for non-item subjects such as weekdays). */
  subjectIds: string[];
  /** Machine-readable figures backing the claim (shown in the UI, fed to the judge). */
  metrics: Record<string, number | string>;
  /** Orders / days / views the pattern rests on — the honesty floor. */
  sampleSize: number;
  confidence: PatternConfidence;
  /** The sample in plain words, shown verbatim next to the claim. */
  sampleLabel: string;
  /** 0..1 normalised strength of the signal itself. */
  strength: number;
  /** Ranking score = strength × sample weight; higher surfaces first within a tier. */
  score: number;
  /** Neutral, structured English description handed to the LLM judge. */
  desc: string;
  /** Templated sentence in the copy's locale, shown when the judge is unavailable. */
  fallbackText: string;
};

export type SoldByDayRow = { id: string; date: string; qty: number; revenueIqd: number };

export type LocaleAudience = {
  locale: string;
  sessions: number;
  /** Items by penetration rate (share of this locale's own sessions that viewed it), best first. */
  topItems: readonly { id: string; rate: number }[];
};

export type PatternsInput = {
  /** Day-grain sold items (business dates), already exclusion-filtered by the caller or via `keep`. */
  soldByDay: readonly SoldByDayRow[];
  /** Business dates with any sales at all — the shared day axis. */
  recordedDays: readonly string[];
  /** Item ids per order (distinct-ified inside); omit when unavailable. */
  baskets?: readonly (readonly string[])[];
  /** From `buildPriceBands`; omit when engagement data is absent. */
  priceBands?: readonly PriceBandSales[];
  /** Views → real sales for discounted vs full-price items; omit when unknown. */
  discount?: { discounted: { views: number; sold: number }; regular: { views: number; sold: number } } | null;
  /** Two (or more) menu-language audiences; the two largest are compared. */
  locales?: readonly LocaleAudience[];
  /** Only items WITH a cost; an empty/absent map mines no margin patterns. */
  costs?: ReadonlyMap<string, { priceIqd: number; costIqd: number }>;
  names: ItemNames;
  keep?: (id: string) => boolean;
};

export type PatternsCopy = {
  locale: Locale;
  weekday: (dow: number) => string;
  bandLabel: (band: PriceBandBounds) => string;
  localeLabel: (locale: string) => string;
  discountSubject: string;
  marginSubject: string;
  sample: {
    days: (n: number) => string;
    coOrders: (count: number, orders: number) => string;
    weekdays: (n: number, weekday: string) => string;
    views: (n: number) => string;
    sessions: (parts: readonly { label: string; sessions: number }[]) => string;
    weekdayPair: (bestDays: number, bestDay: string, worstDays: number, worstDay: string) => string;
  };
  fallback: {
    coMoveTogether: (a: string, b: string, corr: number, days: number) => string;
    coMoveInverse: (a: string, b: string, corr: number, days: number) => string;
    basket: (a: string, b: string, confidencePct: number, lift: number, count: number) => string;
    weekdaySkew: (item: string, weekday: string, itemDayPct: number, houseDayPct: number, index: number, days: number) => string;
    priceCliff: (bestBand: string, bestPerView: number, worstBand: string, worstPerView: number) => string;
    discountLift: (discountedPct: number, regularPct: number) => string;
    discountNoLift: (discountedPct: number, regularPct: number) => string;
    localeSplit: (aLabel: string, aItem: string, aPct: number, bLabel: string, bItem: string, bPct: number) => string;
    marginUp: (earlyPct: number, latePct: number, days: number, driver: string | null) => string;
    marginDown: (earlyPct: number, latePct: number, days: number, driver: string | null) => string;
    marginWeekdayBusiest: (worstDay: string, worstPct: number, bestDay: string, bestPct: number, worstDays: number) => string;
    marginWeekday: (worstDay: string, worstPct: number, bestDay: string, bestPct: number, worstDays: number, bestDays: number, gap: number) => string;
  };
};

const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const enNum = new Intl.NumberFormat('en');

export const DEFAULT_PATTERNS_COPY_EN: PatternsCopy = {
  locale: 'en',
  weekday: (d) => EN_WEEKDAYS[d] ?? String(d),
  bandLabel: (b) =>
    b.maxIqd === null ? `${enNum.format(b.minIqd)}+ IQD` : `${enNum.format(b.minIqd)}–${enNum.format(b.maxIqd - 1)} IQD`,
  localeLabel: (l) => (l === 'ar' ? 'Arabic' : l === 'en' ? 'English' : l),
  discountSubject: 'Discounts',
  marginSubject: 'Gross margin',
  sample: {
    days: (n) => `${n} days`,
    coOrders: (count, orders) => `${count} / ${orders} orders`,
    weekdays: (n, wd) => `${n} ${wd}s`,
    views: (n) => `${n} views`,
    sessions: (parts) => parts.map((p) => `${p.sessions} ${p.label}`).join(' / ') + ' sessions',
    weekdayPair: (bd, b, wd, w) => `${bd} ${b}s / ${wd} ${w}s`,
  },
  fallback: {
    coMoveTogether: (a, b, corr, days) =>
      `${a} and ${b} move together across days (share correlation ${corr}, ${days} days) — suggest one when the other is ordered.`,
    coMoveInverse: (a, b, corr, days) =>
      `${b} slips on the days ${a} sells well (inverse correlation ${corr}, ${days} days) — one may be replacing the other.`,
    basket: (a, b, conf, lift, count) =>
      `${conf}% of orders with ${a} also include ${b} (${lift}× chance, ${count} orders) — a combo / cross-sell opportunity.`,
    weekdaySkew: (item, wd, itemPct, housePct, index, days) =>
      `${item} skews to ${wd}: ${itemPct}% of its sales land that day vs ${housePct}% of all sales (${index}× the house level, over ${days} ${wd}s) — an item-specific rhythm, not just a busy day.`,
    priceCliff: (best, bestPer, worst, worstPer) =>
      `${best} items sell ${bestPer} units per view while ${worst} items sell ${worstPer} — the cheap band is ordered without browsing, the pricey band is browsed far more than it is bought.`,
    discountLift: (d, r) =>
      `Discounted items turn ${d} of every 100 views into sales vs ${r} for full price — discounts genuinely sell; use them selectively.`,
    discountNoLift: (d, r) =>
      `Discounts are not lifting sales (${d} sales per 100 views discounted vs ${r} full price) — review presentation instead of price.`,
    localeSplit: (aL, aI, aP, bL, bI, bP) =>
      `${aL}-menu guests gravitate to ${aI} (${aP}% of their sessions) while ${bL}-menu guests gravitate to ${bI} (${bP}%) — feature a different item per language.`,
    marginUp: (e, l, days, driver) =>
      `Gross margin rose from ${e}% in the first half of the period to ${l}% in the second (${days} days)${driver ? ` — biggest contributor ${driver}` : ''}. The mix changed, not the revenue; protect it.`,
    marginDown: (e, l, days, driver) =>
      `Gross margin fell from ${e}% in the first half of the period to ${l}% in the second (${days} days)${driver ? ` — centred on ${driver}` : ''}. Revenue can hold while profit erodes; stop the drift to low-margin items.`,
    marginWeekdayBusiest: (wD, wP, bD, bP, wDays) =>
      `${wD} is the biggest revenue day but the thinnest margin (${wP}% vs ${bP}% on ${bD}; over ${wDays} ${wD}s). Shift that day's mix toward higher-margin items.`,
    marginWeekday: (wD, wP, bD, bP, wDays, bDays, gap) =>
      `${wD}s run a ${wP}% margin, ${bD}s ${bP}% (${wDays}/${bDays} days) — same menu, ${gap} points apart; look at the weak day's mix.`,
  },
};

/** Tier a sample against its own medium/high thresholds. */
function tier(sample: number, medium: number, high: number): PatternConfidence {
  if (sample >= high) return 'high';
  if (sample >= medium) return 'medium';
  return 'low';
}

/** The lower of two tiers — a claim is only as sound as its thinnest sample. */
function weakest(...tiers: PatternConfidence[]): PatternConfidence {
  if (tiers.includes('low')) return 'low';
  return tiers.includes('medium') ? 'medium' : 'high';
}

const TIER_RANK: Record<PatternConfidence, number> = { high: 2, medium: 1, low: 0 };

type Thresholds = {
  minDays: number; // recorded days needed to trust a daily correlation
  minItemDays: number; // days an item must have sold on to enter co-move
  minItemQty: number; // total qty an item needs to be worth correlating
  minShareCorr: number; // |share correlation| floor (busy-day-controlled)
  minBasketSupport: number; // co-orders needed for a basket pair
  minLift: number; // lift floor (1 = independent → obvious)
  minWeekdayQty: number; // qty on a weekday to call it an over-index
  minWeekdayIndex: number; // observed/expected share to flag a weekday skew
  minWeekdayDays: number; // occurrences of that weekday in the recorded range
  minSegmentViews: number; // distinct-session views floor for segment skews
};

/**
 * Widening levels: mine at 0 first; when too few survive, re-mine at the next level with
 * looser floors. Every level keeps a real significance floor — loosening never means inventing.
 */
const LEVELS: readonly Thresholds[] = [
  { minDays: 8, minItemDays: 4, minItemQty: 12, minShareCorr: 0.55, minBasketSupport: 5, minLift: 1.6, minWeekdayQty: 8, minWeekdayIndex: 1.7, minWeekdayDays: 5, minSegmentViews: 30 },
  { minDays: 6, minItemDays: 3, minItemQty: 8, minShareCorr: 0.5, minBasketSupport: 4, minLift: 1.45, minWeekdayQty: 6, minWeekdayIndex: 1.55, minWeekdayDays: 3, minSegmentViews: 20 },
  { minDays: 5, minItemDays: 3, minItemQty: 6, minShareCorr: 0.45, minBasketSupport: 3, minLift: 1.35, minWeekdayQty: 5, minWeekdayIndex: 1.45, minWeekdayDays: 2, minSegmentViews: 14 },
];

export const MAX_PATTERN_LEVEL = LEVELS.length;

/** Sample thresholds per pattern shape: `[medium, high]`; below `medium` tiers as `low`. */
export const SAMPLE_TIERS = {
  coMoveDays: [10, 21],
  basketSupport: [5, 12],
  basketOrders: [15, 60],
  weekdayOccurrences: [4, 8],
  segmentViews: [40, 150],
  marginDays: [12, 24],
} as const satisfies Record<string, readonly [number, number]>;

/** Percentage points of margin movement below which a shift is noise. */
export const MIN_MARGIN_SHIFT_POINTS = 3;
/** Costed revenue (IQD) each half of the period needs before its margin is readable. */
export const MIN_HALF_REVENUE_IQD = 100_000;
/** An item must reach this penetration in its own locale to count as that audience's favourite. */
export const MIN_LOCALE_RATE = 0.15;
/** Each locale audience needs this many sessions before the two are compared. */
export const MIN_LOCALE_SESSIONS = 8;

// ---------- small helpers ----------

/**
 * Pearson correlation of two equal-length vectors. 0 on degenerate input.
 *
 * Two-pass (centred) sums, not the one-pass `n·Σxy − Σx·Σy` form: on a constant vector the
 * one-pass form leaves ~1e-15 of cancellation noise in the variance and the quotient of two
 * noise terms reads as a confident ±1 — which is exactly the "pure-volume pair" the share
 * control exists to kill. A spread within floating-point noise of the mean is treated as
 * constant, and the result is clamped to [−1, 1].
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const noise = (ss: number, mean: number) => ss <= n * (1e-9 * Math.max(Math.abs(mean), 1e-9)) ** 2;
  if (noise(sxx, mx) || noise(syy, my)) return 0;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(n * 100);
const idKey = (kind: PatternKind, parts: readonly string[]) => `${kind}:${[...parts].sort().join('|')}`;

type Ctx = {
  t: Thresholds;
  copy: PatternsCopy;
  name: (id: string) => string;
};

// ---------- family 1: item co-movement (busy-day-controlled) ----------

function mineCoMovement(sold: readonly SoldByDayRow[], recordedDays: readonly string[], c: Ctx): PatternCandidate[] {
  const { t, copy } = c;
  if (recordedDays.length < t.minDays) return [];
  const dayIndex = new Map(recordedDays.map((d, i) => [d, i] as const));
  const n = recordedDays.length;

  const qtyByItem = new Map<string, number[]>();
  const totalByDay = new Array<number>(n).fill(0);
  const daysActive = new Map<string, number>();
  const totalQty = new Map<string, number>();
  for (const row of sold) {
    const di = dayIndex.get(row.date);
    if (di === undefined || row.qty <= 0) continue;
    let vec = qtyByItem.get(row.id);
    if (!vec) {
      vec = new Array<number>(n).fill(0);
      qtyByItem.set(row.id, vec);
    }
    if (vec[di] === 0) daysActive.set(row.id, (daysActive.get(row.id) ?? 0) + 1);
    vec[di]! += row.qty;
    totalByDay[di]! += row.qty;
    totalQty.set(row.id, (totalQty.get(row.id) ?? 0) + row.qty);
  }

  const items = [...qtyByItem.keys()]
    .filter((id) => (daysActive.get(id) ?? 0) >= t.minItemDays && (totalQty.get(id) ?? 0) >= t.minItemQty)
    .sort();
  const shareByItem = new Map<string, number[]>();
  for (const id of items) {
    shareByItem.set(
      id,
      qtyByItem.get(id)!.map((q, di) => (totalByDay[di]! > 0 ? q / totalByDay[di]! : 0)),
    );
  }

  const out: PatternCandidate[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const shareCorr = pearson(shareByItem.get(a)!, shareByItem.get(b)!);
      if (Math.abs(shareCorr) < t.minShareCorr) continue;
      const rawCorr = pearson(qtyByItem.get(a)!, qtyByItem.get(b)!);
      // A share correlation that flips sign vs raw is an artifact — demand both agree.
      if (Math.sign(shareCorr) !== Math.sign(rawCorr) || rawCorr === 0) continue;

      const positive = shareCorr > 0;
      const strength = Math.min(1, Math.abs(shareCorr));
      const an = c.name(a);
      const bn = c.name(b);
      out.push({
        id: idKey('co-move', [a, b]),
        kind: 'co-move',
        subjects: [an, bn],
        subjectIds: [a, b],
        metrics: {
          shareCorrelation: round1(shareCorr),
          rawCorrelation: round1(rawCorr),
          days: n,
          direction: positive ? 'together' : 'inverse',
        },
        sampleSize: n,
        confidence: tier(n, ...SAMPLE_TIERS.coMoveDays),
        sampleLabel: copy.sample.days(n),
        strength,
        score: strength * Math.log2(n + 2),
        desc:
          `Daily-share correlation between "${an}" and "${bn}" over ${n} recorded days is ` +
          `${round1(shareCorr)} (${positive ? 'move together' : 'move inversely'}), measured on each ` +
          `item's share of the day's sales so busy/slow days are already controlled for. ` +
          `Raw quantity correlation ${round1(rawCorr)}.`,
        fallbackText: positive
          ? copy.fallback.coMoveTogether(an, bn, round1(shareCorr), n)
          : copy.fallback.coMoveInverse(an, bn, round1(shareCorr), n),
      });
    }
  }
  return out;
}

// ---------- family 2: market-basket lift ----------

function mineBasketLift(baskets: readonly (readonly string[])[], keep: (id: string) => boolean, c: Ctx): PatternCandidate[] {
  const { t, copy } = c;
  const tally = tallyBaskets(baskets, keep);
  if (tally.orders < 4) return [];
  const out: PatternCandidate[] = [];
  for (const p of tally.pairs) {
    if (p.count < t.minBasketSupport) continue;
    const lift = (p.count * tally.orders) / (p.aCount * p.bCount);
    if (lift < t.minLift) continue;
    // Confidence from the rarer item's side — the higher, more actionable rate.
    const [a, b, base] = p.aCount <= p.bCount ? [p.a, p.b, p.aCount] : [p.b, p.a, p.bCount];
    const confidence = base > 0 ? p.count / base : 0;
    const strength = Math.min(1, (lift - 1) / 3); // lift 4 → ~1.0
    const an = c.name(a);
    const bn = c.name(b);
    out.push({
      id: idKey('basket', [a, b]),
      kind: 'basket',
      subjects: [an, bn],
      subjectIds: [a, b],
      metrics: { lift: round1(lift), support: p.count, confidencePct: pct(confidence), orders: tally.orders },
      sampleSize: p.count,
      confidence: weakest(tier(p.count, ...SAMPLE_TIERS.basketSupport), tier(tally.orders, ...SAMPLE_TIERS.basketOrders)),
      sampleLabel: copy.sample.coOrders(p.count, tally.orders),
      strength,
      score: strength * Math.log2(p.count + 2),
      desc:
        `"${an}" and "${bn}" appear together in ${p.count} of ${tally.orders} orders. Lift ${round1(lift)} ` +
        `(1 = independent): ordering "${an}" makes "${bn}" ${round1(lift)}× more likely than its baseline. ` +
        `Of orders with "${an}", ${pct(confidence)}% also had "${bn}".`,
      fallbackText: copy.fallback.basket(an, bn, pct(confidence), round1(lift), p.count),
    });
  }
  return out;
}

// ---------- family 3: weekday over-indexing ----------

/**
 * Items that sell disproportionately on a weekday RELATIVE TO the house's own weekday rhythm —
 * otherwise every item "over-indexes" on the busiest day just because that day is busy.
 */
function mineWeekdaySkew(sold: readonly SoldByDayRow[], recordedDays: readonly string[], c: Ctx): PatternCandidate[] {
  const { t, copy } = c;
  const weekdayCount = new Array<number>(7).fill(0);
  for (const d of recordedDays) weekdayCount[dayOfWeekOfDate(d)]! += 1;
  if (recordedDays.length < t.minDays) return [];

  const byItem = new Map<string, { perDay: number[]; total: number }>();
  const housePerDay = new Array<number>(7).fill(0);
  let houseTotal = 0;
  const recorded = new Set(recordedDays);
  for (const row of sold) {
    if (!recorded.has(row.date) || row.qty <= 0) continue;
    const wd = dayOfWeekOfDate(row.date);
    const rec = byItem.get(row.id) ?? { perDay: new Array<number>(7).fill(0), total: 0 };
    rec.perDay[wd]! += row.qty;
    rec.total += row.qty;
    byItem.set(row.id, rec);
    housePerDay[wd]! += row.qty;
    houseTotal += row.qty;
  }
  if (houseTotal <= 0) return [];

  const out: PatternCandidate[] = [];
  for (const [id, rec] of [...byItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (rec.total < t.minItemQty) continue;
    for (let wd = 0; wd < 7; wd++) {
      // The range has to contain enough of THIS weekday, not just enough days.
      if (weekdayCount[wd]! < t.minWeekdayDays || rec.perDay[wd]! < t.minWeekdayQty) continue;
      const baselineShare = housePerDay[wd]! / houseTotal;
      if (baselineShare <= 0) continue;
      const observedShare = rec.perDay[wd]! / rec.total;
      const index = observedShare / baselineShare;
      if (index < t.minWeekdayIndex) continue;
      const strength = Math.min(1, (index - 1) / 2); // index 3 → ~1.0
      const name = c.name(id);
      const wdName = copy.weekday(wd);
      out.push({
        id: idKey('time', [id, `wd:${wd}`]),
        kind: 'time',
        subjects: [name, wdName],
        subjectIds: [id],
        metrics: {
          weekday: wd,
          index: round1(index),
          itemDayPct: pct(observedShare),
          houseDayPct: pct(baselineShare),
          itemTotal: rec.total,
        },
        sampleSize: weekdayCount[wd]!,
        confidence: tier(weekdayCount[wd]!, ...SAMPLE_TIERS.weekdayOccurrences),
        sampleLabel: copy.sample.weekdays(weekdayCount[wd]!, wdName),
        strength,
        score: strength * Math.log2(rec.total + 2),
        desc:
          `"${name}" skews to ${EN_WEEKDAYS[wd]} ABOVE the venue's own rhythm: ${pct(observedShare)}% of its ` +
          `${rec.total} units sell on ${EN_WEEKDAYS[wd]}, vs ${pct(baselineShare)}% of ALL sales on that day — ` +
          `${round1(index)}× the house level (${weekdayCount[wd]} such days). The busy-day effect is already ` +
          `removed by baselining against the house weekday mix.`,
        fallbackText: copy.fallback.weekdaySkew(name, wdName, pct(observedShare), pct(baselineShare), round1(index), weekdayCount[wd]!),
      });
    }
  }
  return out;
}

// ---------- family 4: segment skews (price band / discount / locale) ----------

function mineSegmentSkews(input: PatternsInput, keep: (id: string) => boolean, c: Ctx): PatternCandidate[] {
  const { t, copy } = c;
  const out: PatternCandidate[] = [];
  const conv = (v: { views: number; sold: number }) => (v.views > 0 ? v.sold / v.views : 0);

  // Price cliff: best- vs worst-selling band with enough traffic; needs real sales somewhere.
  const bands = (input.priceBands ?? []).filter((b) => b.views >= t.minSegmentViews);
  if (bands.length >= 2 && bands.some((b) => b.sold > 0)) {
    const best = bands.reduce((m, b) => (conv(b) > conv(m) ? b : m));
    const worst = bands.reduce((m, b) => (conv(b) < conv(m) ? b : m));
    const ratio = conv(worst) > 0 ? conv(best) / conv(worst) : Infinity;
    if (best.band !== worst.band && conv(best) > 0 && (ratio >= 1.5 || conv(worst) === 0)) {
      const bestLabel = copy.bandLabel(best);
      const worstLabel = copy.bandLabel(worst);
      const sample = best.views + worst.views;
      const strength = Math.min(1, (Number.isFinite(ratio) ? ratio : 3) / 4);
      out.push({
        id: idKey('segment', ['price', `band:${best.band}`, `band:${worst.band}`]),
        kind: 'segment',
        subjects: [bestLabel, worstLabel],
        subjectIds: [],
        // Per-view RATIO ("5.7×"), never a percentage: views and sold count different populations.
        metrics: {
          bestBand: best.band,
          bestSalesPerView: `${round1(conv(best))}×`,
          bestSold: best.sold,
          bestViews: best.views,
          worstBand: worst.band,
          worstSalesPerView: `${round1(conv(worst))}×`,
          worstSold: worst.sold,
          worstViews: worst.views,
        },
        sampleSize: sample,
        confidence: tier(sample, ...SAMPLE_TIERS.segmentViews),
        sampleLabel: copy.sample.views(sample),
        strength,
        score: strength * Math.log2(sample + 2),
        desc:
          `Units sold per menu view, by price band — an INDEX, not a conversion rate, and NEVER a percentage. ` +
          `"${bestLabel}" sells ${round1(conv(best))} units per view (${best.sold} sold, ${best.views} views); ` +
          `"${worstLabel}" sells ${round1(conv(worst))} (${worst.sold} sold, ${worst.views} views). Views are QR ` +
          `sessions that opened the item, sold is every unit including guests who never scanned; a value above 1× ` +
          `means the band is ordered WITHOUT being browsed. Phrase it as "N sales per view" or "N×", never "N%".`,
        fallbackText: copy.fallback.priceCliff(bestLabel, round1(conv(best)), worstLabel, round1(conv(worst))),
      });
    }
  }

  // Discount lift: does a discount actually SELL more?
  const disc = input.discount?.discounted;
  const reg = input.discount?.regular;
  if (disc && reg && disc.views >= t.minSegmentViews && reg.views >= t.minSegmentViews && disc.sold + reg.sold > 0) {
    const dc = conv(disc);
    const rc = conv(reg);
    const ratio = rc > 0 ? dc / rc : Infinity;
    if (ratio >= 1.4 || ratio <= 0.7) {
      const better = ratio >= 1.4;
      const sample = disc.views + reg.views;
      const strength = Math.min(1, Math.abs(Math.log2(Number.isFinite(ratio) && ratio > 0 ? ratio : 2)));
      out.push({
        id: idKey('segment', ['discount']),
        kind: 'segment',
        subjects: [copy.discountSubject],
        subjectIds: [],
        metrics: {
          discountedSalesPerViewPct: pct(dc),
          discountedSold: disc.sold,
          regularSalesPerViewPct: pct(rc),
          regularSold: reg.sold,
          ratio: round1(Number.isFinite(ratio) ? ratio : 0),
        },
        sampleSize: sample,
        confidence: tier(sample, ...SAMPLE_TIERS.segmentViews),
        sampleLabel: copy.sample.views(sample),
        strength,
        score: strength * Math.log2(sample + 2),
        desc:
          `Discounted items turn ${pct(dc)}% of views into real SALES (${disc.sold} sold on ${disc.views} views) vs ` +
          `${pct(rc)}% for full-price (${reg.sold} sold on ${reg.views} views) — discounts ` +
          `${better ? 'clearly lift' : 'do NOT lift (and may hurt)'} actual sales.`,
        fallbackText: better ? copy.fallback.discountLift(pct(dc), pct(rc)) : copy.fallback.discountNoLift(pct(dc), pct(rc)),
      });
    }
  }

  // Locale divergence — by PENETRATION RATE (share of each locale's OWN sessions), never raw views.
  const audiences = [...(input.locales ?? [])].sort((x, y) => y.sessions - x.sessions);
  const A = audiences[0];
  const B = audiences[1];
  if (A && B && A.sessions >= MIN_LOCALE_SESSIONS && B.sessions >= MIN_LOCALE_SESSIONS) {
    const bTop = new Set(B.topItems.map((i) => i.id));
    const aTop = new Set(A.topItems.map((i) => i.id));
    const onlyA = A.topItems.find((i) => keep(i.id) && i.rate >= MIN_LOCALE_RATE && !bTop.has(i.id));
    const onlyB = B.topItems.find((i) => keep(i.id) && i.rate >= MIN_LOCALE_RATE && !aTop.has(i.id));
    if (onlyA && onlyB) {
      const strength = Math.min(1, (onlyA.rate + onlyB.rate) / 2 + 0.2);
      const sample = A.sessions + B.sessions;
      const aL = copy.localeLabel(A.locale);
      const bL = copy.localeLabel(B.locale);
      const aN = c.name(onlyA.id);
      const bN = c.name(onlyB.id);
      out.push({
        id: idKey('segment', ['locale', onlyA.id, onlyB.id]),
        kind: 'segment',
        subjects: [aN, bN],
        subjectIds: [onlyA.id, onlyB.id],
        metrics: {
          localeA: A.locale,
          favoriteA: aN,
          penetrationAPct: pct(onlyA.rate),
          localeB: B.locale,
          favoriteB: bN,
          penetrationBPct: pct(onlyB.rate),
        },
        sampleSize: sample,
        // Tiered on the SMALLER audience: that side limits the claim.
        confidence: tier(Math.min(A.sessions, B.sessions), ...SAMPLE_TIERS.segmentViews),
        sampleLabel: copy.sample.sessions([
          { label: aL, sessions: A.sessions },
          { label: bL, sessions: B.sessions },
        ]),
        strength,
        score: strength * Math.log2(sample + 2),
        desc:
          `Menu-language divergence by PENETRATION RATE (share of each locale's own sessions, so the smaller ` +
          `audience is comparable — raw view counts are deliberately NOT used): ${aL}-menu guests gravitate to ` +
          `"${aN}" (${pct(onlyA.rate)}% of ${A.locale} sessions viewed it, absent from the ${B.locale} top list), ` +
          `while ${bL}-menu guests gravitate to "${bN}" (${pct(onlyB.rate)}% of ${B.locale} sessions).`,
        fallbackText: copy.fallback.localeSplit(aL, aN, pct(onlyA.rate), bL, bN, pct(onlyB.rate)),
      });
    }
  }

  return out;
}

// ---------- family 5: margin patterns (needs item costs) ----------

type MarginDay = { date: string; revenue: number; profit: number };

/** Day-level margin series over costed items; a day with no costed sales is skipped, not zero. */
function marginSeries(
  sold: readonly SoldByDayRow[],
  recordedDays: readonly string[],
  costs: ReadonlyMap<string, { priceIqd: number; costIqd: number }>,
): { days: MarginDay[]; profitByItemDay: Map<string, Map<string, number>> } {
  const recorded = new Set(recordedDays);
  const byDay = new Map<string, MarginDay>();
  const profitByItemDay = new Map<string, Map<string, number>>();
  for (const row of sold) {
    if (!recorded.has(row.date) || row.qty <= 0) continue;
    const entry = costs.get(row.id);
    if (!entry) continue;
    const unitPrice = row.revenueIqd > 0 ? row.revenueIqd / row.qty : entry.priceIqd;
    if (unitPrice <= 0) continue;
    const revenue = row.revenueIqd > 0 ? row.revenueIqd : entry.priceIqd * row.qty;
    const profit = revenue - entry.costIqd * row.qty;
    const day = byDay.get(row.date) ?? { date: row.date, revenue: 0, profit: 0 };
    day.revenue += revenue;
    day.profit += profit;
    byDay.set(row.date, day);
    const perDay = profitByItemDay.get(row.id) ?? new Map<string, number>();
    perDay.set(row.date, (perDay.get(row.date) ?? 0) + profit);
    profitByItemDay.set(row.id, perDay);
  }
  return { days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), profitByItemDay };
}

function mineMarginPatterns(
  sold: readonly SoldByDayRow[],
  recordedDays: readonly string[],
  costs: ReadonlyMap<string, { priceIqd: number; costIqd: number }>,
  c: Ctx,
): PatternCandidate[] {
  const { t, copy } = c;
  if (costs.size === 0 || recordedDays.length < t.minDays) return [];
  const { days, profitByItemDay } = marginSeries(sold, recordedDays, costs);
  if (days.length < t.minDays) return [];

  const out: PatternCandidate[] = [];
  const marginOf = (d: MarginDay[]) => {
    const rev = d.reduce((s, x) => s + x.revenue, 0);
    const prof = d.reduce((s, x) => s + x.profit, 0);
    return { rev, prof, pct: rev > 0 ? (prof / rev) * 100 : 0 };
  };

  // --- 1. mix drift: first half vs second half of the recorded days ---
  const mid = Math.floor(days.length / 2);
  const early = marginOf(days.slice(0, mid));
  const late = marginOf(days.slice(mid));
  const shift = late.pct - early.pct;
  if (
    days.length >= Math.max(t.minDays, 4) &&
    early.rev >= MIN_HALF_REVENUE_IQD &&
    late.rev >= MIN_HALF_REVENUE_IQD &&
    Math.abs(shift) >= MIN_MARGIN_SHIFT_POINTS
  ) {
    const earlyDays = new Set(days.slice(0, mid).map((d) => d.date));
    let driver: string | null = null;
    let driverDelta = 0;
    for (const [id, perDay] of [...profitByItemDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      let e = 0;
      let l = 0;
      for (const [date, profit] of perDay) {
        if (earlyDays.has(date)) e += profit;
        else l += profit;
      }
      const eShare = early.prof !== 0 ? e / early.prof : 0;
      const lShare = late.prof !== 0 ? l / late.prof : 0;
      const delta = lShare - eShare;
      if (Math.sign(delta) === Math.sign(shift) && Math.abs(delta) > Math.abs(driverDelta)) {
        driver = id;
        driverDelta = delta;
      }
    }
    const up = shift > 0;
    const driverName = driver ? c.name(driver) : null;
    const strength = Math.min(1, Math.abs(shift) / 8); // 8 points → ~1.0
    out.push({
      id: idKey('margin', driver ? ['mix', driver] : ['mix']),
      kind: 'margin',
      subjects: driverName ? [driverName] : [copy.marginSubject],
      subjectIds: driver ? [driver] : [],
      metrics: {
        earlyMarginPct: round1(early.pct),
        lateMarginPct: round1(late.pct),
        shiftPoints: round1(shift),
        days: days.length,
        ...(driverName ? { driver: driverName, driverShareShiftPct: pct(driverDelta) } : {}),
      },
      sampleSize: days.length,
      confidence: tier(days.length, ...SAMPLE_TIERS.marginDays),
      sampleLabel: copy.sample.days(days.length),
      strength,
      score: strength * Math.log2(days.length + 2),
      desc:
        `Gross margin on the costed part of the menu moved from ${round1(early.pct)}% in the first half of the ` +
        `period to ${round1(late.pct)}% in the second (${round1(shift)} points over ${days.length} recorded days). ` +
        `Revenue is NOT the driver — this is the sales MIX rotating toward ${up ? 'higher' : 'lower'}-margin items.` +
        (driverName ? ` Largest single mover: "${driverName}", ${pct(Math.abs(driverDelta))}% ${up ? 'more' : 'less'} of total profit.` : ''),
      fallbackText: up
        ? copy.fallback.marginUp(round1(early.pct), round1(late.pct), days.length, driverName)
        : copy.fallback.marginDown(round1(early.pct), round1(late.pct), days.length, driverName),
    });
  }

  // --- 2. weekday margin gap: best-margin weekday vs worst, and whether the worst is the busiest ---
  const perWeekday = new Map<number, { revenue: number; profit: number; days: number }>();
  for (const d of days) {
    const wd = dayOfWeekOfDate(d.date);
    const cur = perWeekday.get(wd) ?? { revenue: 0, profit: 0, days: 0 };
    cur.revenue += d.revenue;
    cur.profit += d.profit;
    cur.days++;
    perWeekday.set(wd, cur);
  }
  const usable = [...perWeekday.entries()]
    .filter(([, v]) => v.days >= t.minWeekdayDays && v.revenue >= MIN_HALF_REVENUE_IQD / 2)
    .sort(([a], [b]) => a - b);
  if (usable.length >= 2) {
    type Entry = [number, { revenue: number; profit: number; days: number }];
    const rate = ([, v]: Entry) => (v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0);
    const best = usable.reduce((m, x) => (rate(x) > rate(m) ? x : m));
    const worst = usable.reduce((m, x) => (rate(x) < rate(m) ? x : m));
    const gap = rate(best) - rate(worst);
    if (best[0] !== worst[0] && gap >= MIN_MARGIN_SHIFT_POINTS) {
      const busiest = usable.reduce((m, x) => (x[1].revenue / x[1].days > m[1].revenue / m[1].days ? x : m));
      const worstIsBusiest = busiest[0] === worst[0];
      const sample = Math.min(best[1].days, worst[1].days);
      const strength = Math.min(1, gap / 10);
      const bestName = copy.weekday(best[0]);
      const worstName = copy.weekday(worst[0]);
      out.push({
        id: idKey('margin', ['weekday', `wd:${best[0]}`, `wd:${worst[0]}`]),
        kind: 'margin',
        subjects: [worstName, bestName],
        subjectIds: [],
        metrics: {
          bestDay: best[0],
          bestMarginPct: round1(rate(best)),
          worstDay: worst[0],
          worstMarginPct: round1(rate(worst)),
          gapPoints: round1(gap),
          worstIsBusiest: worstIsBusiest ? 'yes' : 'no',
        },
        sampleSize: sample,
        confidence: tier(sample, ...SAMPLE_TIERS.weekdayOccurrences),
        sampleLabel: copy.sample.weekdayPair(best[1].days, bestName, worst[1].days, worstName),
        strength,
        score: strength * Math.log2(sample + 2),
        desc:
          `Margin differs by DAY on the costed menu: ${EN_WEEKDAYS[best[0]]} earns ${round1(rate(best))}% of its ` +
          `revenue as profit (${best[1].days} such days) vs ${EN_WEEKDAYS[worst[0]]} at ${round1(rate(worst))}% ` +
          `(${worst[1].days} such days) — a ${round1(gap)}-point gap on the same menu.` +
          (worstIsBusiest ? ` The thin day is also the BUSIEST day by revenue.` : ''),
        fallbackText: worstIsBusiest
          ? copy.fallback.marginWeekdayBusiest(worstName, round1(rate(worst)), bestName, round1(rate(best)), worst[1].days)
          : copy.fallback.marginWeekday(worstName, round1(rate(worst)), bestName, round1(rate(best)), worst[1].days, best[1].days, round1(gap)),
      });
    }
  }
  return out;
}

/**
 * Mine every family at a widening level and return candidates ranked by TIER first, then
 * score — a two-day curiosity never outranks a three-week finding. Deduped by id.
 */
export function minePatterns(
  input: PatternsInput,
  level: PatternLevel = 0,
  copy: PatternsCopy = DEFAULT_PATTERNS_COPY_EN,
): PatternCandidate[] {
  const t = LEVELS[Math.max(0, Math.min(level, LEVELS.length - 1))]!;
  const keep = input.keep ?? (() => true);
  const c: Ctx = {
    t,
    copy,
    name: (id) => {
      const ref = refOf(id, input.names);
      return pickLocale({ en: ref.nameEn, ar: ref.nameAr }, copy.locale) || id;
    },
  };

  for (const row of input.soldByDay) {
    assertCount(row.qty, 'qty');
    iqd(row.revenueIqd);
  }
  const sold = input.soldByDay.filter((r) => keep(r.id));
  const recordedDays = [...new Set(input.recordedDays)].sort();
  const costs = input.costs ?? new Map<string, { priceIqd: number; costIqd: number }>();

  const all = [
    ...mineCoMovement(sold, recordedDays, c),
    ...(input.baskets ? mineBasketLift(input.baskets, keep, c) : []),
    ...mineWeekdaySkew(sold, recordedDays, c),
    ...mineSegmentSkews(input, keep, c),
    ...mineMarginPatterns(sold, recordedDays, costs, c),
  ];

  const byId = new Map<string, PatternCandidate>();
  for (const cand of all) if (!byId.has(cand.id)) byId.set(cand.id, cand);
  return [...byId.values()].sort(
    (a, b) => TIER_RANK[b.confidence] - TIER_RANK[a.confidence] || b.score - a.score || a.id.localeCompare(b.id),
  );
}
