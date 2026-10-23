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
  /** Today's business date by the server's clock (`businessDate`), whether or not a day is open. */
  today: string | null;
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
    today: str(r.businessDate),
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
  out: '/stock?filter=out',
  low: '/stock?filter=low',
  belowPar: '/stock?filter=belowPar',
  expiringSoon: '/stock/expiry',
  expired: '/stock/expiry',
  alerts: '/stock/alerts',
  lastCount: '/stock/counts',
} as const;

// ---------------------------------------------------------------------------
// Needs you: the one to-do list
// ---------------------------------------------------------------------------

/**
 * Every row "Needs you" can hold, in the order it shows them. The page has
 * ONE to-do list (the 2026-10-16 rebuild): the floor's alarms, the work that
 * waits on this person, and the three queues that used to be panels of their
 * own (online refunds, lesson money, player reports), which a manager read as
 * a second, third and fourth to-do list in three different designs.
 *
 * Order is by who is waiting, never by count, so 597 late tickets cannot push
 * a guest owed money below them:
 *
 *   1. a guest in the building: a table calling, an order running late;
 *   2. a guest owed money: online refunds, lesson money paid at the desk;
 *   3. a complaint about a player;
 *   4. the shelves: expired stock (nobody may use it), then running low;
 *   5. the paperwork: goods to book in, a till counted short or over, protocol
 *      steps, pay deductions (the owner's), incident reports, posts (the owner's).
 *
 * How a row is acted on:
 *   - `open`: one button to the screen that shows exactly those items;
 *   - `review`: the queue opens in place, under its row, with every action it
 *     had as a panel (Try again, Refund, Settled another way, Close report,
 *     Ban, the lesson Refund, Record the handback);
 *   - `none`: nothing on this workspace fixes it. Late orders are the kitchen's
 *     to cook, so the row says "Tell the kitchen" where a button would be.
 *
 * The day not being open is NOT a row: it is the banner above the list,
 * because it stops the whole till and is the page's one primary action.
 * No-shows are not a row either: a no-show has already happened, and it is a
 * fact about the day ("So far today").
 */
export type NeedKey =
  | 'waiterCalls'
  | 'ticketsLate'
  | 'deposits'
  | 'lessonRefunds'
  | 'matchReports'
  | 'expired'
  | 'low'
  | 'purchases'
  | 'tillShifts'
  | 'protocols'
  | 'deductions'
  | 'incidents'
  | 'content'
  | 'plan';

export type NeedSeverity = 'danger' | 'warn';

export type NeedAction = { kind: 'open'; href: string } | { kind: 'review' } | { kind: 'none' };

export interface NeedDef {
  key: NeedKey;
  severity: NeedSeverity;
  action: NeedAction;
}

export const NEEDS: readonly NeedDef[] = [
  { key: 'waiterCalls', severity: 'warn', action: { kind: 'open', href: '/till/tabs' } },
  { key: 'ticketsLate', severity: 'danger', action: { kind: 'none' } },
  // Danger while a refund failed or a paid booking is off; a refund Qi is
  // still answering is only a warn (nothing to press, see needCounts).
  { key: 'deposits', severity: 'danger', action: { kind: 'review' } },
  { key: 'lessonRefunds', severity: 'warn', action: { kind: 'review' } },
  { key: 'matchReports', severity: 'warn', action: { kind: 'review' } },
  { key: 'expired', severity: 'danger', action: { kind: 'open', href: STOCK_HREF.expired } },
  { key: 'low', severity: 'warn', action: { kind: 'open', href: STOCK_HREF.low } },
  // The driver's purchases still to be received as stock (app.purchases_to_receive, Goods in's read).
  { key: 'purchases', severity: 'warn', action: { kind: 'open', href: '/stock/receive' } },
  // Wave 5 (wave5-addendum-2026-09-25 §5.2, §8 Q27): the day's closed till
  // shifts whose count differs from the expected (app.till_shift_list).
  { key: 'tillShifts', severity: 'warn', action: { kind: 'open', href: '/admin/day-close' } },
  // Steps to decide and to do (app.protocols_waiting_count, the rail badge's read).
  { key: 'protocols', severity: 'warn', action: { kind: 'open', href: '/protocols?filter=waiting' } },
  // Wave 5 people records: each is counted only for a role its read admits.
  { key: 'deductions', severity: 'warn', action: { kind: 'open', href: '/deductions' } },
  { key: 'incidents', severity: 'warn', action: { kind: 'open', href: '/incidents' } },
  { key: 'content', severity: 'warn', action: { kind: 'open', href: '/marketing' } },
  // Marketing's month plans waiting on the owner (0362); /plan opens the oldest.
  { key: 'plan', severity: 'warn', action: { kind: 'open', href: '/plan' } },
];

/** A count per row; a read that has not answered, or that the role never makes, is absent and counts none. */
export type NeedCounts = Partial<Record<NeedKey, number>>;

export interface Need extends NeedDef {
  count: number;
}

/**
 * The rows that stand, in table order, zeros dropped. `severity` overrides a
 * row's tone where its own read knows better (an online refund that is only
 * slow is a warn, not a danger).
 */
export function needsFor(counts: NeedCounts, severity: Partial<Record<NeedKey, NeedSeverity>> = {}): Need[] {
  return NEEDS.flatMap((d) => {
    const count = counts[d.key] ?? 0;
    return count > 0 ? [{ ...d, severity: severity[d.key] ?? d.severity, count }] : [];
  });
}

/** The rows `ops_overview` itself answers. */
export function overviewNeedCounts(o: OpsOverview): NeedCounts {
  return {
    waiterCalls: o.cafe.waiterCallsOpen,
    ticketsLate: o.cafe.ticketsLate,
    expired: o.stock.expired,
    low: o.stock.low,
  };
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
