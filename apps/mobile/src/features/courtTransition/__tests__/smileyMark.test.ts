import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildSmileyShapes,
  SMILEY_BALL_PATHS,
  SMILEY_CIRCLE,
  SMILEY_INK_PATHS,
  SMILEY_INK_TOP_PATHS,
  SMILEY_SEAM_PATHS,
  SMILEY_VIEWBOX,
} from '../smileyMark';
import { parseSvgPath } from '../svgPath';

const ALL = [
  ...SMILEY_INK_PATHS,
  ...SMILEY_BALL_PATHS,
  ...SMILEY_SEAM_PATHS,
  ...SMILEY_INK_TOP_PATHS,
];

const subpathsOf = (data: readonly string[]): THREE.Path[] => data.flatMap((d) => parseSvgPath(d));

/** Every point the built shapes draw, holes included — the ink, not its box. */
const pointsOf = (groups: readonly THREE.Shape[][]): THREE.Vector2[] => {
  const out: THREE.Vector2[] = [];
  for (const shapes of groups)
    for (const shape of shapes) {
      out.push(...shape.getPoints(64));
      for (const hole of shape.holes) out.push(...hole.getPoints(64));
    }
  return out;
};

describe('the smiley path data', () => {
  it('uses only the absolute M, L, C and Z', () => {
    // Not decoration: the parser is deliberately not a general SVG parser, so
    // an arc or a relative command appearing in a re-export must fail loudly
    // rather than be quietly approximated.
    const letters = new Set<string>();
    for (const d of ALL) for (const c of d.match(/[A-Za-z]/g) ?? []) letters.add(c);
    expect([...letters].sort().join('')).toBe('CLMZ');
  });

  it('is the sticker sheet WITHOUT its halo: twelve paths, 23 drawn subpaths', () => {
    // The PDF page carries 36 paths. The first 24 are the die-cut sticker's
    // white halo — the same twelve shapes stroke-expanded and painted under
    // them — and a racket face is not a sticker, so only these twelve are here.
    expect(ALL).toHaveLength(12);
    expect(subpathsOf(ALL)).toHaveLength(23);
    // The split, named rather than merely counted, so a re-export that loses a
    // window or a seam lands here: the navy is ONE path of eleven subpaths, the
    // felt six paths, the seams four, and the eye that goes back on top one.
    expect(SMILEY_INK_PATHS.map((d) => parseSvgPath(d).length)).toEqual([11]);
    expect(SMILEY_BALL_PATHS.map((d) => parseSvgPath(d).length)).toEqual([2, 1, 1, 1, 1, 1]);
    expect(SMILEY_SEAM_PATHS.map((d) => parseSvgPath(d).length)).toEqual([1, 1, 1, 1]);
    expect(SMILEY_INK_TOP_PATHS.map((d) => parseSvgPath(d).length)).toEqual([1]);
  });

  it('starts at the origin, and is a ball rather than a box', () => {
    // The extraction was translated so the drawn ink's bounding box starts at
    // (0, 0) and rounded to 2 dp, so the outlines fill the declared frame to
    // within one rounding step.
    const box = new THREE.Box2(
      new THREE.Vector2(Infinity, Infinity),
      new THREE.Vector2(-Infinity, -Infinity),
    );
    for (const path of subpathsOf(ALL)) for (const p of path.getPoints(64)) box.expandByPoint(p);
    expect(box.min.x).toBeCloseTo(0, 1);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.x).toBeCloseTo(SMILEY_VIEWBOX.width, 1);
    expect(box.max.y).toBeCloseTo(SMILEY_VIEWBOX.height, 1);
    // …and it is very nearly square, which is the tell that the enclosing
    // circle and not this box is the honest measure of the mark.
    expect(Math.abs(box.max.x - box.max.y) / box.max.x).toBeLessThan(0.01);
  });
});

describe('buildSmileyShapes', () => {
  const RADIUS = 0.1119; // what the racket face has room for
  const built = buildSmileyShapes(RADIUS);

  it('nests the counters rather than filling them in', () => {
    // ELEVEN counters, and the shape of the artwork is in where they are. The
    // navy is not a ring and some features: it is one disc with the felt's ten
    // windows cut out of it, and what is left between them IS the ring, the
    // eyes and the smile. Fill those windows in and the mark is a navy blob.
    expect(built.ink).toHaveLength(1);
    expect(built.ink[0]!.holes).toHaveLength(10);
    // The felt's big left field carries the left eye as its own counter, which
    // is why the eye has to be painted back over it — see `inkTop`.
    expect(built.ball).toHaveLength(6);
    expect(built.ball.reduce((n, s) => n + s.holes.length, 0)).toBe(1);
    expect(built.seam).toHaveLength(4);
    expect(built.seam.every((s) => s.holes.length === 0)).toBe(true);
    expect(built.inkTop).toHaveLength(1);
    expect(built.inkTop[0]!.holes).toHaveLength(0);
  });

  it('fills a circle of exactly the radius asked for, centred on the origin', () => {
    // The caller passes the radius it has room for because a round face asks
    // only that question. Tight on BOTH sides: a mark that merely fits is not
    // the same as a mark that fills, and on a ball the two are one question.
    //
    // To five places, not more: SMILEY_CIRCLE.r is written to 3 dp of artwork
    // units, so the built ink reaches 0.111899 rather than 0.111900 — one part
    // in 87,000, or 5 nm of model. Tighter than that would be testing the
    // constant's rounding rather than the mark's size.
    const reach = pointsOf([built.ink, built.ball, built.seam, built.inkTop]).map((p) =>
      p.length(),
    );
    expect(Math.max(...reach)).toBeCloseTo(RADIUS, 5);
    // …and the ink SURROUNDS the origin rather than merely reaching it, which
    // is what "centred" has to mean for a mark whose caller only positions a
    // group. Every side of the navy's box lands between 95 % and 100 % of the
    // radius (the circle is minimal, so it touches the ink at a few points and
    // stands off it everywhere else), and the box's centre sits within 2 % of
    // the origin. A mark pinned by a corner would fail both.
    const box = new THREE.Box2(
      new THREE.Vector2(Infinity, Infinity),
      new THREE.Vector2(-Infinity, -Infinity),
    );
    for (const p of pointsOf([built.ink])) box.expandByPoint(p);
    for (const side of [-box.min.x, box.max.x, -box.min.y, box.max.y]) {
      expect(side).toBeGreaterThan(0.95 * RADIUS);
      expect(side).toBeLessThanOrEqual(RADIUS);
    }
    expect(Math.abs(box.min.x + box.max.x) / 2).toBeLessThan(0.02 * RADIUS);
    expect(Math.abs(box.min.y + box.max.y) / 2).toBeLessThan(0.02 * RADIUS);
  });

  it('scales linearly, and stands upright rather than mirrored', () => {
    const twice = buildSmileyShapes(2 * RADIUS);
    const at = (shapes: THREE.Shape[]): THREE.Vector2 => shapes[0]!.getPoints(64)[0]!;
    expect(at(twice.ink).x).toBeCloseTo(2 * at(built.ink).x, 9);
    expect(at(twice.ink).y).toBeCloseTo(2 * at(built.ink).y, 9);
    // SVG's y points DOWN and three's UP, so the flip is not cosmetic: the
    // smile has to be below the eyes. The eye painted back over the felt is the
    // LEFT one, and the artwork puts it above the ball's centre.
    const eye = pointsOf([built.inkTop]);
    expect(eye.every((p) => p.y > 0)).toBe(true);
    expect(eye.every((p) => p.x < 0)).toBe(true);
  });

  it('keeps the enclosing circle it declares', () => {
    // SMILEY_CIRCLE is what the scale divides by, so a wrong one silently
    // resizes the mark. Measured back out of the artwork units it came from.
    const k = RADIUS / SMILEY_CIRCLE.r;
    expect(SMILEY_CIRCLE.cx).toBeGreaterThan(0);
    expect(SMILEY_CIRCLE.cy).toBeGreaterThan(0);
    expect(SMILEY_CIRCLE.r * k).toBeCloseTo(RADIUS, 9);
    // The circle encloses the box's centre and is no smaller than the box's
    // half-diagonal would allow a circle to be — i.e. it really is enclosing.
    expect(SMILEY_CIRCLE.r).toBeGreaterThan(SMILEY_VIEWBOX.width / 2);
    expect(SMILEY_CIRCLE.r).toBeLessThan(
      Math.hypot(SMILEY_VIEWBOX.width, SMILEY_VIEWBOX.height) / 2,
    );
  });
});
