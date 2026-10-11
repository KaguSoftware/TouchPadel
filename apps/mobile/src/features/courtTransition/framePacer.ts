/**
 * The top-view court's frame pacer (Play and Coaches; Majed, 2026-10-11: "can
 * we make it 45 fps"). Pure, so vitest runs it under plain node.
 *
 * 45 DOES NOT DIVIDE A 60 OR 120 HZ DISPLAY, so a "skip anything sooner than
 * 1000/45 ms after the last frame" floor cannot reach it: on 60 Hz every
 * second tick passes and the court runs at 30. This keeps a running schedule
 * instead: each frame drawn books the next one a period after the PREVIOUS
 * booking, not after now, so the misses and early ticks average out and the
 * rate holds at 45 on any display:
 *
 *   60 Hz   3 ticks drawn in every 4 (gaps 17 / 17 / 33 ms)
 *   90 Hz   every second tick, evenly
 *   120 Hz  gaps alternating 25 / 17 ms
 *
 * `SLACK_MS` lets a tick that lands a hair before its booking count as on
 * time (display ticks jitter by a millisecond or two). A loop that fell a
 * whole period behind (a stall) restarts the schedule from now rather than
 * drawing a burst to catch up.
 */
export const SLACK_MS = 2;

export interface PaceResult {
  draw: boolean;
  /** The next booking, to pass back in on the following tick. */
  nextDueAt: number | null;
}

/** `nextDueAt` null: the first frame after a start or a stop, which always draws. */
export function paceFrame(nextDueAt: number | null, now: number, periodMs: number): PaceResult {
  if (nextDueAt === null) return { draw: true, nextDueAt: now + periodMs };
  if (now < nextDueAt - SLACK_MS) return { draw: false, nextDueAt };
  const next = nextDueAt + periodMs;
  return { draw: true, nextDueAt: next <= now ? now + periodMs : next };
}
