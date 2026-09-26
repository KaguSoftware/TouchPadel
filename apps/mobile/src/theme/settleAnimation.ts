/**
 * A timed animation that ALWAYS settles.
 *
 * The theme crossfade awaits a fade before committing the new palette, so
 * anything that leaves the promise pending freezes the theme mid-switch: the
 * tree keeps the old colours with no way back, and the cover can be left up
 * over them. `Animated.timing` advances on `requestAnimationFrame`, which the
 * OS suspends while the app is backgrounded — and backgrounding is the NORMAL
 * path for a system theme change, since it means Control Center or Settings.
 * The device listener therefore fires while nothing can animate, the fade sits
 * at its start value with its callback unfired, and the commit behind it never
 * runs. That is the split-theme frame: React chrome on the new palette, the
 * parts that only repaint on a commit still on the old one.
 *
 * So the animation's own callback races a wall-clock timer. `setTimeout` is not
 * throttled the way rAF is, so it still fires on a backgrounded app; whichever
 * lands first wins and the loser is a no-op.
 *
 * Kept apart from ThemeProvider so it can be tested without a renderer: the
 * guarantee is "this promise always resolves, and the value always ends at
 * `toValue`", which is exactly what the provider's correctness rests on.
 */

/** The slice of Animated.Value this needs. */
export interface SettleTarget {
  setValue: (value: number) => void;
}

/** The slice of a started Animated.CompositeAnimation this needs. */
export interface SettleAnimation {
  start: (callback?: () => void) => void;
  stop: () => void;
}

/**
 * Grace on top of the animation's own duration before it is force-settled.
 * Long enough that a real fade on a loaded JS thread is never cut short, short
 * enough that a theme flip which arrived while backgrounded is already applied
 * by the time the app is back on screen.
 */
export const ANIMATION_TIMEOUT_MS = 400;

/**
 * Run `animation`, resolving when it finishes OR when `duration + grace` has
 * elapsed on the wall clock — whichever comes first. On the timeout path the
 * animation is stopped and `target` is snapped to `toValue`, so the caller's
 * next phase sees the value it expects either way.
 */
export function settleAnimation(
  animation: SettleAnimation,
  target: SettleTarget,
  toValue: number,
  duration: number,
  grace: number = ANIMATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      // `stop()` fires the start callback synchronously (with finished: false),
      // so the callback below would resolve from inside the call and hand the
      // next phase a value still sitting where the stalled fade left it. Claim
      // the race FIRST: the callback then no-ops, the snap lands, and the
      // resolve is ours to make once the value is right.
      done = true;
      animation.stop();
      target.setValue(toValue);
      resolve();
    }, duration + grace);
    animation.start(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    });
  });
}
