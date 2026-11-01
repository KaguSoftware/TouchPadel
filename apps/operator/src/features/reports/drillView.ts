/**
 * The drill window's arithmetic, kept pure so a node test can pin it: which
 * day a transaction falls on at the venue, which kind (and colour) it is, and
 * the figure card's totals (Sait, 2026-10-19).
 */
import { VENUE_TZ } from '@touch/i18n';
import { BUSINESS_DAY_START_DEFAULT, businessDayOf } from '@touch/core';
import type { DrillSub } from './drillWords';
import type { DrillTotals } from './reportPayloads';

/** The card colours a kind is drawn in; each has a --tp-breakdown-* and a --tp-split-* family. */
export type DrillTone = 'green' | 'violet' | 'rose' | 'sky' | 'teal' | 'gold';

/**
 * Padel green, cafe violet, money back rose, payments light blue, discounts
 * gold, write-offs teal: the Breakdown's colours, so a kind looks the same in
 * the overview and in the window it opens. Keys are the detail `sub`s and,
 * for a row without detail, the server's `kind`.
 */
const TONES: Record<string, DrillTone> = {
  booking: 'green',
  reservation: 'green',
  settledTab: 'violet',
  order: 'violet',
  line: 'violet',
  tab: 'violet',
  payment: 'sky',
  refund: 'rose',
  void: 'rose',
  discount: 'gold',
  adjustment: 'gold',
  waste: 'teal',
};

export function drillTone(key: string): DrillTone {
  return TONES[key] ?? 'sky';
}

/** The kind a row is filed under: its detail `sub`, else the server's kind. */
export function drillKindKey(sub: DrillSub | null, kind: string | null): string {
  return sub ?? kind ?? 'other';
}

/**
 * The BUSINESS day at the venue (F-14, F-37): Baghdad's clock wherever the till
 * is, shifted by the day start (04:00 unless the settings say otherwise), so a
 * sale at 01:30 sits under the night it belongs to, as every report counts it.
 * The server sends each row's own `day` since 0388; this is the fallback.
 */
export function venueDay(iso: string | null, startHour: number = BUSINESS_DAY_START_DEFAULT): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : businessDayOf(d, startHour, VENUE_TZ);
}

/**
 * The figure card's totals (F-14). The window lists the newest 500 rows; past
 * that the server's totals (0388) are the figure, so the card never sums a
 * capped page. A kind tab reads that kind's server total; a place or a search
 * narrows to what is listed, so it sums the rows shown.
 */
export function drillCardSummary(
  local: DrillSummary,
  answer: { totals: DrillTotals | null; capped: boolean },
  filter: { kind: string | null; narrowed: boolean },
): DrillSummary {
  const t = answer.totals;
  if (!answer.capped || !t || filter.narrowed) return local;
  if (filter.kind) {
    const k = t.kinds.find((x) => x.key === filter.kind);
    return k ? { total: k.sum, count: k.count, kinds: [k], soleStaff: null } : local;
  }
  return { total: t.amountIqd, count: t.count, kinds: t.kinds, soleStaff: null };
}

/** A day's total in the table (F-14): the server's when the list is capped and unfiltered, else the rows'. */
export function drillDayTotal(
  day: string | null,
  rows: readonly { amount: number | null }[],
  answer: { totals: DrillTotals | null; capped: boolean },
  filtered: boolean,
): number {
  const server = day && answer.capped && !filtered ? answer.totals?.days[day] : undefined;
  return server ? server.sum : rows.reduce((a, r) => a + (r.amount ?? 0), 0);
}

export interface DrillSummary {
  total: number;
  count: number;
  /** One entry per kind, in the order the kinds first appear. */
  kinds: { key: string; count: number; sum: number }[];
  /** The one person who took every row, or null when there were several (or none named). */
  soleStaff: string | null;
}

export function summarizeDrill(rows: readonly { kind: string; amount: number | null; staff: string | null }[]): DrillSummary {
  const kinds = new Map<string, { key: string; count: number; sum: number }>();
  const staff = new Set<string | null>();
  let total = 0;
  for (const r of rows) {
    const amount = r.amount ?? 0;
    total += amount;
    staff.add(r.staff);
    const k = kinds.get(r.kind) ?? { key: r.kind, count: 0, sum: 0 };
    k.count += 1;
    k.sum += amount;
    kinds.set(r.kind, k);
  }
  const [only] = staff;
  return { total, count: rows.length, kinds: [...kinds.values()], soleStaff: staff.size === 1 && only ? only : null };
}

/** Each kind's share of the bar: by size of money moved, so a refund takes room too. */
export function splitShares(kinds: DrillSummary['kinds']): { key: string; share: number }[] {
  const whole = kinds.reduce((a, k) => a + Math.abs(k.sum), 0);
  return kinds.map((k) => ({ key: k.key, share: whole > 0 ? Math.abs(k.sum) / whole : 0 }));
}
