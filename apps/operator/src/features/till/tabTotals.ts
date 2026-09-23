/**
 * The till's display mirror of `app.compute_tab_totals`.
 *
 * The server re-stamps the authoritative figures at settle time; this exists so
 * the cashier sees the same number a moment earlier, and so the guest bill and
 * the settle panel cannot disagree with each other.
 *
 * It was ~25 lines inside a `useMemo` in the middle of a 1,162-line component,
 * which meant the arithmetic on the money path had NO tests — the audit's
 * "untested logic embedded in a component". Extracted so it can be tested, and
 * so `BillView` renders from exactly the same computation the settle buttons do
 * rather than a second one that drifts.
 *
 * Kept step for step with `app.compute_tab_totals` (0106), whose rules are:
 *   - live lines only (a voided line and a voided order are both out);
 *   - discounts capped at the subtotal;
 *   - tax per ACTIVE tax group, on that group's base after its own line
 *     discounts and its pro-rata share of the whole-tab discounts (the share
 *     is over every group's base, untaxed and inactive ones included);
 *   - `tax_inclusive`: the tax is carved OUT of the price, rate/(10000+rate),
 *     and is display-only — it is not added to the total.
 *
 * This used to tax the full line totals at rate/10000 and call the gap
 * "sub-IQD". It was not: a 20% discount showed 20% too much tax on the guest
 * bill, the exact tender and the part-payment cap, and an inclusive venue
 * showed rate/10000 of a price that already contained it.
 *
 * The court fee is NOT mirrored, and must not be. Since 0106 a booking tab
 * charges the court fee still OWED on the booking — the price now, less what
 * other settled tabs of that booking already stamped — and the client cannot
 * see those other tabs. So the caller passes the server's figure: the stamped
 * `tabs.court_iqd` for a settled tab, `booking_bill.live_tab.court_iqd` for an
 * open one. This file only adds it, the way 0106 does: after the goods total
 * is floored at zero, so a discount can never eat into the court fee.
 */

export interface TotalsLine {
  /** Matches a line discount's `order_item_id`. Optional: a row cached before it was selected. */
  id?: string;
  line_total_iqd: number;
  voided: boolean;
  menu_item: { category_id: string } | null;
}

export interface TotalsOrder {
  status: string;
  order_items?: TotalsLine[];
}

export interface TotalsAdjustment {
  kind: string;
  amount_iqd: number;
  /** Set on a LINE discount; null (or absent on an old cached row) on a whole-tab one. */
  order_item_id?: string | null;
}

/**
 * Every array here is optional ON PURPOSE. These rows reach us through
 * `as unknown as TabListRow[]` casts and out of the persisted query cache
 * (lib/persist.ts), so a missing embed is a runtime possibility the compiler
 * cannot rule out — and this runs on the screen that takes the money, on a
 * kiosk with no address bar. A stale row must degrade to a wrong-for-a-moment
 * figure that the next refetch corrects, never to a dead screen.
 */
export interface TotalsInput {
  orders?: TotalsOrder[];
  tab_adjustments?: TotalsAdjustment[];
  payments?: { amount_iqd: number }[];
}

export interface TaxGroup {
  id: string;
  rateBp: number;
  /** An inactive group still counts in the pro-rata spread, but charges no tax (0106). */
  active: boolean;
}

export interface TaxContext {
  /** category id -> its tax group. A category with no group is simply absent. */
  groupByCategory: ReadonlyMap<string, TaxGroup>;
  taxInclusive: boolean;
}

/** Categories as the till menu reads them (`tax_group:tax_groups(id, rate_bp, is_active)`). */
export interface TaxCategory {
  id: string;
  tax_group: { id?: string; rate_bp: number; is_active?: boolean } | null;
}

export function taxContextFrom(categories: readonly TaxCategory[], taxInclusive: boolean): TaxContext {
  const groupByCategory = new Map<string, TaxGroup>();
  for (const c of categories) {
    if (!c.tax_group) continue;
    const g = c.tax_group;
    // A menu cached before `id` was selected: its rate is the best key there is.
    groupByCategory.set(c.id, { id: g.id ?? `rate:${g.rate_bp}`, rateBp: g.rate_bp, active: g.is_active ?? true });
  }
  return { groupByCategory, taxInclusive };
}

/** round(a / b) for non-negative integers, half away from zero like Postgres numeric round. */
function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

const NO_GROUP = '';

export interface TabTotals {
  subtotal: number;
  discount: number;
  tax: number;
  /** The court fee this tab charges — a server figure passed in, 0 for a tab with no booking. */
  court: number;
  total: number;
  paid: number;
  /** What is still owed. Never negative — an overpayment is a refund, not a credit. */
  due: number;
}

const DISCOUNT_KINDS = new Set(['discount_percent', 'discount_amount']);

/** Every line that still counts: a voided line, or any line of a voided order, is out. */
export function liveLines(orders: readonly TotalsOrder[] | undefined): TotalsLine[] {
  return (orders ?? [])
    .filter((o) => o.status !== 'voided')
    .flatMap((o) => (o.order_items ?? []).filter((i) => !i.voided));
}

/**
 * @param court The court fee from the SERVER (see the header): stamped
 *   `tabs.court_iqd` for a settled tab, `booking_bill.live_tab.court_iqd` for an
 *   open one. Absent, null or negative counts as no court fee.
 */
export function computeTabTotals(tab: TotalsInput | null, tax: TaxContext | null, court?: number | null): TabTotals {
  // No tab is nothing to pay, court or not: the fee belongs to a tab that has loaded.
  if (!tab) return { subtotal: 0, discount: 0, tax: 0, court: 0, total: 0, paid: 0, due: 0 };
  const courtFee = court != null && Number.isFinite(court) && court > 0 ? court : 0;

  const lines = liveLines(tab.orders);
  const subtotal = lines.reduce((s, l) => s + l.line_total_iqd, 0);

  // Capped at the subtotal: 0036 does the same, so a discount can never make a
  // tab owe less than nothing.
  const groupOf = (l: TotalsLine) => tax?.groupByCategory.get(l.menu_item?.category_id ?? '');
  const liveById = new Map<string, TotalsLine>();
  for (const l of lines) if (l.id) liveById.set(l.id, l);

  // A line discount counts only while its line is live; a whole-tab one always.
  const lineDiscByGroup = new Map<string, number>();
  let discLine = 0;
  let discTab = 0;
  for (const a of tab.tab_adjustments ?? []) {
    if (!DISCOUNT_KINDS.has(a.kind)) continue;
    if (a.order_item_id == null) {
      discTab += a.amount_iqd;
      continue;
    }
    const l = liveById.get(a.order_item_id);
    if (!l) continue;
    discLine += a.amount_iqd;
    const key = groupOf(l)?.id ?? NO_GROUP;
    lineDiscByGroup.set(key, (lineDiscByGroup.get(key) ?? 0) + a.amount_iqd);
  }
  // Capped at the subtotal: 0036 does the same, so a discount can never make a
  // tab owe less than nothing.
  const discount = Math.min(discLine + discTab, subtotal);
  // The whole-tab share that survives the cap, after the line discounts took theirs.
  const tabAlloc = Math.max(Math.min(discTab, discount - Math.min(discLine, discount)), 0);

  const groups = new Map<string, { group: TaxGroup | undefined; subtotal: number }>();
  for (const l of lines) {
    const group = groupOf(l);
    const key = group?.id ?? NO_GROUP;
    const g = groups.get(key) ?? { group, subtotal: 0 };
    g.subtotal += l.line_total_iqd;
    groups.set(key, g);
  }
  const bases = [...groups].map(([key, g]) => ({
    group: g.group,
    afterLine: Math.max(g.subtotal - (lineDiscByGroup.get(key) ?? 0), 0),
  }));
  const baseSum = bases.reduce((s, b) => s + b.afterLine, 0);

  let taxTotal = 0;
  for (const { group, afterLine } of bases) {
    if (!group?.active) continue;
    const share = baseSum > 0 ? roundDiv(tabAlloc * afterLine, baseSum) : 0;
    const taxable = Math.max(afterLine - share, 0);
    taxTotal += tax?.taxInclusive
      ? roundDiv(taxable * group.rateBp, 10000 + group.rateBp)
      : roundDiv(taxable * group.rateBp, 10000);
  }

  // Goods floored at zero first, then the court fee on top — 0106's order.
  const total = Math.max(subtotal - discount + (tax?.taxInclusive ? 0 : taxTotal), 0) + courtFee;
  const paid = (tab.payments ?? []).reduce((s, p) => s + p.amount_iqd, 0);

  return { subtotal, discount, tax: taxTotal, court: courtFee, total, paid, due: Math.max(total - paid, 0) };
}

/**
 * Split the tab's discount rows into what a manager did and what the server
 * applied as a promotion (0067: `reason_code = 'promotion'`). Both are plain
 * sums of server rows — the same rule computeTabTotals uses for `discount` —
 * so the two lines on the bill add up to that figure. Non-discount kinds
 * (price overrides) are not discounts and are excluded, as in computeTabTotals.
 */
export interface DiscountBreakdown {
  manager: number;
  promotion: number;
}

export function discountBreakdown(
  adjustments: readonly (TotalsAdjustment & { reason_code?: string | null })[],
): DiscountBreakdown {
  let manager = 0;
  let promotion = 0;
  for (const a of adjustments) {
    if (!DISCOUNT_KINDS.has(a.kind)) continue;
    if (a.reason_code === 'promotion') promotion += a.amount_iqd;
    else manager += a.amount_iqd;
  }
  return { manager, promotion };
}
