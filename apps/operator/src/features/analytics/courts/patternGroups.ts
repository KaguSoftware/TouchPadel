/**
 * The court patterns grouped for the Patterns card (Sait, 2026-10-19): one
 * section per kind of finding, one row per finding with a value, the figure it
 * is measured against, and a bar scale. Pure, so the card only formats and
 * draws. The miner's numbers are read back from `metrics`; nothing is
 * recomputed here, only arranged.
 */
import type { CourtPatternCandidate, EndingsDimension } from '@touch/core';

export type PatternGroupKey =
  | 'cancellations'
  | 'noShows'
  | 'deadSlot'
  | 'saturatedSlot'
  | 'shift'
  | 'attachGap'
  | 'lapsing'
  | 'courtBasket';

export interface PatternRow {
  candidate: CourtPatternCandidate;
  /** What the finding is about: a court, a weekday, a segment. */
  label: string;
  /** A second line under the label: the hours of a slot. */
  hours: string | null;
  /** The breakdown a segment belongs to (source, lead time ...); null for courts and slots. */
  dimension: EndingsDimension | null;
  /** The finding's own percentage. */
  value: number;
  /** The percentage it is measured against; null when there is none (a full slot). */
  base: number | null;
  /** How far the finding sits from its base, for ordering within a group. */
  gap: number;
}

export interface PatternGroup {
  key: PatternGroupKey;
  rows: PatternRow[];
  /** The base every row shares (venue-wide cancellation rate ...), or null when rows differ. */
  sharedBase: number | null;
  /** The top of the bar scale, in percent. */
  scaleMax: number;
}

const num = (v: number | string | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0) || 0;

function groupKey(c: CourtPatternCandidate): PatternGroupKey {
  switch (c.kind) {
    case 'ending-cluster':
      return c.metrics.ending === 'noShows' ? 'noShows' : 'cancellations';
    case 'dead-slot':
      return 'deadSlot';
    case 'saturated-slot':
      return 'saturatedSlot';
    case 'shift':
      return 'shift';
    case 'attach-gap':
      return 'attachGap';
    case 'lapsing':
      return 'lapsing';
    case 'court-basket':
      return 'courtBasket';
  }
}

function toRow(c: CourtPatternCandidate): PatternRow {
  const m = c.metrics;
  const base = { candidate: c, label: c.subjects.join(' '), hours: null, dimension: null } as const;
  switch (c.kind) {
    case 'ending-cluster': {
      const dimension = String(m.dimension) as EndingsDimension;
      return {
        ...base,
        label: c.subjects[0] ?? '',
        dimension: dimension === 'byCourt' ? null : dimension,
        value: num(m.segRatePct),
        base: num(m.baseRatePct),
        gap: num(m.ratio),
      };
    }
    case 'dead-slot':
      return {
        ...base,
        label: c.subjects[0] ?? '',
        hours: c.subjects[1] ?? null,
        value: num(m.occupancyPct),
        base: num(m.houseHourPct),
        gap: num(m.houseHourPct) - num(m.occupancyPct),
      };
    case 'saturated-slot':
      return {
        ...base,
        label: c.subjects[0] ?? '',
        hours: c.subjects[1] ?? null,
        value: num(m.occupancyPct),
        base: null,
        gap: num(m.occupancyPct),
      };
    case 'shift':
      return {
        ...base,
        value: num(m.sharePct),
        base: num(m.prevSharePct),
        gap: Math.abs(num(m.deltaPts)),
      };
    case 'attach-gap': {
      const ratio = num(m.ratio);
      return {
        ...base,
        value: num(m.attachPct),
        base: num(m.venueAttachPct),
        gap: ratio > 0 ? Math.abs(Math.log(ratio)) : 0,
      };
    }
    case 'lapsing':
      return { ...base, value: num(m.lapsingPct), base: null, gap: num(m.lapsingPct) };
    case 'court-basket':
      return { ...base, value: num(m.linkedSharePct), base: num(m.allSharePct), gap: num(m.lift) };
  }
}

/** A round top for the bar scale, a little above the largest figure so no bar touches the end. */
export function niceMax(n: number): number {
  if (!(n > 0)) return 10;
  const target = n * 1.1;
  for (const step of [5, 10, 20, 25, 50]) {
    const top = Math.ceil(target / step) * step;
    if (top / target < 1.5 || step === 50) return Math.min(100, top);
  }
  return 100;
}

/**
 * Groups in the order the miner ranked them (the group of its strongest finding
 * first); rows within a group by distance from their base, largest first.
 */
export function groupPatterns(candidates: readonly CourtPatternCandidate[]): PatternGroup[] {
  const groups = new Map<PatternGroupKey, PatternRow[]>();
  for (const c of candidates) {
    const key = groupKey(c);
    const rows = groups.get(key) ?? [];
    rows.push(toRow(c));
    groups.set(key, rows);
  }
  return [...groups].map(([key, rows]) => {
    rows.sort((a, b) => b.gap - a.gap);
    const bases = new Set(rows.map((r) => r.base));
    const sharedBase = bases.size === 1 ? (rows[0]?.base ?? null) : null;
    const top = Math.max(...rows.map((r) => Math.max(r.value, r.base ?? 0)));
    const scaleMax = key === 'saturatedSlot' || key === 'lapsing' ? 100 : niceMax(top);
    return { key, rows, sharedBase, scaleMax };
  });
}
