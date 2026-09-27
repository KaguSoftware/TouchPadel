import { describe, expect, it } from 'vitest';
import type { ReservationRow } from '../deskTypes';
import {
  canAddCafeBill,
  canTakePayment,
  chargeLabelOf,
  closeBillPlan,
  onlinePaymentsTaken,
  onlineRefundState,
  paidOnlineOnly,
  panelStateOf,
  paymentMethodKey,
  statesById,
  toSettle,
  unsettledBefore,
  type BillStateRow,
  type BookingBill,
  type LiveTab,
} from './deskPaymentLogic';

function bill(over: Partial<BookingBill> = {}, reservation: Partial<BookingBill['reservation']> = {}): BookingBill {
  return {
    reservation: {
      id: 'r1',
      kind: 'booking',
      status: 'confirmed',
      price_iqd: 30_000,
      guest_name: 'Sara',
      start_at: '2026-09-17T18:00:00.000Z',
      end_at: '2026-09-17T19:00:00.000Z',
      court_id: 'c1',
      court_name_en: 'Court 1',
      court_name_ar: 'الملعب ١',
      ...reservation,
    },
    live: true,
    day_open: true,
    live_tab: null,
    court_paid_iqd: 0,
    court_remaining_iqd: 30_000,
    court_refund_due_iqd: 0,
    settled_tabs: [],
    ...over,
  };
}

function tab(over: Partial<LiveTab> = {}): LiveTab {
  return {
    id: 't1',
    status: 'open',
    day_session_id: 'd1',
    subtotal_iqd: 0,
    discount_iqd: 0,
    tax_iqd: 0,
    court_iqd: 30_000,
    total_iqd: 30_000,
    paid_iqd: 0,
    due_iqd: 30_000,
    over_paid_iqd: 0,
    item_count: 0,
    has_orders: false,
    has_payments: false,
    has_adjustments: false,
    ...over,
  };
}

function state(over: Partial<BillStateRow> = {}): BillStateRow {
  return {
    reservation_id: 'r1',
    state: 'none',
    live_tab_id: null,
    due_iqd: 30_000,
    court_paid_iqd: 0,
    court_remaining_iqd: 30_000,
    court_refund_due_iqd: 0,
    ...over,
  };
}

function res(over: Partial<ReservationRow>): ReservationRow {
  return {
    id: 'r1',
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-17T18:00:00.000Z',
    end_at: '2026-09-17T19:00:00.000Z',
    guest_name: 'Sara',
    ...over,
  } as ReservationRow;
}

describe('panelStateOf', () => {
  it('not charged yet → take payment', () => {
    expect(panelStateOf(bill())).toBe('notCharged');
    expect(canTakePayment('notCharged')).toBe(true);
  });
  it('an open bill with money due', () => {
    expect(panelStateOf(bill({ live_tab: tab() }))).toBe('billOpen');
  });
  it('an open bill owing nothing must be closed, not paid', () => {
    const b = bill({ live: false, court_remaining_iqd: 0, live_tab: tab({ court_iqd: 0, total_iqd: 0, due_iqd: 0 }) }, { status: 'no_show' });
    expect(panelStateOf(b)).toBe('closeBill');
    expect(canTakePayment('closeBill')).toBe(false);
  });
  it('paid, then the booking got dearer → owed again', () => {
    expect(panelStateOf(bill({ court_paid_iqd: 30_000, court_remaining_iqd: 15_000 }))).toBe('owedAgain');
  });
  it('paid in full', () => {
    expect(panelStateOf(bill({ court_paid_iqd: 30_000, court_remaining_iqd: 0 }))).toBe('paid');
  });
  it('money owed back wins over everything, including an open bill', () => {
    expect(panelStateOf(bill({ court_refund_due_iqd: 10_000, court_paid_iqd: 30_000, court_remaining_iqd: 0 }))).toBe('refundDue');
    expect(panelStateOf(bill({ live_tab: tab({ over_paid_iqd: 5_000, due_iqd: 0 }) }))).toBe('refundDue');
  });
  it('an ended booking with nothing open', () => {
    expect(panelStateOf(bill({ live: false, court_remaining_iqd: 0 }, { status: 'cancelled' }))).toBe('ended');
  });
  it('a live booking with no court price', () => {
    expect(panelStateOf(bill({ court_remaining_iqd: 0 }, { price_iqd: null }))).toBe('noFee');
  });
});

describe('online deposit (build-contracts-2026-09-27)', () => {
  it('a deposit paid online leaves the rest to take, not "owed again"', () => {
    const b = bill({ court_paid_iqd: 15_000, court_remaining_iqd: 15_000, online_paid_iqd: 15_000 });
    expect(paidOnlineOnly(b)).toBe(true);
    expect(panelStateOf(b)).toBe('depositRest');
    expect(canTakePayment('depositRest')).toBe(true);
  });
  it('desk money on top of the deposit, then a dearer booking, is owed again', () => {
    const b = bill({ court_paid_iqd: 30_000, court_remaining_iqd: 5_000, online_paid_iqd: 15_000 });
    expect(paidOnlineOnly(b)).toBe(false);
    expect(panelStateOf(b)).toBe('owedAgain');
  });
  it('a deposit that covers the whole fee is paid; a bill without the field reads as no deposit', () => {
    expect(panelStateOf(bill({ court_paid_iqd: 30_000, court_remaining_iqd: 0, online_paid_iqd: 30_000 }))).toBe('paid');
    expect(paidOnlineOnly(bill({ court_paid_iqd: 15_000 }))).toBe(false);
  });
  it('the till only ever names cash and card; anything else on a bill is online', () => {
    expect(paymentMethodKey('cash')).toBe('cash');
    expect(paymentMethodKey('card')).toBe('card');
    expect(paymentMethodKey('qi')).toBe('online');
  });
  it('lists only deposits that took money, earliest first', () => {
    const p = (id: string, succeeded_at: string | null, status = 'succeeded') => ({ id, status, amount_iqd: 15_000, refund_amount_iqd: null, succeeded_at, refunded_at: null, sandbox: false });
    const b = bill({ online_payments: [p('late', '2099-09-02T10:00:00Z'), p('failed', null, 'failed'), p('early', '2099-09-01T10:00:00Z')] });
    expect(onlinePaymentsTaken(b).map((x) => x.id)).toEqual(['early', 'late']);
    expect(onlinePaymentsTaken(bill())).toEqual([]);
  });
  it('says what became of a refund', () => {
    const base = { amount_iqd: 20_000, refund_amount_iqd: 20_000 };
    expect(onlineRefundState({ ...base, status: 'succeeded' })).toBe('none');
    expect(onlineRefundState({ ...base, status: 'succeeded', forfeited: true })).toBe('kept');
    expect(onlineRefundState({ ...base, status: 'refund_pending' })).toBe('pending');
    expect(onlineRefundState({ ...base, status: 'refund_failed' })).toBe('failed');
    expect(onlineRefundState({ ...base, status: 'refunded' })).toBe('refunded');
    expect(onlineRefundState({ ...base, status: 'refunded', refund_amount_iqd: 5_000 })).toBe('refundedPart');
  });
});

describe('closeBillPlan', () => {
  it('removes an empty bill, naming the booking state as the reason', () => {
    const b = bill({ live: false, live_tab: tab({ court_iqd: 0, total_iqd: 0, due_iqd: 0 }) }, { status: 'no_show' });
    expect(closeBillPlan(b)).toEqual({ mutation: 'tab.cancel', reason: 'booking_no_show' });
  });
  it('closes at zero a bill that ever held anything', () => {
    const b = bill({ live: false, live_tab: tab({ court_iqd: 0, total_iqd: 0, due_iqd: 0, has_orders: true }) }, { status: 'cancelled' });
    expect(closeBillPlan(b)).toEqual({ mutation: 'tab.settle_zero', reason: 'booking_cancelled' });
  });
  it('never closes a bill that owes money or was over-paid', () => {
    expect(closeBillPlan(bill({ live_tab: tab() }))).toBeNull();
    expect(closeBillPlan(bill({ live_tab: tab({ due_iqd: 0, over_paid_iqd: 1 }) }))).toBeNull();
    expect(closeBillPlan(bill())).toBeNull();
  });
});

describe('canAddCafeBill', () => {
  it('needs a live booking, an open day, and no refund pending', () => {
    expect(canAddCafeBill(bill())).toBe(true);
    expect(canAddCafeBill(bill({ day_open: false }))).toBe(false);
    expect(canAddCafeBill(bill({ live: false }))).toBe(false);
    expect(canAddCafeBill(bill({ court_refund_due_iqd: 1 }))).toBe(false);
  });
});

describe('chargeLabelOf', () => {
  it('maps every server state to one tone and sentence', () => {
    expect(chargeLabelOf(state({ state: 'paid', due_iqd: 0 }), true)).toEqual({ tone: 'success', key: 'paid' });
    expect(chargeLabelOf(state({ state: 'open' }), false)).toEqual({ tone: 'warn', key: 'billOpen', amount: 30_000 });
    expect(chargeLabelOf(state({ state: 'partly_paid', due_iqd: 20_000 }), false)).toEqual({ tone: 'warn', key: 'partlyPaid', amount: 20_000 });
    expect(chargeLabelOf(state({ state: 'dead_open', due_iqd: 0 }), true)).toEqual({ tone: 'warn', key: 'closeBill' });
    expect(chargeLabelOf(state({ state: 'owed', due_iqd: 15_000 }), true)).toEqual({ tone: 'warn', key: 'owed', amount: 15_000 });
    expect(chargeLabelOf(state({ state: 'refund_due', court_refund_due_iqd: 10_000 }), true)).toEqual({ tone: 'danger', key: 'refundDue', amount: 10_000 });
  });
  it('not paid is a warning only once the game is over', () => {
    expect(chargeLabelOf(state(), false)).toEqual({ tone: 'muted', key: 'notPaidYet', amount: 30_000 });
    expect(chargeLabelOf(state(), true)).toEqual({ tone: 'warn', key: 'notPaid', amount: 30_000 });
    expect(chargeLabelOf(state({ due_iqd: 0 }), true)).toEqual({ tone: 'muted', key: 'noFee' });
  });
});

describe('toSettle / unsettledBefore', () => {
  const now = '2026-09-17T19:30:00.000Z';
  const played = res({ id: 'a', start_at: '2026-09-17T18:00:00.000Z', end_at: '2026-09-17T19:00:00.000Z' });
  const playing = res({ id: 'b', start_at: '2026-09-17T19:00:00.000Z', end_at: '2026-09-17T20:00:00.000Z' });
  const paid = res({ id: 'c', court_id: 'c2', start_at: '2026-09-17T17:00:00.000Z', end_at: '2026-09-17T18:00:00.000Z' });
  const block = res({ id: 'm', kind: 'maintenance', start_at: '2026-09-17T16:00:00.000Z', end_at: '2026-09-17T17:00:00.000Z' });
  const states = statesById([
    state({ reservation_id: 'a' }),
    state({ reservation_id: 'b' }),
    state({ reservation_id: 'c', state: 'paid', due_iqd: 0 }),
    state({ reservation_id: 'm', due_iqd: 0 }),
  ]);

  it('lists only bookings that ended and still need settling', () => {
    expect(toSettle([playing, paid, played, block], states, now).map((r) => r.id)).toEqual(['a']);
    expect(toSettle([played], undefined, now)).toEqual([]);
  });
  it('a completed booking counts as ended before its slot is over', () => {
    const early = res({ id: 'a', status: 'completed', end_at: '2026-09-17T20:00:00.000Z' });
    expect(toSettle([early], states, now).map((r) => r.id)).toEqual(['a']);
  });
  it('names the unsettled booking that played on the same court right before', () => {
    expect(unsettledBefore(playing, [played, playing, paid], states, now)?.id).toBe('a');
    expect(unsettledBefore(played, [played, playing], states, now)).toBeUndefined();
  });
});
