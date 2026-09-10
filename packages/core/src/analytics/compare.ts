/**
 * The engagement ↔ sales join layer, keyed on `item_id` everywhere (PostHog events carry
 * `item_id`, sales rows carry `menu_item_id`). No name matching exists in this system.
 *
 * Money is integer IQD and is asserted where it enters; quantities are non-negative integers.
 */
import { iqd } from '../money/iqd';
import type { EngagementWindow } from './range';

/** Bilingual item identity; the UI picks the locale name. */
export type ItemRef = { id: string; nameEn: string; nameAr: string };

/** Names known to the caller; an id missing here (deleted item) gets empty names. */
export type ItemNames = ReadonlyMap<string, ItemRef>;

export function refOf(id: string, names: ItemNames): ItemRef {
  return names.get(id) ?? { id, nameEn: '', nameAr: '' };
}

/** Non-negative integer count (qty, views, sessions…); throws otherwise. */
export function assertCount(value: number, what = 'count'): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

/** Percentage change, rounded; null when there is no baseline (prev ≤ 0). */
export function pctDelta(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export type ItemConversion = ItemRef & {
  views: number;
  carts: number;
  sold: number;
  /**
   * views → actually SOLD, in percent. Can exceed 100 when an item sells more than its page
   * is opened — common for staples ordered verbally without a scan.
   */
  convPct: number;
};

/**
 * One row per item across the funnel: distinct-session views → cart adds → actually sold.
 * Counts for a repeated id are SUMMED (never assigned), so a duplicate row can't clobber a
 * total. Sorted by views so "looked at a lot but never bought" surfaces first.
 */
export function buildItemConversion(
  views: readonly { id: string; count: number }[],
  carts: readonly { id: string; count: number }[],
  sold: readonly { id: string; qty: number }[],
  names: ItemNames,
  limit = 15,
): ItemConversion[] {
  const rows = new Map<string, ItemConversion>();
  const row = (id: string): ItemConversion => {
    let r = rows.get(id);
    if (!r) {
      r = { ...refOf(id, names), views: 0, carts: 0, sold: 0, convPct: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const v of views) row(v.id).views += assertCount(v.count, 'views');
  for (const c of carts) row(c.id).carts += assertCount(c.count, 'carts');
  for (const s of sold) row(s.id).sold += assertCount(s.qty, 'qty');
  return [...rows.values()]
    .map((r) => ({ ...r, convPct: r.views > 0 ? Math.round((r.sold / r.views) * 100) : 0 }))
    .sort((a, b) => b.views - a.views || b.sold - a.sold || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * Units sold per view, as the UI should present it — an INDEX (two different populations),
 * never a conversion rate: 'none' = no views to divide by; 'zero' = viewed, never sold;
 * 'lt' = below `value` (rounds to 0.0); 'ratio' = `value` sales per view (one decimal).
 */
export function saleRatio(
  sold: number,
  views: number,
): { kind: 'none' | 'zero' | 'lt' | 'ratio'; value?: number } {
  if (views <= 0) return { kind: 'none' };
  if (sold <= 0) return { kind: 'zero' };
  const r = sold / views;
  if (r < 0.05) return { kind: 'lt', value: 0.1 };
  return { kind: 'ratio', value: Math.round(r * 10) / 10 };
}

/** Abandoned item views per item PER DAY, bucketed by dwell time. */
export type AbandonedViewDay = {
  id: string;
  /** Business date 'YYYY-MM-DD'. */
  date: string;
  b5to10: number;
  b10to20: number;
  b20plus: number;
};

export type AbandonedView = ItemRef & {
  b5to10: number;
  b10to20: number;
  b20plus: number;
  total: number;
};

/**
 * "Looked but didn't order", net of real sales. Sales are day-level, so suppression is
 * day-level: on any day an item actually sold, that day's abandoned views for it are
 * dropped. The rest is re-aggregated per item, largest first.
 */
export function abandonedViewsNet(
  byDay: readonly AbandonedViewDay[],
  soldByDay: readonly { id: string; date: string; qty: number }[],
  names: ItemNames,
  limit = 12,
): AbandonedView[] {
  const soldOn = new Set<string>();
  for (const s of soldByDay) if (assertCount(s.qty, 'qty') > 0) soldOn.add(`${s.id}\n${s.date}`);

  const byItem = new Map<string, AbandonedView>();
  for (const r of byDay) {
    if (soldOn.has(`${r.id}\n${r.date}`)) continue;
    let cur = byItem.get(r.id);
    if (!cur) {
      cur = { ...refOf(r.id, names), b5to10: 0, b10to20: 0, b20plus: 0, total: 0 };
      byItem.set(r.id, cur);
    }
    cur.b5to10 += assertCount(r.b5to10, 'b5to10');
    cur.b10to20 += assertCount(r.b10to20, 'b10to20');
    cur.b20plus += assertCount(r.b20plus, 'b20plus');
    cur.total = cur.b5to10 + cur.b10to20 + cur.b20plus;
  }
  return [...byItem.values()]
    .filter((v) => v.total > 0)
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export type HiddenGem = ItemRef & { views: number; sold: number; convPct: number };

/**
 * Items that convert views into real sales at a high rate but get little exposure — few
 * diners find them, most who do buy. `rows` must be a DEEP conversion pool (≥ 80), or the
 * low-view tail is truncated before this filter sees it.
 */
export function hiddenGems(rows: readonly ItemConversion[], limit = 6): HiddenGem[] {
  const maxViews = Math.max(1, ...rows.map((r) => r.views));
  return rows
    .filter((r) => r.sold >= 2 && r.views >= 3 && r.convPct >= 50 && r.views <= maxViews * 0.4)
    .sort((a, b) => b.convPct - a.convPct || a.views - b.views || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(({ id, nameEn, nameAr, views, sold, convPct }) => ({ id, nameEn, nameAr, views, sold, convPct }));
}

export type ItemMomentum = ItemRef & {
  current: number;
  previous: number;
  /** null when previous = 0 (brand new). */
  deltaPct: number | null;
  isNew: boolean;
};

export type MomentumResult = {
  rising: ItemMomentum[];
  fading: ItemMomentum[];
  /** False when the baseline can't carry a comparison (windows of unequal tracked length, or an empty previous window). */
  comparable: boolean;
  /** Engagement days actually behind each side, for the on-screen explanation. */
  currentDays: number;
  previousDays: number;
};

/** Ignore items too small in both periods to read a trend from. */
export const MOMENTUM_MIN_VIEWS = 5;

/**
 * Per-item interest momentum: distinct-session views this window vs the comparison window.
 * The baseline must span the SAME number of tracked days — a clipped previous window would
 * understate every previous count and turn ordinary items into "▲ +350 %".
 */
export function itemMomentum(
  cur: readonly { id: string; count: number }[],
  prev: readonly { id: string; count: number }[],
  engNow: EngagementWindow,
  engPrev: EngagementWindow,
  names: ItemNames,
  limit = 6,
): MomentumResult {
  const base: MomentumResult = {
    rising: [],
    fading: [],
    comparable: false,
    currentDays: engNow.days,
    previousDays: engPrev.days,
  };
  if (engNow.empty || engPrev.empty || engPrev.days !== engNow.days) return base;

  const prevById = new Map<string, number>();
  for (const p of prev) prevById.set(p.id, (prevById.get(p.id) ?? 0) + assertCount(p.count, 'views'));
  if (prevById.size === 0) return base;

  const curById = new Map<string, number>();
  for (const c of cur) curById.set(c.id, (curById.get(c.id) ?? 0) + assertCount(c.count, 'views'));

  const rows: ItemMomentum[] = [];
  for (const [id, current] of curById) {
    const previous = prevById.get(id) ?? 0;
    rows.push({ ...refOf(id, names), current, previous, deltaPct: pctDelta(current, previous), isNew: previous === 0 });
  }
  // Items that fell out of the current list entirely still count as fading.
  for (const [id, previous] of prevById) {
    if (curById.has(id)) continue;
    rows.push({ ...refOf(id, names), current: 0, previous, deltaPct: -100, isNew: false });
  }

  const rising = rows
    .filter((r) => r.current >= MOMENTUM_MIN_VIEWS && (r.isNew || (r.deltaPct != null && r.deltaPct >= 25)))
    .sort((a, b) => (b.deltaPct ?? 9999) - (a.deltaPct ?? 9999) || b.current - a.current || a.id.localeCompare(b.id))
    .slice(0, limit);
  const fading = rows
    .filter((r) => r.previous >= MOMENTUM_MIN_VIEWS && r.deltaPct != null && r.deltaPct <= -25)
    .sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0) || b.previous - a.previous || a.id.localeCompare(b.id))
    .slice(0, limit);
  return { ...base, rising, fading, comparable: true };
}

export type SalesVsEngagementDay = {
  date: string;
  /** null on days with engagement but no sales recorded — the chart draws a gap. */
  revenue: number | null;
  tabs: number | null;
  views: number;
  waiterCalls: number;
};

/**
 * Real daily revenue and engagement on one shared daily timeline. Days with sales but no
 * engagement data show zeros; days with engagement but no sales show `revenue: null`.
 */
export function salesVsEngagement(
  sales: readonly { date: string; revenueIqd: number; tabs: number }[],
  eng: readonly { date: string; views: number; waiterCalls: number }[],
): SalesVsEngagementDay[] {
  const salesByDate = new Map<string, { revenue: number; tabs: number }>();
  for (const s of sales) {
    const cur = salesByDate.get(s.date) ?? { revenue: 0, tabs: 0 };
    cur.revenue += iqd(s.revenueIqd);
    cur.tabs += assertCount(s.tabs, 'tabs');
    salesByDate.set(s.date, cur);
  }
  const engByDate = new Map<string, { views: number; waiterCalls: number }>();
  for (const e of eng) {
    const cur = engByDate.get(e.date) ?? { views: 0, waiterCalls: 0 };
    cur.views += assertCount(e.views, 'views');
    cur.waiterCalls += assertCount(e.waiterCalls, 'waiterCalls');
    engByDate.set(e.date, cur);
  }
  const dates = [...new Set([...salesByDate.keys(), ...engByDate.keys()])].sort();
  return dates.map((date) => {
    const s = salesByDate.get(date);
    const e = engByDate.get(date);
    return {
      date,
      revenue: s ? s.revenue : null,
      tabs: s ? s.tabs : null,
      views: e ? e.views : 0,
      waiterCalls: e ? e.waiterCalls : 0,
    };
  });
}
