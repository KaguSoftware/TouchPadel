import { describe, expect, it } from 'vitest';
import {
  cubicBezier,
  EASE_IO,
  EASE_OUT,
  pillSlice,
  pitchEase,
  rowSlice,
  sampleCurve,
  sampleEased,
  slice,
  SPEC,
  SPRING,
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

describe('the close spring outruns the sheet it is hiding', () => {
  // Why the Book tab does not wait for this spring to finish before it drops
  // the sheet (useCourtTransition retires it on a progress listener instead):
  // the spring is overdamped, so its tail is far longer than the part of the
  // close a guest can actually see. Reverse p from 1, analytically, the way
  // RN's SpringAnimation does.
  const { stiffness: k, damping: c, mass: m } = SPRING;
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  /** p at t seconds into a close, released from rest at p = 1. */
  const p = (t: number) =>
    zeta < 1
      ? Math.exp(-zeta * omega0 * t) *
        (Math.cos(omega0 * Math.sqrt(1 - zeta * zeta) * t) +
          ((zeta * omega0) / (omega0 * Math.sqrt(1 - zeta * zeta))) *
            Math.sin(omega0 * Math.sqrt(1 - zeta * zeta) * t))
      : Math.exp(-omega0 * t) * (1 + omega0 * t);
  /** First t at which p has fallen to `target`. */
  const reaches = (target: number) => {
    let t = 0;
    while (p(t) > target && t < 10) t += 0.001;
    return t;
  };

  it('is overdamped, so it approaches 0 asymptotically rather than snapping', () => {
    expect(zeta).toBeGreaterThan(1);
  });

  it('hides the card in under half a second but keeps crawling for a second more', () => {
    // The card's opacity is 0 at and below SPEC.sheet.fade[0].
    const invisible = reaches(SPEC.sheet.fade[0]);
    expect(invisible).toBeLessThan(0.5);
    // Yet p is still visibly off 0 long after that — this gap is exactly the
    // dead time the old "unmount when the spring finishes" behaviour showed.
    expect(reaches(0.01) - invisible).toBeGreaterThan(0.5);
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
