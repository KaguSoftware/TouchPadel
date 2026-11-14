/**
 * How far a page lifts its foot above the iOS keyboard. Pure (no
 * `react-native` import) so vitest pins it; `KeyboardAvoid` measures and
 * animates.
 *
 * `viewBottom` is the page's bottom edge and `keyboardTop` the keyboard's top
 * edge, both in window points. `footerPad` is the bottom padding the page's
 * pinned bar keeps for the home indicator while the keyboard is down: the
 * keyboard may cover all of it but `KEYBOARD_GAP`, so the button sits just
 * above the keys instead of a safe-area's height above them (Majed,
 * 2026-11-12: "it goes way above the keyboard").
 */

/** What is left of a pinned bar's bottom padding above the keys. */
export const KEYBOARD_GAP = 12;

/**
 * The iOS keyboard's own curve (UIKit animation curve 7) as a cubic bezier:
 * a fast start that settles. React Native's 'keyboard' LayoutAnimation type
 * falls back to LINEAR on the New Architecture (ReactCommon animations/utils.cpp),
 * so the page started slower than the keyboard and lagged behind it.
 */
export const KEYBOARD_CURVE = [0.38, 0.7, 0.125, 1] as const;

export function keyboardLift(a: { viewBottom: number; keyboardTop: number; footerPad: number }): number {
  const covered = Math.max(0, a.viewBottom - a.keyboardTop);
  const tuck = Math.max(0, a.footerPad - KEYBOARD_GAP);
  return Math.max(0, Math.round(covered - tuck));
}

/**
 * The keyboard's top edge from its event. With "Prefer Cross-Fade Transitions"
 * on, iOS reports `screenY` 0; the height is still right.
 */
export function keyboardTop(a: { screenY: number; height: number; windowHeight: number }): number {
  return a.screenY > 0 ? a.screenY : a.windowHeight - a.height;
}
