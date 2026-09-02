/**
 * Court view → booking view transition: the motion spec, ported line for line
 * from the handoff table in `docs/design/mobile-ui/Court Transition Prototype.html`
 * (2026-09-01). Everything derives from ONE progress value p ∈ [0, 1]:
 * 0 = court view, 1 = booking view.
 *
 * PURE — no React Native imports — so the numbers are unit-tested and the
 * component files only wire tables into Animated nodes. One thing the
 * prototype does at runtime is precomputed here instead:
 *
 * 1. Eased slices. The prototype passes an easing to every `useTransform`;
 *    RN's native animation driver accepts only inputRange/outputRange
 *    (`easing` is dropped, see NativeAnimatedAllowlist), so `sampleEased`
 *    turns "slice [a, b] with ease E" into a dense piecewise-linear table the
 *    native driver can play.
 * 2. The camera orbit and the rally are pure functions of (p, t) in rally.ts;
 *    scene.ts applies them to the three.js meshes every frame.
 */

export type Dir = 1 | -1;
export type Range = readonly [number, number];

/** Play / reverse driver: a spring on p itself, not a duration (ζ ≈ 1.06, ≈ 1.6 s to settle). */
export const SPRING = {
  stiffness: 60,
  damping: 18,
  mass: 1.2,
  restDisplacementThreshold: 0.0005,
  restSpeedThreshold: 0.002,
} as const;

/** Reduced motion: no spring, one short linear cross-fade to the target. */
export const REDUCED_MOTION_MS = 220;

export const SPEC = {
  camera: {
    slice: [0, 1] as Range,
    elevation: [89.5, 40] as Range,
    azimuth: [0, 28] as Range,
    distance: [60, 46] as Range,
    /** Look-at z in metres: the camera re-centres 1.4 m toward the near end. */
    lookZ: [-0.8, 0.6] as Range,
    fov: 24,
  },
  court: {
    slice: [0, 1] as Range,
    y: [0, -60] as Range,
    dim: [0.35, 0.85] as Range,
    opacity: [1, 0.55] as Range,
  },
  lines: { range: [0.3, 0.7] as Range, opacity: [1, 0.4] as Range },
  /** Near-side half of the cage fades with the pitch so it does not block the view: mesh, glass, frame, window panes. */
  nearCage: {
    fence: [0.42, 0.1] as Range,
    glass: [0.55, 0.12] as Range,
    frame: [1, 0.25] as Range,
    pane: [0.75, 0.1] as Range,
  },
  button: {
    fade: [0, 0.25] as Range,
    move: [0, 0.3] as Range,
    y: [0, 24] as Range,
    scale: [1, 0.96] as Range,
  },
  sheet: {
    move: [0.25, 1] as Range,
    y: [360, 0] as Range,
    scale: [0.92, 1] as Range,
    fade: [0.25, 0.45] as Range,
  },
  back: { fade: [0.2, 0.5] as Range },
  pills: { start: 0.45, stagger: 0.035, length: 0.22, y: 14 },
  grid: { start: 0.58, stagger: 0.06, length: 0.28, y: 18, scale: 0.96, sharedFromRow: 3 },
} as const;

// ── Scalar helpers ──────────────────────────────────────────────────────────

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Normalised position of v inside [a, b], clamped to 0..1. */
export const slice = (v: number, [a, b]: Range): number => clamp01((v - a) / (b - a));

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` as a function of t — the same solver
 * motion.dev uses (Newton–Raphson with a bisection fallback).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1;
  const B = (a1: number, a2: number) => 3 * a2 - 6 * a1;
  const C = (a1: number) => 3 * a1;
  const bezier = (t: number, a1: number, a2: number) =>
    ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const derivative = (t: number, a1: number, a2: number) =>
    3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  const solveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = derivative(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      const err = bezier(t, x1, x2) - x;
      if (Math.abs(err) < 1e-7) return t;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      t = (lo + hi) / 2;
      if (bezier(t, x1, x2) < x) lo = t;
      else hi = t;
    }
    return t;
  };
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (x1 === y1 && x2 === y2) return t; // linear
    return bezier(solveX(t), y1, y2);
  };
}

export const EASE_OUT = cubicBezier(0.22, 1, 0.36, 1);
export const EASE_IO = cubicBezier(0.45, 0, 0.55, 1);

/**
 * The PITCH ease (camera, court layer, sheet) is direction-aware:
 *  play:    ease-in-out over the element's full slice, so it settles together with the spring;
 *  reverse: the original ease-out over the old 0 → 0.8 slice, remapped inside [a, 1].
 * `a` is the start of the element's slice (0 for the court, 0.25 for the sheet).
 */
export function pitchEase(dir: Dir, a: number): (t: number) => number {
  return (t) => (dir > 0 ? EASE_IO(t) : EASE_OUT(Math.min(1, (t * (1 - a)) / (0.8 - a))));
}

// ── Staggers ────────────────────────────────────────────────────────────────

/** Day pill i: start 0.45 + i·0.035, length 0.22 (pill 0: 0.450–0.670 … pill 9: 0.765–0.985). */
export function pillSlice(i: number): Range {
  const a = SPEC.pills.start + i * SPEC.pills.stagger;
  return [a, a + SPEC.pills.length];
}

/**
 * Time-grid row r: start 0.58 + r·0.06, length 0.28; rows ≥ 3 share row 3's
 * slice. The handoff table ends row 3 at 1.00 (0.76 + 0.28 would overrun p's
 * range and leave the last rows 14 % short when the spring settles), so the
 * end is clamped to 1 — every row is fully in when the transition is.
 */
export function rowSlice(r: number): Range {
  const a = SPEC.grid.start + Math.min(r, SPEC.grid.sharedFromRow) * SPEC.grid.stagger;
  return [a, Math.min(1, a + SPEC.grid.length)];
}

// ── Eased keyframe tables ───────────────────────────────────────────────────

export interface Keyframes {
  inputRange: number[];
  outputRange: number[];
}

/**
 * "Over [a, b], go from → to with ease E" as a table over the WHOLE 0..1
 * domain (flat before a and after b) — what `Animated.interpolate` needs from
 * a native-driven value that ignores `easing`. 24 samples keep the eased
 * curve within a pixel of the analytic one at these amplitudes.
 */
export function sampleEased(
  range: Range,
  out: Range,
  ease: (t: number) => number = (t) => t,
  samples = 24,
): Keyframes {
  const [a, b] = range;
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  if (a > 0) {
    inputRange.push(0);
    outputRange.push(out[0]);
  }
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    inputRange.push(lerp(a, b, t));
    outputRange.push(lerp(out[0], out[1], ease(t)));
  }
  if (b < 1) {
    inputRange.push(1);
    outputRange.push(out[1]);
  }
  return { inputRange, outputRange };
}

/** Sample an arbitrary f(p) over 0..1 into a table (rackets: projected positions). */
export function sampleCurve(f: (p: number) => number, samples = 24): Keyframes {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    inputRange.push(p);
    outputRange.push(f(p));
  }
  return { inputRange, outputRange };
}
