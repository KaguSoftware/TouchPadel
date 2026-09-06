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
 * Kept deliberately in step with 0036, whose rules are:
 *   - live lines only (a voided line and a voided order are both out);
 *   - discounts capped at the subtotal;
 *   - tax per active group on the post-discount base;
 *   - `tax_inclusive` means the tax figure is display-only.
 *
 * The one simplification against the server: the pro-rata spread of a WHOLE-TAB
 * discount across tax groups. The till has at most a couple of groups and the
 * difference is sub-IQD, and the server figure is the one that gets charged.
 */

export interface TotalsLine {
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

export interface TaxContext {
  /** category id -> rate in basis points. */
  rateByCategory: ReadonlyMap<string, number>;
  taxInclusive: boolean;
}

export interface TabTotals {
  subtotal: number;
  discount: number;
  tax: number;
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

export function computeTabTotals(tab: TotalsInput | null, tax: TaxContext | null): TabTotals {
  if (!tab) return { subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, due: 0 };

  const lines = liveLines(tab.orders);
  const subtotal = lines.reduce((s, l) => s + l.line_total_iqd, 0);

  // Capped at the subtotal: 0036 does the same, so a discount can never make a
  // tab owe less than nothing.
  const discount = Math.min(
    (tab.tab_adjustments ?? [])
      .filter((a) => DISCOUNT_KINDS.has(a.kind))
      .reduce((s, a) => s + a.amount_iqd, 0),
    subtotal,
  );

  const byRate = new Map<number, number>();
  for (const l of lines) {
    const rate = tax?.rateByCategory.get(l.menu_item?.category_id ?? '') ?? 0;
    byRate.set(rate, (byRate.get(rate) ?? 0) + l.line_total_iqd);
  }
  let taxTotal = 0;
  for (const [rate, groupSubtotal] of byRate) {
    taxTotal += Math.round((groupSubtotal * rate) / 10000);
  }

  const total = Math.max(subtotal - discount + (tax?.taxInclusive ? 0 : taxTotal), 0);
  const paid = (tab.payments ?? []).reduce((s, p) => s + p.amount_iqd, 0);

  return { subtotal, discount, tax: taxTotal, total, paid, due: Math.max(total - paid, 0) };
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
