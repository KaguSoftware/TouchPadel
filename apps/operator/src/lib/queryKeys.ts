/**
 * Query-key registry — every shared key in one place, so a collision is visible.
 *
 * A key is SHARED when more than one module spells it: two screens reading the
 * same rows, or a screen reading and the durable write path (queueResults.ts)
 * invalidating. The families the queue fans out to were registered on
 * 2026-09-20; until then queueResults spelled them as literals next to the
 * screens' own literals, and a rename on either side would have invalidated
 * nothing, with no error anywhere.
 *
 * A family carries `all`, its invalidation ROOT: React Query matches keys by
 * prefix, so invalidating ['tab'] refetches every mounted ['tab', id] without
 * knowing the ids. Feature-private subtrees (stock's SK, the analytics and
 * assistant trees, ['profilesSearch', q]) stay in their own modules, nested
 * under a root registered here when the write path needs to reach them.
 *
 * This file is a LEAF on purpose — type imports only. queries.ts re-exports it
 * next to the fetchers, but queries.ts also pulls refCache → mutate →
 * queueResults, and queueResults reads QK at module scope; a registry that
 * lived inside that loop would be in its temporal dead zone for whichever
 * module the bundler happened to evaluate first.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';

export const QK = {
  /** venue_settings_public, one row: timezone + hours + closed dates. */
  venueSettings: ['venueSettings'] as const satisfies QueryKey,
  /** Active courts, ordered for display. */
  courts: ['courts'] as const satisfies QueryKey,
  /** The open (or closing) day session, or null. */
  day: ['day'] as const satisfies QueryKey,
  /** ACTIVE cafe tables only — the till's table picker. */
  activeCafeTables: ['cafeTables', 'active'] as const satisfies QueryKey,
  /** ALL cafe tables including inactive — the QR admin's editor. */
  allCafeTables: ['cafeTables', 'all'] as const satisfies QueryKey,

  /** venue_settings.tax_inclusive — half of the till's tax context (till/useTaxContext.ts). */
  taxInclusive: ['taxInclusive'] as const satisfies QueryKey,
  /** Every open tab on the floor: the rail and the open-tabs board (till/tillData.ts OPEN_TABS_QUERY). */
  tabs: ['tabs'] as const satisfies QueryKey,
  /** One tab's detail, the six-level join (till/tillData.ts tabDetailQuery). */
  tab: {
    all: ['tab'] as const satisfies QueryKey,
    one: (tabId: string) => ['tab', tabId] as const satisfies QueryKey,
  },
  /** Live kitchen tickets (kds/KdsBoard.tsx). */
  tickets: ['tickets'] as const satisfies QueryKey,
  /** Waiter calls awaiting the floor (till/WaiterCallsPanel.tsx). */
  waiterCalls: ['waiterCalls'] as const satisfies QueryKey,
  /** Reservations on one business date, the desk grid (desk/useTradingNight.ts). */
  reservations: {
    all: ['reservations'] as const satisfies QueryKey,
    day: (date: string) => ['reservations', date] as const satisfies QueryKey,
  },
  /** Per-day booking counts for one month, the calendar's month view (desk/calendar/useMonthCounts.ts). */
  reservationsMonth: {
    all: ['reservationsMonth'] as const satisfies QueryKey,
    month: (monthStart: string) => ['reservationsMonth', monthStart] as const satisfies QueryKey,
  },
  /** One booking's full record (desk/BookingDetail.tsx). */
  reservation: {
    all: ['reservation'] as const satisfies QueryKey,
    one: (reservationId: string) => ['reservation', reservationId] as const satisfies QueryKey,
  },
  /** What one booking owes — app.booking_bill (desk/payment/useBookingBill.ts). */
  bookingBill: {
    all: ['bookingBill'] as const satisfies QueryKey,
    one: (reservationId: string) => ['bookingBill', reservationId] as const satisfies QueryKey,
  },
  /** Paid / unpaid state per booking for the board — app.booking_bill_states, ids sorted (useBookingBill.ts). */
  bookingBillStates: {
    all: ['bookingBillStates'] as const satisfies QueryKey,
    of: (sortedIds: readonly string[]) => ['bookingBillStates', sortedIds] as const satisfies QueryKey,
  },
  /** Root of the stock tree; the keys themselves are feature-private in stock/stockKeys.ts (SK). */
  stock: {
    all: ['stock'] as const satisfies QueryKey,
  },
} as const;

/**
 * The two reservation lists the desk keeps warm: the day grid and the month
 * counts. Every reservation write must refresh both, and nine call sites spell
 * the pair out by hand — one forgotten second line and the month view keeps
 * yesterday's counts. One list, one helper; the write path uses the list.
 */
export const RESERVATION_LIST_KEYS = [QK.reservations.all, QK.reservationsMonth.all] as const;

export function invalidateReservations(queryClient: QueryClient): void {
  for (const queryKey of RESERVATION_LIST_KEYS) void queryClient.invalidateQueries({ queryKey });
}
