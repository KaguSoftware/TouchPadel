/**
 * How the Book tab's busy ranges stay current without a refetch storm
 * (load test 2026-11-03, weak points 4 and 5).
 *
 * Every booking broadcasts `slot_changed` twice (hold, then confirm), and every
 * connected app used to answer each one by re-reading the whole seven-night
 * window at the same instant: 200 phones, 216 rows each, twice per booking. The
 * broadcast already says what changed (0382 `app.rt_reservation`: court, start,
 * end, kind, status, busy), so the cached window is patched in place instead
 * and nothing is fetched.
 *
 * The poll that used to run every 60 s whether the sheet was open or not now
 * runs only where it earns its keep: while the sheet is open (every 5 minutes
 * while the channel is live, a hold that lapses by its TTL fires no event; every
 * minute while it is down) and while the channel is down with the sheet closed.
 *
 * PURE (vitest).
 */
import type { AvailabilityRow } from './assemble';

/** One reservation's change, as `app.rt_reservation` (0382) broadcasts it. */
export interface SlotChange {
  courtId: string;
  startAt: string;
  endAt: string;
  /** The view's kind: a lesson reads as a booking (0280). */
  kind: 'booking' | 'hold' | 'maintenance';
  /** pending, confirmed or arrived: the slot is taken. */
  busy: boolean;
}

const KINDS = new Set(['booking', 'hold', 'maintenance', 'lesson']);

/**
 * The broadcast's payload as a change, or null when it is not one this build
 * can patch from (an older server, an unknown kind): the caller re-reads then.
 */
export function parseSlotChange(payload: unknown): SlotChange | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const { court_id, start_at, end_at, kind, busy } = p;
  if (typeof court_id !== 'string' || typeof start_at !== 'string' || typeof end_at !== 'string') {
    return null;
  }
  if (typeof kind !== 'string' || !KINDS.has(kind) || typeof busy !== 'boolean') return null;
  if (Number.isNaN(Date.parse(start_at)) || Number.isNaN(Date.parse(end_at))) return null;
  return {
    courtId: court_id,
    startAt: start_at,
    endAt: end_at,
    kind: kind === 'lesson' ? 'booking' : (kind as SlotChange['kind']),
    busy,
  };
}

/** Same court and the same range. Compared as instants: the view and the broadcast may print offsets differently. */
function sameSlot(row: AvailabilityRow, change: SlotChange): boolean {
  return (
    row.court_id === change.courtId &&
    row.start_at !== null &&
    row.end_at !== null &&
    Date.parse(row.start_at) === Date.parse(change.startAt) &&
    Date.parse(row.end_at) === Date.parse(change.endAt)
  );
}

/**
 * The window with one change applied. A taken slot is added (or its kind
 * updated, a hold becoming a booking on confirm); a freed one is removed. The
 * same array comes back when nothing changed, so the grid cache, which
 * validates by reference, is not rebuilt for nothing.
 *
 * What a patch cannot see: a reservation MOVED to another court or time
 * broadcasts only where it went, so the old slot stays busy until the next
 * read. That errs the safe way (a free slot shown taken, never the reverse),
 * and the next read is close: opening the sheet re-reads.
 */
export function patchWindow(
  rows: readonly AvailabilityRow[],
  change: SlotChange,
): readonly AvailabilityRow[] {
  const at = rows.findIndex((row) => sameSlot(row, change));
  if (!change.busy) {
    if (at < 0) return rows;
    return rows.filter((row) => !sameSlot(row, change));
  }
  if (at >= 0) {
    if (rows[at]!.kind === change.kind) return rows;
    const next = rows.slice();
    next[at] = { ...rows[at]!, kind: change.kind };
    return next;
  }
  return [
    ...rows,
    { court_id: change.courtId, start_at: change.startAt, end_at: change.endAt, kind: change.kind },
  ];
}

/** While the realtime channel is live, an open sheet still re-reads this often: a hold that lapses by its TTL fires nothing. */
export const WINDOW_POLL_LIVE_MS = 5 * 60_000;
/** Without the channel, the poll is the only news there is. */
export const WINDOW_POLL_DOWN_MS = 60_000;

/**
 * The busy ranges' poll. Closed sheet with a live channel: none, the
 * broadcast patches the cache. Otherwise every minute without the channel and
 * every five with it.
 */
export function windowPollMs({ open, live }: { open: boolean; live: boolean }): number | false {
  if (!live) return WINDOW_POLL_DOWN_MS;
  return open ? WINDOW_POLL_LIVE_MS : false;
}

/**
 * The window a just-opened sheet trusts without re-reading. Younger than this
 * the rows were read (or patched) a moment ago; older, the sheet shows them at
 * once and checks them behind the scenes.
 */
export const OPEN_FRESH_MS = 15_000;

/** A re-read the broadcast forces on everyone at once is spread over this. */
export const REFRESH_JITTER_MS = 3_000;

/** 0 to REFRESH_JITTER_MS, so a club's phones do not all ask in the same instant. */
export function refreshDelayMs(random: () => number = Math.random): number {
  return Math.floor(random() * REFRESH_JITTER_MS);
}

/**
 * Busy ranges to show while this window's own have not arrived: the newest
 * cached window of the same branch (the strip rolled past midnight, or the
 * hours moved the bounds). Its rows are absolute instants, so the nights the
 * two windows share read right; the new night reads free until the rows land,
 * which is why the sheet takes no taps on placeholder rows.
 */
export function pickPlaceholderRows(
  cached: readonly { rows: readonly AvailabilityRow[] | undefined; updatedAt: number }[],
): readonly AvailabilityRow[] | undefined {
  let best: { rows: readonly AvailabilityRow[]; updatedAt: number } | undefined;
  for (const entry of cached) {
    if (!entry.rows) continue;
    if (!best || entry.updatedAt > best.updatedAt) best = { rows: entry.rows, updatedAt: entry.updatedAt };
  }
  return best?.rows;
}
