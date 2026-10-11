/**
 * THE COURT IS DRAWN AT 2× PIXELS AT MOST (Majed, 2026-10-11: "2x looks good").
 *
 * expo-gl sizes a GLView's buffers to its LAYOUT times the screen's pixel
 * ratio, and there is no prop to ask for fewer. So on a denser screen (a 3×
 * iPhone, an Android phone at 2.625–3.5) the GLView is laid out SMALLER, at
 * MAX_RENDER_RATIO / ratio of its box, and scaled back up to fill the box by a
 * transform. The GPU draws and holds 2× pixels; the compositor stretches the
 * finished picture, which is the comparison Majed signed off (2.25× fewer
 * pixels than 3×, every buffer with them: colour, depth, MSAA samples). A
 * screen at 2× or below draws exactly as before.
 *
 * Centred, not pinned to a corner: the transform scales about the view's
 * centre, and a centred box needs no physical left/right, so RTL changes
 * nothing. Pure, so vitest runs it under plain node.
 */
export const MAX_RENDER_RATIO = 2;

/** How much smaller than its box the GLView is laid out: 1 = full size. */
export function glScaleFor(pixelRatio: number, max = MAX_RENDER_RATIO): number {
  if (!(pixelRatio > max)) return 1;
  return max / pixelRatio;
}

export interface GlBox {
  width: number;
  height: number;
  /** Offsets inside the box, dp: the smaller view sits centred in it. */
  start: number;
  top: number;
  /** The transform that scales it back up to the box. */
  scale: number;
}

/** The GLView's own box inside a `width` × `height` box, at `k` (glScaleFor). */
export function glBoxFor(width: number, height: number, k: number): GlBox {
  const w = width * k;
  const h = height * k;
  return { width: w, height: h, start: (width - w) / 2, top: (height - h) / 2, scale: 1 / k };
}

/** The buffer, device px, that expo-gl gives a GLView of `dp` at `pixelRatio`. */
export function bufferPx(dp: number, k: number, pixelRatio: number): number {
  return Math.round(dp * k * pixelRatio);
}
