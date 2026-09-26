/**
 * Where a dragged booking lands on the desk grid, and whether it may land
 * there. Pure, so the arithmetic that decides a move is tested without a DOM.
 *
 * WHY THIS EXISTS (Parsa, 2026-09-23)
 *
 * A guest booked 00:00–01:00 from the phone. The desk dragged it "half an hour
 * earlier" and it landed at 22:30, in the past — the server took the move, the
 * desk went on calling it confirmed, and on the guest's phone the booking left
 * Upcoming and was never seen again. Three things were wrong and all three are
 * answered here:
 *
 *  - **The pointer was the new start.** Grab a two-row block anywhere but its
 *    very top row and the block jumped so its START sat under the pointer, one
 *    row further than the hand moved. `dropStartMin` keeps the grab offset, so
 *    the block moves exactly as far as the pointer did.
 *  - **Nothing said where it would land.** The only feedback was a one-row
 *    outline on the cell under the pointer — and the dragged block covered it,
 *    so for a short drag there was no feedback at all and the desk kept
 *    dragging until something lit up. The caller now draws the whole
 *    destination span; this file tells it where.
 *  - **The past was a legal target.** `dropRefusal` names the two targets the
 *    server would take but the desk should not offer. The RPC is still the wall
 *    (0150 refuses RESERVATION_IN_PAST); this keeps the desk from asking.
 */
import { slotTaken } from './deskLogic';
import type { ReservationRow } from './deskTypes';

/** Why a drop is refused before it is asked for. Null means it may be asked. */
export type DropRefusal = 'past' | 'taken';

/**
 * Which row of a block the pointer took hold of, so the block can move with
 * the hand instead of snapping its start under the pointer. Measured against
 * the block's drawn height, which is the only thing that knows the row pitch.
 */
export function grabRowOffset(offsetPx: number, blockPx: number, visibleRows: number): number {
  if (!(blockPx > 0) || !Number.isFinite(offsetPx) || visibleRows <= 1) return 0;
  const row = Math.floor((offsetPx / blockPx) * visibleRows);
  return Math.min(Math.max(row, 0), visibleRows - 1);
}

/**
 * Venue-local minutes the booking would START at, for a pointer over the slot
 * at `pointerMin`. The grab offset comes off the front; the tail is kept inside
 * the night, so a booking dragged past the last row rests against it rather
 * than hanging off the end of the grid.
 */
export function dropStartMin(
  pointerMin: number,
  grabRows: number,
  spanRows: number,
  openMin: number,
  closeMin: number,
  slotMin: number,
): number {
  const last = Math.max(openMin, closeMin - spanRows * slotMin);
  return Math.min(Math.max(pointerMin - grabRows * slotMin, openMin), last);
}

/**
 * Whether this destination may be offered at all.
 *
 * A start that does not move is never "in the past": carrying a game that is
 * already running across to another court is a normal desk act, and the only
 * thing it changes is the court. It is a start that MOVES into the past that
 * strands the booking — which is exactly what happened on 09-23.
 */
export function dropRefusal(args: {
  reservations: readonly ReservationRow[];
  ignoreId: string;
  courtId: string;
  startMs: number;
  endMs: number;
  originalStartMs: number;
  nowMs: number;
}): DropRefusal | null {
  const { reservations, ignoreId, courtId, startMs, endMs, originalStartMs, nowMs } = args;
  if (startMs !== originalStartMs && startMs < nowMs) return 'past';
  if (slotTaken(reservations, courtId, startMs, endMs, ignoreId)) return 'taken';
  return null;
}
