/**
 * F-30: the court desk's printed receipt for a booking (its court fee and
 * bill). Every figure is app.booking_bill's, as on the panel; nothing here
 * computes money beyond adding the settled bills' own totals together.
 *
 *   courtReceiptLines  which lines the receipt carries, in order (pure).
 *   courtReceiptBody   the receipt's markup from words already translated,
 *                      escaped, for BillView's buildReceiptDoc (pure).
 *
 * With a bill open: court fee, café items, discount, tax, total, what was
 * paid and what is left. With none: the settled bills' court fee and total,
 * then each payment (cash or card, with the change given) and refunds. An
 * online deposit comes first, as what was paid before the desk: the court fee
 * on the bill is already the rest (app.booking_bill), so it is not taken off
 * a second time.
 */
import type { BookingBill } from './deskPaymentLogic';

export type ReceiptLineKey =
  | 'courtFee'
  | 'courtFeeRest'
  | 'cafeItems'
  | 'discount'
  | 'tax'
  | 'total'
  | 'paidOnline'
  | 'paidSoFar'
  | 'due'
  | 'paidCash'
  | 'paidCard'
  | 'change'
  | 'refunded';

export interface ReceiptLine {
  key: ReceiptLineKey;
  /** IQD, already signed the way it prints (a discount or a payment is negative). */
  amount: number;
  strong?: boolean;
  /** cafeItems: how many units. */
  count?: number;
}

/** Is there anything to print? A booking with no bill, no payment and no deposit has no receipt. */
export function hasCourtReceipt(bill: BookingBill): boolean {
  return bill.live_tab !== null || bill.settled_tabs.some((t) => t.payments.length > 0) || (bill.online_paid_iqd ?? 0) > 0;
}

export function courtReceiptLines(bill: BookingBill): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const online = bill.online_paid_iqd ?? 0;
  const tab = bill.live_tab;
  const courtKey: ReceiptLineKey = online > 0 ? 'courtFeeRest' : 'courtFee';
  if (online > 0) out.push({ key: 'paidOnline', amount: online });
  if (tab) {
    out.push({ key: courtKey, amount: tab.court_iqd });
    if (tab.item_count > 0) out.push({ key: 'cafeItems', amount: tab.subtotal_iqd, count: tab.item_count });
    if (tab.discount_iqd > 0) out.push({ key: 'discount', amount: -tab.discount_iqd });
    if (tab.tax_iqd > 0) out.push({ key: 'tax', amount: tab.tax_iqd });
    out.push({ key: 'total', amount: tab.total_iqd, strong: true });
    if (tab.paid_iqd > 0) out.push({ key: 'paidSoFar', amount: -tab.paid_iqd });
    out.push({ key: 'due', amount: tab.due_iqd, strong: true });
    return out;
  }
  const settled = bill.settled_tabs;
  const court = settled.reduce((n, t) => n + t.court_iqd, 0);
  const total = settled.reduce((n, t) => n + t.total_iqd, 0);
  if (settled.length > 0) {
    out.push({ key: courtKey, amount: court });
    out.push({ key: 'total', amount: total, strong: true });
  }
  const payments = settled
    .flatMap((t) => t.payments)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const p of payments) {
    out.push({ key: p.method === 'card' ? 'paidCard' : 'paidCash', amount: -p.amount_iqd });
    if (p.method === 'cash' && (p.change_iqd ?? 0) > 0) out.push({ key: 'change', amount: p.change_iqd ?? 0 });
  }
  const refunds = settled.reduce((n, t) => n + t.refunds_iqd, 0);
  if (refunds > 0) out.push({ key: 'refunded', amount: refunds });
  return out;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The receipt's inner markup (the thermal pipeline wraps it with
 * buildReceiptDoc). Words come in translated; every one is escaped here, so a
 * guest's name typed at the desk cannot become markup on the paper.
 */
export function courtReceiptBody(r: {
  venue: string;
  heading: string;
  /** Court, time, guest: one short line each. */
  meta: readonly string[];
  printedAt: string;
  rows: readonly { label: string; value: string; strong?: boolean }[];
  thanks: string;
}): string {
  const meta = r.meta.map((m) => `<div style="color:var(--tp-muted-fg)">${esc(m)}</div>`).join('');
  const rows = r.rows
    .map(
      (row) =>
        `<tr${row.strong ? ' style="font-weight:700"' : ''}><td style="text-align:start;padding-block:0.15rem">${esc(row.label)}</td>` +
        `<td style="text-align:end;white-space:nowrap;padding-block:0.15rem"><span dir="ltr">${esc(row.value)}</span></td></tr>`,
    )
    .join('');
  return (
    `<div style="text-align:center;margin-block-end:0.6rem"><div style="font-weight:700">${esc(r.venue)}</div>` +
    `<div style="font-weight:700">${esc(r.heading)}</div>${meta}` +
    `<div style="color:var(--tp-muted-fg);font-size:0.8rem">${esc(r.printedAt)}</div></div>` +
    `<table style="inline-size:100%;border-collapse:collapse"><tbody>${rows}</tbody></table>` +
    `<p style="text-align:center;color:var(--tp-muted-fg);margin-block-start:0.8rem">${esc(r.thanks)}</p>`
  );
}
