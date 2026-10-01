/**
 * The customer record's open-match block, pure (docs/design/open-matches/
 * operator.md §5.15): the ticket wallet's rows, a purchase's refund state and
 * cash-out state (R13), a cash-out refusal read from its detail, and the
 * record's "plays as", ban and match-list readings.
 *
 * The server is the wall and the only source of figures: `guest_tickets`
 * sends the counts, whether a purchase may be cashed out, how many tickets and
 * how much (money.md §5.7, `ticket_cashout_block`). Nothing here counts
 * tickets or prices a refund; it only decides which sentence and which button
 * a reading gets.
 */
import type { MessageKey } from '@touch/i18n';
import { AppRpcError } from '../../../lib/appRpc';
import { matchErrorKey, ticketInUseDetail, type Tr } from '../../matches/matchLogic';
import type { GuestTickets, TicketCashout, TicketPurchase } from '../../matches/matchPayloads';
import type { CustomerFlag, CustomerGender, CustomerGenderSource, CustomerMatchRow, CustomerRecord } from '../deskTypes';

// ---------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------

/** The wallet's rows in the order a desk reads them: what can be used, what is tied up, what is gone. */
export const WALLET_ROWS = [
  { id: 'available', key: 'ws.matches.customers.tickets.available' },
  { id: 'reserved', key: 'ws.matches.customers.tickets.reserved' },
  { id: 'in_use', key: 'ws.matches.customers.tickets.inUse' },
  { id: 'forfeited', key: 'ws.matches.customers.tickets.forfeited' },
  { id: 'cashed_out', key: 'ws.matches.customers.tickets.cashedOut' },
] as const satisfies readonly { id: keyof GuestTickets; key: MessageKey }[];

export type WalletRowId = (typeof WALLET_ROWS)[number]['id'];

/** Label-and-figure rows; a count the server did not send stays null (printed "—", never 0). */
export function walletRows(t: Pick<GuestTickets, WalletRowId>): { id: WalletRowId; key: MessageKey; count: number | null }[] {
  return WALLET_ROWS.map((r) => ({ id: r.id, key: r.key, count: t[r.id] }));
}

// ---------------------------------------------------------------------------
// A purchase
// ---------------------------------------------------------------------------

export type PurchaseRefundState = { kind: 'requested' } | { kind: 'failed' } | { kind: 'refunded'; at: string | null } | null;

/**
 * Where a purchase's refund stands, from its booking_payments status: asked
 * of Qi, failed (a manager deals with it under Online refunds on Ops), or done.
 * null for a purchase with no refund.
 */
export function purchaseRefundState(p: Pick<TicketPurchase, 'status' | 'refunded_at'>): PurchaseRefundState {
  if (p.status === 'refund_pending') return { kind: 'requested' };
  if (p.status === 'refund_failed') return { kind: 'failed' };
  if (p.status === 'refunded') return { kind: 'refunded', at: p.refunded_at };
  return null;
}

/** The three reasons a cash-out waits (R13); the rest (`none_unused`, `not_succeeded`, `done`) offer no button. */
export const CASHOUT_WAIT_REASONS = ['in_use', 'reserved', 'restorable'] as const;
export type CashoutWaitReason = (typeof CASHOUT_WAIT_REASONS)[number];

function isWaitReason(r: string | null | undefined): r is CashoutWaitReason {
  return (CASHOUT_WAIT_REASONS as readonly string[]).includes(r ?? '');
}

/** A sentence key and, when it says "until {time}", the instant. */
export interface KeyedLine {
  key: MessageKey;
  timeAt?: string;
}

/**
 * Why a cash-out waits, in words. `in_use` and `reserved` name the time the
 * server gave; with none (a blocker that waits for the day close), the plain
 * "still in use" line. `restorable` names no time: it waits for the day close.
 */
export function cashoutWaitLine(reason: CashoutWaitReason, untilAt: string | null | undefined): KeyedLine {
  if (reason === 'restorable') return { key: 'ws.matches.errors.ticketInUse.restorable' };
  if (!untilAt) return { key: 'ws.matches.customers.cashout.waiting' };
  return { key: reason === 'in_use' ? 'ws.matches.errors.ticketInUse.in_use' : 'ws.matches.errors.ticketInUse.reserved', timeAt: untilAt };
}

export type CashoutState =
  /** The button: "Cash out {tickets} · {amount}", both the server's. */
  | { kind: 'allowed'; tickets: number | null; amount: number | null }
  /** The button disabled, with the sentence that says until when. */
  | { kind: 'waiting'; reason: CashoutWaitReason; tickets: number | null; amount: number | null; line: KeyedLine }
  /** No button: nothing unused, not paid, or already cashed out; the refund state line says the rest. */
  | { kind: 'none' };

/** A purchase's cash-out (money.md §5.7 `cashout`), read, never computed. */
export function cashoutStateOf(c: TicketCashout | null | undefined): CashoutState {
  if (!c) return { kind: 'none' };
  if (c.allowed) return { kind: 'allowed', tickets: c.tickets, amount: c.amount_iqd };
  if (isWaitReason(c.reason)) return { kind: 'waiting', reason: c.reason, tickets: c.tickets, amount: c.amount_iqd, line: cashoutWaitLine(c.reason, c.until_at) };
  return { kind: 'none' };
}

/**
 * A refused cash-out in words. TICKET_IN_USE carries Money's JSON detail
 * `{reason, count, until_at}` (a join committed since the panel was read):
 * the same three sentences as the waiting button. Anything else is the
 * code's own line through matchErrorKey.
 */
export function cashoutRefusal(error: unknown): KeyedLine {
  if (error instanceof AppRpcError && error.code === 'TICKET_IN_USE') {
    const d = ticketInUseDetail(error.details);
    if (d && isWaitReason(d.reason)) return cashoutWaitLine(d.reason, d.untilAt);
  }
  return matchErrorKey(error);
}

/** A refusal after which the panel's reading is out of date: read the purchases again. */
export function cashoutRefusalRefetches(error: unknown): boolean {
  return error instanceof AppRpcError && ['TICKET_IN_USE', 'NO_UNUSED_TICKETS', 'PAYMENT_STATE', 'PAYMENT_NOT_FOUND'].includes(error.code);
}

// ---------------------------------------------------------------------------
// The record: plays as, the ban, the match list
// ---------------------------------------------------------------------------

export interface PlaysAs {
  /** false on a server before 0262 (no `gender` key): the record shows no match block. */
  known: boolean;
  gender: CustomerGender | null;
  source: CustomerGenderSource | null;
}

export function playsAsOf(customer: Pick<CustomerRecord['customer'], 'gender' | 'gender_set_by'>): PlaysAs {
  const gender = customer.gender === 'female' || customer.gender === 'male' ? customer.gender : null;
  const source = gender && (customer.gender_set_by === 'guest' || customer.gender_set_by === 'staff') ? customer.gender_set_by : null;
  return { known: customer.gender !== undefined, gender, source };
}

/** "Woman · set by the guest", "Man · set at the desk", or "Not set". */
export function playsAsLine(p: PlaysAs, tr: Tr): string {
  if (!p.gender) return tr('ws.matches.customers.playsAs.notSet');
  const gender = tr(p.gender === 'female' ? 'ws.matches.customers.playsAs.female' : 'ws.matches.customers.playsAs.male');
  if (!p.source) return gender;
  return tr('ws.matches.customers.playsAs.value', { gender, source: tr(`ws.matches.customers.playsAs.${p.source}`) });
}

/** Banned from open matches: the `match_ban` flag only set_match_ban writes (R35). */
export function isMatchBanned(flags: readonly Pick<CustomerFlag, 'type'>[]): boolean {
  return flags.some((f) => f.type === 'match_ban');
}

/** The flags the desk's flag editor owns (it never lists or sends `match_ban`). */
export function editableFlags<T extends Pick<CustomerFlag, 'type'>>(flags: readonly T[]): T[] {
  return flags.filter((f) => f.type !== 'match_ban');
}

const LIVE_MATCH = new Set(['filling', 'awaiting_court', 'booked']);

/**
 * The record's matches split in two: coming up (a live match that has not
 * ended), soonest first; and recent (everything else), newest first.
 */
export function recordMatches(rows: readonly CustomerMatchRow[] | null | undefined, nowMs: number): { upcoming: CustomerMatchRow[]; recent: CustomerMatchRow[] } {
  const upcoming: CustomerMatchRow[] = [];
  const recent: CustomerMatchRow[] = [];
  for (const r of rows ?? []) {
    const end = Date.parse(r.end_at ?? r.start_at);
    if (LIVE_MATCH.has(r.status) && Number.isFinite(end) && end > nowMs) upcoming.push(r);
    else recent.push(r);
  }
  upcoming.sort((a, b) => a.start_at.localeCompare(b.start_at) || a.match_id.localeCompare(b.match_id));
  recent.sort((a, b) => b.start_at.localeCompare(a.start_at) || a.match_id.localeCompare(b.match_id));
  return { upcoming, recent };
}

/**
 * A row this station can open (`/desk/matches/$id` shows only this branch's
 * matches), or one to label with its branch. With no branch known (tests, a
 * boot still loading) every row counts as here.
 */
export function isHereMatch(row: Pick<CustomerMatchRow, 'venue_id'>, branchId: string | null): boolean {
  return !branchId || !row.venue_id || row.venue_id === branchId;
}

const SEAT_STATUSES = ['in', 'attended', 'no_show', 'left', 'left_late', 'removed', 'cancelled', 'refilled'] as const;

/** Their seat's status in words, or null for one this build does not know (printed as sent). */
export function seatStatusKey(status: string | null | undefined): MessageKey | null {
  return status && (SEAT_STATUSES as readonly string[]).includes(status)
    ? (`ws.matches.customers.matches.seatStatus.${status as (typeof SEAT_STATUSES)[number]}` as const)
    : null;
}

/** "friend seat" / "desk seat" beside the status; an account seat is the default and says nothing. */
export function seatKindKey(kind: string | null | undefined): MessageKey | null {
  if (kind === 'friend') return 'ws.matches.customers.matches.kind.friend';
  if (kind === 'desk') return 'ws.matches.customers.matches.kind.desk';
  return null;
}
