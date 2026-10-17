import { describe, expect, it } from 'vitest';
import { createUndoQueue, type UndoTimer } from '../undoLogic';

/** A hand-wound clock: `tick()` fires every timer still set. */
function fakeTimer() {
  const live = new Map<number, () => void>();
  let next = 0;
  const timer: UndoTimer<number> = {
    set: (fn) => {
      live.set(++next, fn);
      return next;
    },
    clear: (h) => void live.delete(h),
  };
  const tick = () => {
    const due = [...live.values()];
    live.clear();
    due.forEach((fn) => fn());
  };
  return { timer, tick, live };
}

describe('createUndoQueue', () => {
  it('sends when the time is up, never restoring', () => {
    const { timer, tick } = fakeTimer();
    const q = createUndoQueue(timer);
    const log: string[] = [];
    q.defer(
      () => log.push('send'),
      () => log.push('restore'),
    );
    expect(log).toEqual([]);
    expect(q.pending()).toBe(true);
    tick();
    expect(log).toEqual(['send']);
    expect(q.pending()).toBe(false);
  });

  it('undo restores and the call is never made', () => {
    const { timer, tick, live } = fakeTimer();
    const q = createUndoQueue(timer);
    const log: string[] = [];
    const id = q.defer(
      () => log.push('send'),
      () => log.push('restore'),
    );
    expect(q.undo(id)).toBe(true);
    expect(live.size).toBe(0);
    tick();
    expect(log).toEqual(['restore']);
  });

  it('a second action sends the first at once, and the old Undo does nothing', () => {
    const { timer, tick } = fakeTimer();
    const q = createUndoQueue(timer);
    const log: string[] = [];
    const first = q.defer(
      () => log.push('send 1'),
      () => log.push('restore 1'),
    );
    const second = q.defer(
      () => log.push('send 2'),
      () => log.push('restore 2'),
    );
    expect(log).toEqual(['send 1']);
    expect(q.undo(first)).toBe(false);
    expect(q.undo(second)).toBe(true);
    tick();
    expect(log).toEqual(['send 1', 'restore 2']);
  });

  it('flush sends what waits, once', () => {
    const { timer, tick } = fakeTimer();
    const q = createUndoQueue(timer);
    const log: string[] = [];
    const id = q.defer(
      () => log.push('send'),
      () => log.push('restore'),
    );
    q.flush();
    q.flush();
    tick();
    expect(q.undo(id)).toBe(false);
    expect(log).toEqual(['send']);
  });
});
