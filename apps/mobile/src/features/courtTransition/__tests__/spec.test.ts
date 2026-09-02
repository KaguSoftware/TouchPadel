import { describe, expect, it } from 'vitest';
import {
  cameraAt,
  cubicBezier,
  EASE_IO,
  EASE_OUT,
  netFrame,
  pillSlice,
  pitchAt,
  pitchEase,
  projectPlanePoint,
  rowSlice,
  sampleCurve,
  sampleEased,
  slice,
  SPEC,
} from '../spec';

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

describe('cubic-bezier easing (the prototype uses motion.dev cubicBezier)', () => {
  it('pins the endpoints and stays monotonic', () => {
    for (const ease of [EASE_IO, EASE_OUT, cubicBezier(0.42, 0, 1, 1)]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = ease(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('ease-in-out (0.45,0,0.55,1) is symmetric about the midpoint', () => {
    expect(close(EASE_IO(0.5), 0.5)).toBe(true);
    expect(close(EASE_IO(0.25) + EASE_IO(0.75), 1)).toBe(true);
    // Starts slow: well under linear early on.
    expect(EASE_IO(0.2)).toBeLessThan(0.15);
  });

  it('ease-out (0.22,1,0.36,1) front-loads the motion', () => {
    expect(EASE_OUT(0.2)).toBeGreaterThan(0.55);
    expect(EASE_OUT(0.5)).toBeGreaterThan(0.9);
  });

  it('linear control points short-circuit to identity', () => {
    const lin = cubicBezier(0.3, 0.3, 0.7, 0.7);
    expect(lin(0.37)).toBe(0.37);
  });
});

describe('PITCH ease (direction-aware)', () => {
  it('play = ease-in-out over the full slice', () => {
    const play = pitchEase(1, 0);
    expect(play(0.5)).toBe(EASE_IO(0.5));
    expect(play(1)).toBe(1);
  });

  it('reverse = ease-out over the old 0→0.8 slice, flat after', () => {
    const rev = pitchEase(-1, 0);
    expect(rev(0.4)).toBe(EASE_OUT(0.5));
    expect(rev(0.8)).toBe(1);
    expect(rev(0.95)).toBe(1);
  });

  it('remaps inside the sheet slice (a = 0.25) so the sheet settles at 0.8 too', () => {
    const rev = pitchEase(-1, 0.25);
    // t is the normalised position inside [0.25, 1]; p = 0.8 ↔ t = 0.7333…
    const tAt08 = slice(0.8, SPEC.sheet.move);
    expect(close(rev(tAt08), 1, 1e-6)).toBe(true);
    expect(rev(tAt08 / 2)).toBe(EASE_OUT(0.5));
  });
});

describe('staggers (handoff table)', () => {
  it('day pills: pill 0 0.450–0.670, pill 9 0.765–0.985', () => {
    expect(pillSlice(0).map((n) => +n.toFixed(3))).toEqual([0.45, 0.67]);
    expect(pillSlice(9).map((n) => +n.toFixed(3))).toEqual([0.765, 0.985]);
  });

  it('grid rows: row 0 0.58–0.86, row 3 0.76–1.00, rows beyond share row 3', () => {
    expect(rowSlice(0).map((n) => +n.toFixed(3))).toEqual([0.58, 0.86]);
    expect(rowSlice(3).map((n) => +n.toFixed(3))).toEqual([0.76, 1]);
    expect(rowSlice(7)).toEqual(rowSlice(3));
  });

  it('the last row still finishes with the spring (never past p = 1)', () => {
    expect(rowSlice(3)[1]).toBeLessThanOrEqual(1 + 1e-9);
    expect(pillSlice(9)[1]).toBeLessThanOrEqual(1);
  });
});

describe('sampleEased → native-driver tables', () => {
  it('covers the whole 0..1 domain, flat outside the slice, monotonic input', () => {
    const t = sampleEased([0.25, 0.45], [0, 1]);
    expect(t.inputRange[0]).toBe(0);
    expect(t.inputRange[t.inputRange.length - 1]).toBe(1);
    expect(t.outputRange[0]).toBe(0);
    expect(t.outputRange[t.outputRange.length - 1]).toBe(1);
    for (let i = 1; i < t.inputRange.length; i++) {
      expect(t.inputRange[i]!).toBeGreaterThanOrEqual(t.inputRange[i - 1]!);
    }
    expect(t.inputRange.length).toBe(t.outputRange.length);
  });

  it('applies the ease to the normalised slice (matches motion useTransform)', () => {
    const t = sampleEased([0, 1], [0, -60], EASE_IO, 4);
    expect(t.inputRange).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(close(t.outputRange[2]!, -30)).toBe(true);
    expect(close(t.outputRange[1]!, -60 * EASE_IO(0.25))).toBe(true);
  });

  it('a full-domain slice adds no guard samples', () => {
    const t = sampleEased([0, 1], [1, 0.55], undefined, 2);
    expect(t.inputRange).toEqual([0, 0.5, 1]);
    expect(t.outputRange).toEqual([1, 0.775, 0.55]);
  });

  it('sampleCurve samples uniformly over p', () => {
    const t = sampleCurve((p) => p * p, 2);
    expect(t.inputRange).toEqual([0, 0.5, 1]);
    expect(t.outputRange).toEqual([0, 0.25, 1]);
  });
});

describe('camera → flat-view transform', () => {
  it('orbit endpoints match the handoff table', () => {
    const rest = cameraAt(0);
    expect([rest.elevation, rest.azimuth, rest.distance, rest.lookZ]).toEqual([89.5, 0, 60, -0.8]);
    const full = cameraAt(1);
    expect(full.elevation).toBeCloseTo(40, 9);
    expect(full.azimuth).toBeCloseTo(28, 9);
    expect(full.distance).toBeCloseTo(46, 9);
    expect(full.lookZ).toBeCloseTo(0.6, 9);
  });

  it('rest is (visually) the identity; pitched is 50° tilt, 28° azimuth, ×1.3', () => {
    const rest = pitchAt(0, 1);
    expect(rest.tiltDeg).toBeCloseTo(0.5, 9);
    expect(rest.azimuthDeg).toBe(0);
    expect(rest.scale).toBe(1);
    expect(rest.translateY).toBeCloseTo(0, 9);
    const full = pitchAt(1, 1);
    expect(full.tiltDeg).toBeCloseTo(50, 9);
    expect(full.azimuthDeg).toBeCloseTo(28, 9);
    expect(close(full.scale, 60 / 46, 1e-6)).toBe(true);
    // −60 px layer shift plus 1.4 m of look-at re-centring, both upward.
    expect(full.translateY).toBeLessThan(-60);
  });

  it('projection: identity at rest, near end larger and far end swung right when pitched', () => {
    const P = 5 * 396;
    const rest = projectPlanePoint(30, -100, 0, 1, P);
    expect(close(rest.x, 30, 0.5)).toBe(true);
    expect(close(rest.y, -100, 0.5)).toBe(true);
    expect(close(rest.s, 1, 0.01)).toBe(true);

    const far = projectPlanePoint(0, -150, 1, 1, P);
    const near = projectPlanePoint(0, 150, 1, 1, P);
    expect(near.s).toBeGreaterThan(far.s); // foreshortening
    expect(far.x).toBeGreaterThan(0); // azimuth 28°: the far end appears to the right
    expect(near.x).toBeLessThan(0);
    expect(far.y).toBeLessThan(near.y); // still top-to-bottom
    // rotateX compresses the long axis: the pitched court is flatter than 300 px tall.
    expect(near.y - far.y).toBeLessThan(300);
  });

  it('the on-net button spans post to post', () => {
    const f = netFrame(1.2);
    expect(f.left).toBeCloseTo(24, 9);
    expect(f.width).toBeCloseTo(336, 9);
    expect(f.centerY).toBeCloseTo(237.6, 9);
  });
});
