/**
 * The 3D court's motion, as pure numbers — ported 1:1 from the three.js
 * prototype (`Court Transition Prototype.html`: `updateCamera` / `updateRally`)
 * so it is unit-tested here and merely applied to meshes in scene.ts.
 *
 * The rackets' stroke is the second design (`padel-racket.html`): its `swing`
 * clip lives in swing.ts and this file schedules it — every player winds up,
 * strikes and follows through around the moment the ball is on their face.
 *
 * Units are the prototype's: metres, seconds, radians. Court 10 × 20 m, net on
 * z = 0, back walls at z = ±10, side walls at x = ±5; +z is the near end.
 */
import { lerp, SPEC } from './spec';
import {
  addV,
  applyEulerYXZ,
  faceOffset,
  scaleV,
  subV,
  SWING_CONTACT,
  SWING_TRAVEL,
  swingAt,
  v3,
  type Vec3,
} from './swing';

export type { Vec3 } from './swing';

const DEG = Math.PI / 180;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

// ── Camera ──────────────────────────────────────────────────────────────────

export interface CameraPose {
  position: Vec3;
  /** Normalised: (0, 0, −1) top-down → (0, 1, 0) pitched. */
  up: Vec3;
  lookAt: Vec3;
}

/**
 * The orbit at eased pitch progress k: elevation 89.5° → 40°, azimuth 0° → 28°,
 * distance 60 → 46 m, look-at z −0.8 → 0.6 m, fov 24° constant (SPEC.camera).
 */
export function cameraPose(k: number): CameraPose {
  const c = SPEC.camera;
  const el = lerp(c.elevation[0], c.elevation[1], k) * DEG;
  const az = lerp(c.azimuth[0], c.azimuth[1], k) * DEG;
  const d = lerp(c.distance[0], c.distance[1], k);
  const upLen = Math.hypot(k, 1 - k) || 1;
  return {
    position: v3(
      d * Math.cos(el) * Math.sin(az),
      d * Math.sin(el),
      d * Math.cos(el) * Math.cos(az),
    ),
    up: v3(0, k / upLen, -(1 - k) / upLen),
    lookAt: v3(0, 0, lerp(c.lookZ[0], c.lookZ[1], k)),
  };
}

/** The near-side cage fades as the camera pitches so it does not block the view. */
export function nearCageOpacity(k: number): {
  fence: number;
  glass: number;
  frame: number;
  pane: number;
} {
  const n = SPEC.nearCage;
  return {
    fence: lerp(n.fence[0], n.fence[1], k),
    glass: lerp(n.glass[0], n.glass[1], k),
    frame: lerp(n.frame[0], n.frame[1], k),
    pane: lerp(n.pane[0], n.pane[1], k),
  };
}

// ── Rally ───────────────────────────────────────────────────────────────────

export interface Player {
  x: number;
  z: number;
  /** −1 = far pair (handles point to −z), +1 = near pair. */
  face: -1 | 1;
  seed: number;
  /** Which side of the body the forehand comes off: the swing clip is mirrored for −1. */
  hand: 1 | -1;
}

/** Four rackets stand in for players: far pair at z −6.3, near pair at z +6.3. */
export const PLAYERS: readonly Player[] = [
  { x: -2.3, z: -6.3, face: -1, seed: 0.0, hand: 1 },
  { x: 2.3, z: -6.3, face: -1, seed: 1.7, hand: -1 },
  { x: -2.3, z: 6.3, face: 1, seed: 3.1, hand: 1 },
  { x: 2.3, z: 6.3, face: 1, seed: 4.4, hand: -1 },
];

/** One leg of the rally, seconds; four legs A(0) → D(3) → B(1) → C(2) → A … */
export const LEG_SECONDS = 1.3;
export const RALLY_ORDER = [0, 3, 1, 2] as const;
/** One full loop of the rally: the four legs, back to A. */
export const LOOP_SECONDS = LEG_SECONDS * RALLY_ORDER.length;
/**
 * The SWEET SPOT's height: the racket lies flat on the court in the top view
 * and stands at chest height in the front view. The grip hangs below it, out
 * to the player's side — the hold is a forehand, not a racket on a stick.
 */
export const RACKET_Y = { flat: 0.75, standing: 1.55 } as const;
export const BALL_RADIUS = 0.22;

/** Which leg of the loop each player strikes on (their slot in RALLY_ORDER). */
const SLOT = PLAYERS.map((_, i) => RALLY_ORDER.indexOf(i as 0 | 1 | 2 | 3));

/** Positive remainder, exact for a v already inside [0, m) — the strike lands on SWING_CONTACT to the bit. */
const mod = (v: number, m: number): number => {
  const r = v % m;
  return r < 0 ? r + m : r;
};

/**
 * The top-view cheat, as the angle on the rig's `lay` group: −90° lays the
 * racket flat on the turf (face up) for the top-down view, 0° stands it up
 * facing the net for the front view. It is nested INSIDE the swing pivot so
 * the stroke sweeps across the court plane in both views (see swing.ts).
 */
export function layAngle(camK: number): number {
  return ((camK - 1) * Math.PI) / 2;
}

/**
 * The first leg start at or after t. There the ball is ON the striker's face at
 * the instant of contact and everyone else is somewhere in their own wind-up —
 * the freeze frame the idle hold and reduced motion both rest on.
 */
export function nextLegStart(t: number): number {
  return Math.ceil(t / LEG_SECONDS - 1e-9) * LEG_SECONDS;
}

/** Resting yaw: far pair faces −z, near pair +z, each angled 0.3 rad toward the centre line. */
export function playerYaw(p: Player): number {
  return (p.face < 0 ? 0 : Math.PI) + (p.x < 0 ? -0.3 * p.face : 0.3 * p.face);
}

export interface RacketPose {
  /**
   * The rig's MOUNT, world metres: the stance's origin. The hand itself is
   * this plus `swing.position` turned by `rotation`; the sweet spot is
   * `contact`, one rigid arm (HEAD_ARM · RACKET_SCALE) further out.
   */
  position: Vec3;
  /**
   * The stance, Euler YXZ: yaw to the net plus the top-view roll. `x` is
   * always 0 — the lay angle belongs to a group nested inside the swing.
   */
  rotation: Vec3;
  /** The swing pivot inside the stance: the clip's travel (court metres) and turn. */
  swing: { position: Vec3; rotation: Vec3 };
  /** The SWEET SPOT, world metres — where the ball meets the face. */
  contact: Vec3;
  /** 0 at rest, 1 at the moment of contact. */
  hit: number;
}

export interface RallyState {
  /** Which player just hit (index into PLAYERS) and who receives. */
  from: number;
  to: number;
  /** 0..1 inside the current leg. */
  u: number;
  /** True in the first 2 % of a leg — the prototype resets the ball's trail here. */
  newLeg: boolean;
  ball: Vec3;
  rackets: RacketPose[];
  /** The ball's ground disc: offset opposite the sun, larger and fainter when the ball is high. */
  shade: { x: number; z: number; scale: number; opacity: number };
}

/**
 * One racket at time t and eased pitch progress camK. The player idle-drifts
 * (sin, ±0.25 m) around their spot; on top of that runs the swing clip, phased
 * so its contact lands on the leg where they strike — 0.86 s of wind-up while
 * the ball is still flying at them, then 1.34 s of follow-through. Between
 * strokes the clip is outside its window and the racket holds its rest stance.
 *
 * `position` is the hand and `contact` the sweet spot; the offset between them
 * is the whole rig (swing → lay → hold → arm) resolved at this frame, chosen
 * so the sweet spot sits exactly on the player's spot when they are at rest.
 * The stroke then whips the head around the hand — which is why the ball is
 * launched from `contact` and not from the group's origin.
 */
function racketAt(i: number, t: number, camK: number): RacketPose {
  const pl = PLAYERS[i]!;
  const lay = layAngle(camK);
  const pose = swingAt(mod(t - SLOT[i]! * LEG_SECONDS + SWING_CONTACT, LOOP_SECONDS), pl.hand);
  const rest = swingAt(-1, pl.hand);
  const base = v3(
    pl.x + Math.sin(t * 0.9 + pl.seed) * 0.25,
    lerp(RACKET_Y.flat, RACKET_Y.standing, camK) + Math.sin(t * 1.6 + pl.seed) * 0.06,
    pl.z + Math.cos(t * 0.7 + pl.seed) * 0.2,
  );
  const rotation = v3(0, playerYaw(pl), (1 - camK) * 0.12 * Math.sin(t * 1.1 + pl.seed));
  const restFace = faceOffset(rest, lay, pl.hand);
  const face = faceOffset(pose, lay, pl.hand);
  return {
    position: subV(base, applyEulerYXZ(restFace, rotation)),
    rotation,
    swing: { position: scaleV(pose.position, SWING_TRAVEL), rotation: pose.rotation },
    contact: addV(base, applyEulerYXZ(subV(face, restFace), rotation)),
    hit: pose.hit,
  };
}

/**
 * The whole rally at time t (seconds since start) and eased pitch progress
 * camK. The ball flies a two-arc leg (flight 62 %, bounce 38 %; heights 1.9 m
 * / 0.6 m) from the face that struck it, at the instant of the strike, to the
 * face that will receive it, at the instant it arrives — both ends read off
 * the swing, so the ball leaves and lands ON a racket rather than near one.
 * Independent of p except through camK, which stands the rackets up: top view
 * flat on the turf (y 0.75) → front view upright at chest height (y 1.55).
 */
export function rallyAt(t: number, camK: number): RallyState {
  // Snap a t that is a leg start within float noise (nextLegStart's n × LEG_SECONDS)
  // onto u = 0 rather than u ≈ 1 of the leg before.
  const legs = t / LEG_SECONDS;
  let leg = Math.floor(legs);
  let u = legs - leg;
  if (u > 1 - 1e-9) {
    leg += 1;
    u = 0;
  }
  const legIdx = leg % 4;
  const from = RALLY_ORDER[legIdx]!;
  const to = RALLY_ORDER[(legIdx + 1) % 4]!;

  const rackets = PLAYERS.map((_, i) => racketAt(i, t, camK));

  // The strike and the reception, each sampled at ITS OWN moment: the hitter's
  // face where it was when the ball left, the receiver's where it will be when
  // the ball arrives. (Reading the live positions instead would drag the whole
  // arc along with the follow-through.)
  const legStart = leg * LEG_SECONDS;
  const A = racketAt(from, legStart, camK).contact;
  const B = racketAt(to, legStart + LEG_SECONDS, camK).contact;
  const bounce = { ...lerp3(A, B, 0.8), y: BALL_RADIUS };
  let ball: Vec3;
  if (u < 0.62) {
    const w = u / 0.62;
    ball = { ...lerp3(A, bounce, w), y: lerp(A.y, bounce.y, w) + 1.9 * Math.sin(Math.PI * w) };
  } else {
    const w = (u - 0.62) / 0.38;
    ball = { ...lerp3(bounce, B, w), y: lerp(bounce.y, B.y, w) + 0.6 * Math.sin(Math.PI * w) };
  }

  // The disc lands where the sun (6, 30, 10) would cast it.
  const hs = 1 - Math.min(1, ball.y / 3);
  return {
    from,
    to,
    u,
    newLeg: u < 0.02,
    ball,
    rackets,
    shade: {
      x: ball.x - ball.y * 0.2,
      z: ball.z - ball.y * 0.33,
      scale: 0.8 + 0.3 * hs,
      opacity: 0.16 + 0.14 * hs,
    },
  };
}
