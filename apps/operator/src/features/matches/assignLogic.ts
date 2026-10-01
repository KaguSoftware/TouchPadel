/**
 * Assign: money taken on a match booking's own bill (the offline path, or the
 * bill's Cash/Card) put on the players it was for
 * (docs/design/open-matches/operator.md §5.13.6; money.md §6.5, MD-9). Pure;
 * the dialog is AssignPaymentDialog.tsx.
 *
 * The server is the wall: app.match_link_payment refuses a link on a seat that
 * carries nothing (NOTHING_OWED), over what a seat's share has room for
 * (AMOUNT_OVER_SEAT: its links and the amount above its share), or over what
 * the payment has left (PAYMENT_OVER_ALLOCATED). What lives here is the
 * pre-fill the desk starts from and the same caps checked before Save, so a
 * typo is caught on the field rather than as a refusal.
 *
 * The seats a payment can go on are every carrier with room left in its
 * share, not only the ones that owe: the credit pool (MD-9) pays unlinked bill
 * money into the seats on its own, so the payment being assigned has often
 * already brought them to 0 (money.md §10 #21: "the pool credits every seat
 * to 0; Assign makes it exact"). A no-show's share takes a link too: it
 * lowers the write-off (the organiser paid for the absent friend, §6.5).
 */
import type { MatchSeat, UnassignedPayment } from './matchPayloads';

type SeatMoneyOf = Pick<MatchSeat, 'carrying' | 'money'>;

/**
 * What a link can still put on a seat: its share less what is already linked
 * to it (`share_iqd − paid_desk_iqd`, the server's AMOUNT_OVER_SEAT rule).
 * That is what it owes plus what the pool credited it, or what is written
 * off on it. 0 for a seat that carries nothing (the server's NOTHING_OWED).
 */
export function seatRoom(seat: SeatMoneyOf): number {
  if (!seat.carrying || !seat.money) return 0;
  return Math.max(0, (seat.money.share_iqd ?? 0) - (seat.money.paid_desk_iqd ?? 0));
}

/**
 * What a seat still owes the desk: its owed amount, or a share a manager
 * wrote off (a payment clears it, MD-11). Money's figures, never more than
 * the seat's room.
 */
export function seatDue(seat: SeatMoneyOf): number {
  const owed = seat.money?.owed_iqd ?? 0;
  const take = seat.money?.take_iqd ?? 0;
  return Math.min(seatRoom(seat), Math.max(0, owed, take));
}

/** What the pool credited a seat (MD-9), within the room left after what it owes. */
function seatCredit(seat: SeatMoneyOf): number {
  return Math.min(seatRoom(seat) - seatDue(seat), Math.max(0, seat.money?.credit_iqd ?? 0));
}

/** The seats a payment can go on, in seat order: every carrier with room left in its share. */
export function assignSeats(seats: readonly MatchSeat[]): MatchSeat[] {
  return seats.filter((s) => seatRoom(s) > 0).sort((a, b) => a.seat_no - b.seat_no || a.seat_id.localeCompare(b.seat_id));
}

/** How a seat stands, for its line in the dialog. Each figure is the server's (0 when absent). */
export interface SeatStanding {
  /** Owes the desk: `take_iqd` (owed, or a manual write-off). */
  owes: number;
  /** What the credit pool covered. */
  covered: number;
  /** Written off by the rules: a no-show, a late leave after the start. */
  writtenOff: number;
  /** Not due yet: a late leave before the start. */
  open: number;
}

export function seatStanding(seat: SeatMoneyOf): SeatStanding {
  const m = seat.money;
  return {
    owes: seatDue(seat),
    covered: Math.max(0, m?.credit_iqd ?? 0),
    // A manual write-off is what Take share collects: it is in `owes`.
    writtenOff: m?.write_off === 'manual' ? 0 : Math.max(0, m?.written_off_iqd ?? 0),
    open: Math.max(0, m?.open_iqd ?? 0),
  };
}

/** The payments still carrying money nobody was named for, oldest first. */
export function assignablePayments(unassigned: readonly UnassignedPayment[]): UnassignedPayment[] {
  return unassigned
    .filter((p) => (p.unassigned_iqd ?? 0) > 0)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.payment_id.localeCompare(b.payment_id));
}

/**
 * The money the Players footer offers to assign: the rows of
 * `money.unassigned[]` with money left, a live bill's included. Not the
 * booking's `unassigned_iqd` (U, money.md §6.2): U counts settled bills only,
 * so money taken on a bill still open would never show.
 */
export function assignableTotal(unassigned: readonly UnassignedPayment[]): number {
  return assignablePayments(unassigned).reduce((sum, p) => sum + (p.unassigned_iqd ?? 0), 0);
}

/**
 * The payment on a booking's live bill: app.match_seat_settle refuses
 * BOOKING_TAB_OPEN with that tab's id as its detail, and the Players panel
 * opens Assign on the money in it.
 */
export function paymentOnTab(unassigned: readonly UnassignedPayment[], tabId: string | null | undefined): UnassignedPayment | null {
  if (!tabId) return null;
  return assignablePayments(unassigned).find((p) => p.tab_id === tabId) ?? null;
}

/**
 * "Keep on the booking" (C22): only a payment on a LIVE court-only bill, which
 * app.match_link_payment closes at what was paid when sent no allocations.
 */
export function canKeepOnBooking(payment: Pick<UnassignedPayment, 'tab_live'>): boolean {
  return payment.tab_live;
}

/** payment id → seat id → the amount typed for that seat. */
export type AssignDraft = Record<string, Record<string, number>>;

/**
 * The starting amounts: each payment (oldest first) goes first to the seats
 * that still owe, in seat order, each up to what it owes; then to the seats
 * the pool credited, each up to that credit (the pool spread this very money:
 * Save makes it exact). A payment goes no further than what it has left, and
 * a written-off share is never pre-filled (the desk types it). The desk
 * corrects the draft; the server re-checks every figure.
 */
export function prefillAssign(payments: readonly UnassignedPayment[], seats: readonly MatchSeat[]): AssignDraft {
  const list = assignSeats(seats);
  const room = new Map(list.map((s) => [s.seat_id, seatRoom(s)]));
  const due = new Map(list.map((s) => [s.seat_id, seatDue(s)]));
  const credit = new Map(list.map((s) => [s.seat_id, seatCredit(s)]));
  const draft: AssignDraft = {};
  for (const p of assignablePayments(payments)) {
    let left = p.unassigned_iqd ?? 0;
    const row: Record<string, number> = {};
    for (const pass of [due, credit]) {
      for (const s of list) {
        const take = Math.min(left, pass.get(s.seat_id) ?? 0, room.get(s.seat_id) ?? 0);
        if (take > 0) {
          row[s.seat_id] = (row[s.seat_id] ?? 0) + take;
          pass.set(s.seat_id, (pass.get(s.seat_id) ?? 0) - take);
          room.set(s.seat_id, (room.get(s.seat_id) ?? 0) - take);
          left -= take;
        }
      }
    }
    draft[p.payment_id] = row;
  }
  return draft;
}

function amountOf(draft: AssignDraft, paymentId: string, seatId: string): number {
  const v = draft[paymentId]?.[seatId] ?? 0;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export interface AssignCheck {
  /** Payments whose amounts add up to more than they have left. */
  overPayment: Set<string>;
  /** Seats given more, across every payment, than their share has room for. */
  overSeat: Set<string>;
  /** Nothing typed anywhere: Save has nothing to send. */
  empty: boolean;
}

/** The two caps the server holds, checked before Save (the per-seat one across every payment in the dialog). */
export function checkAssign(draft: AssignDraft, payments: readonly UnassignedPayment[], seats: readonly MatchSeat[]): AssignCheck {
  const list = assignSeats(seats);
  const overPayment = new Set<string>();
  const perSeat = new Map<string, number>();
  let total = 0;
  for (const p of assignablePayments(payments)) {
    let sum = 0;
    for (const s of list) {
      const a = amountOf(draft, p.payment_id, s.seat_id);
      sum += a;
      perSeat.set(s.seat_id, (perSeat.get(s.seat_id) ?? 0) + a);
    }
    if (sum > (p.unassigned_iqd ?? 0)) overPayment.add(p.payment_id);
    total += sum;
  }
  const overSeat = new Set(list.filter((s) => (perSeat.get(s.seat_id) ?? 0) > seatRoom(s)).map((s) => s.seat_id));
  return { overPayment, overSeat, empty: total === 0 };
}

/**
 * One payment's `p_allocations`: `[{seat_id, amount_iqd}]` in seat order,
 * whole dinars, every amount at least 1. Empty when nothing was typed for it
 * (that payment is not sent; "Keep on the booking" sends `[]` on purpose).
 */
export function allocationsOf(
  draft: AssignDraft,
  paymentId: string,
  seats: readonly MatchSeat[],
): { seat_id: string; amount_iqd: number }[] {
  return assignSeats(seats).flatMap((s) => {
    const amount = amountOf(draft, paymentId, s.seat_id);
    return amount > 0 ? [{ seat_id: s.seat_id, amount_iqd: amount }] : [];
  });
}

/** A typed amount as whole dinars: digits only, empty is 0 (the till's amount boxes). */
export function parseAmount(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  return digits === '' ? 0 : Number(digits);
}
