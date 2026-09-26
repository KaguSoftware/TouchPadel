/**
 * Scroll → camera for the club section. Pure, so the mapping is tested rather
 * than eyeballed.
 *
 * k is the phone's eased camera pitch (@touch/court3d rally.ts cameraPose):
 * 0 = the flat top-down diagram, 1 = the booking view's 40° pitch. The scroll plays
 * the app's "Check availability" move (owner, 2026-09-25): the court comes up the
 * screen as the flat diagram and, as the section scrolls on, tilts up to the booking
 * view, turning 28° round with the rackets standing up, on the app's own ease-in-out.
 * The move runs over MOVE, the middle of the section's passage, so it starts once the
 * court is on screen and has landed before it leaves. Without the scroll link it
 * rests at K_REST, where the cage, the glass, the net and the standing rackets all
 * read as a 3D model.
 */
import { clamp01, EASE_IO, lerp } from '@touch/court3d/spec';

/** Pitch before the move: the flat top-down diagram (89.5° elevation, 0° around). */
export const K_FROM = 0;
/** The court at rest (no scroll link, reduced motion): 60° elevation, 16.8° around. */
export const K_REST = 0.6;
/** Pitch after the move: the booking view (40° elevation, 28° around). */
export const K_TO = 1;
/** The span of section progress the move plays over. */
export const MOVE = [0.15, 0.6] as const;

/**
 * How far the section has travelled through the viewport: 0 when its top edge is
 * at the bottom of the screen, 1 when its bottom edge leaves the top. Measured on
 * the SECTION, not the court's box, because on a desktop that box is sticky and
 * its own rect hardly moves while the section scrolls past.
 */
export function sectionProgress(top: number, height: number, viewportH: number): number {
  const span = height + viewportH;
  if (!(span > 0)) return 0;
  const p = (viewportH - top) / span;
  return Number.isFinite(p) ? clamp01(p) : 0;
}

/** The camera pitch for a section progress (0..1): the app's move, eased in and out over MOVE. */
export function kFor(progress: number): number {
  const [a, b] = MOVE;
  return lerp(K_FROM, K_TO, EASE_IO(clamp01((progress - a) / (b - a))));
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
