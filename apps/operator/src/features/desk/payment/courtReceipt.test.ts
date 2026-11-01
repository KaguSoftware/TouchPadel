import { describe, expect, it } from 'vitest';
import { courtReceiptBody, courtReceiptLines, hasCourtReceipt } from './courtReceipt';
import type { BookingBill, LiveTab, SettledTab } from './deskPaymentLogic';

function bill(over: Partial<BookingBill> = {}): BookingBill {
  return {
    reservation: {
      id: 'r1', kind: 'booking', status: 'confirmed', price_iqd: 40000, guest_name: 'Ali',
      start_at: '2026-11-01T17:00:00Z', end_at: '2026-11-01T18:30:00Z', court_id: 'c1',
      court_name_en: 'Court 1', court_name_ar: 'الملعب 1',
    },
    live: true,
    day_open: true,
    live_tab: null,
    court_paid_iqd: 0,
    court_remaining_iqd: 40000,
    court_refund_due_iqd: 0,
    settled_tabs: [],
    ...over,
  };
}
const tab: LiveTab = {
  id: 't1', status: 'open', day_session_id: 'd1', subtotal_iqd: 6000, discount_iqd: 1000, tax_iqd: 0,
  court_iqd: 40000, total_iqd: 45000, paid_iqd: 10000, due_iqd: 35000, over_paid_iqd: 0, item_count: 2,
  has_orders: true, has_payments: true, has_adjustments: true,
};
const settled: SettledTab = {
  tab_id: 't0', settled_at: '2026-11-01T18:00:00Z', court_iqd: 40000, total_iqd: 40000, refunds_iqd: 0,
  payments: [
    { id: 'p2', method: 'card', amount_iqd: 15000, tendered_iqd: null, change_iqd: null, created_at: '2026-11-01T18:01:00Z', recorded_by_name: 'Sara' },
    { id: 'p1', method: 'cash', amount_iqd: 25000, tendered_iqd: 30000, change_iqd: 5000, created_at: '2026-11-01T18:00:00Z', recorded_by_name: 'Sara' },
  ],
};

describe('court receipt (F-30)', () => {
  it('an open bill: court fee, café, discount, total, paid and left to pay', () => {
    expect(courtReceiptLines(bill({ live_tab: tab }))).toEqual([
      { key: 'courtFee', amount: 40000 },
      { key: 'cafeItems', amount: 6000, count: 2 },
      { key: 'discount', amount: -1000 },
      { key: 'total', amount: 45000, strong: true },
      { key: 'paidSoFar', amount: -10000 },
      { key: 'due', amount: 35000, strong: true },
    ]);
  });

  it('a paid booking: the bill, then each payment oldest first with the change given', () => {
    expect(courtReceiptLines(bill({ settled_tabs: [settled] }))).toEqual([
      { key: 'courtFee', amount: 40000 },
      { key: 'total', amount: 40000, strong: true },
      { key: 'paidCash', amount: -25000 },
      { key: 'change', amount: 5000 },
      { key: 'paidCard', amount: -15000 },
    ]);
  });

  it('an online deposit comes first and the court fee reads as the rest', () => {
    const lines = courtReceiptLines(bill({ online_paid_iqd: 10000, live_tab: { ...tab, court_iqd: 30000 } }));
    expect(lines[0]).toEqual({ key: 'paidOnline', amount: 10000 });
    expect(lines[1]).toEqual({ key: 'courtFeeRest', amount: 30000 });
  });

  it('nothing to print for a booking with no bill, payment or deposit', () => {
    expect(hasCourtReceipt(bill())).toBe(false);
    expect(hasCourtReceipt(bill({ live_tab: tab }))).toBe(true);
    expect(hasCourtReceipt(bill({ settled_tabs: [settled] }))).toBe(true);
    expect(hasCourtReceipt(bill({ online_paid_iqd: 5000 }))).toBe(true);
  });

  it('escapes every word, so a typed name cannot become markup', () => {
    const html = courtReceiptBody({
      venue: 'Touch Padel', heading: 'Court receipt', meta: ['<b>Ali</b> & co'], printedAt: '18:30',
      rows: [{ label: 'Total', value: '40,000 IQD', strong: true }], thanks: 'Thanks',
    });
    expect(html).toContain('&lt;b&gt;Ali&lt;/b&gt; &amp; co');
    expect(html).not.toContain('<b>Ali');
    expect(html).toContain('font-weight:700"><td');
  });
});
