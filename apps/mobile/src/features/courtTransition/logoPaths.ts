/**
 * THE TOUCH PADEL WORDMARK AND BALL, as vector path data — and nothing else.
 *
 * The artwork is the brand's own, not a redraw: `docs/brand/identity.pdf` page
 * 3 was lifted with pdftocairo, the resulting outlines translated so the mark's
 * bounding box starts at (0, 0) and the coordinates rounded to 2 dp. That
 * extraction was rasterised and diffed against the brand file's own render — it
 * reproduces the logo exactly — so the `d` strings below are VERBATIM and must
 * never be re-traced, simplified or "improved". Any change to the mark starts
 * at the PDF again.
 *
 * FREE OF THREE, ON PURPOSE. Two renderers read these strings: the three.js
 * geometry builder in logoMark.ts (the racket decal, the court transition) and
 * react-native-svg on the boot loading screen (components/LogoMark.tsx). The
 * loading screen is the FIRST frame the app paints, and reaching the strings
 * through logoMark.ts would put three.js on that path — so the data lives
 * here, importing nothing, and logoMark.ts re-exports it. The same split, for
 * the same reason, as smileyPaths.ts / smileyMark.ts.
 *
 * FILL RULE: nonzero, the SVG default — and the only one that draws this mark
 * right. The u, h and a are unions of same-winding overlapping subpaths (a
 * stem over a curve), which evenodd would punch false holes into; the d's
 * bowl counter and the P's loop wind opposite to their outers, which nonzero
 * cuts out on its own. logoPaths.test.ts measures the windings.
 *
 * The lockup's frame is 385.137 × 141.973 units — the same crop, to within
 * 0.07 %, as assets/logo-white.png (900 × 332), which is the native splash
 * image. Drawn at the splash's width these paths ARE the splash, pixel for
 * pixel; that is what lets the loading screen start on a frame identical to
 * the one the OS was showing.
 */

/**
 * The extraction's frame, in its own units. This is the artwork's bounding box
 * before the path coordinates were rounded, so the drawn outlines fill it to
 * within one rounding step (measured: 385.140 x 141.9663) — near enough that
 * the mark's frame and its ink share a centre, far enough that "exactly" is a
 * word for the tolerance in the tests, not for an equality.
 */
export const LOGO_VIEWBOX = { width: 385.137, height: 141.973 } as const;

/**
 * The wordmark: one `d` string per drawn element, in the extraction's order —
 * the letters T u c h a d e l, then the swoosh that sweeps up out of the word
 * and closes into the "P". That last string holds two subpaths; the second is
 * the counter inside the P, and `groupSubpaths` is what makes it a hole.
 * The "o" is not here — it is the ball, below.
 */
export const LOGO_WORDMARK_PATHS: readonly string[] = Object.freeze([
  // the "T"
  'M 0 14.32 L 32.72 14.32 L 32.72 21.59 L 20.75 21.59 L 20.75 55.46 L 11.91 55.46 L 11.91 21.59 L 0 21.59',
  // the "u"
  'M 105.88 25.43 L 114.44 25.43 L 114.44 55.46 L 105.88 55.46 Z M 93.57 41.93 C 93.57 43.87 94.08 45.4 95.09 46.52 C 96.09 47.64 97.47 48.2 99.23 48.2 C 101.31 48.16 102.95 47.39 104.12 45.9 C 105.29 44.41 105.88 42.53 105.88 40.25 L 107.95 40.25 C 107.95 43.76 107.45 46.66 106.47 48.95 C 105.48 51.24 104.08 52.95 102.27 54.07 C 100.47 55.19 98.31 55.77 95.81 55.8 C 93.57 55.8 91.66 55.32 90.05 54.38 C 88.45 53.43 87.2 52.09 86.31 50.38 C 85.41 48.66 84.96 46.63 84.96 44.28 L 84.96 25.43 L 93.57 25.43',
  // the "c"
  'M 140.86 35.39 C 140.07 34.38 139.1 33.6 137.95 33.04 C 136.79 32.48 135.47 32.2 133.98 32.2 C 132.59 32.2 131.36 32.54 130.28 33.23 C 129.2 33.93 128.35 34.89 127.74 36.14 C 127.12 37.39 126.82 38.86 126.82 40.53 C 126.82 42.18 127.12 43.63 127.74 44.89 C 128.35 46.16 129.2 47.14 130.28 47.83 C 131.36 48.52 132.59 48.87 133.98 48.87 C 135.5 48.87 136.86 48.58 138.06 48 C 139.25 47.42 140.22 46.55 140.97 45.4 L 146.89 49.31 C 145.63 51.36 143.85 52.95 141.56 54.07 C 139.26 55.19 136.6 55.75 133.58 55.75 C 130.52 55.75 127.84 55.11 125.53 53.84 C 123.22 52.58 121.42 50.8 120.13 48.5 C 118.84 46.21 118.2 43.55 118.2 40.53 C 118.2 37.48 118.84 34.79 120.13 32.48 C 121.42 30.17 123.23 28.37 125.56 27.08 C 127.89 25.8 130.56 25.15 133.58 25.15 C 136.49 25.15 139.07 25.68 141.3 26.75 C 143.54 27.81 145.33 29.31 146.67 31.25',
  // the "h"
  'M 172.02 39.02 C 172.02 37.05 171.49 35.5 170.43 34.38 C 169.37 33.26 167.92 32.7 166.09 32.7 C 163.93 32.74 162.23 33.5 161 35 C 159.77 36.49 159.16 38.37 159.16 40.64 L 157.04 40.64 C 157.04 37.14 157.54 34.24 158.54 31.95 C 159.55 29.65 161 27.94 162.88 26.8 C 164.76 25.66 166.99 25.09 169.56 25.09 C 171.84 25.09 173.8 25.57 175.46 26.52 C 177.12 27.47 178.4 28.8 179.29 30.52 C 180.19 32.24 180.64 34.27 180.64 36.62 L 180.64 55.46 L 172.02 55.46 Z M 150.55 13.96 L 159.16 13.96 L 159.16 55.46 L 150.55 55.46 Z M 150.55 13.96',
  // the "a"
  'M 292.6 37.04 C 292.6 35.39 292.07 34.11 291 33.18 C 289.94 32.25 288.38 31.78 286.34 31.78 C 284.99 31.78 283.56 32.01 282.03 32.48 C 280.5 32.94 278.95 33.61 277.39 34.46 L 274.7 28.87 C 276.19 28.09 277.64 27.43 279.07 26.91 C 280.48 26.39 281.94 25.99 283.43 25.71 C 284.92 25.43 286.54 25.29 288.29 25.29 C 292.35 25.29 295.49 26.24 297.69 28.14 C 299.89 30.04 301.01 32.67 301.04 36.03 L 301.1 55.66 L 292.65 55.66 Z M 285.83 42.63 C 284.19 42.63 282.96 42.91 282.14 43.46 C 281.32 44.03 280.91 44.92 280.91 46.15 C 280.91 47.34 281.33 48.29 282.16 48.98 C 283 49.66 284.15 50.01 285.61 50.01 C 286.88 50.01 288 49.8 288.99 49.37 C 289.98 48.94 290.8 48.36 291.45 47.63 C 292.11 46.91 292.5 46.06 292.65 45.09 L 293.94 49.9 C 293.08 51.91 291.74 53.44 289.92 54.48 C 288.09 55.53 285.85 56.05 283.2 56.05 C 281.08 56.05 279.24 55.64 277.69 54.82 C 276.14 54 274.95 52.88 274.12 51.46 C 273.28 50.05 272.86 48.45 272.86 46.66 C 272.86 43.86 273.84 41.66 275.82 40.05 C 277.8 38.45 280.63 37.63 284.32 37.59 L 293.49 37.59 L 293.49 42.63',
  // the "d"
  'M 328.68 14.16 L 337.24 14.16 L 337.24 55.66 L 328.68 55.66 Z M 321.19 32.17 C 319.7 32.17 318.38 32.54 317.24 33.26 C 316.11 33.99 315.22 35 314.59 36.31 C 313.95 37.61 313.62 39.11 313.58 40.78 C 313.62 42.42 313.95 43.89 314.59 45.17 C 315.22 46.46 316.11 47.46 317.24 48.19 C 318.38 48.92 319.7 49.29 321.19 49.29 C 322.64 49.29 323.93 48.92 325.07 48.19 C 326.21 47.46 327.1 46.46 327.73 45.17 C 328.36 43.89 328.68 42.42 328.68 40.78 C 328.68 39.07 328.36 37.57 327.73 36.28 C 327.1 34.99 326.21 33.99 325.07 33.26 C 323.93 32.54 322.64 32.17 321.19 32.17 M 318.95 25.29 C 321.6 25.29 323.85 25.91 325.72 27.16 C 327.58 28.41 329.02 30.17 330.02 32.45 C 331.03 34.72 331.54 37.43 331.54 40.56 C 331.54 43.73 331.04 46.47 330.05 48.78 C 329.06 51.09 327.65 52.88 325.8 54.12 C 323.95 55.37 321.75 56 319.18 56 C 316.34 56 313.85 55.35 311.7 54.07 C 309.56 52.78 307.91 50.97 306.73 48.64 C 305.55 46.31 304.97 43.6 304.97 40.5 C 304.97 37.48 305.55 34.83 306.73 32.56 C 307.91 30.29 309.53 28.5 311.63 27.22 C 313.71 25.93 316.16 25.29 318.95 25.29',
  // the "e"
  'M 363.49 38.21 C 363.45 36.83 363.16 35.65 362.62 34.66 C 362.08 33.67 361.31 32.89 360.3 32.34 C 359.29 31.78 358.14 31.5 356.83 31.5 C 355.38 31.5 354.11 31.87 353.03 32.62 C 351.95 33.36 351.11 34.39 350.51 35.69 C 349.91 37 349.62 38.51 349.62 40.22 C 349.62 42.16 349.95 43.82 350.62 45.2 C 351.3 46.58 352.25 47.64 353.48 48.39 C 354.71 49.13 356.12 49.51 357.73 49.51 C 360.64 49.51 363.17 48.43 365.34 46.26 L 369.86 50.74 C 368.38 52.41 366.54 53.7 364.36 54.6 C 362.17 55.49 359.72 55.94 357 55.94 C 353.79 55.94 351.01 55.3 348.66 54.04 C 346.32 52.77 344.5 50.99 343.21 48.7 C 341.92 46.4 341.29 43.75 341.29 40.73 C 341.29 37.63 341.93 34.94 343.24 32.64 C 344.54 30.35 346.36 28.57 348.7 27.3 C 351.02 26.04 353.72 25.38 356.77 25.34 C 360.32 25.34 363.22 26.08 365.47 27.55 C 367.73 29.03 369.37 31.1 370.39 33.76 C 371.42 36.43 371.8 39.59 371.54 43.24 L 348.39 43.24 L 348.39 38.21',
  // the "l"
  'M 376.53 55.66 L 385.14 55.66 L 385.14 14.16 L 376.53 14.16 Z M 376.53 55.66',
  // the swoosh, and the loop of the "P" it closes into
  'M 229.03 15.78 C 221.77 18.09 214.76 22.84 208.91 29.59 C 202.16 37.37 198.1 46.24 195.78 55.09 C 194.28 60.83 193.5 66.57 193.22 71.99 C 193.11 73.92 193.07 75.8 193.07 77.62 C 174.18 78.04 154.74 75.45 138.54 72.27 C 100.73 64.88 64.42 51.25 45.22 41.05 L 41 48.98 C 60.79 59.5 98.09 73.52 136.81 81.1 C 153.58 84.38 173.71 87.04 193.47 86.57 C 195.1 105.86 201.73 126 211.72 141.97 L 219.34 137.21 C 210.18 122.55 203.91 104.11 202.38 86.13 C 202.74 86.1 203.1 86.07 203.47 86.04 C 213.95 85.18 224.16 83.29 233.48 79.95 C 237.55 78.51 241.46 76.78 245.15 74.77 C 262.25 65.38 268.27 51.95 267.23 40.2 C 266.95 36.83 266.07 33.61 264.7 30.65 C 260.56 21.69 252.74 15.79 243.25 14.45 C 241.88 14.26 240.5 14.16 239.1 14.16 C 235.75 14.16 232.37 14.71 229.03 15.78 M 215.7 35.48 C 222.52 27.61 231.06 23.15 239.08 23.15 C 240.06 23.15 241.04 23.21 242 23.35 C 248.5 24.27 253.66 28.2 256.54 34.41 C 261.79 45.8 255.48 58.84 240.83 66.89 C 229.65 73.01 216.17 76.09 202.02 77.18 C 202.11 61.32 206.23 46.41 215.7 35.48',
]);

/**
 * The ball: the tennis-ball "o" of "Touch", three arcs that interlock into the
 * seam. Held apart from the wordmark because the transition flies it out of the
 * word; drawn where it lies, it closes the word back up.
 */
export const LOGO_BALL_PATHS: readonly string[] = Object.freeze([
  // the ball, arc 1 of 3
  'M 40.32 22.57 C 39.64 19.54 39.71 16.3 40.67 13.12 C 42.51 7.07 47.16 2.66 52.77 0.88 C 54.25 4.16 54.6 7.98 53.48 11.7 C 51.62 17.8 46.29 21.93 40.32 22.57',
  // the ball, arc 2 of 3
  'M 60.16 36.91 C 57.81 37.14 55.38 36.92 53 36.19 C 47.44 34.5 43.26 30.44 41.24 25.46 C 48.13 24.5 54.2 19.65 56.34 12.56 C 57.63 8.34 57.31 3.99 55.72 0.19 C 58.32 -0.18 61.06 -0.01 63.74 0.8 C 69.52 2.56 73.82 6.91 75.75 12.17 C 68.51 12.85 62.04 17.8 59.8 25.18 C 58.59 29.17 58.8 33.27 60.16 36.91',
  // the ball, arc 3 of 3
  'M 76.06 23.87 C 74.14 30.2 69.13 34.75 63.16 36.36 C 61.86 33.19 61.59 29.57 62.66 26.05 C 64.59 19.68 70.27 15.49 76.55 15.12 C 77.07 17.95 76.95 20.93 76.06 23.87',
]);

/**
 * The ball's disc, in the same frame as everything else.
 *
 * THE SEAMS ARE NOT DRAWN. The three arcs above do not overlap: they interlock
 * with two curved GAPS between them, and on the brand's white page the page
 * itself is the seam. That works everywhere the mark is printed on white and
 * nowhere else — dropped straight onto the racket's blue plate the gaps went
 * blue, the three arcs merged into one lime lozenge, and the tennis ball
 * stopped being a tennis ball (which is what "it shouldn't be just a mark, it
 * should be the logo" was pointing at, 2026-09-05).
 *
 * So the seam needs a ground of its own wherever the backing is not white. The
 * three arcs inscribe a circle to within 0.01 units (bbox 36.99 x 37.00), which
 * is the tell that this is the ball's true outline rather than a rectangle
 * fitted round it: centre (58.37, 18.50), radius 18.50. Draw this disc in the
 * seam colour, the three arcs over it, and the ball reads as it does on paper.
 */
export const LOGO_BALL_CIRCLE = { cx: 58.37, cy: 18.5, r: 18.5 } as const;

/**
 * The ball's own svg box: its circle padded by one unit a side, because the
 * arcs' control points reach a hair past the circle (y −0.18, x 77.07) and a
 * viewBox cut exactly on it clips them.
 */
export const LOGO_BALL_PAD = 1;

/** `viewBox` for an svg that draws only the ball, framed on LOGO_BALL_CIRCLE. */
export function logoBallViewBox(): string {
  const { cx, cy, r } = LOGO_BALL_CIRCLE;
  const s = r + LOGO_BALL_PAD;
  return `${cx - s} ${cy - s} ${2 * s} ${2 * s}`;
}

/**
 * Where everything lands, in points, when the lockup is drawn `width` wide:
 * the mark's height, and the ball's svg box (`start`/`top`/`size`, padded as
 * logoBallViewBox is) plus its true centre and diameter. All the loading
 * screen needs to lay a separately-animated ball over the wordmark exactly
 * where the brand drew the "o".
 */
export function logoFrame(width: number): {
  scale: number;
  height: number;
  ball: {
    size: number;
    start: number;
    top: number;
    centreX: number;
    centreY: number;
    diameter: number;
  };
} {
  const scale = width / LOGO_VIEWBOX.width;
  const { cx, cy, r } = LOGO_BALL_CIRCLE;
  const s = r + LOGO_BALL_PAD;
  return {
    scale,
    height: LOGO_VIEWBOX.height * scale,
    ball: {
      size: 2 * s * scale,
      start: (cx - s) * scale,
      top: (cy - s) * scale,
      centreX: cx * scale,
      centreY: cy * scale,
      diameter: 2 * r * scale,
    },
  };
}
