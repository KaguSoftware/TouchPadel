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
    /**
     * The prototype dimmed the court to 55 % behind the card; the owner asked
     * for it at full strength (2026-09-05), so the layer only lifts now. The
     * slice and the flat table are kept rather than deleted: the sheet already
     * frosts what is behind it on iOS and tints it on Android, which is what
     * separates card from court, and restoring the dim is a one-number change
     * here rather than a re-wiring in the screen.
     */
    dim: [0.35, 0.85] as Range,
    opacity: [1, 1] as Range,
  },
  lines: { range: [0.3, 0.7] as Range, opacity: [1, 0.4] as Range },
  /**
   * The bottom end wall and the side walls' bottom glass sections fade with the
   * pitch so they do not block the view: mesh, glass, frame. The side walls' mesh
   * sections do not fade (owner, 2026-09-29). The window panes
   * of the whole near half go all the way out, so in the pitched view only the
   * upper (far) side of the cage carries them.
   */
  nearCage: {
    fence: [0.42, 0.1] as Range,
    glass: [0.55, 0.12] as Range,
    frame: [1, 0.25] as Range,
    pane: [1, 0] as Range,
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
  /**
   * The card's content enters in three GROUPS, each moving as one (owner,
   * 2026-10-09): 0 the day chips, 1 the duration picker with the court lanes,
   * 2 the entry rows (open matches, lessons, tournaments). Timed in SECONDS of
   * the opening spring, not in p (see `openP`): the spring covers p's last
   * stretch slowly, so the old per-item p slices gave the first pill a 0.13 s
   * fade and the last row a 1.1 s one, the lower items arriving late and
   * crawling in. Group g: in over [0.22 + g·0.08, + 0.22] s, all in by 0.6 s.
   */
  groups: { startS: 0.22, staggerS: 0.08, lengthS: 0.22 },
  pills: { y: 14 },
  grid: { y: 18, scale: 0.96 },
} as const;

/**
 * The p below which the SHEET has nothing left to show: its slide has reached
 * the far end of `sheet.move` and its content is at zero opacity (`sheet.fade`
 * starts at the same 0.25). Everything under this point is the court alone,
 * settling back up under a card that is already gone.
 *
 * That distinction is the whole reason this constant exists. The driver is a
 * spring, so p approaches its target exponentially and the two halves of a
 * close are nothing alike in WALL CLOCK time: with SPRING's roots at −5 and
 * −10 s⁻¹, p(t) = 2e⁻⁵ᵗ − e⁻¹⁰ᵗ reaches 0.25 in ≈ 0.40 s and only trips the
 * rest thresholds at ≈ 1.70 s. Handing the court view back on the animation's
 * completion callback therefore left the card parked over the tab bar and the
 * "check availability" button dead for the 1.3 s in between (owner,
 * 2026-09-05). `useCourtTransition` watches for this crossing instead.
 *
 * The tail is not something the spring could simply skip: down there the
 * reverse PITCH ease is at its steepest (EASE_OUT front-loads), so the last
 * 6 % of p is still ~19 px of the court's lift. The sheet leaves early; the
 * court really does take the full spring.
 */
export const SHEET_GONE = SPEC.sheet.move[0];

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

/**
 * p at t seconds into an OPEN (p 0 → 1 from rest): SPRING is overdamped with
 * roots r₁, r₂ (−5 and −10 s⁻¹), so p(t) = 1 − (r₂e^{r₁t} − r₁e^{r₂t}) / (r₂ − r₁).
 */
const ROOTS = (() => {
  const { mass: m, damping: c, stiffness: k } = SPRING;
  const d = Math.sqrt(c * c - 4 * m * k);
  return [(-c + d) / (2 * m), (-c - d) / (2 * m)] as const;
})();
export function openP(t: number): number {
  const [r1, r2] = ROOTS;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** The card's entrance groups, in order (see SPEC.groups). */
export type EntranceGroup = 0 | 1 | 2;

/** Group g's slice of the open, as a p range. */
export function groupSlice(g: EntranceGroup): Range {
  const a = SPEC.groups.startS + g * SPEC.groups.staggerS;
  return [openP(a), openP(a + SPEC.groups.lengthS)];
}

/**
 * `sampleEased` for a slice from `groupSlice`: the table is
 * sampled at even TIMES of the open, so the element moves linearly in wall
 * clock rather than in p.
 */
export function sampleOpenLinear(range: Range, out: Range, samples = 12): Keyframes {
  const [ta, tb] = range.map(openT) as [number, number];
  const inputRange: number[] = [0];
  const outputRange: number[] = [out[0]];
  for (let i = 0; i <= samples; i++) {
    inputRange.push(openP(lerp(ta, tb, i / samples)));
    outputRange.push(lerp(out[0], out[1], i / samples));
  }
  inputRange.push(1);
  outputRange.push(out[1]);
  return { inputRange, outputRange };
}

/** Inverse of `openP` (bisection; p is monotonic). */
function openT(p: number): number {
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (openP(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
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
