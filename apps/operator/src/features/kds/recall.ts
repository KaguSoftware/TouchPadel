/**
 * F-57 (0396): a ticket marked Complete by mistake can be brought back for ten
 * minutes. The board keeps its own memory of what it saw completed: the
 * server's board read (app.kitchen_board) keeps a completed ticket for two
 * minutes only (the card fades and leaves), and widening that read would put
 * eight more minutes of finished cards on every board. So the board remembers
 * a completed ticket from the moment it reads one, for the rest of the ten
 * minutes app.recall_ticket allows, and lists those under "Just completed".
 *
 * A board that restarts forgets its memory: a ticket completed before the
 * restart can then be brought back from another kitchen screen that saw it,
 * or not at all. The server holds the rule either way (TICKET_RECALL_EXPIRED).
 *
 * Only cloud tickets: a LAN ticket (the till's ring, while the board has no
 * internet) cannot be recalled, see KdsBoard.
 */
import type { TicketRow } from './ticketView';

/** The same ten minutes as app.recall_ticket (0396). */
export const RECALL_WINDOW_MS = 10 * 60 * 1000;
/** The strip shows this many at most, newest first. */
export const RECALL_SHOWN = 6;

export type RecallMemory = ReadonlyMap<string, TicketRow>;

function completedMs(row: TicketRow): number | null {
  if (row.status !== 'completed' || !row.completed_at) return null;
  const ms = new Date(row.completed_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Still inside the window at `nowMs` (a ticket completed in the future, a skewed clock, counts). */
export function recallable(row: TicketRow, nowMs: number): boolean {
  const at = completedMs(row);
  return at !== null && nowMs - at < RECALL_WINDOW_MS;
}

/**
 * The memory after one board read: completed tickets are added (or kept up to
 * date), a ticket the read shows live again (recalled on another screen) is
 * forgotten, and anything past the window is dropped. Pure: returns a new map.
 */
export function rememberCompleted(memory: RecallMemory, rows: readonly TicketRow[], nowMs: number): Map<string, TicketRow> {
  const next = new Map(memory);
  for (const row of rows) {
    if (recallable(row, nowMs)) next.set(row.id, row);
    else if (row.status !== 'completed') next.delete(row.id);
  }
  for (const [id, row] of next) if (!recallable(row, nowMs)) next.delete(id);
  return next;
}

/** A ticket brought back: off the list at once, before the next read confirms it. */
export function forgetRecalled(memory: RecallMemory, id: string): Map<string, TicketRow> {
  const next = new Map(memory);
  next.delete(id);
  return next;
}

/** What the strip lists: newest completed first, at most RECALL_SHOWN. */
export function recallCandidates(memory: RecallMemory, nowMs: number): TicketRow[] {
  return [...memory.values()]
    .filter((r) => recallable(r, nowMs))
    .sort((a, b) => (completedMs(b) ?? 0) - (completedMs(a) ?? 0))
    .slice(0, RECALL_SHOWN);
}

/** Whole minutes since it was completed, never below 0. */
export function minutesSinceCompleted(row: TicketRow, nowMs: number): number {
  const at = completedMs(row);
  return at === null ? 0 : Math.max(0, Math.floor((nowMs - at) / 60_000));
}
