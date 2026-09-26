/**
 * Pure helpers for the manager's Today screen (spec 06.21).
 *
 * `app.ops_overview()` (migration 0068, build plan §4) returns one jsonb
 * document. `normalizeOverview` accepts the contract shape plus the richer
 * fields 0068 actually sends (next arrival's court, cancellations, orders
 * today, open stock alerts, the blocking tabs' table and guest) and fills
 * anything missing with zeros or nulls, so the screen renders "—" instead of
 * guessing. No figure here is computed client-side.
 *
 * One figure is deliberately NOT read from the server: queued writes. 0068
 * never sends `dayClose.queued`, and the queue is station-local anyway (the
 * durable outbox this machine has not synced yet), so the old screen printed
 * "Queued writes: None" whatever was actually waiting. The screen reads the
 * queue the same way the day-close screen does and passes the count in.
 */

export interface OpsCount {
  count: number;
  amountIqd: number | null;
}

export interface OpsBlockingTab {
  id: string;
  tableNumber: string | null;
  label: string | null;
  guestName: string | null;
}

export interface OpsStaffRow {
  staffId: string;
  name: string;
  role: string | null;
  ordersTaken: number;
  bookingsCreated: number;
  paymentsTaken: number | null;
}

export interface OpsOverview {
  bookings: {
    today: number;
    arrived: number;
    upcoming: number;
    noShows: number;
    /** `null` when the server does not report it — never drawn as zero. */
    cancelledToday: number | null;
    /** ISO timestamp of the next arrival, when the server reports one. */
    nextArrivalAt: string | null;
    nextArrivalLabel: string | null;
    nextArrivalCourtEn: string | null;
    nextArrivalCourtAr: string | null;
  };
  cafe: {
    openTabs: number;
    ordersToday: number | null;
    ticketsQueued: number;
    ticketsPreparing: number | null;
    ticketsLate: number;
    waiterCallsOpen: number;
  };
  stock: {
    low: number;
    belowPar: number;
    expiringSoon: number;
    expired: number;
    openAlerts: number | null;
    lastCountAt: string | null;
  };
  staffActivity: OpsStaffRow[];
  exceptions: {
    discounts: OpsCount;
    voids: OpsCount;
    refunds: OpsCount;
    waste: OpsCount | null;
  };
  dayClose: {
    open: boolean;
    businessDate: string | null;
    openedAt: string | null;
    blockingCount: number;
    blockingTabs: OpsBlockingTab[];
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * `{count, amountIqd}` | `{count, amount}` | `{count, costIqd}` | bare number.
 *
 * `costIqd` is not a hypothetical spelling: `ops_overview` builds the waste
 * figure as `{count, costIqd}` while every other exception is `{count,
 * amountIqd}`, so reading only the `amount*` keys silently dropped waste's money
 * and printed its bare count where the other three showed IQD.
 */
export function normalizeCount(v: unknown): OpsCount {
  if (typeof v === 'number') return { count: num(v), amountIqd: null };
  if (isRecord(v)) {
    return {
      count: num(v.count),
      amountIqd: numOrNull(v.amountIqd ?? v.amount_iqd ?? v.amount ?? v.costIqd ?? v.cost_iqd),
    };
  }
  return { count: 0, amountIqd: null };
}

export function normalizeOverview(raw: unknown): OpsOverview {
  const r = isRecord(raw) ? raw : {};
  const bookings = isRecord(r.bookings) ? r.bookings : {};
  const cafe = isRecord(r.cafe) ? r.cafe : {};
  const stock = isRecord(r.stock) ? r.stock : {};
  const exceptions = isRecord(r.exceptions) ? r.exceptions : {};
  const dayClose = isRecord(r.dayClose) ? r.dayClose : {};
  const next = isRecord(bookings.nextArrival) ? bookings.nextArrival : null;

  const staff = Array.isArray(r.staffActivity) ? r.staffActivity : [];
  const staffActivity: OpsStaffRow[] = staff.filter(isRecord).map((s) => ({
    staffId: str(s.staffId) ?? str(s.staff_id) ?? '',
    name: str(s.name) ?? '',
    role: str(s.role),
    ordersTaken: num(s.ordersTaken ?? s.orders_taken),
    bookingsCreated: num(s.bookingsCreated ?? s.bookings_created),
    paymentsTaken: numOrNull(s.paymentsTaken ?? s.payments_taken),
  }));

  const blockingRaw = dayClose.blockingTabs;
  const blockingTabs: OpsBlockingTab[] = Array.isArray(blockingRaw)
    ? blockingRaw
        .map((t): OpsBlockingTab | null => {
          if (typeof t === 'string') return { id: t, tableNumber: null, label: null, guestName: null };
          if (isRecord(t) && typeof t.id === 'string') {
            return {
              id: t.id,
              tableNumber: str(t.tableNumber) ?? str(t.table_number),
              label: str(t.label),
              guestName: str(t.guestName) ?? str(t.guest_name),
            };
          }
          return null;
        })
        .filter((t): t is OpsBlockingTab => t !== null)
    : [];
  const blockingCount = Array.isArray(blockingRaw) ? blockingTabs.length : num(blockingRaw);

  return {
    bookings: {
      today: num(bookings.today),
      arrived: num(bookings.arrived),
      upcoming: num(bookings.upcoming),
      noShows: num(bookings.noShows),
      cancelledToday: numOrNull(bookings.cancelledToday),
      nextArrivalAt: next ? (str(next.startAt) ?? str(next.start_at)) : str(bookings.nextArrivalAt),
      nextArrivalLabel: next ? (str(next.guestName) ?? str(next.guest_name) ?? str(next.label)) : null,
      nextArrivalCourtEn: next ? str(next.courtNameEn) : null,
      nextArrivalCourtAr: next ? str(next.courtNameAr) : null,
    },
    cafe: {
      openTabs: num(cafe.openTabs),
      ordersToday: numOrNull(cafe.ordersToday),
      ticketsQueued: num(cafe.ticketsQueued),
      ticketsPreparing: numOrNull(cafe.ticketsPreparing),
      ticketsLate: num(cafe.ticketsLate),
      waiterCallsOpen: num(cafe.waiterCallsOpen),
    },
    stock: {
      low: num(stock.low),
      belowPar: num(stock.belowPar),
      expiringSoon: num(stock.expiringSoon),
      expired: num(stock.expired),
      openAlerts: numOrNull(stock.openAlerts),
      lastCountAt: str(stock.lastCountAt),
    },
    staffActivity,
    exceptions: {
      discounts: normalizeCount(exceptions.discounts),
      voids: normalizeCount(exceptions.voids),
      refunds: normalizeCount(exceptions.refunds),
      waste: exceptions.waste === undefined ? null : normalizeCount(exceptions.waste),
    },
    dayClose: {
      open: dayClose.open === true,
      businessDate: str(dayClose.businessDate),
      openedAt: str(dayClose.openedAt),
      blockingCount,
      blockingTabs,
    },
  };
}

/** Audit-log search text for each exception figure (the drill target). */
export const EXCEPTION_AUDIT_QUERY = {
  discounts: 'discount.apply',
  voids: 'order_item.void',
  refunds: 'payment.refund',
  waste: 'stock.record_waste',
} as const;

export type ExceptionKey = keyof typeof EXCEPTION_AUDIT_QUERY;

export function auditDrillHref(key: ExceptionKey): string {
  return `/admin/audit?q=${encodeURIComponent(EXCEPTION_AUDIT_QUERY[key])}`;
}

export function tillTabHref(tabId: string): string {
  return `/till?tab=${encodeURIComponent(tabId)}`;
}

/**
 * Where each stock figure opens. Low and below par open On hand already
 * filtered to them (OnHand reads `?filter=`); the two expiry figures open the
 * expiry screen, which is where a batch is written off.
 */
export const STOCK_HREF = {
  low: '/stock?filter=low',
  belowPar: '/stock?filter=belowPar',
  expiringSoon: '/stock/expiry',
  expired: '/stock/expiry',
  alerts: '/stock/alerts',
  lastCount: '/stock/counts',
} as const;

// ---------------------------------------------------------------------------
// What needs the manager now
// ---------------------------------------------------------------------------

/**
 * The things that mean "stop and deal with this", in the order a manager
 * should deal with them, each with the screen that resolves it.
 *
 * Order is by who is waiting: a day that is not open stops the whole till; a
 * guest is standing at a table; an order is late in front of a guest; then
 * the shelves. It is never sorted by count — 390 late tickets must not push
 * one closed day below it.
 *
 * `href: null` means there is nothing in this workspace that fixes it. Late
 * tickets used to open the tab list, which does not show tickets at all; the
 * honest answer is "talk to the kitchen", so the row says that and offers no
 * button that would pretend otherwise.
 *
 * No-shows are NOT here any more. A no-show has already happened and nothing on
 * any screen undoes it; it is a fact about the day, and it lives on the courts
 * card with the rest of those.
 */
export const OPS_ALERTS = [
  { key: 'dayNotOpen', severity: 'danger', href: '/admin/day-close', count: (o: OpsOverview) => (o.dayClose.open ? 0 : 1) },
  { key: 'waiterCalls', severity: 'warn', href: '/till/tabs', count: (o: OpsOverview) => o.cafe.waiterCallsOpen },
  { key: 'ticketsLate', severity: 'danger', href: null, count: (o: OpsOverview) => o.cafe.ticketsLate },
  { key: 'low', severity: 'danger', href: STOCK_HREF.low, count: (o: OpsOverview) => o.stock.low },
  { key: 'expired', severity: 'danger', href: STOCK_HREF.expired, count: (o: OpsOverview) => o.stock.expired },
] as const;

/**
 * Two more rows from their own reads, not from ops_overview
 * (build-contracts-2026-09-23 §5.4): protocol steps waiting on this person
 * (app.protocols_waiting_count, the rail badge's read) and the driver's
 * purchases still to be received as stock (app.purchases_to_receive, Goods
 * in's read). Both wait on the manager rather than on a guest, so they follow
 * the table above.
 */
export const OPS_WORK_ALERTS = [
  { key: 'protocols', severity: 'warn', href: '/protocols?filter=waiting' },
  { key: 'purchases', severity: 'warn', href: '/stock/receive' },
  // Wave 5, people records (wave5-addendum-2026-09-25 §5.2): pay deductions
  // to decide, incident reports to review, and (the owner's) posts to approve.
  // Each is counted only for a role its read admits; the rest count none.
  { key: 'deductions', severity: 'warn', href: '/deductions' },
  { key: 'incidents', severity: 'warn', href: '/incidents' },
  { key: 'content', severity: 'warn', href: '/marketing' },
  // Wave 5, till shifts (wave5-addendum-2026-09-25 §5.2, §8 Q27): the day's
  // closed shifts whose count differs from the expected, any non-zero
  // difference (app.till_shift_list, tillShift shiftsWithDifference).
  { key: 'tillShifts', severity: 'warn', href: '/admin/day-close' },
] as const;

export type OpsWorkKey = (typeof OPS_WORK_ALERTS)[number]['key'];
export type OpsAlertKey = (typeof OPS_ALERTS)[number]['key'] | OpsWorkKey;
export type OpsSeverity = 'danger' | 'warn';

export interface OpsAlert {
  key: OpsAlertKey;
  count: number;
  severity: OpsSeverity;
  href: string | null;
}

/** The standing alarms, in table order. Nothing is sorted by value. */
export function alertsFor(o: OpsOverview): OpsAlert[] {
  return OPS_ALERTS.map((a) => ({ key: a.key, severity: a.severity, href: a.href, count: a.count(o) })).filter((a) => a.count > 0);
}

/** The work rows with their counts; a read that has not answered, or that the role does not make, counts none. */
export function workAlertsFor(counts: Readonly<Partial<Record<OpsWorkKey, number>>>): OpsAlert[] {
  return OPS_WORK_ALERTS.map((a) => ({ key: a.key, severity: a.severity, href: a.href, count: counts[a.key] ?? 0 })).filter((a) => a.count > 0);
}

/**
 * Day close as one word rather than figures the manager has to combine.
 *
 * The four states are exactly the four the day-close screen itself names
 * (`ws.manager.dayClose.state.*`), so this screen and its destination describe
 * the same situation in the same words. Open tabs outrank queued writes because
 * a tab needs somebody on the floor, while a queue usually only needs the
 * network back.
 */
export type DayCloseState = 'closed' | 'blockedByOpenTabs' | 'blockedByUnsyncedQueue' | 'ready';

export function dayCloseState(d: OpsOverview['dayClose'], queued: number): DayCloseState {
  if (!d.open) return 'closed';
  if (d.blockingCount > 0) return 'blockedByOpenTabs';
  if (queued > 0) return 'blockedByUnsyncedQueue';
  return 'ready';
}

export const DAY_CLOSE_TONE: Record<DayCloseState, 'neutral' | 'danger' | 'warn' | 'success'> = {
  closed: 'neutral',
  blockedByOpenTabs: 'danger',
  blockedByUnsyncedQueue: 'warn',
  ready: 'success',
};
