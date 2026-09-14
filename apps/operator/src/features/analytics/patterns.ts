/**
 * The cafe tab's deterministic pattern miner, in one place: the Patterns card
 * renders these candidates and the AI insights payload carries the same ones
 * as ground truth (`extras.patterns`), so the model can never contradict what
 * the card shows. Pure: the statistics come from `@touch/core`, the copy from
 * the operator catalog; nothing here renders or fetches.
 */
import { minePatterns, type CourtPatternCandidate, type PatternCandidate, type PatternLevel, type PatternsCopy } from '@touch/core';
import type { PatternCandidateWire } from '../../lib/analyticsApi';
import type { Derived, RawAnalytics } from './derive';

/**
 * Mine the cafe candidates at a widening level. The basket family reads the
 * SQL bought-together rows (app.analytics_bought_together, already a pair
 * tally over real orders) folded into the miner's tally shape; the co-move,
 * weekday, price-cliff and margin families read the day-grain sales. Costs
 * come from the menu snapshot: only items WITH a cost enter the margin family.
 */
export function mineCafeCandidates(raw: RawAnalytics, derived: Derived, level: PatternLevel, copy: PatternsCopy): PatternCandidate[] {
  const costs = new Map<string, { priceIqd: number; costIqd: number }>();
  for (const m of raw.menu) if (m.costIqd !== null && m.priceIqd > 0) costs.set(m.id, { priceIqd: m.priceIqd, costIqd: m.costIqd });

  const kept = raw.boughtTogether.filter((p) => derived.keep(p.a) && derived.keep(p.b));
  const solo = new Map<string, number>();
  for (const p of kept) {
    solo.set(p.a, Math.max(solo.get(p.a) ?? 0, p.countA));
    solo.set(p.b, Math.max(solo.get(p.b) ?? 0, p.countB));
  }
  const orders = Math.max(0, ...kept.map((p) => p.orders));
  const pairTally =
    kept.length > 0 && orders > 0
      ? { orders, solo, pairs: kept.map((p) => ({ a: p.a, b: p.b, count: p.both, aCount: p.countA, bCount: p.countB, orders })) }
      : null;

  return minePatterns(
    {
      soldByDay: raw.soldByDay.map((r) => ({ id: r.id, date: r.date, qty: r.qty, revenueIqd: r.revenueIqd })),
      recordedDays: raw.daily.map((d) => d.date),
      pairTally,
      priceBands: derived.priceBands,
      // The language-preference query was cut with its card: no audiences to mine.
      locales: undefined,
      costs,
      names: derived.names,
      keep: derived.keep,
    },
    level,
    copy,
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A candidate as the edge function reads it: the statistics and the templated
 * sentence. `subjectIds` stay behind, and so does any metric that is a row id
 * (the court miner keys an attach gap and an ending cluster by court id): the
 * payload carries display names only, never an identifier of any kind.
 */
export function toPatternWire(c: PatternCandidate | CourtPatternCandidate): PatternCandidateWire {
  return {
    id: c.id,
    kind: c.kind,
    subjects: c.subjects,
    metrics: Object.fromEntries(Object.entries(c.metrics).filter(([, v]) => typeof v !== 'string' || !UUID_RE.test(v))),
    confidence: c.confidence,
    sampleLabel: c.sampleLabel,
    desc: c.desc,
    fallbackText: c.fallbackText,
  };
}
