/**
 * The live floor — the pure half.
 *
 * Turns the rows the boards already read (courts, today's bookings, cafe
 * tables, open tabs, staff, station assignments, station heartbeats, open
 * breaks) into one snapshot the plan can draw: what every court, table and
 * person is doing at this moment. No formatting, no fetching, no three.js, so
 * it is testable on its own.
 *
 * What the snapshot claims, and what it refuses to:
 *
 *  - A court is IN PLAY when a booking on it has been marked arrived AND its
 *    slot has started and not ended; BOOKED when a confirmed booking's slot
 *    contains now but nobody has been marked arrived; FREE otherwise.
 *    Arrived is not "on court" (owner call, 2026-09-22): a guest checked in
 *    at 17:40 for 18:00 is at the venue, not playing, and the court may still
 *    hold the previous booking. Such a guest is WAITING — named on the court
 *    they are booked on, never drawn on it. A game is always four players, so
 *    an in-play court is drawn with four.
 *  - A table is OCCUPIED when an open tab sits on it. Nothing records how many
 *    guests are there, so the model never says so; the drawn figure at the
 *    table means "a tab is open", and its colour whether that tab is waiting
 *    to be paid.
 *  - A person is ON BREAK when they have an open break; AT A STATION when a
 *    device they are signed in on has beaten within the stale window (0107:
 *    the heartbeat names who is signed in), when they are covering somebody's
 *    break, or when they are assigned to a station whose device is live.
 *    Managers and owners hold no assignment — they are the jokers who may
 *    cover any station — so for them the signed-in beat is the whole signal,
 *    and it puts them in the office. Anyone else is simply not on the plan:
 *    an absence is not drawn, because a floor covered in ghosts of everyone
 *    who is off today says nothing about tonight.
 *
 * The plan is the venue as built: two courts, nine tables. Courts take the two
 * slots in rail order, tables the nine in table-number order; anything beyond
 * is counted, and reported as "not on this plan", but has nowhere to stand.
 */
import { compareTableNumbers } from '../../lib/queries';

export const COURT_SLOTS = 2;
export const TABLE_SLOTS = 9;

/**
 * `venue_settings.heartbeat_stale_seconds` defaults to 45 (0021) and is not on
 * the public view, so the plan reads a station as live for the same 45 s the
 * server does by default.
 */
export const HEARTBEAT_STALE_MS = 45_000;

/** How far ahead "next booking" looks on a free court. */
export const LOOKAHEAD_MS = 3 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Raw rows, exactly as the reads return them
// ---------------------------------------------------------------------------

export interface RawCourt {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

export interface RawBooking {
  id: string;
  court_id: string;
  status: string;
  start_at: string;
  end_at: string;
  guest_name: string | null;
  /** The account a mobile booking came from; the desk-typed `guest_name` is null there. */
  guest?: { full_name: string | null } | null;
}

export interface RawTable {
  id: string;
  table_number: string;
}

export interface RawTab {
  id: string;
  status: string;
  table_id: string | null;
  label: string | null;
  opened_at: string;
  reservation: { guest_name: string | null; guest?: { full_name: string | null } | null } | null;
}

export interface RawStaff {
  id: string;
  display_name: string;
  role: string;
}

export interface RawStationStaff {
  station_id: string;
  staff_id: string;
}

export interface RawHeartbeat {
  device_id: string;
  last_seen_at: string;
  /** Who was signed in at the last beat (0107); null on rows older than that. */
  staff_id: string | null;
}

export interface RawBreak {
  staff_id: string;
  station_id: string;
  started_at: string;
  covered_by: string | null;
  cover_started_at: string | null;
}

export interface FloorRaw {
  courts: RawCourt[];
  bookings: RawBooking[];
  tables: RawTable[];
  tabs: RawTab[];
  staff: RawStaff[];
  stationStaff: RawStationStaff[];
  heartbeats: RawHeartbeat[];
  breaks: RawBreak[];
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

export type CourtStatus = 'in_play' | 'booked' | 'free';

export interface FloorCourt {
  id: string;
  /** 0-based place on the plan, null when the plan has no room for it. */
  slot: number | null;
  name_en: string;
  name_ar: string;
  status: CourtStatus;
  guest: string | null;
  /** ISO end of the current booking (in play or booked). */
  until: string | null;
  /** ISO start of the next booking, when the court is free. */
  nextAt: string | null;
  /**
   * A guest marked arrived whose slot on this court has not started yet: at
   * the venue, not on the court. Shown in words, never drawn as players.
   */
  waiting: { guest: string | null; startsAt: string } | null;
}

export type TableStatus = 'occupied' | 'free';
export type TabState = 'open' | 'awaiting_payment';

export interface FloorTable {
  id: string;
  slot: number | null;
  number: string;
  status: TableStatus;
  tab: { id: string; label: string | null; guest: string | null; state: TabState; openedAt: string } | null;
}

export type StaffStatus = 'working' | 'break';

/** The rooms of the plan a person can stand in. */
export type Room = 'reception' | 'bar' | 'kitchen' | 'office' | 'meeting' | 'floor';

export interface FloorStaff {
  id: string;
  name: string;
  role: string;
  room: Room;
  status: StaffStatus;
  /** The live station they are at, when that is how they were placed. */
  stationId: string | null;
  /** Who they are covering for, when that is how they were placed. */
  coveringFor: string | null;
  /** ISO start of the break, when on one. */
  since: string | null;
}

export interface FloorSnapshot {
  courts: FloorCourt[];
  tables: FloorTable[];
  staff: FloorStaff[];
}

export interface FloorCounts {
  courtsInPlay: number;
  courtsTotal: number;
  tablesOccupied: number;
  tablesTotal: number;
  staffWorking: number;
  staffOnBreak: number;
  courtsNotDrawn: number;
  tablesNotDrawn: number;
}

/** Where a role stands on the plan when nothing more specific is known. */
export function roomForRole(role: string): Room {
  switch (role) {
    case 'court_desk':
      return 'reception';
    // The bar and kitchen split of 0155: baristas work the bar beside the
    // cashier, chefs the kitchen beside whoever is still on prep.
    case 'cashier':
    case 'head_barista':
    case 'barista':
      return 'bar';
    case 'prep':
    case 'head_chef':
    case 'chef':
      return 'kitchen';
    // The two jokers share the office: whoever is running the building sits
    // there, and a second desk in a meeting room said nothing true.
    case 'manager':
    case 'owner':
      return 'office';
    // Driver and marketing (0155) have no room of their own on the plan, so
    // they stand where any role without one does.
    default:
      return 'floor';
  }
}

function ms(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

/**
 * Whose booking it is. A booking made in the app has no `guest_name` — only the
 * account it came from — so the floor showed those courts with a blank name.
 */
function bookingGuest(b: { guest_name: string | null; guest?: { full_name: string | null } | null } | null | undefined): string | null {
  return b?.guest_name ?? b?.guest?.full_name ?? null;
}

export function composeSnapshot(raw: FloorRaw, nowMs: number, staleMs = HEARTBEAT_STALE_MS): FloorSnapshot {
  // Courts -----------------------------------------------------------------
  const courtsSorted = raw.courts
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name_en.localeCompare(b.name_en) || a.id.localeCompare(b.id));
  const byCourt = new Map<string, RawBooking[]>();
  for (const b of raw.bookings) {
    const list = byCourt.get(b.court_id) ?? [];
    list.push(b);
    byCourt.set(b.court_id, list);
  }
  const courts: FloorCourt[] = courtsSorted.map((c, i) => {
    const list = (byCourt.get(c.id) ?? []).slice().sort((a, b) => ms(a.start_at) - ms(b.start_at));
    const running = (b: RawBooking) => ms(b.start_at) <= nowMs && ms(b.end_at) > nowMs;
    const inPlay = list.find((b) => b.status === 'arrived' && running(b));
    const booked = inPlay ? undefined : list.find((b) => b.status === 'confirmed' && running(b));
    const current = inPlay ?? booked;
    const upcoming = (b: RawBooking) => (b.status === 'confirmed' || b.status === 'arrived') && ms(b.start_at) > nowMs;
    const next = current ? undefined : list.find((b) => upcoming(b) && ms(b.start_at) - nowMs <= LOOKAHEAD_MS);
    const waiting = list.find((b) => b.status === 'arrived' && ms(b.start_at) > nowMs);
    return {
      id: c.id,
      slot: i < COURT_SLOTS ? i : null,
      name_en: c.name_en,
      name_ar: c.name_ar,
      status: inPlay ? 'in_play' : booked ? 'booked' : 'free',
      guest: bookingGuest(current),
      until: current?.end_at ?? null,
      nextAt: next?.start_at ?? null,
      waiting: waiting ? { guest: bookingGuest(waiting), startsAt: waiting.start_at } : null,
    };
  });

  // Tables -----------------------------------------------------------------
  const tabByTable = new Map<string, RawTab>();
  for (const t of raw.tabs.slice().sort((a, b) => ms(a.opened_at) - ms(b.opened_at))) {
    if (t.table_id && !tabByTable.has(t.table_id)) tabByTable.set(t.table_id, t);
  }
  const tables: FloorTable[] = raw.tables
    .slice()
    .sort((a, b) => compareTableNumbers(a.table_number, b.table_number))
    .map((t, i) => {
      const tab = tabByTable.get(t.id);
      return {
        id: t.id,
        slot: i < TABLE_SLOTS ? i : null,
        number: t.table_number,
        status: tab ? 'occupied' : 'free',
        tab: tab
          ? {
              id: tab.id,
              label: tab.label,
              guest: bookingGuest(tab.reservation),
              state: tab.status === 'awaiting_payment' ? 'awaiting_payment' : 'open',
              openedAt: tab.opened_at,
            }
          : null,
      };
    });

  // Staff ------------------------------------------------------------------
  const fresh = raw.heartbeats.filter((h) => nowMs - ms(h.last_seen_at) <= staleMs);
  const liveStations = new Set(fresh.map((h) => h.device_id));
  // The device a person is signed in on right now, when one is beating.
  const ownStation = new Map<string, string>();
  for (const h of fresh) if (h.staff_id && !ownStation.has(h.staff_id)) ownStation.set(h.staff_id, h.device_id);
  const stationsOf = new Map<string, string[]>();
  for (const s of raw.stationStaff) {
    const list = stationsOf.get(s.staff_id) ?? [];
    list.push(s.station_id);
    stationsOf.set(s.staff_id, list);
  }
  const nameOf = new Map(raw.staff.map((s) => [s.id, s.display_name] as const));
  const breakOf = new Map<string, RawBreak>();
  const coverOf = new Map<string, RawBreak>();
  for (const b of raw.breaks) {
    breakOf.set(b.staff_id, b);
    if (b.covered_by) coverOf.set(b.covered_by, b);
  }

  const staff: FloorStaff[] = [];
  for (const s of raw.staff.slice().sort((a, b) => a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id))) {
    const room = roomForRole(s.role);
    const brk = breakOf.get(s.id);
    if (brk) {
      staff.push({ id: s.id, name: s.display_name, role: s.role, room, status: 'break', stationId: brk.station_id, coveringFor: null, since: brk.started_at });
      continue;
    }
    const cover = coverOf.get(s.id);
    if (cover) {
      staff.push({
        id: s.id,
        name: s.display_name,
        role: s.role,
        room,
        status: 'working',
        stationId: cover.station_id,
        coveringFor: nameOf.get(cover.staff_id) ?? null,
        since: cover.cover_started_at,
      });
      continue;
    }
    const live = ownStation.get(s.id) ?? (stationsOf.get(s.id) ?? []).find((id) => liveStations.has(id));
    if (live) {
      staff.push({ id: s.id, name: s.display_name, role: s.role, room, status: 'working', stationId: live, coveringFor: null, since: null });
    }
  }

  return { courts, tables, staff };
}

export function countsOf(s: FloorSnapshot): FloorCounts {
  return {
    courtsInPlay: s.courts.filter((c) => c.status === 'in_play').length,
    courtsTotal: s.courts.length,
    tablesOccupied: s.tables.filter((t) => t.status === 'occupied').length,
    tablesTotal: s.tables.length,
    staffWorking: s.staff.filter((p) => p.status === 'working').length,
    staffOnBreak: s.staff.filter((p) => p.status === 'break').length,
    courtsNotDrawn: s.courts.filter((c) => c.slot === null).length,
    tablesNotDrawn: s.tables.filter((t) => t.slot === null).length,
  };
}

/** What the pointer is over on the plan. */
export type FloorTarget = { kind: 'court'; id: string } | { kind: 'table'; id: string } | { kind: 'room'; room: Room };

export const EMPTY_SNAPSHOT: FloorSnapshot = { courts: [], tables: [], staff: [] };

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** Never closer than this to what the camera looks at (metres). */
export const ZOOM_MIN_DIST = 6;

/**
 * The zoom track, as pure arithmetic, so it can be tested without a GPU.
 *
 * Distance and slider position are LOGARITHMIC in each other, because zooming
 * multiplies the distance rather than subtracting from it: halving the
 * distance is the same length of travel wherever the thumb starts. Linear
 * would give a track whose far half barely moved and whose near half flew.
 *
 * 0 is the whole floor (`home`, which depends on the panel's size) and 1 is
 * ZOOM_MIN_DIST, the closest the plan allows.
 */
export function zoomLevelOf(dist: number, home: number): number {
  if (home <= ZOOM_MIN_DIST) return 0;
  const t = Math.log(dist / home) / Math.log(ZOOM_MIN_DIST / home);
  return Math.min(1, Math.max(0, t));
}

/** The inverse: where to stand for a point on the track. */
export function zoomDistanceAt(level: number, home: number): number {
  if (home <= ZOOM_MIN_DIST) return home;
  const t = Math.min(1, Math.max(0, level));
  return home * Math.pow(ZOOM_MIN_DIST / home, t);
}
