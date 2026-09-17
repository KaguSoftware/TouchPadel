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
  | 'notCharged' // court fee owed, no bill yet
  | 'paid' // court fee fully paid
  | 'noFee' // a live booking with no court price
  | 'ended'; // cancelled / no-show / expired, nothing open, nothing owed back

export function panelStateOf(bill: BookingBill): PanelState {
  if (bill.court_refund_due_iqd > 0 || (bill.live_tab?.over_paid_iqd ?? 0) > 0) return 'refundDue';
  if (bill.live_tab) return bill.live_tab.due_iqd > 0 ? 'billOpen' : 'closeBill';
  if (!bill.live) return 'ended';
  if (bill.court_remaining_iqd > 0) return bill.court_paid_iqd > 0 ? 'owedAgain' : 'notCharged';
  if (bill.court_paid_iqd > 0) return 'paid';
  return 'noFee';
}

/** Whether Cash / Card can be offered in this state (the day must also be open). */
export function canTakePayment(state: PanelState): boolean {
  return state === 'billOpen' || state === 'owedAgain' || state === 'notCharged';
}

/** Whether a cafe bill can be pulled onto this booking now. */
export function canAddCafeBill(bill: BookingBill): boolean {
  return bill.live && bill.day_open && panelStateOf(bill) !== 'refundDue';
}

/**
 * Closing a bill that owes nothing: an empty one is removed (app.cancel_tab),
 * one that ever held anything is closed at zero (app.settle_zero_tab). The
 * reason is the booking's own state — the desk is not asked for what the
 * system already knows.
 */
export function closeBillPlan(bill: BookingBill): { rpc: 'cancel_tab' | 'settle_zero_tab'; reason: string } | null {
  const tab = bill.live_tab;
  if (!tab || tab.due_iqd > 0 || tab.over_paid_iqd > 0) return null;
  const everUsed = tab.has_orders || tab.has_payments || tab.has_adjustments;
  const status = bill.reservation.status;
  const reason = status === 'cancelled' || status === 'no_show' || status === 'expired' ? `booking_${status}` : 'nothing_owed';
  return { rpc: everUsed ? 'settle_zero_tab' : 'cancel_tab', reason };
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
