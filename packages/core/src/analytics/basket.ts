/**
 * Market-basket affinity ("bought together") from real orders, id-keyed.
 *
 * The SQL `app.analytics_bought_together` does the pair tally; `rankPairs` turns its raw
 * co-occurrence rows into the display list (confidence from the RARER item's side — the
 * higher, more actionable number). `tallyBaskets` is the in-process tally for callers that
 * hold raw baskets (the patterns miner's basket-lift family).
 */
import { assertCount } from './compare';

export type ItemPair = {
  /** Antecedent — the rarer of the two (the trigger item). */
  a: string;
  /** Companion. */
  b: string;
  /** Orders containing both. */
  count: number;
  /** Of orders with `a`, share that also had `b`, percent. */
  confidencePct: number;
  /** P(b|a) / P(b); 1 = independent. null when the total order count is unknown. */
  lift: number | null;
};

export type RawPair = {
  a: string;
  b: string;
  /** Orders containing both. */
  count: number;
  /** Orders containing `a` / `b` at all. */
  aCount: number;
  bCount: number;
  /** Total orders the tally ran over (enables lift). */
  orders?: number;
};

/** A lone co-order isn't a pattern. */
export const MIN_PAIR_SUPPORT = 2;

/**
 * Below this lift a pair is two popular items landing in the same basket by
 * chance (water with everything): it is not a combo worth suggesting.
 */
export const MIN_PAIR_LIFT = 1.3;

/**
 * Rank raw co-occurrence rows: the pairs that happen MORE than chance first
 * (lift, then count), confidence from the rarer side. A pair whose lift is
 * known and under the floor is dropped; a pair with no order total (lift
 * unknown) is kept and sorts after every pair with a lift.
 */
export function rankPairs(raw: readonly RawPair[], limit = 8): ItemPair[] {
  const out: ItemPair[] = [];
  for (const r of raw) {
    const count = assertCount(r.count, 'count');
    if (count < MIN_PAIR_SUPPORT || r.a === r.b) continue;
    const ca = Math.max(assertCount(r.aCount, 'aCount'), count);
    const cb = Math.max(assertCount(r.bCount, 'bCount'), count);
    const [a, b, base, other] = ca <= cb ? [r.a, r.b, ca, cb] : [r.b, r.a, cb, ca];
    const orders = r.orders === undefined ? null : assertCount(r.orders, 'orders');
    const lift = orders !== null && orders > 0 ? (count * orders) / (base * other) : null;
    if (lift !== null && lift < MIN_PAIR_LIFT) continue;
    out.push({
      a,
      b,
      count,
      confidencePct: Math.round((count / base) * 100),
      lift,
    });
  }
  return out
    .sort((p, q) => (q.lift ?? -1) - (p.lift ?? -1) || q.count - p.count || q.confidencePct - p.confidencePct || p.a.localeCompare(q.a) || p.b.localeCompare(q.b))
    .slice(0, limit);
}

export type BasketTally = {
  /** Baskets with at least one kept item. */
  orders: number;
  /** Orders containing each item. */
  solo: Map<string, number>;
  /** Unordered pairs (a < b) with their co-order counts and each side's solo count. */
  pairs: RawPair[];
};

/**
 * Tally distinct-item baskets (item ids per order). Duplicate ids within a basket count once;
 * single-item baskets still count toward `orders` and `solo` (they are the denominator of
 * "how often does X appear at all").
 */
export function tallyBaskets(
  baskets: readonly (readonly string[])[],
  keep: (id: string) => boolean = () => true,
): BasketTally {
  const solo = new Map<string, number>();
  const pairs = new Map<string, Map<string, number>>();
  let orders = 0;
  for (const basket of baskets) {
    const ids = [...new Set(basket.filter((id) => id && keep(id)))].sort();
    if (ids.length === 0) continue;
    orders++;
    for (const id of ids) solo.set(id, (solo.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const inner = pairs.get(ids[i]!) ?? new Map<string, number>();
        inner.set(ids[j]!, (inner.get(ids[j]!) ?? 0) + 1);
        pairs.set(ids[i]!, inner);
      }
    }
  }
  const out: RawPair[] = [];
  for (const [a, inner] of pairs) {
    for (const [b, count] of inner) {
      out.push({ a, b, count, aCount: solo.get(a) ?? count, bCount: solo.get(b) ?? count, orders });
    }
  }
  return { orders, solo, pairs: out };
}
