/**
 * Scroll → camera for the landing hero. Pure, so the mapping is tested rather
 * than eyeballed.
 *
 * p is the phone's transition progress (spec.ts): 0 = the top-down court,
 * 1 = the booking view's 40° pitch. On the site the scroll only ever takes it
 * to SCROLL_P_MAX: far enough that the court tips toward the visitor as the hero
 * leaves, not so far that the near corners run out of a portrait box.
 */
export const SCROLL_P_MAX = 0.75;

/** How much of the stage has scrolled out of the top when p reaches SCROLL_P_MAX. */
export const SCROLL_OUT_AT = 0.6;

/**
 * Progress from the stage's own box: 0 while its top edge is still in the
 * viewport (the upper third on a desktop hero, lower on a phone), rising
 * linearly to SCROLL_P_MAX by the time SCROLL_OUT_AT of its height has left the
 * top, so the pitched court is still on screen when it gets there.
 */
export function scrollProgress(top: number, height: number, viewportH: number): number {
  void viewportH; // kept in the signature: the start line may move off the top later
  const span = height * SCROLL_OUT_AT;
  if (!(span > 0)) return 0;
  const raw = -top / span;
  return Math.min(1, Math.max(0, raw)) * SCROLL_P_MAX;
}

/**
 * Frame-rate independent follow: the shown value closes on the target with a
 * time constant of 1/rate seconds, so a wheel notch reads as the camera easing
 * into place rather than stepping, and 120 Hz and 60 Hz screens agree.
 */
export function follow(shown: number, target: number, dtS: number, rate = 9): number {
  if (!(dtS > 0)) return shown;
  const next = shown + (target - shown) * (1 - Math.exp(-dtS * rate));
  return Math.abs(target - next) < 1e-4 ? target : next;
}
