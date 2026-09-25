/**
 * The forehand swing from `docs/design/mobile-ui/padel-racket.html`, as pure
 * numbers — the `swing` AnimationClip that file plays on `swing_pivot`, ported
 * so it is unit-tested here and merely applied to a three.js group in scene.ts
 * (the same split rally.ts / camera.ts already use).
 *
 * The design ships the racket as a three-level rig, and the port keeps it:
 *
 *   mount   the player's stance — where they are, which way they face
 *     pivot the HAND: the clip's travel + turn (this file)
 *       lay the top-view cheat — rotation.x lays the racket flat on the court
 *         body the racket itself, held (HAND_HOLD) with the grip on the pivot
 *
 * The lay sits INSIDE the pivot on purpose. The clip's dominant channel is a
 * yaw sweep about the player's vertical; with the lay outside, that sweep
 * would become a rotation about a court-plane axis and tip the racket up out
 * of the turf in the top-down view. Nested this way the swing sweeps across
 * the court from above and reads as a forehand from the front — one clip, both
 * views.
 *
 * Units are the design's: metres, seconds, radians, Euler in three's 'YXZ'
 * order. The model is real-world scale (a 26 cm head); RACKET_SCALE blows it
 * up to the court's player-sized rackets.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ── Vector / Euler helpers (three's maths, without three) ───────────────────

/**
 * Rotate v by an Euler applied in three's 'YXZ' order — R = Ry·Rx·Rz, the
 * order every group in the rig uses (Object3D.rotation.order = 'YXZ').
 */
export function applyEulerYXZ(v: Vec3, e: Vec3): Vec3 {
  const cx = Math.cos(e.x);
  const sx = Math.sin(e.x);
  const cy = Math.cos(e.y);
  const sy = Math.sin(e.y);
  const cz = Math.cos(e.z);
  const sz = Math.sin(e.z);
  return {
    x: (cy * cz + sy * sz * sx) * v.x + (sy * sx * cz - cy * sz) * v.y + cx * sy * v.z,
    y: cx * sz * v.x + cx * cz * v.y - sx * v.z,
    z: (cy * sz * sx - sy * cz) * v.x + (sy * sz + cy * sx * cz) * v.y + cx * cy * v.z,
  };
}

/** Rotate v about the x axis (the lay: the top-view cheat). */
export function applyRotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

export const addV = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const subV = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scaleV = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);

// ── The racket, as the design builds it ─────────────────────────────────────

/** Head centre, in model metres above the butt cap (padel-racket.html: HEAD.y). */
export const HEAD_Y = 0.32;
/** The grip pivot — where the hand closes round the handle (PIVOT_Y). */
export const PIVOT_Y = 0.05;
/** Grip to sweet spot, model metres: the arm the swing whips the head around. */
export const HEAD_ARM = HEAD_Y - PIVOT_Y;

/**
 * The one-handed forehand hold (`hand_hold`): handle out to the player's side,
 * head away from them, a touch above horizontal and leaning forward.
 */
export const HAND_HOLD: Vec3 = { x: -0.08, y: 0, z: 0.75 };

/**
 * Model → court. The design's racket is life-size (26 cm head, 45 cm long);
 * the court's four rackets stand in for the players themselves, so they are
 * blown up to person height. 4.2 lands a 1.13 m head and a 1.89 m racket —
 * the footprint the old cartoon racket had, so the court's composition, the
 * ball's flight and the on-net button's geometry are all unchanged.
 */
export const RACKET_SCALE = 4.2;

/**
 * How far the HAND travels, model metres → court metres. The clip's arc is a
 * real player's (≈ 0.9 m of travel); at the full RACKET_SCALE the racket would
 * lunge 2.4 m across the court every stroke. Half of it keeps the swing a
 * stride, with the head's reach (HEAD_ARM · RACKET_SCALE ≈ 1.13 m of radius)
 * still doing the sweeping.
 */
export const SWING_TRAVEL = 2.0;

// ── The clip ────────────────────────────────────────────────────────────────

/**
 * `swing` from padel-racket.html: rest → backswing → contact → follow-through
 * → rest, as [t, rotX, rotY, rotZ, posX, posY, posZ] on `swing_pivot`. Stored
 * already mirrored the way that file publishes the clip (its `keys` table is
 * flipped as it is written into the tracks).
 *
 * The first and last keys are the same pose, so a racket that is not swinging
 * simply sits on key 0 — the rest stance every player holds between strokes.
 */
const DESIGN_KEYS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [0.0, 0.03, 0.35, -0.06, -0.1, 0.0, 0.16],
  [0.45, 0.05, 0.55, -0.14, -0.14, 0.02, 0.26],
  [0.62, 0.05, 0.52, -0.14, -0.13, 0.01, 0.26],
  [0.78, 0.02, 0.25, -0.06, -0.06, 0.0, 0.08],
  [0.9, 0.0, -0.05, 0.04, 0.02, 0.02, -0.1],
  [1.1, -0.04, -0.35, 0.16, 0.1, 0.08, -0.26],
  [1.35, -0.04, -0.4, 0.2, 0.12, 0.11, -0.3],
  [1.8, 0.0, -0.05, 0.08, 0.03, 0.05, -0.1],
  [2.2, 0.03, 0.35, -0.06, -0.1, 0.0, 0.16],
] as const;

/**
 * The clip, with its travel reversed along z — and this is a CORRECTION, not a
 * port choice. The design file says "-Z is forward" and sends the hand from
 * z +0.26 (wound up) through to z −0.30 (followed through), but it builds the
 * racket's face pointing +Z: measured at the strike, the head's velocity and
 * the face normal are 180° apart, so the racket goes into the ball back-first.
 * One of the two has to give, and the court settles it — `playerYaw` puts the
 * mount's +Z on the direction that player hits, and the top-down view has to
 * look down at the FACE, both of which need the face where the design builds
 * it. So the stroke is mirrored through z = 0 instead: positions keep x and y
 * and flip z, a YXZ Euler flips x and y and keeps z (M·Ry·Rx·Rz·M with
 * M = diag(1, 1, −1)).
 *
 * Mirroring in SPACE, not in time: the clip's shape is asymmetric on purpose —
 * a slow hold at the top of the backswing, one fast pass, a long unwinding
 * follow-through — and playing it backwards would snap out of rest and coast
 * through the ball.
 */
export const SWING_KEYS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = DESIGN_KEYS.map(
  ([t, rx, ry, rz, px, py, pz]) => [t, -rx, -ry, rz, px, py, -pz] as const,
);

/** The clip's length (AnimationClip('swing', 2.2, …)). */
export const SWING_DURATION = 2.2;

/**
 * When the ball leaves the face. The hand's fastest pass is key 0.78 → 0.90
 * (≈ 1.65 model m/s, twice any other segment) and the turn crosses neutral
 * inside it; 0.86 s is that crossing. Everything before is the backswing
 * (0.86 s of it — a whole leg's anticipation while the ball is still in the
 * air toward the player) and everything after the follow-through (1.34 s).
 */
export const SWING_CONTACT = 0.86;

export interface SwingPose {
  /** The hand's travel, in MODEL metres — scale by SWING_TRAVEL for the court. */
  position: Vec3;
  /** The hand's turn, Euler YXZ. */
  rotation: Vec3;
  /** 0 at rest, 1 at the moment of contact — who is swinging, and how hard. */
  hit: number;
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * Cubic Hermite through the keys, with the tangent at each interior key the
 * non-uniform Catmull-Rom secant (what three's CubicInterpolant does for a
 * VectorKeyframeTrack on InterpolateSmooth) and ZERO at the two ends. The
 * clip's ends are the rest pose the racket holds for the other 3 s of the
 * rally, so it has to leave and re-enter that pose at rest — a Catmull-Rom
 * secant there would kick the racket into motion out of nowhere.
 */
function hermite(col: number, i: number, u: number, h: number): number {
  const n = SWING_KEYS.length;
  const p1 = SWING_KEYS[i]![col]!;
  const p2 = SWING_KEYS[i + 1]![col]!;
  const tangent = (k: number): number => {
    if (k === 0 || k === n - 1) return 0;
    const prev = SWING_KEYS[k - 1]!;
    const next = SWING_KEYS[k + 1]!;
    return (next[col]! - prev[col]!) / (next[0]! - prev[0]!);
  };
  const m1 = tangent(i);
  const m2 = tangent(i + 1);
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * p1 +
    (u3 - 2 * u2 + u) * h * m1 +
    (-2 * u3 + 3 * u2) * p2 +
    (u3 - u2) * h * m2
  );
}

const REST: SwingPose = {
  position: v3(SWING_KEYS[0]![4]!, SWING_KEYS[0]![5]!, SWING_KEYS[0]![6]!),
  rotation: v3(SWING_KEYS[0]![1]!, SWING_KEYS[0]![2]!, SWING_KEYS[0]![3]!),
  hit: 0,
};

/**
 * Mirror a pose through the player's centre plane: the same stroke played off
 * the other side of the body. A reflection in x negates the x of a position
 * and the y and z of a YXZ Euler (M·Ry·Rx·Rz·M = Ry(−a)·Rx(b)·Rz(−c)).
 */
export function mirrorPosition(p: Vec3, hand: 1 | -1): Vec3 {
  return hand > 0 ? p : v3(-p.x, p.y, p.z);
}
export function mirrorRotation(e: Vec3, hand: 1 | -1): Vec3 {
  return hand > 0 ? e : v3(e.x, -e.y, -e.z);
}

/**
 * The clip at `clipTime` seconds (0 = the start of the wind-up, SWING_CONTACT
 * = the strike, SWING_DURATION = back at rest). Anything outside the clip is
 * the rest stance, so a player who is not swinging costs one comparison.
 */
export function swingAt(clipTime: number, hand: 1 | -1 = 1): SwingPose {
  if (!(clipTime > 0) || clipTime >= SWING_DURATION) {
    return {
      position: mirrorPosition(REST.position, hand),
      rotation: mirrorRotation(REST.rotation, hand),
      hit: 0,
    };
  }
  let i = 0;
  while (i < SWING_KEYS.length - 2 && clipTime >= SWING_KEYS[i + 1]![0]!) i += 1;
  const t1 = SWING_KEYS[i]![0]!;
  const h = SWING_KEYS[i + 1]![0]! - t1;
  const u = (clipTime - t1) / h;
  return {
    position: mirrorPosition(
      v3(hermite(4, i, u, h), hermite(5, i, u, h), hermite(6, i, u, h)),
      hand,
    ),
    rotation: mirrorRotation(
      v3(hermite(1, i, u, h), hermite(2, i, u, h), hermite(3, i, u, h)),
      hand,
    ),
    hit:
      clipTime < SWING_CONTACT
        ? smooth(clipTime / SWING_CONTACT)
        : smooth((SWING_DURATION - clipTime) / (SWING_DURATION - SWING_CONTACT)),
  };
}

/**
 * The sweet spot in the MOUNT frame, in court metres: where the head sits once
 * the clip has turned and travelled the hand, the lay has flattened the racket
 * for the view, and the hold has put it in one. `lay` is the view cheat's
 * angle (rally.layAngle); the arm is the grip-to-head reach at court scale.
 */
export function faceOffset(pose: SwingPose, lay: number, hand: 1 | -1 = 1): Vec3 {
  const arm = applyRotX(
    applyEulerYXZ(v3(0, HEAD_ARM * RACKET_SCALE, 0), mirrorRotation(HAND_HOLD, hand)),
    lay,
  );
  return addV(scaleV(pose.position, SWING_TRAVEL), applyEulerYXZ(arm, pose.rotation));
}
