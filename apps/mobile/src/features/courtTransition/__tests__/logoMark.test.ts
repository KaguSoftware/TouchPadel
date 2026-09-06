import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildLogoShapes,
  groupSubpaths,
  LOGO_BALL_PATHS,
  LOGO_VIEWBOX,
  LOGO_WORDMARK_PATHS,
  parseSvgPath,
} from '../logoMark';

/**
 * The counts below were MEASURED from the path data, not taken on trust:
 * 15 drawn wordmark subpaths (T 1, u 2, c 1, h 2, a 2, d 3, e 1, l 1, and 2 for
 * the swoosh + the P's counter) and 3 for the ball. Two of the wordmark strings
 * end with a lone trailing moveto that draws nothing; those are dropped, so a
 * naive count of "M" letters gives 17, not 15.
 */
const WORDMARK_SUBPATHS = 15;
const BALL_SUBPATHS = 3;

const subpathsOf = (data: readonly string[]): THREE.Path[] => data.flatMap((d) => parseSvgPath(d));

/** Where a subpath begins, in the extraction's own coordinates — its fingerprint. */
const startOf = (path: THREE.Path): string => path.curves[0]!.getPoint(0).toArray().join(',');

const boxOf = (shapes: readonly THREE.Shape[]): THREE.Box2 => {
  const box = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity),
  );
  for (const shape of shapes) for (const p of shape.getPoints(64)) box.expandByPoint(p);
  return box;
};

describe('the brand path data', () => {
  it('uses only the absolute M, L, C and Z', () => {
    // Not decoration: the parser is deliberately not a general SVG parser, so
    // an arc or a relative command appearing in a re-export must fail loudly
    // rather than be approximated.
    const letters = new Set<string>();
    for (const d of [...LOGO_WORDMARK_PATHS, ...LOGO_BALL_PATHS]) {
      for (const c of d.match(/[A-Za-z]/g) ?? []) letters.add(c);
    }
    expect([...letters].sort().join('')).toBe('CLMZ');
  });

  it('parses every path, and drops the two subpaths that draw nothing', () => {
    expect(LOGO_WORDMARK_PATHS).toHaveLength(9);
    expect(LOGO_BALL_PATHS).toHaveLength(3);
    expect(subpathsOf(LOGO_WORDMARK_PATHS)).toHaveLength(WORDMARK_SUBPATHS);
    expect(subpathsOf(LOGO_BALL_PATHS)).toHaveLength(BALL_SUBPATHS);
    // The letter-by-letter split, so a re-export that loses a counter is named
    // rather than merely counted: T u c h a d e l, then swoosh + P counter.
    expect(LOGO_WORDMARK_PATHS.map((d) => parseSvgPath(d).length)).toEqual([
      1, 2, 1, 2, 2, 3, 1, 1, 2,
    ]);
    expect(LOGO_BALL_PATHS.map((d) => parseSvgPath(d).length)).toEqual([1, 1, 1]);
    // The trailing movetos: 17 "M" letters in the strings, 15 drawn subpaths.
    const moveTos = LOGO_WORDMARK_PATHS.join(' ').match(/M/g) ?? [];
    expect(moveTos).toHaveLength(WORDMARK_SUBPATHS + 2);
  });

  it('keeps curves as curves — no subpath is pre-flattened to a polyline', () => {
    const curved = subpathsOf(LOGO_WORDMARK_PATHS).flatMap((p) =>
      p.curves.filter((c) => c instanceof THREE.CubicBezierCurve),
    );
    expect(curved.length).toBeGreaterThan(100);
    // The "l" is a plain rectangle and must stay one: straight where straight.
    const bar = parseSvgPath(LOGO_WORDMARK_PATHS[7]!)[0]!;
    expect(bar.curves.every((c) => c instanceof THREE.LineCurve)).toBe(true);
  });
});

describe('parseSvgPath', () => {
  it('reads the repeated-coordinate form and the implicit lineto after M', () => {
    const [path] = parseSvgPath('M 0 0 1 0 L 1 1 0 1 Z');
    expect(path!.curves).toHaveLength(4); // 0,0 → 1,0 → 1,1 → 0,1 → close
    expect(path!.curves.every((c) => c instanceof THREE.LineCurve)).toBe(true);
  });

  it('refuses anything the brand extraction does not contain', () => {
    expect(() => parseSvgPath('M 0 0 l 1 1')).toThrow(/unsupported path command "l"/);
    expect(() => parseSvgPath('M 0 0 A 1 1 0 0 1 2 2')).toThrow(/unsupported path command "A"/);
    expect(() => parseSvgPath('L 1 1')).toThrow(/before any moveto/);
    expect(() => parseSvgPath('M 0 0 L 1')).toThrow(/wants a number/);
    expect(() => parseSvgPath('M 0 0 $')).toThrow(/unreadable character/);
  });
});

describe('grouping by containment depth', () => {
  const subpaths = subpathsOf(LOGO_WORDMARK_PATHS);
  const shapes = groupSubpaths(subpaths);
  const holes = shapes.flatMap((s) => s.holes);

  it('finds the counters and nothing else', () => {
    // MEASURED: exactly 2 of the 15 wordmark subpaths sit inside another — the
    // bowl of the "d" and the loop of the "P". The "a" and the "e" are drawn as
    // open unions by this extraction, not as outline-plus-counter, so they
    // contribute no holes; that is the artwork, not a miss.
    expect(holes).toHaveLength(2);
    expect(shapes).toHaveLength(WORDMARK_SUBPATHS - 2);
    expect(shapes.length + holes.length).toBe(subpaths.length);
    expect(groupSubpaths(subpathsOf(LOGO_BALL_PATHS))).toHaveLength(BALL_SUBPATHS);
  });

  it('makes the P-loop counter a hole OF the swoosh, not a shape of its own', () => {
    const swoosh = shapes.find((s) => startOf(s) === '229.03,15.78');
    expect(swoosh).toBeDefined();
    expect(swoosh!.holes.map(startOf)).toEqual(['215.7,35.48']);
    // The "d": stem and bowl are two shapes, the bowl carrying the counter.
    const bowl = shapes.find((s) => startOf(s) === '318.95,25.29');
    expect(bowl!.holes.map(startOf)).toEqual(['321.19,32.17']);
  });

  it('never returns a hole as a top-level shape', () => {
    const holeStarts = new Set(holes.map(startOf));
    expect(holeStarts.size).toBe(holes.length);
    for (const shape of shapes) expect(holeStarts.has(startOf(shape))).toBe(false);
    // Shapes and holes partition the parsed subpaths: nothing lost, nothing twice.
    expect([...shapes.map(startOf), ...holes.map(startOf)].sort()).toEqual(
      subpaths.map(startOf).sort(),
    );
  });

  it('is not fooled by the overlapping unions the letters are drawn as', () => {
    // The stem of the "u" is a rectangle laid across the bowl and the "h" is
    // built the same way — a single sampled point can land inside a neighbour,
    // so both halves must still come back as separate ink, never as a hole.
    expect(shapes.filter((s) => ['105.88,25.43', '93.57,41.93'].includes(startOf(s)))).toHaveLength(
      2,
    );
    expect(
      shapes.filter((s) => ['150.55,13.96', '172.02,39.02'].includes(startOf(s))),
    ).toHaveLength(2);
  });
});

describe('buildLogoShapes', () => {
  const RADIUS = 12;
  const built = buildLogoShapes(RADIUS);

  /**
   * One rounding step of the extraction (2 dp), in the built mark's units — the
   * tolerance every measurement here is held to.
   *
   * The artwork's coordinates were rounded to 2 dp on the way in, so the ink
   * meets its enclosing circle to within that rounding and not to 1e-9. A reach
   * is bounded by two rounded coordinates, and the stack's own offset adds a
   * third, so a few steps of slack is the honest figure. It is still orders of
   * magnitude tighter than the drift any wrong transform gives — a missing flip,
   * a stray offset, the wrong axis scaled.
   */
  const STEP = (0.01 / LOGO_VIEWBOX.width) * RADIUS;

  it('fills a circle of exactly `radius`, centred on the origin', () => {
    // The contract is a RADIUS, not a width. The face is a circle, so the
    // question it asks the mark is how big a circle the ink fills — and the
    // stacked lockup's bounding box holds no ink in its corners, which is why
    // fitting the box was costing 9.7 % for nothing.
    const ink = [...built.wordmark, ...built.ball].flatMap((s) => s.getPoints(24));
    const reach = Math.max(...ink.map((p) => Math.hypot(p.x, p.y)));
    // Tight: the ink TOUCHES the circle, so this is not merely "fits inside".
    expect(reach).toBeGreaterThan(RADIUS - 8 * STEP);
    expect(reach).toBeLessThanOrEqual(RADIUS + 8 * STEP);
  });

  it('is the STACKED lockup — Touch above, Padel below', () => {
    // The rearrangement is the whole point of the stack, so pin it. The ball is
    // the "o" of Touch and belongs to the upper line; the P's descender is the
    // lowest ink on the mark.
    const ballBox = boxOf(built.ball);
    expect(ballBox.min.y).toBeGreaterThan(0);
    const markBox = boxOf(built.wordmark);
    expect(markBox.min.y).toBeLessThan(0);
    // Two lines, not one: the gap between the ball's line and the lowest ink is
    // most of the mark's height. A single-line lockup could not do this.
    expect(ballBox.min.y - markBox.min.y).toBeGreaterThan(0.5 * (markBox.max.y - markBox.min.y));
  });

  it('scales linearly — the caller sizes the mark, never rescales the data', () => {
    const twice = boxOf(buildLogoShapes(2 * RADIUS).wordmark).getSize(new THREE.Vector2());
    const once = boxOf(built.wordmark).getSize(new THREE.Vector2());
    expect(twice.x / once.x).toBeCloseTo(2, 12);
    expect(twice.y / once.y).toBeCloseTo(2, 12);
  });

  it('stands upright in the y-up space three works in', () => {
    // In the SVG the top of the "T" is the SMALLEST y and the tail of the
    // P-loop the largest; the flip reverses that, so getting it backwards
    // renders the lockup upside down. Keyed on the ball rather than on the
    // leftmost shape: stacking moves the second line left, so the leftmost ink
    // is now the swoosh's tail, not the "T".
    const ballTop = boxOf(built.ball).max.y;
    expect(ballTop).toBeGreaterThan(0);
    const tail = boxOf(built.wordmark).min.y;
    expect(tail).toBeLessThan(0);
    // The tail is a descender on the LOWER line, so it reaches further below the
    // centre than the ball on the upper line reaches above it.
    expect(Math.abs(tail)).toBeGreaterThan(ballTop);
  });

  it('holes come through the move into three-space intact', () => {
    expect(built.wordmark.flatMap((s) => s.holes)).toHaveLength(2);
    // A hole must sit inside its shape's box, or the transform was applied to
    // the outlines and not to their counters.
    for (const shape of built.wordmark) {
      const outer = boxOf([shape]);
      for (const hole of shape.holes) {
        for (const p of hole.getPoints(16)) expect(outer.containsPoint(p)).toBe(true);
      }
    }
  });

  it('feeds THREE.ShapeGeometry — the mark triangulates with its counters open', () => {
    const geometry = new THREE.ShapeGeometry([...built.wordmark, ...built.ball], 8);
    const position = geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(0);
    expect(geometry.index!.count % 3).toBe(0);
    // Every vertex lands inside the box the mark declares.
    for (let i = 0; i < position.count; i++) {
      // The bound is the enclosing CIRCLE — the shape the face actually has.
      expect(Math.hypot(position.getX(i), position.getY(i))).toBeLessThanOrEqual(RADIUS + STEP);
      expect(position.getZ(i)).toBe(0);
    }
  });
});
