import { DOUBLE_TAP_SCALE, LIGHTBOX_DISMISS_PX, MAX_SCALE, MIN_SCALE } from './constants';

/** Pure pinch/pan maths for the lightbox (UpperDeck ImageLightbox L13-196). */

export interface Pan {
  x: number;
  y: number;
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Keep the zoomed image inside the viewport: at scale s the image overhangs by
 * ((s − 1) × size) / 2 on each axis, which is exactly how far it may travel.
 */
export function clampPan(pan: Pan, scale: number, size: { width: number; height: number }): Pan {
  const s = clampScale(scale);
  const maxX = Math.max(0, ((s - 1) * size.width) / 2);
  const maxY = Math.max(0, ((s - 1) * size.height) / 2);
  // `+ 0` normalises the -0 that Math.max(-0, negative) produces at scale 1
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, pan.y)) + 0,
  };
}

/** Double tap toggles between fit and 2.5×. */
export function nextTapScale(current: number): number {
  return current > MIN_SCALE + 0.01 ? MIN_SCALE : DOUBLE_TAP_SCALE;
}

/** Distance between two active pointers. */
export function pinchDistance(a: Pan, b: Pan): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Drag-to-dismiss fires past 100 px on either axis (only while un-zoomed). */
export function shouldDismiss(drag: Pan, threshold: number = LIGHTBOX_DISMISS_PX): boolean {
  return Math.abs(drag.x) >= threshold || Math.abs(drag.y) >= threshold;
}

/** Backdrop opacity tracks the dismiss drag: 1 at rest → 0 at the threshold. */
export function dismissOpacity(drag: Pan, threshold: number = LIGHTBOX_DISMISS_PX): number {
  const dist = Math.max(Math.abs(drag.x), Math.abs(drag.y));
  return Math.max(0, Math.min(1, 1 - dist / (threshold * 2)));
}
