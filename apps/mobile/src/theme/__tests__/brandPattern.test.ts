/**
 * The pattern's crop rule, and the guard that keeps the artwork singular.
 *
 * When this module was split out for the court's GL backdrop to share,
 * BrandPattern.tsx was being rewritten in another session and still carried its
 * own copy of the eleven bands; this file held the two side by side until one
 * went. The component now imports from here, so the side-by-side comparison is
 * gone and what replaces it is the stronger claim: that there is nothing to
 * compare. Two copies of brand artwork is the thing the component's own header
 * forbids, and a regression would arrive as a paste, so the guard looks for the
 * paste rather than for a disagreement — a second table that happened to match
 * on the day it was written would pass a comparison and still be the bug.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PATTERN_BAND_WIDTH,
  PATTERN_DEFAULT_OPACITY,
  PATTERN_DEFAULT_WIDTH,
  PATTERN_FIELD,
  PATTERN_LINES,
  PATTERN_MIN_GAP,
  PATTERN_TILE_RADIUS,
  PATTERN_ZOOM,
  PATTERN_VIEWBOX,
  patternInBox,
  patternInk,
  slicePattern,
} from '../brandPattern';

// `new URL(..., import.meta.url)` would be tidier, but this package's lib has
// the DOM's URL, which node:fs will not take.
const here = dirname(fileURLToPath(import.meta.url));
const component = readFileSync(join(here, '../../components/BrandPattern.tsx'), 'utf8');

describe('slicePattern', () => {
  it('covers the box on both axes, never leaving it bare', () => {
    const boxes: readonly (readonly [number, number])[] = [
      [390, 844],
      [844, 390],
      [239.6797, 349.4609],
      [1024, 1366],
      [100, 100],
    ];
    for (const [w, h] of boxes) {
      const cut = slicePattern(w, h);
      expect(cut.width).toBeGreaterThanOrEqual(w - 1e-9);
      expect(cut.height).toBeGreaterThanOrEqual(h - 1e-9);
    }
  });

  it('keeps the panel aspect', () => {
    const cut = slicePattern(390, 844);
    expect(cut.width / cut.height).toBeCloseTo(PATTERN_VIEWBOX.width / PATTERN_VIEWBOX.height, 10);
  });

  it('centres the overflow, so the origin is outside the box', () => {
    const cut = slicePattern(390, 844);
    expect(cut.x).toBeLessThanOrEqual(0);
    expect(cut.y).toBeLessThanOrEqual(0);
    // Centred: as much falls off the far edge as off the near one.
    expect(cut.x + cut.width - 390).toBeCloseTo(-cut.x, 10);
    expect(cut.y + cut.height - 844).toBeCloseTo(-cut.y, 10);
  });

  it('is the panel scaled by the zoom when the box is the panel', () => {
    const cut = slicePattern(PATTERN_VIEWBOX.width, PATTERN_VIEWBOX.height);
    expect(cut.scale).toBeCloseTo(PATTERN_ZOOM, 12);
    // Still centred: the overflow the zoom adds is split evenly.
    expect(cut.x).toBeCloseTo((PATTERN_VIEWBOX.width * (1 - PATTERN_ZOOM)) / 2, 9);
    expect(cut.y).toBeCloseTo((PATTERN_VIEWBOX.height * (1 - PATTERN_ZOOM)) / 2, 9);
  });

  it('takes the larger axis on a phone: height, by a long way', () => {
    // The panel is 0.686 w/h against a phone near 0.46, so height drives it.
    const cut = slicePattern(390, 844);
    expect(cut.scale).toBeCloseTo((844 / PATTERN_VIEWBOX.height) * PATTERN_ZOOM, 10);
    expect(cut.width).toBeGreaterThan(390);
  });

  it('shows the phone fewer than seven bands, which is the whole point of the zoom', () => {
    // The owner's number (2026-09-05), on the screen it was judged on.
    const W = 393;
    const H = 852;
    const cut = slicePattern(W, H);
    const onScreen = PATTERN_FIELD.filter(([x1, y1, x2, y2]) => {
      const ax = cut.x + x1 * cut.scale;
      const ay = cut.y + y1 * cut.scale;
      const bx = cut.x + x2 * cut.scale;
      const by = cut.y + y2 * cut.scale;
      for (let t = 0; t <= 1; t += 0.002) {
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        if (x >= 0 && x <= W && y >= 0 && y <= H) return true;
      }
      return false;
    });
    expect(onScreen.length).toBeLessThan(7);
    expect(onScreen.length).toBeGreaterThan(3); // and not so few it stops being a pattern
  });

  it('keeps the band the weight it was tuned at, whatever the zoom', () => {
    // The stroke is in PANEL units, so it scales with the crop. 5.3 px on a
    // 390 pt screen is the number; the zoom must not quietly change it.
    const cut = slicePattern(390, 844);
    expect(PATTERN_DEFAULT_WIDTH * cut.scale).toBeGreaterThan(4.5);
    expect(PATTERN_DEFAULT_WIDTH * cut.scale).toBeLessThan(6.5);
  });
});

describe('patternInk', () => {
  it('is the ground at alpha 0 and the ink at alpha 1', () => {
    expect(patternInk('#F7F7F5', '#A5D06F', 0)).toBe('#f7f7f5');
    expect(patternInk('#F7F7F5', '#A5D06F', 1)).toBe('#a5d06f');
  });

  it('lands on the midpoint at half', () => {
    // 0x00 -> 0xFF, halfway: 127.5 rounds to 128.
    expect(patternInk('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('blends the light page at the light alpha', () => {
    // 255 + (165 - 255) * 0.9 = 174 = ae, and so on per channel.
    expect(patternInk('#FFFFFF', '#A5D06F', 0.9)).toBe('#aed57d');
  });

  it('always comes back as a six-digit hex three.js can take', () => {
    for (const alpha of [0, 0.13, 0.45, 0.9, 1]) {
      expect(patternInk('#172C4F', '#A5D06F', alpha)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('is what alpha compositing would have produced, which is why the material is opaque', () => {
    // The court's copy sits directly on the clear colour and nothing else, so
    // ground x (1 - a) + ink x a IS the blend, to the rounding.
    const ground = '#F7F7F5';
    const ink = '#A5D06F';
    const alpha = 0.45;
    const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
    const got = patternInk(ground, ink, alpha);
    for (const at of [1, 3, 5]) {
      const want = Math.round(channel(ground, at) * (1 - alpha) + channel(ink, at) * alpha);
      expect(channel(got, at)).toBe(want);
    }
  });
});

describe('PATTERN_FIELD', () => {
  /** a*x + b*y = c, normalised, so two forms of one line compare equal. */
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    let a = y2 - y1;
    let b = x1 - x2;
    const n = Math.hypot(a, b);
    a /= n;
    b /= n;
    if (a < -1e-12 || (Math.abs(a) < 1e-12 && b < 0)) {
      a = -a;
      b = -b;
    }
    return { a, b, c: a * x1 + b * y1 };
  };

  it('is the board itself: eleven bands, not a tiling of them', () => {
    // Tiling was tried and rejected on a device (PATTERN_TILE_RADIUS). This
    // pins the count so putting it back is a change someone meant to make.
    expect(PATTERN_TILE_RADIUS).toBe(0);
    expect(PATTERN_FIELD).toHaveLength(PATTERN_LINES.length);
  });

  it('still contains the board\u2019s own eleven, unmoved', () => {
    // Rings are walked outward from the origin, so an original is never the
    // band dropped when two crowd. Compare as LINES: the field clips each one
    // to the panel box, which moves the endpoints but not the line.
    for (const [x1, y1, x2, y2] of PATTERN_LINES) {
      const want = line(x1, y1, x2, y2);
      const found = PATTERN_FIELD.some((band) => {
        const got = line(...band);
        return (
          Math.abs(got.a - want.a) < 1e-6 &&
          Math.abs(got.b - want.b) < 1e-6 &&
          Math.abs(got.c - want.c) < 1e-4
        );
      });
      expect(found).toBe(true);
    }
  });

  it('is only ever the board tiled — no band invented', () => {
    // Every band must lie on some whole-panel translation of an original.
    for (const band of PATTERN_FIELD) {
      const got = line(...band);
      let onLattice = false;
      for (let i = -PATTERN_TILE_RADIUS; i <= PATTERN_TILE_RADIUS && !onLattice; i++)
        for (let j = -PATTERN_TILE_RADIUS; j <= PATTERN_TILE_RADIUS && !onLattice; j++)
          for (const [x1, y1, x2, y2] of PATTERN_LINES) {
            const want = line(
              x1 + i * PATTERN_VIEWBOX.width,
              y1 + j * PATTERN_VIEWBOX.height,
              x2 + i * PATTERN_VIEWBOX.width,
              y2 + j * PATTERN_VIEWBOX.height,
            );
            if (
              Math.abs(got.a - want.a) < 1e-6 &&
              Math.abs(got.b - want.b) < 1e-6 &&
              Math.abs(got.c - want.c) < 1e-4
            ) {
              onLattice = true;
              break;
            }
          }
      expect(onLattice).toBe(true);
    }
  });

  it('never puts two parallel bands close enough to read as one', () => {
    // The whole reason the field is filtered: lattice offsets are dense for an
    // irrational direction, so without this two bands land a fraction of a unit
    // apart and render as one double-weight blunder.
    const lines = PATTERN_FIELD.map((band) => line(...band));
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const p = lines[i]!;
        const q = lines[j]!;
        if (Math.abs(p.a * q.b - p.b * q.a) >= 1e-6) continue; // not parallel
        expect(Math.abs(p.c - q.c)).toBeGreaterThanOrEqual(PATTERN_MIN_GAP - 1e-9);
      }
  });

  it('gives every band two ends inside the panel box', () => {
    for (const [x1, y1, x2, y2] of PATTERN_FIELD) {
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(-1e-6);
        expect(x).toBeLessThanOrEqual(PATTERN_VIEWBOX.width + 1e-6);
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(PATTERN_VIEWBOX.height + 1e-6);
      }
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(1);
    }
  });

  it('leaves the crowding rule clear of the weight it is protecting', () => {
    expect(PATTERN_MIN_GAP).toBeGreaterThan(PATTERN_DEFAULT_WIDTH * 2);
  });
});

describe('patternInBox', () => {
  it('is slicePattern applied, band for band', () => {
    const cut = slicePattern(393, 852);
    const placed = patternInBox(393, 852);
    expect(placed.scale).toBe(cut.scale);
    expect(placed.bands).toHaveLength(PATTERN_FIELD.length);
    PATTERN_FIELD.forEach(([x1, y1, x2, y2], i) => {
      expect(placed.bands[i]).toEqual([
        cut.x + x1 * cut.scale,
        cut.y + y1 * cut.scale,
        cut.x + x2 * cut.scale,
        cut.y + y2 * cut.scale,
      ]);
    });
  });

  it('carries the zoom, which is the whole reason it exists', () => {
    // The bug this replaced: the page cropped with SVG's own slice, which is
    // cover and nothing else, so it stayed at 2.44x while the court went to
    // 4.88x. Anything that crops must come through here to pick the zoom up.
    const plainCover = Math.max(393 / PATTERN_VIEWBOX.width, 852 / PATTERN_VIEWBOX.height);
    expect(patternInBox(393, 852).scale).toBeCloseTo(plainCover * PATTERN_ZOOM, 9);
  });
});

describe('BrandPattern.tsx', () => {
  it('crops through the shared function, not through SVG', () => {
    // The guard that was missing. Sharing the DATA was never enough — the page
    // and the court agreed only while slicePattern happened to equal plain
    // cover, and the zoom ended that silently. `preserveAspectRatio` here means
    // SVG is doing the crop again, which is a second implementation by
    // definition, whatever it currently computes.
    // Matched as JSX ATTRIBUTES, not as words: both names appear in that
    // file's comments now, explaining why they are gone.
    expect(component).toContain('patternInBox');
    expect(component).not.toMatch(/preserveAspectRatio\s*=/);
    expect(component).not.toMatch(/viewBox\s*=/);
  });

  it('reads the artwork from here', () => {
    expect(component).toMatch(/from '\.\.\/theme\/brandPattern'/);
  });

  it('holds no second copy of the bands, the panel box or the weights', () => {
    // Coordinates first: the panel box and one band endpoint that appears
    // nowhere else in the artwork, so a pasted table cannot hide behind a
    // number the component legitimately uses for something of its own.
    for (const literal of ['239.6797', '349.4609', '233.3', '-6.82']) {
      expect(component).not.toContain(literal);
    }
    // Then the shapes a paste would arrive in, whatever it named them.
    expect(component).not.toMatch(/const\s+\w*LINES\b/);
    expect(component).not.toMatch(/const\s+\w*(?:BAND_WIDTH|DEFAULT_WIDTH|DEFAULT_OPACITY)\b/);
  });
});

describe('the band weights', () => {
  it('keeps the printed board reachable, and defaults well under it', () => {
    // 16 units is the board's own band; the phone default is a texture, and the
    // component's `strokeWidth` prop is the way back up — see its header.
    expect(PATTERN_BAND_WIDTH).toBe(16);
    expect(PATTERN_DEFAULT_WIDTH).toBeGreaterThan(0);
    expect(PATTERN_DEFAULT_WIDTH).toBeLessThan(PATTERN_BAND_WIDTH);
  });

  it('carries a per-theme alpha that is lighter in dark', () => {
    // Lime is 1.77:1 on the light page and 7.85:1 on the dark one, so equal
    // alphas would be two different designs. Which way round is the assertion.
    expect(PATTERN_DEFAULT_OPACITY.dark).toBeLessThan(PATTERN_DEFAULT_OPACITY.light);
  });
});
