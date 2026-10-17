/**
 * Undo instead of "Are you sure?" (Sait, 2026-10-17). The server has no undo
 * for a withdraw, a cancel or an untick, so the phone holds the call back: the
 * row goes at once, a toast offers Undo, and the call is sent when the toast's
 * time is up. Undo puts the row back and the call is never made.
 *
 * One action waits at a time, app-wide: a second one sends the first straight
 * away, so an Undo always takes back the action its toast names. The app
 * leaving the screen, or the page closing, sends what waits (undo.ts).
 *
 * PURE (vitest): the timer is passed in.
 */

/** As long as the toast with the Undo button stays (overlays.tsx ACTION_TOAST_MS). */
export const UNDO_MS = 5000;

export interface UndoTimer<H> {
  set: (fn: () => void, ms: number) => H;
  clear: (handle: H) => void;
}

export interface UndoQueue {
  /** Holds `send` back; returns the id its Undo takes. Sends anything already waiting first. */
  defer: (send: () => void, restore: () => void) => number;
  /** Takes the action back if it is still waiting: `restore` runs, `send` never does. */
  undo: (id: number) => boolean;
  /** Sends the waiting action now, if there is one. */
  flush: () => void;
  pending: () => boolean;
}

export function createUndoQueue<H>(timer: UndoTimer<H>, ms: number = UNDO_MS): UndoQueue {
  let waiting: { id: number; send: () => void; restore: () => void; handle: H } | null = null;
  let seq = 0;

  const flush = () => {
    if (!waiting) return;
    const { send, handle } = waiting;
    waiting = null;
    timer.clear(handle);
    send();
  };

  return {
    defer(send, restore) {
      flush();
      const id = ++seq;
      const handle = timer.set(() => {
        if (waiting?.id !== id) return;
        waiting = null;
        send();
      }, ms);
      waiting = { id, send, restore, handle };
      return id;
    },
    undo(id) {
      if (waiting?.id !== id) return false;
      const { restore, handle } = waiting;
      waiting = null;
      timer.clear(handle);
      restore();
      return true;
    },
    flush,
    pending: () => waiting !== null,
  };
}
