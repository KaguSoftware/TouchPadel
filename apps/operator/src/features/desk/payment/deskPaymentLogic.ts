/**
 * Pure helpers for taking court payment at the desk (0106).
 *
 * Nothing here computes money. Every figure comes from app.booking_bill /
 * app.booking_bill_states; these functions only decide which of a handful of
 * situations the desk is in, so the screen can say it in one sentence and
 * offer the one action that fits.
 */
import type { ReservationRow } from '../deskTypes';

/** app.booking_bill — the bill for one booking. */
export interface BookingBill {
  reservation: {
    id: string;
    kind: string;
    status: string;
    price_iqd: number | null;
    guest_name: string | null;
    start_at: string;
    end_at: string;
    court_id: string;
    court_name_en: string | null;
    court_name_ar: string | null;
  };
  /** Booking is confirmed / arrived / completed. */
  live: boolean;
  day_open: boolean;
  live_tab: LiveTab | null;
  court_paid_iqd: number;
  court_remaining_iqd: number;
  court_refund_due_iqd: number;
  settled_tabs: SettledTab[];
  /**
   * Online deposits (build-contracts-2026-09-27 §2.3): succeeded deposits net
   * of refunds. `court_paid_iqd` already includes them for a live booking, so
   * `court_remaining_iqd` and the open bill's court line are the rest. Optional
   * so a server without migration 0242 still reads as "none".
   */
  online_paid_iqd?: number;
  online_payments?: OnlinePayment[];
  /**
   * Open matches (0262, open-matches money.md §6.7): the part of the court fee
   * written off with players' shares (a no-show, a walk-out), already netted
   * out of `court_remaining_iqd`. Optional, like the online keys: a server
   * before 0262 reads as none.
   */
  court_written_off_iqd?: number;
  /** A match booking's money (null for every other booking). */
  match?: BookingBillMatch | null;
  /** A match booking's seats; empty for every other booking. */
  seats?: BookingBillSeat[];
}

/**
 * app.booking_bill.match: the match_money top level (money.md §6.2). Every
 * figure is the server's; the desk only chooses which of them to say.
 */
export interface BookingBillMatch {
  id: string;
  status: string;
  /** `not_live` | `booked` | `started`. */
  phase: string;
  price_iqd: number;
  booking_price_iqd: number;
  /** A move or extend re-priced the booking (DF-4): the difference is booking-level. */
  price_delta_iqd: number;
  unassigned_iqd: number;
  delta_owed_iqd: number;
  /** What the players owe between them. */
  owed_iqd: number;
  written_off_iqd: number;
  open_iqd: number;
  over_iqd: number;
}

/** One seat on a match booking's bill (money.md §6.7). No phones: cashiers read this. */
export interface BookingBillSeat {
  seat_id: string | null;
  seat_no: number;
  kind: string;
  status: string | null;
  carrying: boolean;
  /** Staff-facing name; the holder's for a friend seat; null for a vacant number. */
  label: string | null;
  ticket: string | null;
  write_off_reason: string | null;
  share_iqd: number | null;
  owed_iqd: number | null;
}

/** One online deposit on the booking (app.booking_bill.online_payments). Not a till payment. */
export interface OnlinePayment {
  id: string;
  status: string;
  amount_iqd: number;
  refund_amount_iqd: number | null;
  succeeded_at: string | null;
  refunded_at: string | null;
  /** Qi's sandbox (the app-review account): no real money moved, and not in online_paid_iqd. */
  sandbox: boolean;
  /** Kept for a no-show (deposit_forfeit_no_show). */
  forfeited?: boolean;
}

export interface LiveTab {
  id: string;
  status: 'open' | 'awaiting_payment';
  day_session_id: string;
  subtotal_iqd: number;
  discount_iqd: number;
  tax_iqd: number;
  court_iqd: number;
  total_iqd: number;
  paid_iqd: number;
  due_iqd: number;
  over_paid_iqd: number;
  /** Units still on the bill (two coffees on one line count as two). */
  item_count: number;
  has_orders: boolean;
  has_payments: boolean;
  has_adjustments: boolean;
}

export interface SettledTab {
  tab_id: string;
  settled_at: string;
  court_iqd: number;
  total_iqd: number;
  refunds_iqd: number;
  payments: {
    id: string;
    method: 'cash' | 'card';
    amount_iqd: number;
    tendered_iqd: number | null;
    change_iqd: number | null;
    created_at: string;
    recorded_by_name: string | null;
    /** The seats this payment was assigned to on a match booking (0262); absent otherwise. */
    seats?: { seat_no: number; amount_iqd: number }[];
  }[];
}

/** app.booking_bill_states — one row per booking. */
export type BillState = 'none' | 'open' | 'partly_paid' | 'dead_open' | 'paid' | 'owed' | 'refund_due';

export interface BillStateRow {
  reservation_id: string;
  state: BillState;
  live_tab_id: string | null;
  due_iqd: number;
  court_paid_iqd: number;
  court_remaining_iqd: number;
  court_refund_due_iqd: number;
  /** Open matches (0262): the match on this booking, and its seats' money (money.md §6.7). */
  match_id?: string | null;
  court_written_off_iqd?: number;
  /** Carriers still owing a share. */
  seats_owing?: number;
  seats_paid?: number;
  seats_owed_iqd?: number;
}

/**
 * What the booking screen's bill panel shows. Ordered by what the clerk must
 * do first: money owed back needs a manager before anything else can close.
 */
export type PanelState =
  | 'refundDue' // more was paid than is owed now
  | 'closeBill' // an open bill that owes nothing — close it
  | 'billOpen' // an open bill with money due
  | 'owedAgain' // court was paid, the price went up
  | 'depositRest' // a deposit was paid online; the rest of the court fee is owed
  | 'notCharged' // court fee owed, no bill yet
  | 'paid' // court fee fully paid
  | 'noFee' // a live booking with no court price
  | 'ended'; // cancelled / no-show / expired, nothing open, nothing owed back

export function panelStateOf(bill: BookingBill): PanelState {
  if (bill.court_refund_due_iqd > 0 || (bill.live_tab?.over_paid_iqd ?? 0) > 0) return 'refundDue';
  if (bill.live_tab) return bill.live_tab.due_iqd > 0 ? 'billOpen' : 'closeBill';
  if (!bill.live) return 'ended';
  if (bill.court_remaining_iqd > 0) {
    if (bill.court_paid_iqd <= 0) return 'notCharged';
    // Everything paid so far came in online: the rest is simply owed, the
    // price did not go up. "Owed again" is for money taken at the desk before.
    return paidOnlineOnly(bill) ? 'depositRest' : 'owedAgain';
  }
  if (bill.court_paid_iqd > 0) return 'paid';
  return 'noFee';
}

/** Whether Cash / Card can be offered in this state (the day must also be open). */
export function canTakePayment(state: PanelState): boolean {
  return state === 'billOpen' || state === 'owedAgain' || state === 'depositRest' || state === 'notCharged';
}

/** Whether every IQD paid on the court so far is an online deposit. */
export function paidOnlineOnly(bill: Pick<BookingBill, 'court_paid_iqd' | 'online_paid_iqd'>): boolean {
  const online = bill.online_paid_iqd ?? 0;
  return online > 0 && bill.court_paid_iqd <= online;
}

/**
 * The payments list's word for how a payment was taken. The till only takes
 * cash and card (mutations.ts keeps z.enum(['cash','card']); a deposit is never
 * a till method), so anything else on a bill is the online deposit.
 */
export function paymentMethodKey(method: string): 'cash' | 'card' | 'online' {
  return method === 'cash' || method === 'card' ? method : 'online';
}

/** Online deposits that took money (a failed or expired attempt never did), earliest first. */
export function onlinePaymentsTaken(bill: Pick<BookingBill, 'online_payments'>): OnlinePayment[] {
  return (bill.online_payments ?? [])
    .filter((p) => p.succeeded_at != null)
    .sort((a, b) => (a.succeeded_at ?? '').localeCompare(b.succeeded_at ?? ''));
}

/** What became of an online deposit's refund, for its line in the payments list. */
export type OnlineRefundState = 'none' | 'kept' | 'pending' | 'failed' | 'refunded' | 'refundedPart';

export function onlineRefundState(p: Pick<OnlinePayment, 'status' | 'amount_iqd' | 'refund_amount_iqd' | 'forfeited'>): OnlineRefundState {
  switch (p.status) {
    case 'succeeded':
      return p.forfeited ? 'kept' : 'none';
    case 'refund_pending':
      return 'pending';
    case 'refund_failed':
      return 'failed';
    case 'refunded':
      return p.refund_amount_iqd != null && p.refund_amount_iqd < p.amount_iqd ? 'refundedPart' : 'refunded';
    default:
      return 'none';
  }
}

/**
 * Whether a cafe bill can be pulled onto this booking now. Never onto an open
 * match's booking (DF-16): its players order on their own bills, and the
 * server refuses the lines anyway (MATCH_BOOKING_NO_CAFE, R20).
 */
export function canAddCafeBill(bill: BookingBill): boolean {
  return bill.live && bill.day_open && !isMatchBill(bill) && panelStateOf(bill) !== 'refundDue';
}

/** A match booking's bill: the server says so with `match` (0262). */
export function isMatchBill(bill: Pick<BookingBill, 'match'>): boolean {
  return bill.match != null;
}

// ---------------------------------------------------------------------------
// A match booking's bill (open-matches operator.md §5.14)
// ---------------------------------------------------------------------------

/**
 * The line a match booking's bill adds while its players owe: the shares are
 * taken under Players, and money taken on this bill stays unassigned until the
 * desk assigns it. null when there is no match or nothing is owed.
 */
export function matchBillSentence(bill: Pick<BookingBill, 'match'>): { key: 'ws.matches.bill.playersOwe'; amount: number } | null {
  const owed = bill.match?.owed_iqd ?? 0;
  return owed > 0 ? { key: 'ws.matches.bill.playersOwe', amount: owed } : null;
}

export type MatchBillRowKey = 'ws.matches.bill.writtenOff' | 'ws.matches.bill.priceChanged' | 'ws.matches.bill.unassigned';

/**
 * The receipt rows a match booking adds, each with the server's figure: the
 * court fee written off with players' shares, a price change after booking
 * (DF-4, signed), and money on the booking not yet assigned to players.
 */
export function matchBillRows(bill: Pick<BookingBill, 'match' | 'court_written_off_iqd'>): { key: MatchBillRowKey; amount: number }[] {
  const rows: { key: MatchBillRowKey; amount: number }[] = [];
  const writtenOff = bill.court_written_off_iqd ?? 0;
  if (writtenOff > 0) rows.push({ key: 'ws.matches.bill.writtenOff', amount: writtenOff });
  const m = bill.match;
  if (!m) return rows;
  if (m.price_delta_iqd !== 0) rows.push({ key: 'ws.matches.bill.priceChanged', amount: m.price_delta_iqd });
  if (m.unassigned_iqd > 0) rows.push({ key: 'ws.matches.bill.unassigned', amount: m.unassigned_iqd });
  return rows;
}

/** The seat numbers a payment was assigned to, in order, once each; empty when it has none. */
export function paymentSeatNumbers(payment: Pick<SettledTab['payments'][number], 'seats'>): number[] {
  return [...new Set((payment.seats ?? []).map((s) => s.seat_no))].sort((a, b) => a - b);
}

/**
 * Closing a bill that owes nothing: an empty one is removed (tab.cancel →
 * app.cancel_tab), one that ever held anything is closed at zero
 * (tab.settle_zero → app.settle_zero_tab). Both are queued mutation types since
 * item 9 (0120), so the desk closes a bill offline too. The reason is the
 * booking's own state — the desk is not asked for what the system already knows.
 */
export function closeBillPlan(bill: BookingBill): { mutation: 'tab.cancel' | 'tab.settle_zero'; reason: string } | null {
  const tab = bill.live_tab;
  if (!tab || tab.due_iqd > 0 || tab.over_paid_iqd > 0) return null;
  const everUsed = tab.has_orders || tab.has_payments || tab.has_adjustments;
  const status = bill.reservation.status;
  const reason = status === 'cancelled' || status === 'no_show' || status === 'expired' ? `booking_${status}` : 'nothing_owed';
  return { mutation: everUsed ? 'tab.settle_zero' : 'tab.cancel', reason };
}

/** The board's payment cell: tone, sentence key, and the one figure it quotes. */
export interface ChargeLabel {
  tone: 'success' | 'warn' | 'danger' | 'muted';
  key:
    | 'paid'
    | 'notPaid'
    | 'notPaidYet'
    | 'billOpen'
    | 'partlyPaid'
    | 'closeBill'
    | 'owed'
    | 'refundDue'
    | 'noFee';
  amount?: number;
}

export function chargeLabelOf(row: BillStateRow, ended: boolean): ChargeLabel {
  switch (row.state) {
    case 'paid':
      return { tone: 'success', key: 'paid' };
    case 'open':
      return { tone: 'warn', key: 'billOpen', amount: row.due_iqd };
    case 'partly_paid':
      return { tone: 'warn', key: 'partlyPaid', amount: row.due_iqd };
    case 'dead_open':
      return { tone: 'warn', key: 'closeBill' };
    case 'owed':
      return { tone: 'warn', key: 'owed', amount: row.due_iqd };
    case 'refund_due':
      return { tone: 'danger', key: 'refundDue', amount: row.court_refund_due_iqd };
    case 'none':
    default:
      if (row.due_iqd <= 0) return { tone: 'muted', key: 'noFee' };
      return ended ? { tone: 'warn', key: 'notPaid', amount: row.due_iqd } : { tone: 'muted', key: 'notPaidYet', amount: row.due_iqd };
  }
}

/** A booking the desk still has to settle: something is owed, open, or owed back. */
export function needsSettling(row: BillStateRow | undefined): boolean {
  if (!row) return false;
  if (row.state === 'paid') return false;
  if (row.state === 'none') return row.due_iqd > 0;
  return true;
}

/** Whether a booking's slot is over (or it was marked completed). */
export function hasEnded(r: Pick<ReservationRow, 'end_at' | 'status'>, nowIso: string): boolean {
  return r.end_at <= nowIso || r.status === 'completed';
}

/**
 * Bookings played tonight that still need settling, earliest first. Only
 * bookings that ended — a guest mid-game is not a debt yet.
 */
export function toSettle(
  reservations: readonly ReservationRow[],
  states: ReadonlyMap<string, BillStateRow> | undefined,
  nowIso: string,
): ReservationRow[] {
  if (!states) return [];
  return reservations
    .filter((r) => r.kind === 'booking' && hasEnded(r, nowIso) && needsSettling(states.get(r.id)))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/**
 * The booking that played on the same court right before this one, when it
 * still needs settling — the desk hears about it as the next group walks in,
 * while the last group may still be at the counter.
 */
export function unsettledBefore(
  r: ReservationRow,
  reservations: readonly ReservationRow[],
  states: ReadonlyMap<string, BillStateRow> | undefined,
  nowIso: string,
): ReservationRow | undefined {
  if (!states) return undefined;
  const earlier = reservations
    .filter((x) => x.id !== r.id && x.kind === 'booking' && x.court_id === r.court_id && x.end_at <= r.start_at)
    .sort((a, b) => b.end_at.localeCompare(a.end_at));
  const prev = earlier[0];
  return prev && hasEnded(prev, nowIso) && needsSettling(states.get(prev.id)) ? prev : undefined;
}

/** Index the RPC's array by reservation id. */
export function statesById(rows: readonly BillStateRow[] | undefined): Map<string, BillStateRow> | undefined {
  return rows ? new Map(rows.map((s) => [s.reservation_id, s])) : undefined;
}
