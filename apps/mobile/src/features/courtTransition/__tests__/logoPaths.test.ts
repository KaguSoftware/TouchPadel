import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as geometry from '../logoMark';
import * as paths from '../logoPaths';
import { parseSvgPath } from '../svgPath';

const here = dirname(fileURLToPath(import.meta.url));

/** Signed area of a subpath — three's convention: positive is anticlockwise. */
const winding = (path: THREE.Path): number => Math.sign(THREE.ShapeUtils.area(path.getPoints(64)));

describe('the artwork/geometry split (2026-09-11)', () => {
  it('re-exports the very data logoPaths holds — one source, two renderers', () => {
    // Reference identity, so everything logoMark.test.ts measures about the
    // mark is measured about the strings the loading screen draws too.
    expect(geometry.LOGO_WORDMARK_PATHS).toBe(paths.LOGO_WORDMARK_PATHS);
    expect(geometry.LOGO_BALL_PATHS).toBe(paths.LOGO_BALL_PATHS);
    expect(geometry.LOGO_BALL_CIRCLE).toBe(paths.LOGO_BALL_CIRCLE);
    expect(geometry.LOGO_VIEWBOX).toBe(paths.LOGO_VIEWBOX);
  });

  it('keeps three out of logoPaths — it is imported by the FIRST frame', () => {
    // BootOverlay draws this mark before anything else paints; reaching the
    // strings through the geometry builder would put three.js in that path.
    const src = readFileSync(join(here, '../logoPaths.ts'), 'utf8');
    expect(src).not.toMatch(/from 'three'|require\('three'\)/);
    expect(src).not.toMatch(/^import /m);
  });
});

describe('the fill rule the svg renderer relies on', () => {
  // react-native-svg fills with nonzero by default and LogoMark.tsx passes no
  // `fillRule`. That is only right because of how the artwork winds, so the
  // windings are measured here rather than trusted: the letters made of
  // overlapping subpaths (u, h, a) wind the same way — a union — while the two
  // real counters (the bowl of the d, the loop of the P) wind against their
  // outers — holes. Under evenodd the unions would show false holes where the
  // subpaths overlap; under nonzero everything draws as the brand drew it.
  const sub = (i: number) => parseSvgPath(paths.LOGO_WORDMARK_PATHS[i]!);

  it('draws the u, h and a as unions: every subpath winds the same way', () => {
    for (const letter of [1, 3, 4]) {
      const w = sub(letter).map(winding);
      expect(w.length).toBeGreaterThan(1);
      expect(new Set(w).size).toBe(1);
    }
  });

  it('cuts the counters of the d and the P: they wind against their outers', () => {
    // The d: three subpaths — its stem, and the bowl's counter and outer. The
    // counter is the smallest by area and must wind against the bowl's outer.
    const d = sub(5);
    expect(d).toHaveLength(3);
    const byArea = [...d].sort(
      (p, q) =>
        Math.abs(THREE.ShapeUtils.area(p.getPoints(64))) -
        Math.abs(THREE.ShapeUtils.area(q.getPoints(64))),
    );
    expect(winding(byArea[0]!)).toBe(-winding(byArea[2]!));
    // The swoosh + P: the loop's counter against the swoosh.
    const p = sub(8);
    expect(p).toHaveLength(2);
    expect(winding(p[0]!)).toBe(-winding(p[1]!));
  });
});

describe('logoFrame', () => {
  it('puts the ball where the brand drew the "o", at the splash width', () => {
    // 220 pt is the native splash's `imageWidth`. The centre is
    // LOGO_BALL_CIRCLE scaled; the box is that circle plus the pad a side.
    const f = paths.logoFrame(220);
    expect(f.ball.centreX).toBeCloseTo(33.34, 2);
    expect(f.ball.centreY).toBeCloseTo(10.57, 2);
    expect(f.ball.diameter).toBeCloseTo(21.135, 2);
    expect(f.ball.start + f.ball.size / 2).toBeCloseTo(f.ball.centreX, 9);
    expect(f.ball.top + f.ball.size / 2).toBeCloseTo(f.ball.centreY, 9);
    expect(f.ball.size).toBeCloseTo(f.ball.diameter + 2 * paths.LOGO_BALL_PAD * f.scale, 9);
    // …inside the mark's box (the pad may poke a hair above the top edge).
    expect(f.ball.start).toBeGreaterThan(0);
    expect(f.ball.start + f.ball.size).toBeLessThan(220);
    expect(f.ball.top + f.ball.size).toBeLessThan(f.height);
  });

  it('frames the ball svg on its circle, padded', () => {
    const { cx, cy, r } = paths.LOGO_BALL_CIRCLE;
    const s = r + paths.LOGO_BALL_PAD;
    expect(paths.logoBallViewBox()).toBe(`${cx - s} ${cy - s} ${2 * s} ${2 * s}`);
    // The pad is needed, and it is enough: the drawn arcs poke past the
    // circle's own box (the seam gaps make the arcs bulge a hair outside it)
    // but stay inside the padded one, so nothing the svg draws is clipped.
    const box = new THREE.Box2(
      new THREE.Vector2(Infinity, Infinity),
      new THREE.Vector2(-Infinity, -Infinity),
    );
    for (const path of paths.LOGO_BALL_PATHS.flatMap((d) => parseSvgPath(d)))
      for (const p of path.getPoints(64)) box.expandByPoint(p);
    const pokesOut =
      box.min.x < cx - r || box.max.x > cx + r || box.min.y < cy - r || box.max.y > cy + r;
    expect(pokesOut).toBe(true);
    expect(box.min.x).toBeGreaterThanOrEqual(cx - s);
    expect(box.max.x).toBeLessThanOrEqual(cx + s);
    expect(box.min.y).toBeGreaterThanOrEqual(cy - s);
    expect(box.max.y).toBeLessThanOrEqual(cy + s);
  });
});

describe('the splash parity the loading screen rests on', () => {
  it('has the same crop as logo-white.png, the native splash image', () => {
    // 900 × 332, no padding (assets/README.md). Within 0.2 % — the png is an
    // integer raster of the same outlines.
    const png = 900 / 332;
    const svg = paths.LOGO_VIEWBOX.width / paths.LOGO_VIEWBOX.height;
    expect(Math.abs(svg - png) / png).toBeLessThan(0.002);
  });
});
