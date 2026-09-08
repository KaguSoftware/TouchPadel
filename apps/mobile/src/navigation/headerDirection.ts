/**
 * THE NATIVE BAR'S DIRECTION, and the back item's rebuild around it.
 *
 * One module, because the two are a single mechanism: the chevron has to be
 * ABSENT at the instant the new direction reaches UIKit, and present again as
 * soon as it has.
 *
 * react-native-screens applies the bar's direction in
 * `applySemanticContentAttributeIfNeededToNavCtrl`
 * (RNSScreenStackHeaderConfig.mm), which mirrors the bar's CONTENTS — the back
 * chevron above all — through
 * `+[UIView appearanceWhenContainedInInstancesOfClasses:]`.
 *
 * `UIAppearance` styles a view AS IT IS ADDED TO THE WINDOW, and never again.
 * A chevron already on screen when the direction flips keeps the direction it
 * was BORN with, whatever the bar around it now says — which is why the arrow
 * used to point the wrong way until an edge-swipe (a pop, and so a brand new
 * chevron) appeared to "fix" it by hand.
 *
 * The whole state is ONE value: the direction the bar is currently showing.
 * While it trails the app's, a flip is in progress and the back item stays off
 * the bar; when it catches up, the item returns. There is no second "am I
 * rebuilding" flag that could be left switched on if a run were interrupted —
 * which is exactly how an earlier version stranded the chevron off the bar
 * for good.
 *
 *   1. `dir` flips        → `shown` still the old one → item hidden
 *   2. one frame later    → `shown = dir`             → direction applied,
 *                                                       no chevron to miss it
 *   3. one frame after    → item restored, built under the new mirroring
 *
 * Two frames (~32 ms) from the moment `dir` commits — deliberately NOT tied to
 * `switching`, which stays raised until LocaleProvider's cover has finished
 * fading back (180 ms after the commit) and so made the chevron pop in visibly
 * late. It only ever had to outlast the direction commit.
 *
 * The app's own layout direction is untouched: `useLocale().dir` still flips in
 * one commit for everything drawn in JS (src/i18n/direction.tsx). This is only
 * what the NATIVE bar is told, and when.
 */
import { useEffect, useState } from 'react';
import type { Direction } from '@touch/i18n';
import { useLocale } from '../i18n/LocaleProvider';

export interface NativeBarDirection {
  /** What `LocaleDirContext` is given — trails `dir` by a frame on a flip. */
  direction: Direction;
  /** True while the back item must stay off the bar so UIKit rebuilds it. */
  rebuilding: boolean;
}

export function useNativeBarDirection(): NativeBarDirection {
  const { dir } = useLocale();
  /** The direction the native bar is currently showing. */
  const [shown, setShown] = useState<Direction>(dir);
  /** Set once the rebuilt item may come back, a frame after `shown` caught up. */
  const [restored, setRestored] = useState(true);

  /**
   * Keyed on `dir` alone, never on `shown`.
   *
   * Listing `shown` made the run cancel itself: its middle step sets `shown`,
   * which re-ran the effect, whose cleanup killed the pending frame that would
   * have put the item back — leaving the chevron hidden permanently. Only a NEW
   * language may interrupt a run, and `dir` is what says so.
   *
   * The cleanup cancels frames and touches nothing else: it also runs on
   * unmount, and between StrictMode's double-invoked mount, where writing state
   * would either fire after teardown or convince the next run it had nothing to
   * do. Interruption is safe without it — a new `dir` starts a fresh run that
   * ends with the item restored either way.
   */
  useEffect(() => {
    if (dir === shown) return;
    let back = 0;
    const flip = requestAnimationFrame(() => {
      // Both in ONE commit: the bar catches up, and the item stays hidden for
      // a frame longer. `dir !== shown` already covers the window before this,
      // so nothing has to be set synchronously in the effect body.
      setShown(dir);
      setRestored(false);
      back = requestAnimationFrame(() => setRestored(true));
    });
    return () => {
      cancelAnimationFrame(flip);
      cancelAnimationFrame(back);
    };
    // `shown` is read, not tracked — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  // Hidden while the bar has not caught up, and for the one frame after, so the
  // item is created strictly later than the direction it must be created under.
  return { direction: shown, rebuilding: dir !== shown || !restored };
}
