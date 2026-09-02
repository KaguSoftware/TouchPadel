/**
 * The 3D court's motion, as pure numbers — ported 1:1 from the three.js
 * prototype (`Court Transition Prototype.html`: `updateCamera` / `updateRally`)
 * so it is unit-tested here and merely applied to meshes in scene.ts.
 *
 * Units are the prototype's: metres, seconds, radians. Court 10 × 20 m, net on
 * z = 0, back walls at z = ±10, side walls at x = ±5; +z is the near end.
 */
import { lerp, SPEC } from './spec';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
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
}

/** Four rackets stand in for players: far pair at z −6.3, near pair at z +6.3. */
export const PLAYERS: readonly Player[] = [
  { x: -2.3, z: -6.3, face: -1, seed: 0.0 },
  { x: 2.3, z: -6.3, face: -1, seed: 1.7 },
  { x: -2.3, z: 6.3, face: 1, seed: 3.1 },
  { x: 2.3, z: 6.3, face: 1, seed: 4.4 },
];

/** One leg of the rally, seconds; four legs A(0) → D(3) → B(1) → C(2) → A … */
export const LEG_SECONDS = 1.3;
export const RALLY_ORDER = [0, 3, 1, 2] as const;
/** One full loop of the rally: the four legs, back to A. */
export const LOOP_SECONDS = LEG_SECONDS * RALLY_ORDER.length;
/** Racket height: flat on the court in the top view, upright at chest height in the front view. */
export const RACKET_Y = { flat: 0.75, standing: 1.55 } as const;
export const BALL_RADIUS = 0.22;

/**
 * The first leg start at or after t: the ball sits on the hitter's racket
 * (u = 0 → the ball is AT the from-racket, the swing pulse is 0, the trail
 * has just reset), so a rally held here reads as a player holding the ball.
 */
export function nextLegStart(t: number): number {
  return Math.ceil(t / LEG_SECONDS - 1e-9) * LEG_SECONDS;
}

/** Resting yaw: far pair faces −z, near pair +z, each angled 0.3 rad toward the centre line. */
export function playerYaw(p: Player): number {
  return (p.face < 0 ? 0 : Math.PI) + (p.x < 0 ? -0.3 * p.face : 0.3 * p.face);
}

export interface RacketPose {
  position: Vec3;
  /** Euler XYZ in the prototype's 'YXZ' order. */
  rotation: Vec3;
  /** 0..1 swing pulse at the moment the racket hits or receives. */
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
 * The whole rally at time t (seconds since start) and eased pitch progress
 * camK. Rackets idle-drift (sin, ±0.25 m) and swing on the hit; the ball flies
 * a two-arc leg (flight 62 %, bounce 38 %; heights 1.9 m / 0.6 m) between the
 * CURRENT racket positions. Independent of p except through camK, which
 * stands the rackets up: top view flat (face up, y 0.75) → front view upright
 * (rotX 90°, y 1.55, face to the net, forehand swing about Y).
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

  const rackets = PLAYERS.map((pl, i) => {
    const hit =
      i === from && u < 0.19
        ? Math.sin((u / 0.19) * Math.PI)
        : i === to && u > 0.86
          ? Math.sin(((u - 0.86) / 0.14) * Math.PI) * 0.6
          : 0;
    return {
      position: v3(
        pl.x + Math.sin(t * 0.9 + pl.seed) * 0.25,
        lerp(RACKET_Y.flat, RACKET_Y.standing, camK) + Math.sin(t * 1.6 + pl.seed) * 0.06,
        pl.z + Math.cos(t * 0.7 + pl.seed) * 0.2,
      ),
      rotation: v3(
        (camK * Math.PI) / 2 + lerp(-0.6, 0.35, camK) * hit,
        playerYaw(pl) + camK * 0.9 * hit * (pl.x < 0 ? 1 : -1),
        (1 - camK) * 0.12 * Math.sin(t * 1.1 + pl.seed),
      ),
      hit,
    };
  });

  const A = rackets[from]!.position;
  const B = rackets[to]!.position;
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
