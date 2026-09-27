/**
 * Till shifts (wave5-addendum-2026-09-25 §2.9, §2.9.9): the pure half.
 *
 * A shift is one person's drawer at one station inside the open day: opened on
 * a counted float, closed by a blind count signed with their own PIN or a
 * manager's. The server stamps every payment and refund with the shift open at
 * its station and sums the money; nothing here adds up money, apart from the
 * one sum the contract names (the start panel prefills what the last shift
 * left plus the cash taken with no shift open since, V18).
 *
 * What this file decides:
 *  - the payment gate (Q30): which stations and people are asked for a shift,
 *    and that the gate FAILS OPEN whenever the status is not known;
 *  - what the rail row shows;
 *  - what the start panel prefills;
 *  - which step the close dialog is on and which PIN signs it;
 *  - the heartbeat identity a shift write beats as (the write form of
 *    app.till_shift_station needs a beat from this session in the last minute);
 *  - the small counts the Setup check and /ops read.
 */
import { varianceMagnitude, varianceSign, type VarianceSign } from '../admin/dayCloseLogic';

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** app.till_shift_status's `shift`: the one open at this station. */
export interface StatusShift {
  id: string;
  staff_id: string;
  staff_name: string;
  is_mine: boolean;
  opened_at: string;
  opening_float_iqd: number;
  payment_count: number;
  refund_count: number;
  drawer_open_count: number;
  /** MGMT only: the key is absent for a cashier or the desk (blind count, Q29). */
  cash_expected_iqd?: number;
}

/** app.till_shift_status(p_device_id). */
export interface ShiftStatus {
  station_id: string;
  day: { id: string; business_date: string; opening_float_iqd: number } | null;
  shift: StatusShift | null;
  last_closed: {
    id: string;
    staff_name: string;
    closed_at: string;
    left_in_drawer_iqd: number;
    outside_cash_since_iqd: number;
  } | null;
  mine_elsewhere: { id: string; station_id: string; opened_at: string } | null;
  queue_depth: number;
}

/** What close_till_shift and close_till_shift_for return on success. */
export interface CloseResult {
  ok: true;
  duplicate?: boolean;
  till_shift_id: string;
  station_id: string;
  staff_id: string;
  staff_name: string;
  opened_at: string;
  closed_at: string;
  closed_via: 'own_pin' | 'manager_pin' | 'day_close';
  authorized_by_name: string | null;
  opening_float_iqd: number;
  cash_payments_iqd: number;
  cash_refunds_iqd: number;
  cash_expected_iqd: number;
  cash_counted_iqd: number;
  cash_variance_iqd: number;
  card_payments_iqd: number;
  card_refunds_iqd: number;
  payment_count: number;
  refund_count: number;
  drawer_open_count: number;
  left_in_drawer_iqd: number;
}

/** A wrong own PIN is RETURNED, never raised (TI13), so its attempt row commits. */
export interface CloseRefused {
  ok: false;
  code: 'PIN_INVALID';
}

/** What open_till_shift returns. */
export interface OpenResult {
  duplicate: boolean;
  till_shift: {
    id: string;
    station_id: string;
    staff_id: string;
    staff_name: string;
    opened_at: string;
    opening_float_iqd: number;
    handover_from: {
      till_shift_id: string;
      staff_name: string;
      closed_at: string;
      left_in_drawer_iqd: number;
      outside_cash_since_iqd: number;
    } | null;
    handover_difference_iqd: number | null;
  };
}

/** One shift of app.till_shift_list (MGMT). An open shift carries its running figures. */
export interface ListShift {
  id: string;
  day_session_id: string;
  business_date: string;
  station_id: string;
  staff_id: string;
  staff_name: string;
  opened_at: string;
  closed_at: string | null;
  closed_via: 'own_pin' | 'manager_pin' | 'day_close' | null;
  closed_by_name: string | null;
  authorized_by_name: string | null;
  opening_float_iqd: number;
  handover_difference_iqd: number | null;
  cash_payments_iqd: number;
  cash_refunds_iqd: number;
  cash_expected_iqd: number;
  cash_counted_iqd: number | null;
  cash_variance_iqd: number | null;
  card_payments_iqd: number;
  card_refunds_iqd: number;
  payment_count: number;
  refund_count: number;
  drawer_open_count: number;
  open_note: string | null;
  close_note: string | null;
}

/** Money taken or paid out with no shift open, per day and station (a null station named no device). */
export interface OutsideRow {
  day_session_id: string;
  business_date: string;
  station_id: string | null;
  cash_payments_iqd: number;
  cash_refunds_iqd: number;
  card_payments_iqd: number;
  card_refunds_iqd: number;
  payment_count: number;
  refund_count: number;
}

/** The difference between a shift's day and close_day's (V10): refunds made on one day for another's payments. */
export interface CrossDayRow {
  day_session_id: string;
  business_date: string;
  earlier_days_cash_refunds_iqd: number;
  earlier_days_card_refunds_iqd: number;
  later_cash_refunds_iqd: number;
  later_card_refunds_iqd: number;
}

export interface ShiftList {
  from: string | null;
  to: string | null;
  shifts: ListShift[];
  outside: OutsideRow[];
  cross_day: CrossDayRow[];
}

// ---------------------------------------------------------------------------
// Defensive readers: a payload that is not the RPC's shape reads as nothing.
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** app.till_shift_status as the screen reads it, or null when it is not that shape. */
export function readShiftStatus(raw: unknown): ShiftStatus | null {
  if (!isObj(raw) || typeof raw.station_id !== 'string') return null;
  const day = isObj(raw.day) ? { id: str(raw.day.id), business_date: str(raw.day.business_date), opening_float_iqd: num(raw.day.opening_float_iqd) } : null;
  const s = raw.shift;
  const shift: StatusShift | null = isObj(s)
    ? {
        id: str(s.id),
        staff_id: str(s.staff_id),
        staff_name: str(s.staff_name),
        is_mine: s.is_mine === true,
        opened_at: str(s.opened_at),
        opening_float_iqd: num(s.opening_float_iqd),
        payment_count: num(s.payment_count),
        refund_count: num(s.refund_count),
        drawer_open_count: num(s.drawer_open_count),
        ...('cash_expected_iqd' in s && s.cash_expected_iqd !== null ? { cash_expected_iqd: num(s.cash_expected_iqd) } : {}),
      }
    : null;
  const l = raw.last_closed;
  const last = isObj(l)
    ? {
        id: str(l.id),
        staff_name: str(l.staff_name),
        closed_at: str(l.closed_at),
        left_in_drawer_iqd: num(l.left_in_drawer_iqd),
        outside_cash_since_iqd: num(l.outside_cash_since_iqd),
      }
    : null;
  const m = raw.mine_elsewhere;
  const mine = isObj(m) ? { id: str(m.id), station_id: str(m.station_id), opened_at: str(m.opened_at) } : null;
  return { station_id: raw.station_id, day, shift, last_closed: last, mine_elsewhere: mine, queue_depth: num(raw.queue_depth) };
}

function readListShift(r: Record<string, unknown>): ListShift {
  const via = r.closed_via;
  return {
    id: str(r.id),
    day_session_id: str(r.day_session_id),
    business_date: str(r.business_date),
    station_id: str(r.station_id),
    staff_id: str(r.staff_id),
    staff_name: str(r.staff_name),
    opened_at: str(r.opened_at),
    closed_at: strOrNull(r.closed_at),
    closed_via: via === 'own_pin' || via === 'manager_pin' || via === 'day_close' ? via : null,
    closed_by_name: strOrNull(r.closed_by_name),
    authorized_by_name: strOrNull(r.authorized_by_name),
    opening_float_iqd: num(r.opening_float_iqd),
    handover_difference_iqd: numOrNull(r.handover_difference_iqd),
    cash_payments_iqd: num(r.cash_payments_iqd),
    cash_refunds_iqd: num(r.cash_refunds_iqd),
    cash_expected_iqd: num(r.cash_expected_iqd),
    cash_counted_iqd: numOrNull(r.cash_counted_iqd),
    cash_variance_iqd: numOrNull(r.cash_variance_iqd),
    card_payments_iqd: num(r.card_payments_iqd),
    card_refunds_iqd: num(r.card_refunds_iqd),
    payment_count: num(r.payment_count),
    refund_count: num(r.refund_count),
    drawer_open_count: num(r.drawer_open_count),
    open_note: strOrNull(r.open_note),
    close_note: strOrNull(r.close_note),
  };
}

/** app.till_shift_list as rows; a malformed payload is an empty list, never a crash. */
export function readShiftList(raw: unknown): ShiftList {
  if (!isObj(raw)) return { from: null, to: null, shifts: [], outside: [], cross_day: [] };
  const rows = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  return {
    from: strOrNull(raw.from),
    to: strOrNull(raw.to),
    shifts: rows(raw.shifts).filter((r) => typeof r.id === 'string').map(readListShift),
    outside: rows(raw.outside).map((o) => ({
      day_session_id: str(o.day_session_id),
      business_date: str(o.business_date),
      station_id: strOrNull(o.station_id),
      cash_payments_iqd: num(o.cash_payments_iqd),
      cash_refunds_iqd: num(o.cash_refunds_iqd),
      card_payments_iqd: num(o.card_payments_iqd),
      card_refunds_iqd: num(o.card_refunds_iqd),
      payment_count: num(o.payment_count),
      refund_count: num(o.refund_count),
    })),
    cross_day: rows(raw.cross_day).map((c) => ({
      day_session_id: str(c.day_session_id),
      business_date: str(c.business_date),
      earlier_days_cash_refunds_iqd: num(c.earlier_days_cash_refunds_iqd),
      earlier_days_card_refunds_iqd: num(c.earlier_days_card_refunds_iqd),
      later_cash_refunds_iqd: num(c.later_cash_refunds_iqd),
      later_card_refunds_iqd: num(c.later_card_refunds_iqd),
    })),
  };
}

// ---------------------------------------------------------------------------
// Who, where
// ---------------------------------------------------------------------------

export type StationMode = 'till' | 'desk' | 'kds';

/**
 * A drawer exists at a till and at the court desk (Q28: the desk counts its own
 * cash box). The kitchen screen has none.
 */
export function stationHasDrawer(mode: StationMode): boolean {
  return mode === 'till' || mode === 'desk';
}

export interface Holder {
  /** SHIFT: the settle_tab list (cashier, court_desk, manager, owner), i.e. permissions.takeCourtPayment. */
  holdsShift: boolean;
  /** CAPABILITY_ROLES.payOnOthersShift (manager, owner): never asked for a shift, may work anyone's drawer. */
  payOnOthersShift: boolean;
}

// ---------------------------------------------------------------------------
// The payment gate (Q30)
// ---------------------------------------------------------------------------

export type GateBanner = { kind: 'othersDrawer'; name: string } | { kind: 'noShift' };

export type ShiftGate =
  /** Take the payment. A manager may carry a banner saying whose drawer it lands in. */
  | { kind: 'ok'; banner: GateBanner | null }
  /** No shift here and this person must hold one: the start panel first. */
  | { kind: 'start' }
  /** Someone else's shift is open here: it is counted and closed (manager PIN), then mine starts. */
  | { kind: 'othersShift'; shiftId: string; name: string; openedAt: string }
  /** My shift is open at another station, so none can open here (TILL_SHIFT_ALREADY_OPEN). */
  | { kind: 'mineElsewhere'; stationId: string }
  /** No business day: nothing to gate; the settle's own NO_OPEN_DAY says why. */
  | { kind: 'noDay' };

export interface GateInput extends Holder {
  mode: StationMode;
  /**
   * The status as last read, or null. Callers pass null whenever the read is
   * not trustworthy RIGHT NOW: still loading, its last attempt failed, or the
   * station is offline. That is what makes the gate fail open (§5.1, §7.5).
   */
  status: ShiftStatus | null;
}

const OK: ShiftGate = { kind: 'ok', banner: null };

export function shiftGate(i: GateInput): ShiftGate {
  if (!i.holdsShift || !stationHasDrawer(i.mode)) return OK;
  // Unknown, loading, errored or offline: fail open. A shift is a record of a
  // drawer, never a reason a guest's money is turned away.
  if (i.status === null) return OK;
  if (i.status.day === null) return { kind: 'noDay' };
  const shift = i.status.shift;
  if (shift) {
    if (shift.is_mine) return OK;
    if (i.payOnOthersShift) return { kind: 'ok', banner: { kind: 'othersDrawer', name: shift.staff_name } };
    return { kind: 'othersShift', shiftId: shift.id, name: shift.staff_name, openedAt: shift.opened_at };
  }
  // Managers and owners are never asked to hold a shift (Q30); what they take
  // here lands outside a shift and reaches the next handover (V18).
  if (i.payOnOthersShift) return { kind: 'ok', banner: { kind: 'noShift' } };
  if (i.status.mine_elsewhere) return { kind: 'mineElsewhere', stationId: i.status.mine_elsewhere.station_id };
  // Sales still waiting to send from here: no shift can open until they land
  // (TILL_SHIFT_UNSYNCED, V13), so asking for one would hold the guest's money
  // on the queue's account. Fail open; this payment lands outside a shift and
  // the next handover counts it (V18). The rail still offers Start, and says why.
  if (i.status.queue_depth > 0) return OK;
  return { kind: 'start' };
}

/** Does the gate stand between the person and the tender? */
export function gateBlocks(g: ShiftGate): g is Extract<ShiftGate, { kind: 'start' | 'othersShift' | 'mineElsewhere' }> {
  return g.kind === 'start' || g.kind === 'othersShift' || g.kind === 'mineElsewhere';
}

// ---------------------------------------------------------------------------
// The rail row
// ---------------------------------------------------------------------------

export type RailShift =
  | { kind: 'mine'; shiftId: string; openedAt: string }
  | { kind: 'others'; shiftId: string; name: string; openedAt: string }
  | { kind: 'start'; blocked: null | 'noDay' | { elsewhere: string } };

/**
 * What the row under the break row says. Null draws nothing: a station with no
 * drawer, a role that holds none, a status not yet known (drawing a guess would
 * lie), or a manager with no shift here (never asked to hold one).
 */
export function railShift(i: GateInput): RailShift | null {
  if (!i.holdsShift || !stationHasDrawer(i.mode) || i.status === null) return null;
  const shift = i.status.shift;
  if (shift) {
    return shift.is_mine
      ? { kind: 'mine', shiftId: shift.id, openedAt: shift.opened_at }
      : { kind: 'others', shiftId: shift.id, name: shift.staff_name, openedAt: shift.opened_at };
  }
  if (i.payOnOthersShift) return null;
  if (i.status.day === null) return { kind: 'start', blocked: 'noDay' };
  if (i.status.mine_elsewhere) return { kind: 'start', blocked: { elsewhere: i.status.mine_elsewhere.station_id } };
  return { kind: 'start', blocked: null };
}

// ---------------------------------------------------------------------------
// The start panel
// ---------------------------------------------------------------------------

export type Handover =
  /** The station's last counted shift of the day left cash, plus or minus cash taken with no shift open since (V18). */
  | { kind: 'handover'; from: string; closedAt: string; leftIqd: number; outsideIqd: number; prefillIqd: number }
  /** The day's first shift at a till: the float the day was opened with. */
  | { kind: 'dayFloat'; prefillIqd: number }
  /** The day's first shift at the desk: the day's float is the till's, so the desk counts its own box. */
  | { kind: 'count' }
  /** No day: nothing can open. */
  | { kind: 'noDay' };

export function handoverPrefill(status: ShiftStatus | null, mode: StationMode): Handover {
  if (!status || status.day === null) return { kind: 'noDay' };
  const last = status.last_closed;
  if (last) {
    return {
      kind: 'handover',
      from: last.staff_name,
      closedAt: last.closed_at,
      leftIqd: last.left_in_drawer_iqd,
      outsideIqd: last.outside_cash_since_iqd,
      // The one sum the contract names (§2.9.4 till_shift_status, V18). A
      // negative total (more paid out than was left) is floored: a float is
      // never below nothing, and INVALID_FLOAT would refuse it.
      prefillIqd: Math.max(0, last.left_in_drawer_iqd + last.outside_cash_since_iqd),
    };
  }
  if (mode === 'desk') return { kind: 'count' };
  return { kind: 'dayFloat', prefillIqd: status.day.opening_float_iqd };
}

/**
 * The last shift here was the viewer's own (they are starting again), so the
 * start panel says "You left …". app.till_shift_status's last_closed names
 * the person and carries no id (0205), so this matches the display name.
 */
export function handoverIsMine(h: Handover, myName: string | null | undefined): boolean {
  return h.kind === 'handover' && !!myName && h.from.trim() === myName.trim();
}

/** Why the start panel cannot open a shift right now, before the server would say so. */
export type StartBlock = null | 'noDay' | 'unsynced' | { elsewhere: string } | { busy: string };

export function startBlock(status: ShiftStatus | null): StartBlock {
  if (!status) return null;
  if (status.day === null) return 'noDay';
  if (status.mine_elsewhere) return { elsewhere: status.mine_elsewhere.station_id };
  if (status.shift && !status.shift.is_mine) return { busy: status.shift.staff_name };
  if (status.queue_depth > 0) return 'unsynced';
  return null;
}

// ---------------------------------------------------------------------------
// The close dialog (Q29: blind, the difference right after)
// ---------------------------------------------------------------------------

export type SignWith = 'own' | 'manager';
export type CloseStep = 'count' | 'sign' | 'done';

export interface CloseInput {
  /** The shift being closed is the signed-in person's. */
  isMine: boolean;
  /** has_own_pin: null until it answers. */
  hasOwnPin: boolean | null;
  /** The count typed so far; null until something is typed (0 is a count). */
  counted: number | null;
  /** The count has been confirmed ("Next"). */
  countConfirmed: boolean;
  /** The person chose the other PIN by hand. */
  chosen: SignWith | null;
  result: CloseResult | null;
}

export interface CloseState {
  step: CloseStep;
  signWith: SignWith;
  /** "Next" on the count step. */
  canConfirmCount: boolean;
  /** The own PIN is on offer at all: only for one's own shift, and not when there is no PIN. */
  ownOffered: boolean;
}

export function closeState(i: CloseInput): CloseState {
  const ownOffered = i.isMine && i.hasOwnPin !== false;
  // Someone else's shift, or mine with no PIN: a manager signs (the 0115 grant).
  const signWith: SignWith = !ownOffered ? 'manager' : (i.chosen ?? 'own');
  if (i.result) return { step: 'done', signWith, canConfirmCount: false, ownOffered };
  if (!i.countConfirmed || i.counted === null) return { step: 'count', signWith, canConfirmCount: i.counted !== null, ownOffered };
  return { step: 'sign', signWith, canConfirmCount: true, ownOffered };
}

/** Which RPC a close goes through. */
export function closeRpc(signWith: SignWith): 'close_till_shift' | 'close_till_shift_for' {
  return signWith === 'own' ? 'close_till_shift' : 'close_till_shift_for';
}

export interface Outcome {
  sign: VarianceSign;
  /** For display beside the sign word; formatting, never arithmetic on money. */
  magnitude: number;
}

/** A stamped variance as "short by", "over by" or "matches". Null for an uncounted shift. */
export function outcomeOf(varianceIqd: number | null | undefined): Outcome | null {
  if (varianceIqd === null || varianceIqd === undefined) return null;
  return { sign: varianceSign(varianceIqd), magnitude: varianceMagnitude(varianceIqd) };
}

/** The upper bound close_till_shift accepts (INVALID_COUNT above it). */
export const MAX_COUNT_IQD = 999_999_999_999;

/** A shift write's key: minted when the dialog opens, reused on retry, replaced after success. */
export function shiftKey(intent: 'till_shift.open' | 'till_shift.close', uuid: string): string {
  return `${intent}:${uuid}`;
}

// ---------------------------------------------------------------------------
// The beat before a write
// ---------------------------------------------------------------------------

/**
 * The identity a shift write beats as, right before it runs. The write form of
 * app.till_shift_station wants a heartbeat from THIS session, for THIS device
 * id, in the last 60 seconds; the device id is the one every till money write
 * carries (lib/idem deviceId), so the stamp trigger finds the shift.
 *
 * In production that is the station's own id, as the regular beat uses. A
 * development build files its regular beat as `DEV-<id>` (lib/heartbeat
 * devSafeIdentity: a dev session must never be a venue's till), so here it
 * beats as the id itself, never as a till, and not at all when the id starts
 * with TILL: such a row would count as a till in app.is_degraded and put the
 * venue into degraded mode the moment the dev session stopped. A dev station
 * named TILL… cannot open a shift (TILL_SHIFT_WRONG_STATION); the Vite
 * default DEV1 can.
 */
export function shiftBeatIdentity(deviceId: string, mode: StationMode, dev: boolean): { deviceId: string; isTill: boolean } | null {
  if (!dev) return { deviceId, isTill: mode === 'till' };
  if (/^TILL/.test(deviceId)) return null;
  return { deviceId, isTill: false };
}

// ---------------------------------------------------------------------------
// Counts for Setup, /ops and Observe
// ---------------------------------------------------------------------------

/**
 * Setup "Worth checking": active people who hold a shift but have no PIN, so
 * they close it with a manager's (§5.2). `holdsShift` and `approvesWithPin`
 * come from the permission map and the staff model, never an inline role list.
 */
export function holdersWithoutPin<T extends { is_active: boolean; has_pin: boolean; role: R }, R>(
  rows: readonly T[],
  holdsShift: (role: R) => boolean,
  approvesWithPin: (role: R) => boolean,
): number {
  return rows.filter((s) => s.is_active && !s.has_pin && holdsShift(s.role) && !approvesWithPin(s.role)).length;
}

/** /ops and Observe: today's closed shifts whose count differs from the expected (Q27: any non-zero). */
export function shiftsWithDifference(list: ShiftList): number {
  return list.shifts.filter((s) => s.closed_at !== null && s.cash_variance_iqd !== null && s.cash_variance_iqd !== 0).length;
}
