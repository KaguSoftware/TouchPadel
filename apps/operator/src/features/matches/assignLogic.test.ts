import { describe, expect, it } from 'vitest';
import {
  allocationsOf,
  assignSeats,
  assignableTotal,
  assignablePayments,
  canKeepOnBooking,
  checkAssign,
  parseAmount,
  paymentOnTab,
  prefillAssign,
  seatDue,
  seatRoom,
  seatStanding,
} from './assignLogic';
import type { MatchSeat, SeatMoney, UnassignedPayment } from './matchPayloads';

// operator.md §5.13.6, money.md §6.5, MD-9: every carrier with room in its
// share, the pre-fill (owing seats first, then what the pool credited), the
// per-seat and per-payment caps, and "Keep on the booking" only on a live
// court-only bill.

function money(owed: number, over: Partial<SeatMoney> = {}): SeatMoney {
  return {
    share_iqd: 10000,
    paid_desk_iqd: 10000 - owed,
    credit_iqd: 0,
    owed_iqd: owed,
    written_off_iqd: 0,
    write_off: null,
    open_iqd: 0,
    take_iqd: owed,
    ...over,
  };
}

function seat(no: number, m: SeatMoney | null): MatchSeat {
  return {
    seat_id: `s${no}`,
    seat_no: no,
    kind: 'desk',
    status: 'attended',
    end_reason: null,
    carrying: true,
    customer_id: null,
    full_name: `Player ${no}`,
    display_name: null,
    phone: null,
    holder_seat_id: null,
    holder_name: null,
    companion_no: null,
    gender: null,
    gender_source: null,
    vouched: false,
    flags: [],
    is_organiser: false,
    joined_at: null,
    ended_at: null,
    marked_at: null,
    marked_by_name: null,
    replaces_seat_id: null,
    replaced_by_seat_id: null,
    ticket: null,
    write_off_reason: null,
    money: m,
    can: { mark_attended: false, mark_no_show: false, unmark: false, remove_reasons: [], take_share: true, write_off: false, replace: false },
  };
}

function payment(id: string, unassigned: number, over: Partial<UnassignedPayment> = {}): UnassignedPayment {
  return {
    payment_id: id,
    tab_id: `tab-${id}`,
    tab_live: false,
    method: 'cash',
    amount_iqd: unassigned,
    unassigned_iqd: unassigned,
    created_at: `2026-10-01T18:0${id.length}:00.000Z`,
    ...over,
  };
}

/** A seat the credit pool covered: owes nothing, nothing linked yet (money.md §10 #21). */
const credited = (credit: number, over: Partial<SeatMoney> = {}) => money(0, { paid_desk_iqd: 10000 - credit, credit_iqd: credit, ...over });

/** A no-show's share, written off by the rules (take 0). */
const noShow = (over: Partial<SeatMoney> = {}) =>
  money(0, { paid_desk_iqd: 0, written_off_iqd: 10000, write_off: 'no_show', ...over });

describe('seatRoom / seatDue / assignSeats', () => {
  it("a seat's room is its share less what is linked (AMOUNT_OVER_SEAT); what it owes is owed or a manual write-off", () => {
    expect(seatRoom(seat(1, money(10000)))).toBe(10000);
    expect(seatDue(seat(1, money(10000)))).toBe(10000);
    const manual = seat(1, money(0, { paid_desk_iqd: 0, write_off: 'manual', written_off_iqd: 10000, take_iqd: 10000 }));
    expect(seatRoom(manual)).toBe(10000);
    expect(seatDue(manual)).toBe(10000);
    expect(seatRoom(seat(1, money(0)))).toBe(0);
    expect(seatRoom(seat(1, null))).toBe(0);
  });

  it('a seat the pool credited owes nothing but still has room for the money that credited it', () => {
    const s = seat(1, credited(10000));
    expect(seatDue(s)).toBe(0);
    expect(seatRoom(s)).toBe(10000);
  });

  it("a no-show's written-off share has room (a link lowers the write-off); a seat that carries nothing has none (NOTHING_OWED)", () => {
    expect(seatRoom(seat(1, noShow()))).toBe(10000);
    expect(seatDue(seat(1, noShow()))).toBe(0);
    expect(seatRoom({ ...seat(1, money(10000)), carrying: false })).toBe(0);
  });

  it('lists every carrier with room, in seat order', () => {
    const seats = [seat(3, money(10000)), seat(1, money(0)), seat(2, money(4000)), seat(4, credited(10000)), { ...seat(5, money(10000)), carrying: false }];
    expect(assignSeats(seats).map((s) => s.seat_no)).toEqual([2, 3, 4]);
  });

  it("each seat's standing, for its line: owes, covered, written off, not due", () => {
    expect(seatStanding(seat(1, money(4000, { credit_iqd: 6000, paid_desk_iqd: 0 })))).toEqual({ owes: 4000, covered: 6000, writtenOff: 0, open: 0 });
    expect(seatStanding(seat(1, noShow()))).toEqual({ owes: 0, covered: 0, writtenOff: 10000, open: 0 });
    // A manual write-off is what Take share collects: it reads as owed, not twice.
    const manual = money(0, { paid_desk_iqd: 0, write_off: 'manual', written_off_iqd: 10000, take_iqd: 10000 });
    expect(seatStanding(seat(1, manual))).toEqual({ owes: 10000, covered: 0, writtenOff: 0, open: 0 });
  });
});

describe('assignablePayments / assignableTotal / paymentOnTab', () => {
  it('the footer total is the rows with money left, a live bill included', () => {
    expect(assignableTotal([payment('a', 5000, { tab_live: true }), payment('b', 0), payment('c', 3000)])).toBe(8000);
    expect(assignableTotal([])).toBe(0);
  });

  it('only payments with money left, oldest first', () => {
    const list = [
      payment('bb', 5000, { created_at: '2026-10-01T19:00:00.000Z' }),
      payment('a', 0),
      payment('c', 3000, { created_at: '2026-10-01T18:00:00.000Z' }),
    ];
    expect(assignablePayments(list).map((p) => p.payment_id)).toEqual(['c', 'bb']);
  });

  it('BOOKING_TAB_OPEN names a tab: the payment on it', () => {
    const list = [payment('a', 5000, { tab_id: 't1', tab_live: true }), payment('b', 3000, { tab_id: 't2' })];
    expect(paymentOnTab(list, 't1')?.payment_id).toBe('a');
    expect(paymentOnTab(list, 'nope')).toBeNull();
    expect(paymentOnTab(list, undefined)).toBeNull();
  });
});

describe('canKeepOnBooking', () => {
  it('only a payment on a live bill (C22)', () => {
    expect(canKeepOnBooking(payment('a', 1, { tab_live: true }))).toBe(true);
    expect(canKeepOnBooking(payment('a', 1, { tab_live: false }))).toBe(false);
  });
});

describe('prefillAssign', () => {
  it('spreads a payment over the owing seats in seat order, each up to what it owes', () => {
    const seats = [seat(1, money(10000)), seat(2, money(10000)), seat(3, money(0)), seat(4, money(10000))];
    expect(prefillAssign([payment('a', 25000)], seats)).toEqual({ a: { s1: 10000, s2: 10000, s4: 5000 } });
  });

  it('a second payment starts where the first stopped, so no seat is filled twice', () => {
    const seats = [seat(1, money(10000)), seat(2, money(10000))];
    const draft = prefillAssign([payment('a', 15000, { created_at: '2026-10-01T18:00:00.000Z' }), payment('b', 8000, { created_at: '2026-10-01T18:30:00.000Z' })], seats);
    expect(draft).toEqual({ a: { s1: 10000, s2: 5000 }, b: { s2: 5000 } });
  });

  it('a payment bigger than every share leaves the rest unassigned', () => {
    const seats = [seat(1, money(4000))];
    expect(prefillAssign([payment('a', 30000)], seats)).toEqual({ a: { s1: 4000 } });
  });

  it('#21: the organiser paid everyone on the bill and the pool credited every seat to 0; the payment goes back on all four', () => {
    const seats = [seat(1, credited(10000)), seat(2, credited(10000)), seat(3, credited(10000)), seat(4, credited(10000))];
    const payments = [payment('a', 40000)];
    const draft = prefillAssign(payments, seats);
    expect(draft).toEqual({ a: { s1: 10000, s2: 10000, s3: 10000, s4: 10000 } });
    const c = checkAssign(draft, payments, seats);
    expect(c.empty).toBe(false);
    expect([...c.overSeat]).toEqual([]);
    expect([...c.overPayment]).toEqual([]);
    expect(allocationsOf(draft, 'a', seats)).toHaveLength(4);
  });

  it('part of the price on a settled bill: the pool credited seats 4 and 3, and the seats that owe are filled first', () => {
    const owes = () => money(10000, { paid_desk_iqd: 0 });
    const seats = [seat(1, owes()), seat(2, owes()), seat(3, credited(10000)), seat(4, credited(10000))];
    expect(assignSeats(seats).map((s) => s.seat_no)).toEqual([1, 2, 3, 4]);
    expect(prefillAssign([payment('a', 20000)], seats)).toEqual({ a: { s1: 10000, s2: 10000 } });
  });

  it('a seat part owed, part credited: what it owes first, then the credit, never past its room', () => {
    const seats = [seat(1, money(4000, { paid_desk_iqd: 0, credit_iqd: 6000 })), seat(2, money(10000, { paid_desk_iqd: 0 }))];
    expect(prefillAssign([payment('a', 20000)], seats)).toEqual({ a: { s1: 10000, s2: 10000 } });
    expect(prefillAssign([payment('a', 12000)], seats)).toEqual({ a: { s1: 4000, s2: 8000 } });
  });

  it("a no-show's share is listed but never pre-filled: the desk types it", () => {
    const seats = [seat(1, money(0)), seat(2, noShow())];
    expect(assignSeats(seats).map((s) => s.seat_no)).toEqual([2]);
    expect(prefillAssign([payment('a', 10000)], seats)).toEqual({ a: {} });
    const draft = { a: { s2: 10000 } };
    expect(checkAssign(draft, [payment('a', 10000)], seats).overSeat.size).toBe(0);
    expect(checkAssign({ a: { s2: 10001 } }, [payment('a', 20000)], seats).overSeat.has('s2')).toBe(true);
    expect(allocationsOf(draft, 'a', seats)).toEqual([{ seat_id: 's2', amount_iqd: 10000 }]);
  });
});

describe('checkAssign', () => {
  const seats = [seat(1, money(10000)), seat(2, money(6000))];

  it('the pre-fill passes', () => {
    const payments = [payment('a', 12000)];
    const c = checkAssign(prefillAssign(payments, seats), payments, seats);
    expect([...c.overPayment]).toEqual([]);
    expect([...c.overSeat]).toEqual([]);
    expect(c.empty).toBe(false);
  });

  it('more than the payment has left is flagged on the payment', () => {
    const payments = [payment('a', 12000)];
    const c = checkAssign({ a: { s1: 10000, s2: 6000 } }, payments, seats);
    expect([...c.overPayment]).toEqual(['a']);
  });

  it("more than a seat's room is flagged on the seat, counted across payments", () => {
    const payments = [payment('a', 8000), payment('bb', 8000)];
    const c = checkAssign({ a: { s2: 4000 }, bb: { s2: 4000 } }, payments, seats);
    expect([...c.overSeat]).toEqual(['s2']);
    expect([...c.overPayment]).toEqual([]);
  });

  it('nothing typed is empty', () => {
    expect(checkAssign({ a: { s1: 0 } }, [payment('a', 5000)], seats).empty).toBe(true);
  });
});

describe('allocationsOf', () => {
  it("one payment's p_allocations in seat order, whole dinars, zeros dropped", () => {
    const seats = [seat(2, money(10000)), seat(1, money(10000))];
    expect(allocationsOf({ a: { s2: 3000, s1: 2500.7 }, b: { s1: 9 } }, 'a', seats)).toEqual([
      { seat_id: 's1', amount_iqd: 2500 },
      { seat_id: 's2', amount_iqd: 3000 },
    ]);
    expect(allocationsOf({ a: { s1: 0 } }, 'a', seats)).toEqual([]);
    expect(allocationsOf({}, 'a', seats)).toEqual([]);
  });
});

describe('parseAmount', () => {
  it('digits only; empty is 0', () => {
    expect(parseAmount('12,500')).toBe(12500);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });
});
