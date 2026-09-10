/**
 * Pure helpers for the operations overview (spec 06.21).
 *
 * `app.ops_overview()` (migration 0068, build plan §4) returns one jsonb
 * document. The contract fixes the core keys; a few things the screen wants
 * (next arrival, tickets preparing, role and payments per staff member, a
 * waste exception, the blocking tabs as rows rather than a count) are not in
 * the contract yet. `normalizeOverview` accepts both shapes and fills the gaps
 * with nulls so the screen renders "—" instead of guessing — no figure here is
 * ever computed client-side.
 */

export interface OpsCount {
  count: number;
  amountIqd: number | null;
}

export interface OpsBlockingTab {
  id: string;
  label: string | null;
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
    /** ISO timestamp of the next arrival, when the server reports one. */
    nextArrivalAt: string | null;
    nextArrivalLabel: string | null;
  };
  cafe: {
    openTabs: number;
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
    queued: number;
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
        .map((t) => {
          if (typeof t === 'string') return { id: t, label: null };
          if (isRecord(t) && typeof t.id === 'string') {
            return { id: t.id, label: str(t.label) ?? str(t.table_number) ?? str(t.tableNumber) };
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
      nextArrivalAt: next ? (str(next.startAt) ?? str(next.start_at)) : str(bookings.nextArrivalAt),
      nextArrivalLabel: next
        ? (str(next.guestName) ?? str(next.guest_name) ?? str(next.label))
        : null,
    },
    cafe: {
      openTabs: num(cafe.openTabs),
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
      queued: num(dayClose.queued),
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

// ---------------------------------------------------------------------------
// Grouping (spec 06.21) — which figures lead, and what state the day is in
// ---------------------------------------------------------------------------

/**
 * The figures that mean "walk over there now", in the order a manager acts on
 * them, with the screen each one opens.
 *
 * Only these five are alarms. The rest of the overview is the shape of the day —
 * true, worth reading, but not a reason to leave the office — and a screen that
 * prints `0` in a tile the same size as a real problem four times over is why
 * the old layout could not be skimmed. `alertsFor` drops every zero, so the band
 * this feeds is empty on a good day and says so in one line.
 *
 * `low` is danger rather than warn on purpose: it means the kitchen is about to
 * run out of something mid-service, which is a harder stop than an expiry date
 * three days out. `belowPar` and `expiringSoon` stay off this list entirely —
 * they belong to the stock cluster, where there is room to read them.
 */
export const OPS_ALERTS = [
  {
    key: 'ticketsLate',
    severity: 'danger',
    href: '/till/tabs',
    count: (o: OpsOverview) => o.cafe.ticketsLate,
  },
  {
    key: 'expired',
    severity: 'danger',
    href: '/stock',
    count: (o: OpsOverview) => o.stock.expired,
  },
  { key: 'low', severity: 'danger', href: '/stock', count: (o: OpsOverview) => o.stock.low },
  {
    key: 'noShows',
    severity: 'danger',
    href: '/desk',
    count: (o: OpsOverview) => o.bookings.noShows,
  },
  {
    key: 'waiterCalls',
    severity: 'warn',
    href: '/till/tabs',
    count: (o: OpsOverview) => o.cafe.waiterCallsOpen,
  },
] as const;

export type OpsAlertKey = (typeof OPS_ALERTS)[number]['key'];
export type OpsSeverity = 'danger' | 'warn';

export interface OpsAlert {
  key: OpsAlertKey;
  count: number;
  severity: OpsSeverity;
  href: string;
}

/** The non-zero alarms, worst first. Table order IS the order; nothing is sorted by value. */
export function alertsFor(o: OpsOverview): OpsAlert[] {
  return OPS_ALERTS.map((a) => ({
    key: a.key,
    severity: a.severity,
    href: a.href,
    count: a.count(o),
  })).filter((a) => a.count > 0);
}

/** The loudest severity present, for the band's own ground. */
export function worstSeverity(alerts: readonly OpsAlert[]): OpsSeverity | null {
  if (alerts.length === 0) return null;
  return alerts.some((a) => a.severity === 'danger') ? 'danger' : 'warn';
}

/**
 * Day close as one word rather than four figures the manager has to combine.
 *
 * The four states are exactly the four the day-close screen itself names
 * (`ws.manager.dayClose.state.*`), so the overview and the screen it routes to
 * describe the same situation in the same words instead of inventing a second
 * vocabulary for it. Open tabs outrank a queued write because a tab needs
 * somebody on the floor, while a queue usually only needs the network back.
 */
export type DayCloseState = 'closed' | 'blockedByOpenTabs' | 'blockedByUnsyncedQueue' | 'ready';

export function dayCloseState(d: OpsOverview['dayClose']): DayCloseState {
  if (!d.open) return 'closed';
  if (d.blockingCount > 0) return 'blockedByOpenTabs';
  if (d.queued > 0) return 'blockedByUnsyncedQueue';
  return 'ready';
}

export const DAY_CLOSE_TONE: Record<DayCloseState, 'neutral' | 'danger' | 'warn' | 'success'> = {
  closed: 'neutral',
  blockedByOpenTabs: 'danger',
  blockedByUnsyncedQueue: 'warn',
  ready: 'success',
};

/**
 * The basis the exception bars are drawn against.
 *
 * Money where the server sends money for every figure, counts otherwise. Mixing
 * the two inside one list of bars would put a 15,000 IQD discount and a count of
 * 3 on the same scale, which is not a comparison of anything. `null` means the
 * bars have no basis at all (every figure is zero) and none should be drawn.
 */
export function exceptionBasis(
  figures: readonly OpsCount[],
): { by: 'amount' | 'count'; max: number } | null {
  const by = figures.every((f) => f.amountIqd !== null) ? 'amount' : 'count';
  const max = figures.reduce(
    (m, f) => Math.max(m, (by === 'amount' ? f.amountIqd : f.count) ?? 0),
    0,
  );
  return max > 0 ? { by, max } : null;
}
