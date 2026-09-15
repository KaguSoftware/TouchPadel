/**
 * The post-model gate of `analytics-insights`, pulled out of the function so the
 * DB vitest suite can run it without Deno: what reaches the owner is what
 * survives these steps, in this order —
 *
 *   dedupe → strong → rejected → low-confidence → excluded → uncited amounts → rank → cap
 *
 * Every step is a pure function over `InsightWire[]`; the text gates from
 * insightsText.ts run on the sentences and the survivors are mapped back to
 * their findings. Nothing here reads the request, the model or the database.
 */
import type { FindingBasisWire, InsightWire } from './insightsContract.ts';
import {
  MAX_FINDINGS,
  dropExcludedMentions,
  dropLowConfidenceClaims,
  dropRejectedFindings,
  dropUncitedAmounts,
  isStrongFinding,
  normalizeFinding,
  rankFindings,
  rejectionKeys,
} from './insightsText.ts';

/** Weekday names as a finding would spell them, 0 = Sunday; the confidence gate reads these. */
export const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
} as const;

/** Common alternative Arabic spellings, so a hamza never lets a weekday claim through. */
export const EXTRA_WEEKDAYS = [
  { day: 0, name: 'الاحد' },
  { day: 1, name: 'الإثنين' },
  { day: 3, name: 'الاربعاء' },
] as const;

export interface GateContext {
  /** The owner's rejected sentences (raw text; normalised inside). */
  rejections: readonly string[];
  /** Days with data and weekday counts; null skips the confidence gate. */
  basis: FindingBasisWire | null;
  /** Display names of excluded items; a finding naming one is dropped. */
  excludedNames: readonly string[];
  /**
   * Every number in the payload the model read (`collectAmounts`). A finding
   * citing an IQD amount outside this set is dropped; null skips the check.
   */
  amounts: ReadonlySet<number> | null;
}

/**
 * Every finite number anywhere in a payload, rounded to the dinar. The set a
 * cited amount must belong to: the model may repeat a figure it was given and
 * nothing else — no scaling to a month, no sum, no projection.
 */
export function collectAmounts(payload: unknown, into = new Set<number>()): Set<number> {
  const walk = (v: unknown) => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) into.add(Math.round(v));
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(payload);
  return into;
}

/** Run the whole gate over a set of findings; the result is what the card shows. */
export function gateInsights<T extends InsightWire>(items: readonly T[], ctx: GateContext, cap = MAX_FINDINGS): T[] {
  // 1. dedupe on the normalised sentence, first occurrence wins
  const byText = new Map<string, T>();
  for (const it of items) {
    const key = normalizeFinding(it.text);
    if (key && !byText.has(key)) byText.set(key, it);
  }
  // 2. strong: cites a number, is not trivially short
  let texts = [...byText.values()].map((i) => i.text).filter(isStrongFinding);
  // 3. the owner's rejections, exact on the normalised key
  texts = dropRejectedFindings(texts, rejectionKeys(ctx.rejections)).kept;
  // 4. thin weekdays and trends the period cannot carry
  if (ctx.basis) {
    texts = dropLowConfidenceClaims(texts, ctx.basis, WEEKDAYS, { extraWeekdayNames: EXTRA_WEEKDAYS }).kept;
  }
  // 5. excluded items, by name
  texts = dropExcludedMentions(texts, ctx.excludedNames);
  // 6. amounts the data does not contain
  if (ctx.amounts) texts = dropUncitedAmounts(texts, ctx.amounts).kept;
  // 7. rank by confidence, then sample, then order; 8. cap
  const survivors = texts.map((t) => byText.get(normalizeFinding(t))!);
  return rankFindings(survivors, cap);
}
