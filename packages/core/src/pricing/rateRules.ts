import { localParts, parseHHMM } from '../time/tz';
import type { IQD } from '../money/iqd';

/**
 * Client-side mirror of rate_rules / rate_rule_prices (design-data.md 1.3). The server-side
 * authority is app.price_slot(); this module implements the SAME resolution so the grid can
 * price slots without a round-trip. The booking always stores the server's answer.
 */
export interface RateRule {
  id: string;
  /** Staff-facing internal name ('Weekday off-peak'). */
  name?: string;
  /** null = applies to all courts. */
  courtId: string | null;
  /** 0=Sun .. 6=Sat, evaluated in the venue's timezone. */
  daysOfWeek: readonly number[];
  /** 'HH:MM' venue-local. Window is half-open [startTime, endTime). */
  startTime: string;
  endTime: string;
  /** Highest priority wins on overlap (within the same specificity tier). */
  priority: number;
  /** Inclusive venue-local date window, 'YYYY-MM-DD' or null for open-ended. */
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}

export interface RateRulePrice {
  ruleId: string;
  durationMin: number;
  priceIqd: IQD;
}

export interface ResolvedRate {
  ruleId: string;
  priceIqd: IQD;
}

/** ruleId -> durationMin -> price. Build once per price set with indexRatePrices(). */
export type RatePriceIndex = ReadonlyMap<string, ReadonlyMap<number, IQD>>;

/**
 * Index rate_rule_prices for repeated lookups. resolveRateRule used to rebuild
 * this map on EVERY call — once per slot per grid build, i.e. ~120 times per
 * availability day on the phone — the single largest cost in grid assembly.
 * Callers that price many slots pass the index; a plain array still works for
 * one-off calls.
 */
export function indexRatePrices(prices: readonly RateRulePrice[]): RatePriceIndex {
  const priceByRule = new Map<string, Map<number, IQD>>();
  for (const p of prices) {
    let byDuration = priceByRule.get(p.ruleId);
    if (!byDuration) {
      byDuration = new Map();
      priceByRule.set(p.ruleId, byDuration);
    }
    byDuration.set(p.durationMin, p.priceIqd);
  }
  return priceByRule;
}

/**
 * Resolve the winning rate for a slot. Precedence (matching app.price_slot):
 *   1. court-specific rules beat null-court (all-courts) rules;
 *   2. then higher `priority`;
 *   3. then rule id ascending (deterministic tie-break).
 *
 * A rule is a candidate only if it is active, matches the court, the venue-local day of week,
 * the venue-local time window [startTime, endTime) at the SLOT START, the validFrom/validTo
 * date window (inclusive), and carries a price for the requested duration — a winning-tier
 * rule with no price for this duration falls through to the next candidate rather than
 * black-holing the slot. Midnight-crossing rule windows (endTime <= startTime) are unsupported
 * and never match. Returns null when no rule prices the slot.
 */
export function resolveRateRule(
  rules: readonly RateRule[],
  prices: readonly RateRulePrice[] | RatePriceIndex,
  courtId: string,
  startAt: Date,
  durationMin: number,
  venueTz: string,
): ResolvedRate | null {
  const local = localParts(startAt, venueTz);
  const slotMin = local.minutesOfDay;

  const priceByRule: RatePriceIndex = Array.isArray(prices)
    ? indexRatePrices(prices as readonly RateRulePrice[])
    : (prices as RatePriceIndex);

  const candidates = rules.filter((r) => {
    if (!r.isActive) return false;
    if (r.courtId !== null && r.courtId !== courtId) return false;
    if (!r.daysOfWeek.includes(local.dayOfWeek)) return false;
    const start = parseHHMM(r.startTime);
    const end = parseHHMM(r.endTime);
    if (end <= start) return false; // midnight-crossing windows unsupported
    if (slotMin < start || slotMin >= end) return false;
    if (r.validFrom !== null && local.date < r.validFrom) return false;
    if (r.validTo !== null && local.date > r.validTo) return false;
    return priceByRule.get(r.id)?.has(durationMin) ?? false;
  });

  candidates.sort((a, b) => {
    const specificity = Number(b.courtId !== null) - Number(a.courtId !== null);
    if (specificity !== 0) return specificity;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const winner = candidates[0];
  if (!winner) return null;
  const priceIqd = priceByRule.get(winner.id)?.get(durationMin);
  if (priceIqd === undefined) return null; // unreachable given the filter; keeps types honest
  return { ruleId: winner.id, priceIqd };
}
