/**
 * The café's sales from before the system (0412): what the old till's reports
 * hold for the picked range, read from `app.analytics_cafe_history`. The same
 * days are already inside the daily sales rows, so the Summary and the trend
 * count them; this module shapes the old till's OWN view (months, product
 * groups, products) and the notice lines that say which part of the page is
 * the old till's and what its reports do not have.
 *
 * Nothing here computes money the server did not send, except two shares
 * (a group's part of item sales, and what is kept after the owner's stated
 * cost), both printed as percentages of figures shown beside them.
 */
import type { MessageKey } from '@touch/i18n';
import type { Tr } from '../copy';
import type { Formatters } from '../format';

export interface OldTillTotals {
  days: number;
  from: string | null;
  to: string | null;
  grossIqd: number;
  discountIqd: number;
  netIqd: number;
  orders: number;
  units: number;
  /** Days no orders report covers: their discounts are unknown, so net equals gross. */
  discountUnknownDays: number;
}

export interface OldTillMonth {
  /** First day of the month, 'YYYY-MM-DD'. */
  month: string;
  days: number;
  grossIqd: number;
  discountIqd: number;
  netIqd: number;
  orders: number;
  units: number;
  discountUnknownDays: number;
}

export interface OldTillGroup {
  key: string;
  units: number;
  grossIqd: number;
  /** Item sales of the group's products that have a cost. */
  costKnownGrossIqd: number;
  /** The owner's stated cost of those units. */
  costIqd: number;
}

export interface OldTillProduct {
  product: string;
  unitPriceIqd: number;
  group: string;
  units: number;
  grossIqd: number;
  /** The owner's stated cost of one unit; null where his sheet does not name the item. */
  unitCostIqd: number | null;
}

export interface OldTillHistory {
  totals: OldTillTotals;
  months: OldTillMonth[];
  groups: OldTillGroup[];
  products: OldTillProduct[];
  items: { grossIqd: number; costKnownGrossIqd: number; costIqd: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
/** jsonb bigint arrives as a number; a string number is read too, anything else is 0. */
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The server payload, or null when it is absent or holds no old-till day. */
export function parseOldTill(json: unknown): OldTillHistory | null {
  if (!isObj(json) || !isObj(json.totals)) return null;
  const t = json.totals;
  const totals: OldTillTotals = {
    days: num(t.days),
    from: str(t.from) || null,
    to: str(t.to) || null,
    grossIqd: num(t.gross),
    discountIqd: num(t.discounts),
    netIqd: num(t.net),
    orders: num(t.orders),
    units: num(t.units),
    discountUnknownDays: num(t.discountUnknownDays),
  };
  if (totals.days === 0) return null;
  const items = isObj(json.items) ? json.items : {};
  return {
    totals,
    months: arr(json.months).map((m) => ({
      month: str(m.month),
      days: num(m.days),
      grossIqd: num(m.gross_iqd),
      discountIqd: num(m.discount_iqd),
      netIqd: num(m.net_iqd),
      orders: num(m.orders),
      units: num(m.units),
      discountUnknownDays: num(m.discount_unknown_days),
    })),
    groups: arr(json.groups).map((g) => ({
      key: str(g.key),
      units: num(g.units),
      grossIqd: num(g.gross_iqd),
      costKnownGrossIqd: num(g.cost_known_gross_iqd),
      costIqd: num(g.cost_iqd),
    })),
    products: arr(json.products).map((p) => ({
      product: str(p.product),
      unitPriceIqd: num(p.unit_price_iqd),
      group: str(p.group),
      units: num(p.units),
      grossIqd: num(p.gross_iqd),
      unitCostIqd: numOrNull(p.unit_cost_iqd),
    })),
    items: { grossIqd: num(items.gross_iqd), costKnownGrossIqd: num(items.cost_known_gross_iqd), costIqd: num(items.cost_iqd) },
  };
}

/** Share of the price left after the owner's cost, in percent; null with no costed sales. */
export function keptPct(costKnownGrossIqd: number, costIqd: number): number | null {
  return costKnownGrossIqd > 0 ? ((costKnownGrossIqd - costIqd) / costKnownGrossIqd) * 100 : null;
}

/** A part of a whole in percent; null when the whole is empty. */
export function sharePct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

const GROUP_KEYS: Record<string, MessageKey> = {
  dessert_food: 'ws.analytics.oldTill.groups.dessertFood',
  juice: 'ws.analytics.oldTill.groups.juice',
  smoothie_shake: 'ws.analytics.oldTill.groups.smoothieShake',
  mojito: 'ws.analytics.oldTill.groups.mojito',
  iced_coffee: 'ws.analytics.oldTill.groups.icedCoffee',
  water_ice: 'ws.analytics.oldTill.groups.waterIce',
  hot_coffee: 'ws.analytics.oldTill.groups.hotCoffee',
  tea_chocolate: 'ws.analytics.oldTill.groups.teaChocolate',
  espresso: 'ws.analytics.oldTill.groups.espresso',
  other: 'ws.analytics.oldTill.groups.other',
};

/** A group's name; a key the app does not know yet reads as "Other". */
export function groupName(key: string, tr: Tr): string {
  return tr(GROUP_KEYS[key] ?? 'ws.analytics.oldTill.groups.other');
}

/** A product as the old till names it; one name sold at two prices carries the price. */
export function productLabel(p: OldTillProduct, all: readonly OldTillProduct[], f: Formatters): string {
  return all.some((o) => o !== p && o.product === p.product) ? `${p.product} (${f.num(p.unitPriceIqd)})` : p.product;
}

export interface OldTillNotice {
  key: string;
  text: string;
}

/**
 * The notice lines for a page whose café figures include the old till:
 * `cafe` (Analytics) or `panel` (the management panel), then the days whose
 * discounts the till's reports do not give.
 */
export function oldTillNotices(totals: OldTillTotals | null, screen: 'cafe' | 'panel', tr: Tr, f: Formatters): OldTillNotice[] {
  if (!totals || totals.days === 0 || !totals.from || !totals.to) return [];
  const out: OldTillNotice[] = [
    {
      key: 'old-till',
      text: tr(screen === 'cafe' ? 'ws.analytics.notices.history.cafe' : 'ws.analytics.notices.history.cafePanel', {
        from: f.date(totals.from, true),
        to: f.date(totals.to, true),
        amount: f.money(totals.netIqd),
      }),
    },
  ];
  if (totals.discountUnknownDays > 0) {
    out.push({ key: 'old-till-discounts', text: tr('ws.analytics.notices.history.cafeNoDiscount', { n: f.num(totals.discountUnknownDays) }) });
  }
  return out;
}

/** The management panel's `history.period.cafe` object (panel_headline, 0412). */
export function parseOldTillTotals(json: unknown): OldTillTotals | null {
  return parseOldTill({ totals: json })?.totals ?? null;
}

/** The section's answer: what the old till took, what sold most, and what the known costs leave. */
export function oldTillTakeaway(h: OldTillHistory, tr: Tr, f: Formatters): string {
  const top = h.groups.reduce<OldTillGroup | null>((b, g) => (b === null || g.grossIqd > b.grossIqd ? g : b), null);
  const topShare = top ? sharePct(top.grossIqd, h.items.grossIqd) : null;
  const coverage = sharePct(h.items.costKnownGrossIqd, h.items.grossIqd);
  const kept = keptPct(h.items.costKnownGrossIqd, h.items.costIqd);
  return [
    top && topShare != null
      ? tr('ws.analytics.oldTill.lead', { amount: f.money(h.totals.netIqd), days: f.num(h.totals.days), group: groupName(top.key, tr), pct: f.pct(topShare) })
      : null,
    coverage != null && kept != null ? tr('ws.analytics.oldTill.leadCost', { coverage: f.pct(coverage), kept: f.pct(kept) }) : null,
  ]
    .filter(Boolean)
    .join(' ');
}
