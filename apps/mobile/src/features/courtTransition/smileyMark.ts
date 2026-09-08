/**
 * The smiley tennis ball, as three.js vector geometry — the mark on the racket
 * face.
 *
 * THE ARTWORK ITSELF LIVES IN ./smileyPaths, which carries its provenance, what
 * was dropped from the sticker, its four colours and the rule that the `d`
 * strings are verbatim and are never re-traced. Read that file before touching
 * the mark. This one only turns those strings into shapes.
 *
 * PAINT ORDER, IN THREE LAYERS AND NOT TWELVE. A flat vector illustration is an
 * ordered stack, and this one overlaps: the greens and creams are painted over
 * the windows of a navy silhouette, which is exactly what leaves the navy
 * showing as a ring, two eyes and a smile. Rendering that needs the order kept — but not twelve z
 * levels, because the overlaps were measured rather than assumed: paths 25-33
 * each cover part of the navy base and none touches another, path 34 touches
 * nothing at all, and only path 35 lands on a green. So the stack is INK, then
 * BALL and SEAM sharing one level, then INK_TOP: three layers, four draw calls,
 * and a decal thin enough to still sit under the perforations. The test
 * re-measures that rather than trusting this paragraph.
 *
 * PURE — three's curve/shape maths and nothing else, sharing `svgPath`'s
 * parser and its containment-depth nesting. No React, no react-native, no
 * material, mesh or scene code: the caller owns how the mark is filled, lit and
 * placed. That is what lets it be unit-tested under plain node.
 */
import * as THREE from 'three';
import { groupSubpaths, parseSvgPath } from './svgPath';
import {
  SMILEY_BALL_PATHS,
  SMILEY_CIRCLE,
  SMILEY_INK_PATHS,
  SMILEY_INK_TOP_PATHS,
  SMILEY_SEAM_PATHS,
} from './smileyPaths';

/**
 * Re-exported, not redeclared: the `d` strings live in ./smileyPaths, which is
 * free of three so the 2D loading-screen mark can read the same artwork. Every
 * existing importer of this module keeps working unchanged.
 */
export {
  SMILEY_VIEWBOX,
  SMILEY_INK_PATHS,
  SMILEY_BALL_PATHS,
  SMILEY_SEAM_PATHS,
  SMILEY_INK_TOP_PATHS,
  SMILEY_CIRCLE,
} from './smileyPaths';


/**
 * Artwork space → three's: centred on the ink's enclosing circle and y-flipped,
 * so the mark stands upright with that circle on the origin. SVG's y points
 * DOWN from a top-left origin and three's points UP; `scale` is metres per
 * artwork unit.
 */
const place =
  (scale: number) =>
  (p: THREE.Vector2): THREE.Vector2 =>
    new THREE.Vector2((p.x - SMILEY_CIRCLE.cx) * scale, (SMILEY_CIRCLE.cy - p.y) * scale);

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
      throw new Error(
        `smileyMark: parseSvgPath emitted a ${curve.type}, which mapPath cannot move`,
      );
  }
  out.currentPoint.copy(f(path.currentPoint));
  return out;
};

/**
 * The mark, ready for `new THREE.ShapeGeometry(shapes, n)`: its ink enclosed by
 * a circle of exactly `radius` centred on (0, 0), standing upright in three's
 * y-up space.
 *
 * The four groups come back separately because they are three colours and three
 * PAINT LAYERS — draw them in the order declared here, `ink` under `ball` and
 * `seam`, `inkTop` over both, and the ball reassembles. All are in the same
 * frame: no offset of the caller's own.
 */
export const buildSmileyShapes = (
  radius: number,
): { ink: THREE.Shape[]; ball: THREE.Shape[]; seam: THREE.Shape[]; inkTop: THREE.Shape[] } => {
  const f = place(radius / SMILEY_CIRCLE.r);
  const build = (data: readonly string[]): THREE.Shape[] =>
    groupSubpaths(data.flatMap((d) => parseSvgPath(d)).map((path) => mapPath(path, f)));
  return {
    ink: build(SMILEY_INK_PATHS),
    ball: build(SMILEY_BALL_PATHS),
    seam: build(SMILEY_SEAM_PATHS),
    inkTop: build(SMILEY_INK_TOP_PATHS),
  };
};
