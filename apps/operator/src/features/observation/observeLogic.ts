/**
 * The arithmetic behind Management's two observe boards (Courts, Tills).
 *
 * These boards are READINGS, not workstations (owner call, 2026-09-13): they
 * say what is active, what is not, and what the day adds up to. Every write
 * lives one button away in the working workspace. So what is here only sorts
 * rows into "happening / done / did not happen" and sums what the rows already
 * carry — nothing is estimated, and a figure the rows cannot support (a court
 * fee on a tab, a lift from a campaign) is not invented.
 */
import type { ReservationRow } from '../desk/deskTypes';
import { compareTableNumbers } from '../../lib/queries';

// ---------------------------------------------------------------------------
// Courts
// ---------------------------------------------------------------------------

/** A booking that is on, or was played. */
const BOOKED = new Set(['pending', 'confirmed', 'arrived', 'completed']);

export interface CourtDaySummary {
  /** Pending, confirmed, arrived or completed — bookings that stand. */
  booked: number;
  /** Of `booked`: the guest turned up (arrived or completed). */
  arrived: number;
  /** Of `booked`: not arrived yet and still to start. */
  upcoming: number;
  noShows: number;
  /** Cancelled or expired — bookings that did not stand. */
  cancelled: number;
  /** Maintenance blocks and private holds on the grid. */
  blocks: number;
  /** Sum of `price_iqd` over `booked`. A booking with no price adds nothing. */
  bookedIqd: number;
  /** Minutes of court time under `booked`. */
  bookedMinutes: number;
}

export function courtDaySummary(rows: readonly ReservationRow[], nowMs: number): CourtDaySummary {
  const s: CourtDaySummary = { booked: 0, arrived: 0, upcoming: 0, noShows: 0, cancelled: 0, blocks: 0, bookedIqd: 0, bookedMinutes: 0 };
  for (const r of rows) {
    if (r.kind !== 'booking') {
      if (r.status !== 'cancelled' && r.status !== 'expired') s.blocks += 1;
      continue;
    }
    if (r.status === 'no_show') {
      s.noShows += 1;
    } else if (r.status === 'cancelled' || r.status === 'expired') {
      s.cancelled += 1;
    } else if (BOOKED.has(r.status)) {
      s.booked += 1;
      s.bookedIqd += r.price_iqd ?? 0;
      s.bookedMinutes += Math.max(0, (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60_000);
      if (r.status === 'arrived' || r.status === 'completed') s.arrived += 1;
      else if (new Date(r.start_at).getTime() > nowMs) s.upcoming += 1;
    }
  }
  return s;
}

/** Drawn on the schedule: everything except what never stood. */
export function isOnSchedule(r: ReservationRow): boolean {
  return r.status !== 'cancelled' && r.status !== 'expired';
}

/** Bookings that did not happen — the "not active" list under the schedule. */
export function didNotHappen(rows: readonly ReservationRow[]): ReservationRow[] {
  return rows
    .filter((r) => r.kind === 'booking' && (r.status === 'cancelled' || r.status === 'expired' || r.status === 'no_show'))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/**
 * Where a reservation sits in a schedule band, as fractions of the whole
 * night: `top` from the grid's opening, `height` of its length. Clamped to the
 * grid, so a booking that starts before opening still shows rather than
 * vanishing above the first row.
 */
export function schedulePlacement(
  r: Pick<ReservationRow, 'start_at' | 'end_at'>,
  dayStartMs: number,
  openMin: number,
  spanMin: number,
): { top: number; height: number } | null {
  if (spanMin <= 0) return null;
  const start = (new Date(r.start_at).getTime() - dayStartMs) / 60_000 - openMin;
  const end = (new Date(r.end_at).getTime() - dayStartMs) / 60_000 - openMin;
  const from = Math.max(0, start);
  const to = Math.min(spanMin, end);
  if (to <= from) return null;
  return { top: from / spanMin, height: (to - from) / spanMin };
}

// ---------------------------------------------------------------------------
// Tills
// ---------------------------------------------------------------------------

export interface TabBoardRow {
  id: string;
  label: string;
  table: string | null;
  court: string | null;
  guest: string | null;
  status: string;
  openedAt: string;
  settledAt: string | null;
  /** Server-stamped at settlement, or the running figure while open. */
  total: number;
  stamped: boolean;
  web: boolean;
}

const ACTIVE_TAB = new Set(['open', 'awaiting_payment']);

export function isActiveTab(status: string): boolean {
  return ACTIVE_TAB.has(status);
}

export interface TillDaySummary {
  /** Open or awaiting payment. */
  active: number;
  /** Of `active`: waiting for the guest to pay. */
  awaiting: number;
  settled: number;
  voided: number;
  /** Running total across the active tabs — what the floor is carrying. */
  runningIqd: number;
  /** Stamped totals across the settled tabs. */
  settledIqd: number;
}

export function tillDaySummary(rows: readonly TabBoardRow[]): TillDaySummary {
  const s: TillDaySummary = { active: 0, awaiting: 0, settled: 0, voided: 0, runningIqd: 0, settledIqd: 0 };
  for (const r of rows) {
    if (isActiveTab(r.status)) {
      s.active += 1;
      s.runningIqd += r.total;
      if (r.status === 'awaiting_payment') s.awaiting += 1;
    } else if (r.status === 'settled') {
      s.settled += 1;
      s.settledIqd += r.total;
    } else if (r.status === 'void') {
      s.voided += 1;
    }
  }
  return s;
}

/** Active tabs first (oldest open first — the one that has waited longest), then the rest, latest first. */
export function splitTabs(rows: readonly TabBoardRow[]): { active: TabBoardRow[]; inactive: TabBoardRow[] } {
  const active = rows.filter((r) => isActiveTab(r.status)).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const inactive = rows
    .filter((r) => !isActiveTab(r.status))
    .sort((a, b) => (b.settledAt ?? b.openedAt).localeCompare(a.settledAt ?? a.openedAt));
  return { active, inactive };
}

export interface TableNow {
  tableNumber: string;
  /** Active tabs seated at this table; empty when it is free. */
  tabs: TabBoardRow[];
  runningIqd: number;
}

/** Every active table, occupied or free, in the order printed on the floor. */
export function tablesNow(tables: readonly { table_number: string }[], rows: readonly TabBoardRow[]): TableNow[] {
  return tables
    .map((t) => {
      const tabs = rows.filter((r) => r.table === t.table_number && isActiveTab(r.status));
      return { tableNumber: t.table_number, tabs, runningIqd: tabs.reduce((sum, r) => sum + r.total, 0) };
    })
    .sort((a, b) => compareTableNumbers(a.tableNumber, b.tableNumber));
}
