/**
 * RTL/direction helpers. Layout itself must use CSS logical properties
 * (lint-enforced) — these helpers are for the few places code needs to know
 * the direction explicitly (document attributes, animations, keyboard arrows).
 */
import type { Locale } from './t';

export type Direction = 'ltr' | 'rtl';

export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

export function dir(locale: Locale): Direction {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

/** The opposite direction (e.g. for back-arrow flipping). */
export function oppositeDir(direction: Direction): Direction {
  return direction === 'rtl' ? 'ltr' : 'rtl';
}

/**
 * Map a physical horizontal delta to a logical one: in RTL, "forward" is
 * visually leftward. Useful for swipe/arrow-key handling.
 */
export function logicalSign(direction: Direction): 1 | -1 {
  return direction === 'rtl' ? -1 : 1;
}
