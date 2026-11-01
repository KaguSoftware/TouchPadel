/**
 * What an offline tab will cost at replay (F-06), worked out the way the
 * server will work it out — not a second, simpler sum.
 *
 * An offline tab is a list of priced lines (the cached menu's prices, which
 * the server snapshots again at replay) plus any whole-tab discounts queued
 * against it (F-09). Its total is `computeTabTotals` — the till's step-for-step
 * mirror of app.compute_tab_totals — fed those lines with their categories,
 * so tax is charged per active tax group at the cached rate, exactly as the
 * online bill does. The estimate used to be a bare sum of the lines: no tax,
 * no discount, and the queued settle carried no amount, so the server charged
 * its own figure at replay and the drawer could be short.
 *
 * Promotions are NOT automatic on the server: app.apply_best_promotion runs
 * only when a cashier presses Promotion on an online tab (TabDetailPanel), and
 * it is not a queued type. So no promotion can reach an offline tab before
 * its settle replays, and none is added here. What can still move the figure
 * (an admin repricing mid-outage, a tax rate changed, a discount refused at
 * replay) is caught by the settle itself: the queued payment carries this
 * estimate as `expectedTotalIqd`, and settle_tab refuses TOTAL_CHANGED instead
 * of charging an amount the cashier never showed the guest (offlineSettlePayload).
 */
import type { OfflineAdjustment, OfflineTab } from '../../lib/offlineTabs';
import { computeTabTotals, type TabTotals, type TaxContext, type TotalsInput } from './tabTotals';

/** The offline tab as compute_tab_totals would see it after replay: one order, live lines, whole-tab discounts. */
export function offlineTotalsInput(tab: Pick<OfflineTab, 'lines' | 'adjustments'>): TotalsInput {
  return {
    orders: [
      {
        status: 'open',
        order_items: tab.lines.map((l) => ({
          line_total_iqd: l.priceIqd * l.qty,
          voided: false,
          menu_item: l.categoryId ? { category_id: l.categoryId } : null,
        })),
      },
    ],
    tab_adjustments: (tab.adjustments ?? []).map((a) => ({ kind: a.kind, amount_iqd: a.amountIqd, order_item_id: null })),
    payments: [],
  };
}

/** The offline tab's bill: subtotal, discount, tax and total, as the server will stamp them. */
export function offlineTabTotals(tab: Pick<OfflineTab, 'lines' | 'adjustments'>, tax: TaxContext | null): TabTotals {
  // No court fee: a tab opened offline is never charged to a booking.
  return computeTabTotals(offlineTotalsInput(tab), tax, 0);
}

/** round(a / b) half away from zero for non-negative integers, as Postgres rounds numeric. */
function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * The amount app.apply_discount writes for a whole-tab discount, on the base
 * it uses: the tab's goods subtotal at the moment the discount replays (every
 * line queued before it, nothing after). Percent is basis points,
 * round(base × bp / 10000); an amount is capped at the base.
 */
export function discountAmountIqd(kind: OfflineAdjustment['kind'], value: number, subtotalIqd: number): number {
  const base = Math.max(0, Math.floor(subtotalIqd));
  if (kind === 'discount_percent') {
    const bp = Math.min(Math.max(Math.floor(value), 0), 10_000);
    return roundDiv(base * bp, 10_000);
  }
  return Math.min(Math.max(Math.floor(value), 0), base);
}

/**
 * The queued settle for an offline tab. It carries the amount the cashier
 * showed and took (F-06): `amountIqd` and `expectedTotalIqd` are the estimate,
 * so the server either charges exactly that or refuses with TOTAL_CHANGED,
 * which comes back to the till as a row to retry or resolve (F-09). Cash also
 * carries what was handed over.
 */
export function offlineSettlePayload(args: {
  tabIdemKey: string;
  method: 'cash' | 'card';
  totalIqd: number;
  tenderedIqd: number | null;
}): {
  tabIdemKey: string;
  method: 'cash' | 'card';
  amountIqd?: number;
  expectedTotalIqd: number;
  tenderedIqd?: number;
} {
  return {
    tabIdemKey: args.tabIdemKey,
    method: args.method,
    // A zero bill has no amount to name (intIqd payloads are positive); the
    // expectation still pins it.
    ...(args.totalIqd > 0 ? { amountIqd: args.totalIqd } : {}),
    expectedTotalIqd: args.totalIqd,
    ...(args.method === 'cash' && args.tenderedIqd != null ? { tenderedIqd: args.tenderedIqd } : {}),
  };
}
