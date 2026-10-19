/**
 * The drill window's arithmetic, kept pure so a node test can pin it: which
 * day a transaction falls on at the venue, which kind (and colour) it is, and
 * the figure card's totals (Sait, 2026-10-19).
 */
import { VENUE_TZ } from '@touch/i18n';
import type { DrillSub } from './drillWords';

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

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD at the venue, so a booking at 00:30 sits under its own night's date in Baghdad wherever the till is. */
export function venueDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DAY.format(d);
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
