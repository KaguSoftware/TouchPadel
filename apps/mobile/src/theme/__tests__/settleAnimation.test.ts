import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { settleAnimation, type SettleAnimation, type SettleTarget } from '../settleAnimation';

/**
 * THE THEME COMMIT HANGS OFF THIS PROMISE.
 *
 * The crossfade fades a cover up, awaits it, and only then commits the new
 * palette. A promise that never resolves is therefore not a dropped animation —
 * it is a theme that never changes, with the cover potentially stranded over
 * the old one. The case that actually shipped: a system appearance change fires
 * while the app is BACKGROUNDED (Control Center / Settings), where
 * `requestAnimationFrame` is suspended, so `Animated.timing` never calls back.
 *
 * The fake below is RN's contract, not a convenience: `start(cb)` holds the
 * callback until the driver runs, and `stop()` fires it synchronously with
 * finished: false (TimingAnimation.stop → __notifyAnimationEnd).
 */

/** An animation whose driver we control: `run()` is the frame that may never come. */
function fakeAnimation(): SettleAnimation & { run: () => void; stopped: boolean } {
  let cb: (() => void) | undefined;
  const api = {
    stopped: false,
    start(callback?: () => void) {
      cb = callback;
    },
    stop() {
      api.stopped = true;
      cb?.(); // RN fires the callback synchronously on stop
    },
    run() {
      cb?.();
    },
  };
  return api;
}

function fakeTarget(): SettleTarget & { value: number | null } {
  return {
    value: null,
    setValue(v: number) {
      this.value = v;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('settleAnimation', () => {
  it('resolves when the animation finishes normally', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    const p = settleAnimation(anim, target, 1, 120);
    anim.run();
    await expect(p).resolves.toBeUndefined();
    // The real fade ran, so nothing was snapped and nothing was stopped.
    expect(target.value).toBeNull();
    expect(anim.stopped).toBe(false);
  });

  it('resolves even when the animation never calls back (backgrounded app)', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    // The frame never comes — rAF is suspended. Before the guard this promise
    // stayed pending forever and the theme commit behind it never ran.
    const p = settleAnimation(anim, target, 1, 120);
    await vi.advanceTimersByTimeAsync(120 + 400);
    await expect(p).resolves.toBeUndefined();
  });

  it('snaps the value to toValue when it force-settles', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    const p = settleAnimation(anim, target, 1, 120);
    await vi.advanceTimersByTimeAsync(120 + 400);
    await p;
    // The cover must end up where the caller expects, or the next phase fades
    // from the wrong place and the seam is visible anyway.
    expect(target.value).toBe(1);
    expect(anim.stopped).toBe(true);
  });

  it('snaps BEFORE resolving, despite stop() firing the callback synchronously', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    let valueAtResolve: number | null = null;
    const p = settleAnimation(anim, target, 1, 120).then(() => {
      valueAtResolve = target.value;
    });
    await vi.advanceTimersByTimeAsync(120 + 400);
    await p;
    // The ordering trap: stop() re-enters the start callback, so a naive
    // implementation resolves with the value still unset.
    expect(valueAtResolve).toBe(1);
  });

  it('does not settle twice when the animation finishes late', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    let resolutions = 0;
    const p = settleAnimation(anim, target, 1, 120).then(() => {
      resolutions += 1;
    });
    await vi.advanceTimersByTimeAsync(120 + 400);
    await p;
    target.value = 0.5; // a suspended fade resuming would move it
    anim.run(); // the late frame finally arrives
    await Promise.resolve();
    expect(resolutions).toBe(1);
    // The late callback must not resolve again or re-snap.
    expect(target.value).toBe(0.5);
  });

  it('does not fire the timeout once the animation has finished', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    const p = settleAnimation(anim, target, 1, 120);
    anim.run();
    await p;
    await vi.advanceTimersByTimeAsync(10_000);
    // Timer cleared: no snap, no stop, long after the fade completed.
    expect(target.value).toBeNull();
    expect(anim.stopped).toBe(false);
  });

  it('waits for the real animation rather than racing it early', async () => {
    const anim = fakeAnimation();
    const target = fakeTarget();
    let settled = false;
    void settleAnimation(anim, target, 1, 120).then(() => {
      settled = true;
    });
    // Still inside the grace window: a fade on a busy JS thread must not be cut.
    await vi.advanceTimersByTimeAsync(120 + 399);
    expect(settled).toBe(false);
  });
});
