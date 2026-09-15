/**
 * Losses as RATES. A losses chart that plots counts while its tip promises a
 * share misleads twice: a busy hour looks worse than a quiet one, and a
 * segment of three bookings looks as solid as one of three hundred. Every row
 * here carries the rate over its own booked total, and `thin` says the total
 * is under the twenty-booking floor (@touch/core MIN_RATE_DENOM): the chart
 * mutes those bars and the table prints "n of N" instead of a percentage.
 */
import { MIN_RATE_DENOM, rateOrCount } from '@touch/core';
import type { Segment } from './shape';

export interface LossRateRow {
  key: string;
  label: string;
  cancelled: number;
  noShow: number;
  /** Everything booked in the segment: live + cancelled + no-show. */
  total: number;
  /** null below the floor (or on an empty segment). */
  cancelledPct: number | null;
  noShowPct: number | null;
  thin: boolean;
}

/** Join the two breakdowns on `keys` (fixed order, zeros kept) and rate each row over its booked total. */
export function lossRates(
  cancelled: readonly Segment[],
  noShows: readonly Segment[],
  keys: readonly string[],
  label: (key: string) => string,
): LossRateRow[] {
  const c = new Map(cancelled.map((s) => [s.key, s]));
  const n = new Map(noShows.map((s) => [s.key, s]));
  return keys.map((key) => {
    const cs = c.get(key);
    const ns = n.get(key);
    // Both breakdowns describe the same booked slots; either side's total is the denominator.
    const total = Math.max(cs?.bookingsTotal ?? 0, ns?.bookingsTotal ?? 0);
    const cancelledN = cs?.n ?? 0;
    const noShowN = ns?.n ?? 0;
    return {
      key,
      label: label(key),
      cancelled: cancelledN,
      noShow: noShowN,
      total,
      cancelledPct: rateOrCount(cancelledN, total).pct,
      noShowPct: rateOrCount(noShowN, total).pct,
      thin: total < MIN_RATE_DENOM,
    };
  });
}

/** The keys of a breakdown in the order the server sent them, deduplicated across both sides. */
export function segmentKeys(cancelled: readonly Segment[], noShows: readonly Segment[]): string[] {
  const out: string[] = [];
  for (const s of [...cancelled, ...noShows]) if (!out.includes(s.key)) out.push(s.key);
  return out;
}

/**
 * What the stacked bars plot: the share even below the floor (a muted bar
 * still says "something happened here"), never a rate invented from zero.
 */
export function lossChartRows(rows: readonly LossRateRow[]): { label: string; cancelled: number; noShow: number; thin: boolean }[] {
  return rows.map((r) => ({
    label: r.label,
    cancelled: r.total > 0 ? Math.round((r.cancelled / r.total) * 1000) / 10 : 0,
    noShow: r.total > 0 ? Math.round((r.noShow / r.total) * 1000) / 10 : 0,
    thin: r.thin,
  }));
}
