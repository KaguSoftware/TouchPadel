/**
 * The Touch Padel wordmark and ball, as three.js vector geometry.
 *
 * The artwork is the brand's own, not a redraw: `docs/brand/identity.pdf` page
 * 3 was lifted with pdftocairo, the resulting outlines translated so the mark's
 * bounding box starts at (0, 0) and the coordinates rounded to 2 dp. That
 * extraction was rasterised and diffed against the brand file's own render — it
 * reproduces the logo exactly — so the `d` strings (in logoPaths.ts, free of
 * three so the loading screen can draw them too) are VERBATIM and must never
 * be re-traced, simplified or "improved". Any change to the mark starts at the
 * PDF again.
 *
 * PURE — three's curve/shape maths and nothing else. No React, no react-native,
 * no material, mesh or scene code: the caller owns how the mark is filled, lit
 * and placed, this module only says what shape it is. That is what lets it be
 * unit-tested under plain node — vitest.config.ts collects only the `__tests__`
 * folders under `src/`, and only modules that import no react-native or expo.
 *
 * WHY SHAPES AND NOT A TEXTURE. The transition zooms the mark across most of
 * the screen; a raster would have to ship at the largest size it is ever drawn
 * and would still soften on a 3x panel. Curves stay curves here — `parseSvgPath`
 * emits `CubicBezierCurve`s, never a pre-flattened polyline — so the caller
 * chooses the tessellation at build time (`new THREE.ShapeGeometry(shapes, n)`)
 * and pays for exactly the smoothness it needs.
 *
 * THE COORDINATE FLIP. SVG's y points DOWN from a top-left origin; three's
 * points UP. `buildLogoShapes` mirrors about the STACKED ink's own enclosing
 * circle (y_out = (STACK_CIRCLE.cy - y_in) * scale), which both stands the mark
 * upright and centres that circle on (0, 0) — the caller positions a group,
 * never an offset. It is the circle and not the viewBox's midline because the
 * lockup is two lines now and the face it sits on is round; see STACK_CIRCLE.
 *
 * VERIFIED AGAINST THE DATA (not assumed): the extraction uses only the
 * absolute commands M, L, C and Z; the wordmark's 9 `d` strings hold 15 drawn
 * subpaths and the ball's 3 hold 3; exactly 2 of those 18 are counters (the
 * one inside the bowl of the "d", and the one inside the loop of the "P").
 * Two of the wordmark strings end
 * with a lone trailing `M` — a moveto that draws nothing, an artefact of the
 * export — which the parser drops rather than emitting as an empty path.
 */
import * as THREE from 'three';
import { LOGO_BALL_CIRCLE, LOGO_BALL_PATHS, LOGO_WORDMARK_PATHS } from './logoPaths';
import { groupSubpaths, parseSvgPath } from './svgPath';

// Re-exported where they have always lived in this module's API: the parser
// moved to `svgPath` when `smileyMark` came to need it, not away.
export { groupSubpaths, parseSvgPath };

// The path data itself lives in logoPaths.ts (free of three, so the loading
// screen can draw it on the first frame) and is re-exported here where it has
// always been.
export { LOGO_BALL_CIRCLE, LOGO_BALL_PATHS, LOGO_VIEWBOX, LOGO_WORDMARK_PATHS } from './logoPaths';

/**
 * THE STACKED LOCKUP. "T(o)uch" over "Padel", rather than the single line the
 * brand file draws — a lockup that does NOT exist in identity.pdf, made here on
 * the owner's instruction (2026-09-05, "make the logo bolder and more obvious"
 * → stack it) and knowingly: it is new brand artwork and wants a designer's eye
 * before it travels anywhere off this racket.
 *
 * It is a rearrangement, never a redraw. Every glyph is the brand's own outline
 * at the brand's own proportions; only the second line's POSITION is ours. The
 * split falls where the artwork already splits: the swoosh and the "P" of Padel
 * are one inseparable path (the swoosh sweeps up into the P's bowl), so the
 * groups can only be [T, o, u, c, h] and [swoosh+P, a, d, e, l].
 *
 * WHY IT IS WORTH DOING, and why it is worth less than it sounds. The face is a
 * circle and the horizontal lockup is a 2.71:1 strip, so most of what the strip
 * costs in enclosing radius is empty air above and below it. Stacking trades
 * that for height. Measured on the ink's own minimal enclosing circle rather
 * than on a bounding box — the box's corners hold no ink and were costing 9.7 %
 * on their own — the cap height goes from 0.02254 to 0.02674, +18.6 %. An
 * earlier estimate of +110 % was wrong and worth recording as wrong: it assumed
 * a squat two-line block, but the P's descender runs the full height of the
 * artwork, so the stack stays tall and the circle barely shrinks (193.7 → 173.0
 * artwork units).
 */
export const STACK_OFFSET = { x: -122.75, y: 52.64 } as const;

/**
 * The minimal circle enclosing the stacked ink, in artwork units — the shape
 * the face actually has to contain, so it is what `buildLogoShapes` scales by.
 * Fitting this instead of a bounding box is the free 9.7 % above.
 */
export const STACK_CIRCLE = { cx: 90.657, cy: 87.551, r: 172.979 } as const;

/** Artwork units from the "T"'s baseline to its cap — the size the eye reads. */
export const CAP_HEIGHT = 41.34;

/**
 * Artwork space → three's: centred on the stacked ink's enclosing circle and
 * y-flipped, so the mark stands upright and its enclosing circle is centred on
 * the origin. `scale` is metres per artwork unit.
 */
const place =
  (scale: number) =>
  (p: THREE.Vector2): THREE.Vector2 =>
    new THREE.Vector2((p.x - STACK_CIRCLE.cx) * scale, (STACK_CIRCLE.cy - p.y) * scale);

/** Rebuild a subpath through `f`, curve for curve, so beziers survive the move. */
const mapPath = (path: THREE.Path, f: (p: THREE.Vector2) => THREE.Vector2): THREE.Path => {
  const out = new THREE.Path();
  for (const curve of path.curves) {
    if (curve instanceof THREE.CubicBezierCurve)
      out.curves.push(
        new THREE.CubicBezierCurve(f(curve.v0), f(curve.v1), f(curve.v2), f(curve.v3)),
      );
    else if (curve instanceof THREE.LineCurve)
      out.curves.push(new THREE.LineCurve(f(curve.v1), f(curve.v2)));
    else
      throw new Error(`logoMark: parseSvgPath emitted a ${curve.type}, which mapPath cannot move`);
  }
  out.currentPoint.copy(f(path.currentPoint));
  return out;
};

/**
 * The stacked mark, ready for `new THREE.ShapeGeometry(shapes, n)`: its ink
 * enclosed by a circle of exactly `radius` centred on (0, 0), standing upright
 * in three's y-up space. The caller passes the radius it has room for, which is
 * the question the face actually asks — see STACK_CIRCLE.
 *
 * Wordmark, ball and seam come back separately because they are three colours
 * and, in the transition, three movers: the ball is the "o" of Touch and flies
 * out of the word. All are in the SAME frame — draw them with no offset of your
 * own and they reassemble into the lockup.
 *
 * `ballSeam` is the disc from LOGO_BALL_CIRCLE and must be drawn UNDER `ball`,
 * in whatever colour the seam should be — see that constant for why the mark
 * cannot be dropped onto a non-white ground without it.
 */
export const buildLogoShapes = (
  radius: number,
): { wordmark: THREE.Shape[]; ball: THREE.Shape[]; ballSeam: THREE.Shape[] } => {
  const scale = radius / STACK_CIRCLE.r;
  const f = place(scale);
  // The second line carries STACK_OFFSET before it is placed; the first and the
  // ball sit where the brand drew them.
  const down = (p: THREE.Vector2): THREE.Vector2 =>
    f(new THREE.Vector2(p.x + STACK_OFFSET.x, p.y + STACK_OFFSET.y));
  const build = (data: readonly string[], move: (p: THREE.Vector2) => THREE.Vector2) =>
    groupSubpaths(data.flatMap((d) => parseSvgPath(d)).map((p) => mapPath(p, move)));
  // `place` is a uniform scale plus a y-flip, so the circle stays a circle:
  // move the centre through it and scale the radius, rather than flattening.
  const centre = f(new THREE.Vector2(LOGO_BALL_CIRCLE.cx, LOGO_BALL_CIRCLE.cy));
  const seam = new THREE.Shape();
  seam.absarc(centre.x, centre.y, LOGO_BALL_CIRCLE.r * scale, 0, Math.PI * 2, false);
  return {
    wordmark: [
      ...build(LOGO_WORDMARK_PATHS.slice(0, 4), f), // T u c h
      ...build(LOGO_WORDMARK_PATHS.slice(4), down), // a d e l, then swoosh + P
    ],
    ball: build(LOGO_BALL_PATHS, f),
    ballSeam: [seam],
  };
};
