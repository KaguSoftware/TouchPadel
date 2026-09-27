/**
 * The till's floor: the pure half of FloorView.
 *
 * The till opens on a picture of the room. A table with a live tab is green,
 * and tapping it goes to that tab. Tapping a free table opens one there. The
 * courts sit behind their own button, one board per court listing today's
 * bookings, and a booking opens or finds its tab the same way.
 *
 * What it claims, and what it refuses to:
 *
 *  - A table is OPEN when a live tab (open or awaiting payment) names it, or
 *    a tab opened offline does. Several tabs on one table are counted, never
 *    folded into one. A table is PAYING when any of its tabs awaits payment.
 *  - The room is the venue as built, the same nine spots the /panel live floor
 *    draws, taken in table-number order. A tenth table has no spot. It is
 *    listed beside the plan instead of dropped, because a table the till
 *    cannot reach is a sale that cannot be rung up.
 *  - A booking is shown on its court while it has a live tab, or until it
 *    ends. A booking that ended with its tab still open is exactly the one
 *    the cashier is looking for.
 *  - Every live tab is reachable from the floor. A tab that is on no drawn
 *    table and no court board (no table, a retired table, yesterday's
 *    booking, an offline tab without a table) is an "other open tab".
 */
import { compareTableNumbers, type ActiveTableRow } from '../../lib/queries';
import { LOCAL_TAB_PREFIX, type OfflineTab } from '../../lib/offlineTabs';
import { tabHasWebOrder, type TabListRow } from './tillData';

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

/**
 * Where each table stands, in metres: x across the room, z from the kitchen
 * toward the entrance. A copy of TABLE_DEF in features/floor/floorScene.ts,
 * copied rather than imported because that module pulls three.js into
 * whatever imports it. Keep the two in step. floorPlan.test.ts checks the
 * count against the live floor's TABLE_SLOTS.
 */
export const CAFE_SPOTS: readonly { x: number; z: number; seats: 2 | 4 }[] = [
  { x: -2.1, z: 1.2, seats: 4 },
  { x: 2.1, z: 1.2, seats: 4 },
  { x: 0, z: 2.3, seats: 2 },
  { x: -2.1, z: 2.5, seats: 4 },
  { x: 2.1, z: 2.9, seats: 4 },
  { x: 0, z: 3.6, seats: 2 },
  { x: -2.1, z: 3.8, seats: 4 },
  { x: 2.1, z: 4.25, seats: 4 },
  { x: 0, z: 4.8, seats: 2 },
];

/** The part of the room the till draws: side wall to side wall, the kitchen pass to the door. */
export const CAFE_VIEW = { x: -5, z: -3.6, w: 10, d: 9.9 } as const;

/** A spot as a fraction of the drawn room, for placing a button over the drawing. */
export function spotPosition(spot: { x: number; z: number }): { inline: number; block: number } {
  return { inline: (spot.x - CAFE_VIEW.x) / CAFE_VIEW.w, block: (spot.z - CAFE_VIEW.z) / CAFE_VIEW.d };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export type SpotStatus = 'free' | 'open' | 'paying';

/** A live tab as the floor lists it. `id` is a rail id: a uuid, or LOCAL_TAB_PREFIX + key when offline. */
export interface SpotTab {
  id: string;
  status: string;
  /** The name typed when it was opened, if any. */
  label: string | null;
  openedAt: string;
  offline: boolean;
  /** Items on it so far (voids excluded): what tells two tabs on one table apart. */
  items: number;
  /** A guest ordered on it from the table QR. */
  web: boolean;
}

export interface CafeSpot {
  table: ActiveTableRow;
  /** Index into CAFE_SPOTS, or null when the table is beyond the drawn nine. */
  slot: number | null;
  tabs: SpotTab[];
  status: SpotStatus;
  /** A guest's waiter call on this table is waiting for somebody. */
  calling: boolean;
}

export interface WaiterCallLike {
  status: string;
  table: { table_number: string } | null;
}

function statusOf(tabs: readonly SpotTab[]): SpotStatus {
  if (tabs.length === 0) return 'free';
  return tabs.some((t) => t.status === 'awaiting_payment') ? 'paying' : 'open';
}

/** Every active table with its live tabs, in table-number order; the first nine get a spot. */
export function placeCafe(
  tables: readonly ActiveTableRow[],
  tabs: readonly TabListRow[],
  offlineTabs: readonly OfflineTab[],
  calls: readonly WaiterCallLike[] = [],
): CafeSpot[] {
  const byNumber = new Map<string, SpotTab[]>();
  const push = (n: string, t: SpotTab) => byNumber.set(n, [...(byNumber.get(n) ?? []), t]);
  for (const t of tabs) {
    if (!t.table) continue;
    push(t.table.table_number, {
      id: t.id,
      status: t.status,
      label: t.label,
      openedAt: t.opened_at,
      offline: false,
      items: (t.orders ?? []).reduce((n, o) => n + (o.order_items ?? []).filter((i) => !i.voided).length, 0),
      web: tabHasWebOrder(t),
    });
  }
  for (const ot of offlineTabs) {
    if (!ot.tableNumber || ot.settled) continue;
    push(ot.tableNumber, {
      id: `${LOCAL_TAB_PREFIX}${ot.idemKey}`,
      status: 'open',
      label: ot.label,
      openedAt: ot.openedAt,
      offline: true,
      items: ot.lines.reduce((n, l) => n + l.qty, 0),
      web: false,
    });
  }
  const calling = new Set(calls.filter((c) => c.status === 'raised' && c.table).map((c) => c.table!.table_number));
  return tables
    .slice()
    .sort((a, b) => compareTableNumbers(a.table_number, b.table_number))
    .map((table, i) => {
      const onIt = (byNumber.get(table.table_number) ?? []).slice().sort((a, b) => a.openedAt.localeCompare(b.openedAt));
      return {
        table,
        slot: i < CAFE_SPOTS.length ? i : null,
        tabs: onIt,
        status: statusOf(onIt),
        calling: calling.has(table.table_number),
      };
    });
}

// ---------------------------------------------------------------------------
// Courts
// ---------------------------------------------------------------------------

export interface CourtRow {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

export interface CourtBookingRow {
  id: string;
  court_id: string;
  start_at: string;
  end_at: string;
  status: string;
  guest_name: string | null;
  tabs: { id: string; status: string }[] | null;
}

export interface BoardBooking {
  booking: CourtBookingRow;
  /** The booking's one live tab (0106 allows one), or null. */
  liveTab: { id: string; status: string } | null;
  /** Where now falls against the booked window. */
  phase: 'ended' | 'playing' | 'upcoming';
}

export interface CourtBoard {
  court: CourtRow;
  bookings: BoardBooking[];
  /** The booking the court drawing stands for: the one playing, else the first listed. */
  featured: BoardBooking | null;
}

const LIVE = new Set(['open', 'awaiting_payment']);

/** One board per court, in rail order, each listing the bookings the till can still act on. */
export function courtBoards(courts: readonly CourtRow[], bookings: readonly CourtBookingRow[], nowMs: number): CourtBoard[] {
  return courts
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((court) => {
      const list = bookings
        .filter((b) => b.court_id === court.id)
        .map((b): BoardBooking => {
          const start = Date.parse(b.start_at);
          const end = Date.parse(b.end_at);
          return {
            booking: b,
            liveTab: (b.tabs ?? []).find((t) => LIVE.has(t.status)) ?? null,
            phase: nowMs >= end ? 'ended' : nowMs >= start ? 'playing' : 'upcoming',
          };
        })
        .filter((bb) => bb.liveTab !== null || Date.parse(bb.booking.end_at) > nowMs)
        .sort((a, b) => a.booking.start_at.localeCompare(b.booking.start_at));
      return { court, bookings: list, featured: list.find((b) => b.phase === 'playing') ?? list[0] ?? null };
    });
}

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

/**
 * Live tabs the floor does not draw: on no active table and on no court
 * board's booking. Offline tabs without a table are here too.
 */
export function otherOpenTabs(
  tabs: readonly TabListRow[],
  offlineTabs: readonly OfflineTab[],
  spots: readonly CafeSpot[],
  boards: readonly CourtBoard[],
): TabListRow['id'][] {
  const drawn = new Set<string>();
  for (const s of spots) for (const t of s.tabs) drawn.add(t.id);
  for (const b of boards) for (const bb of b.bookings) if (bb.liveTab) drawn.add(bb.liveTab.id);
  return [
    ...tabs.map((t) => t.id),
    ...offlineTabs.filter((ot) => !ot.settled).map((ot) => `${LOCAL_TAB_PREFIX}${ot.idemKey}`),
  ].filter((id) => !drawn.has(id));
}

/** How many live tabs sit on the courts: the number on the Courts button. */
export function courtTabCount(boards: readonly CourtBoard[]): number {
  return boards.reduce((n, b) => n + b.bookings.filter((bb) => bb.liveTab).length, 0);
}
