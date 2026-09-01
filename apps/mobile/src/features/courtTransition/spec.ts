/**
 * Court view → booking view transition: the motion spec, ported line for line
 * from the handoff table in `docs/design/mobile-ui/Court Transition Prototype.html`
 * (2026-09-01). Everything derives from ONE progress value p ∈ [0, 1]:
 * 0 = court view, 1 = booking view.
 *
 * PURE — no React Native imports — so the numbers are unit-tested and the
 * component files only wire tables into Animated nodes. Two things the
 * prototype does at runtime are precomputed here instead:
 *
 * 1. Eased slices. The prototype passes an easing to every `useTransform`;
 *    RN's native animation driver accepts only inputRange/outputRange
 *    (`easing` is dropped, see NativeAnimatedAllowlist), so `sampleEased`
 *    turns "slice [a, b] with ease E" into a dense piecewise-linear table the
 *    native driver can play.
 * 2. The camera. The prototype orbits a three.js camera (elevation 89.5° → 40°,
 *    azimuth 0° → 28°, distance 60 m → 46 m). The app's court is a flat native
 *    view, so the same orbit is expressed as the view transform
 *    [perspective, translateY, rotateX(tilt), rotateZ(azimuth), scale] —
 *    `pitchAt` — and `projectPlanePoint` replays Fabric's matrix pipeline so
 *    elements that must STAND on the court (the rackets) can be positioned in
 *    screen space without nested 3D transforms, which RN flattens per view.
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
  /** Near-side cage in the prototype; here the rackets' ground shadow plays that "get out of the way" role. */
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
  const bezier = (t: number, a1: number, a2: number) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
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

// ── Camera → view transform ─────────────────────────────────────────────────

const DEG = Math.PI / 180;

/** Court geometry shared with CourtIllustration (viewBox units). */
export const COURT = {
  vbw: 320,
  vbh: 396,
  /** Turf rect x26 y8 w268 h380 stands for the prototype's 11.4 × 21.4 m base. */
  unitsPerMetre: 380 / 21.4,
  /** Net tape `M20 198h280`: the on-net button spans post to post. */
  net: { x: 20, width: 280, y: 198 },
} as const;

/**
 * Perspective distance as a multiple of the court's rendered height. The
 * prototype's fov 24° over an 844 px viewport is a focal length of
 * (844/2)/tan 12° ≈ 1985 px ≈ 5 × its ~400 px court — a telephoto look.
 */
export const PERSPECTIVE_PER_HEIGHT = 5;

export interface CameraState {
  elevation: number;
  azimuth: number;
  distance: number;
  lookZ: number;
}

/** Orbit at eased pitch progress k ∈ [0, 1]. */
export function cameraAt(k: number): CameraState {
  const c = SPEC.camera;
  return {
    elevation: lerp(c.elevation[0], c.elevation[1], k),
    azimuth: lerp(c.azimuth[0], c.azimuth[1], k),
    distance: lerp(c.distance[0], c.distance[1], k),
    lookZ: lerp(c.lookZ[0], c.lookZ[1], k),
  };
}

export interface Pitch {
  /** rotateX, degrees: 90° − elevation (top-down 0.5° → pitched 50°). */
  tiltDeg: number;
  /** rotateZ, degrees: the azimuth — the far end swings to the right. */
  azimuthDeg: number;
  /** distance 60 m → 46 m reads as the court growing. */
  scale: number;
  /** Screen-space lift, px: the prototype's −60 px layer shift plus the look-at re-centring. */
  translateY: number;
}

/**
 * The court view's transform at eased progress k, for a court rendered at
 * `pxPerUnit` px per viewBox unit. Array order for RN (first = outermost):
 * [{perspective}, {translateY}, {rotateX}, {rotateZ}, {scale}].
 */
export function pitchAt(k: number, pxPerUnit: number): Pitch {
  const cam = cameraAt(k);
  const lookShift = (cam.lookZ - SPEC.camera.lookZ[0]) * COURT.unitsPerMetre * pxPerUnit;
  return {
    tiltDeg: 90 - cam.elevation,
    azimuthDeg: cam.azimuth,
    scale: SPEC.camera.distance[0] / cam.distance,
    translateY: lerp(SPEC.court.y[0], SPEC.court.y[1], k) - lookShift,
  };
}

export interface Projected {
  /** px from the court's centre, screen space. */
  x: number;
  y: number;
  /** Apparent scale of a small billboard at that point. */
  s: number;
}

/**
 * Where a point of the court plane lands on screen under `pitchAt(k)` —
 * Fabric's own pipeline (Transform.cpp: column vectors, m[11] = −1/perspective,
 * rotateX m[5]=cos m[6]=sin m[9]=−sin m[10]=cos, transforms about the centre):
 * scale → rotateZ → rotateX → translateY → perspective divide.
 * (u, v) are px from the court's centre in the flat view.
 */
export function projectPlanePoint(u: number, v: number, k: number, pxPerUnit: number, perspective: number): Projected {
  const pitch = pitchAt(k, pxPerUnit);
  const x0 = u * pitch.scale;
  const y0 = v * pitch.scale;
  const az = pitch.azimuthDeg * DEG;
  const x1 = x0 * Math.cos(az) - y0 * Math.sin(az);
  const y1 = x0 * Math.sin(az) + y0 * Math.cos(az);
  const tilt = pitch.tiltDeg * DEG;
  const y2 = y1 * Math.cos(tilt);
  const z2 = y1 * Math.sin(tilt);
  const y3 = y2 + pitch.translateY;
  const w = 1 - z2 / perspective;
  return { x: x1 / w, y: y3 / w, s: pitch.scale / w };
}

/** The on-net button's frame in px for a court rendered at `pxPerUnit`. */
export function netFrame(pxPerUnit: number): { left: number; width: number; centerY: number } {
  return {
    left: COURT.net.x * pxPerUnit,
    width: COURT.net.width * pxPerUnit,
    centerY: COURT.net.y * pxPerUnit,
  };
}
