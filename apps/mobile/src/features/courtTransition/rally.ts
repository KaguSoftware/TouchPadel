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

/**
 * Four rackets stand in for players: far pair at z −6.3, near pair at z +6.3.
 * In the top-down view +x is screen right and +z is screen down, so [0] is the
 * TOP-LEFT racket, [1] top-right, [2] bottom-left, [3] bottom-right.
 */
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

/**
 * Resting yaw: far pair faces −z, near pair +z, each turned toward the centre
 * line — a ready stance, racket carried across the body rather than square on.
 *
 * The turn is 0.6 rad (34°). At the original 0.3 rad the rackets sat all but
 * parallel to the court's long axis, and since each is at rest for ~85 % of a
 * rally — the stroke is brief — that near-straight pose is what the court
 * actually looks like; angling them is what makes four rackets read as
 * players holding them rather than sticks lying on the turf. Past ~0.6 the
 * resting spot drifts so far from where the racket must be to meet the ball
 * that the step between them becomes a lurch rather than a walk.
 */
export function playerYaw(p: Player): number {
  return (p.face < 0 ? 0 : Math.PI) + (p.x < 0 ? -0.6 * p.face : 0.6 * p.face) + (p.trim ?? 0);
}

/**
 * The ball's launch angle: it leaves on the arc rallyAt flies it along, about
 * 10° above the horizontal. The face must tilt back by this much to meet it
 * square — a face left square to the HORIZON is 10° off perpendicular.
 *
 * It was 0.295 (17°) while the ball flew hand-to-hand. Flying it between the
 * STRING BEDS instead lifted both ends of every leg by the head's own height
 * and so flattened the arc; leaving LAUNCH at the old value tilted the face
 * 7° off the new shot line.
 *
 * It is baked into STANDING_PITCH rather than added at contact, so the racket
 * RESTS at the angle it strikes at. That matters because the scene places the
 * hand by the resting pitch: any tilt applied only at contact would swing the
 * head — and the strings — away from the ball it is meant to meet.
 */
const LAUNCH = 0.172;
/**
 * The racket's pitch, radians from flat on the court — how far it stands up on
 * its edge. Both views use it: a racket lying FLAT (0) has its string bed
 * pointing at the sky, so seen from above it can only ever meet the ball with
 * its rim, which is what made the top view read as a racket that never turned
 * to face the ball. At π/2 it is bolt upright, which looks stiff and bobs the
 * hand through the stroke; leaning it back by LAUNCH puts the head up and out
 * in front of the grip, where a player actually holds one, and squares the
 * face to the arc the ball flies.
 */
const STANDING_PITCH = Math.PI / 2 - LAUNCH;
/**
 * The top view's pitch: how far the racket is canted out of the court plane.
 *
 * Not 0. Lying exactly flat, a racket presents the camera a pure outline —
 * every point of it the same distance away, nothing self-shadowing, no edge
 * catching the light — so four modelled objects read as four flat stickers on
 * the turf. 0.6 rad (34°) tips it far enough that the face foreshortens into
 * an ellipse, the frame's near edge stands proud of its far one and the grip
 * clearly rises toward the camera — a racket held at an angle, not a decal —
 * while still showing you the string bed rather than the rim.
 */
const TOP_CANT = 0.6;
/**
 * How far the head tips DOWN at the moment of contact, radians on top of the
 * resting cant — the racket chopping down onto the ball and coming back up.
 *
 * 1.05 rad ≈ 60° of travel, mid-way through the 50–70° the tip should cover:
 * the head sits at TOP_CANT (34°) between strokes and chops down to ~94° —
 * just past vertical — at the ball. The ease is squared, so most of that
 * swing happens in the handful of frames either side of contact.
 */
const STRIKE_TIP = 1.05;
/**
 * The top view's pitch AT the moment of contact — resting cant plus the full
 * strike tip. The placement maths uses this, not TOP_CANT: the strings have to
 * land on the ball at the instant the racket is tipped furthest down, and
 * placing by the resting angle instead left them 0.4 m short.
 */
const CONTACT_PITCH = TOP_CANT - STRIKE_TIP;

/**
 * What makes the stroke read as a WRIST, not a machine cam (top view only).
 *
 * A held racket does not dip symmetrically into the ball and back out — the
 * hand cocks the head UP through the wind-up, whips it down through contact,
 * lets it carry on LOW a beat into the follow-through, and only then brings
 * it back up to rest. COCK_UP and CARRY_LOW ride the two halves of `phase`
 * (negative in the wind-up, positive after, ZERO at contact — so neither can
 * move the strings off the ball at the one instant placement depends on).
 * CARRY_LOW stays well under STRIKE_TIP's slope so the deepest point of the
 * swing is still the ball itself, not a beat after it.
 */
const COCK_UP = 0.35;
const CARRY_LOW = 0.1;
/**
 * Idle life: a held racket is never still. The head breathes a few degrees in
 * pitch and wanders a hair in yaw between strokes — small, slow and per-seed
 * desynchronised, so the four rackets read as four people waiting rather than
 * one looped animation. Both fade out toward contact (× (1 − hit) / the aim
 * blend), so the strike geometry stays exact.
 */
const IDLE_BREATH = 0.05;
const IDLE_WANDER = 0.05;

/** Who each player hits to, from the rally cycle (0 → 3 → 1 → 2 → 0). */
const HIT_TARGET = RALLY_ORDER.map(
  (_, k) => [RALLY_ORDER[k]!, RALLY_ORDER[(k + 1) % 4]!] as const,
).reduce<number[]>((m, [a, b]) => ((m[a] = b), m), []);

/**
 * Flat-view placement: each racket stands a constant REACH to the SIDE of the
 * point the ball flies to and from (its ball point stays `positions[i]` — the
 * path is untouched), so that at the contact yaw — perpendicular across the
 * shot — the string bed sits ON the ball, not the ball on the butt of the
 * grip. Constant per player (their target never changes), so the racket does
 * not translate through the stroke: the swing stays rotation in place.
 * Computed from the static line-up; the ±0.25 m idle drift bends the true
 * contact yaw a few degrees off this, leaving the head within ~5 cm of the
 * ball — invisible at court scale.
 */
const FLAT_OFFSET = PLAYERS.map((pl, i) => {
  const tgt = PLAYERS[HIT_TARGET[i]!]!;
  const aim0 = Math.atan2(tgt.x - pl.x, tgt.z - pl.z);
  // Only the horizontal part of the head's reach lies in the court plane, and
  // the pitch that matters is the one AT CONTACT — the head tipped down onto
  // the ball — not the shallower angle it rests at between strokes.
  const r = REACH * Math.cos(CONTACT_PITCH);
  return { x: -r * Math.sin(aim0), z: -r * Math.cos(aim0) };
});

/** Smoothstep, 0 → 1 over w ∈ [0, 1]. */
const smooth = (w: number): number => w * w * (3 - 2 * w);

/**
 * How far the racket has stepped to its interception point, over the stroke
 * window w ∈ [−1, 1] (contact at 0) — the top view's "plant the face and wait"
 * profile.
 *
 * It rises over the WIND-UP and is fully there by w = −0.5, holds at 1 through
 * contact and the early follow-through, then eases back out. That hold is the
 * point: the face is standing at the interception point while the ball is
 * still travelling toward it, so the ball flies INTO a waiting racket. Ramping
 * it to a peak at contact instead had the racket and the ball converging
 * together — the strings closing on the ball from 3 m out and only arriving at
 * the instant of impact, which reads as the ball meeting a racket still on its
 * way rather than being hit by one.
 *
 * Both ends leave at 0 with zero slope, so the step never snaps and the racket
 * is back on its idle drift outside the window.
 */
function plantEase(w: number): number {
  if (w >= 1) return 0;
  // The rise is handled by the approach (see APPROACH_U), which hands over at
  // w = −1 already at full extension. So from the start of the wind-up right
  // through contact the racket simply STANDS there, and only the release is
  // shaped here. Ramping up again from 0 at w = −1 teleported it 2.2 m at the
  // handoff, since the approach had already walked it all the way in.
  if (w > 0) return (1 + Math.cos(Math.PI * w)) / 2;
  return 1;
}

/** Shortest signed angle from `a` to `b`, in (−π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The stroke, as one continuous sweep through the ball.
 *
 * It straddles the leg boundary — the wind-up occupies the tail of the leg the
 * ball is arriving on, the follow-through the head of the next, and contact is
 * the boundary itself, the instant the ball leaves. `swingPhase` below is the
 * single curve over that whole window: −1 fully cocked back, 0 AT the ball,
 * +1 fully followed through.
 *
 * The three constants are angles about the racket's own yaw, added to the
 * contact facing — so at phase 0 the face is exactly perpendicular to the shot
 * and the two humps open it away from that on either side.
 */
const BACKSWING = 1.1;
const FOLLOW_THROUGH = 1.45;
const HEAD_TILT = 0.5;

/** The wind-up occupies the last WINDUP_U of a leg; the follow-through the first FOLLOW_U. */
const WINDUP_U = 0.34;
const FOLLOW_U = 0.34;
/**
 * The receiver starts walking to its interception point this far into the leg
 * — long before the stroke itself begins.
 *
 * The plant covers about 2 m, from where the racket idles to where it must
 * stand to meet the ball. Squeezed into the 27-frame wind-up that is a 0.17 m
 * lurch per frame; spread over most of the leg it is an unhurried walk, which
 * is also what a player actually does — move to the ball early, then swing.
 */
const APPROACH_U = 0.3;

/**
 * The stroke's shape over window position w ∈ [−1, 1], where w = 0 is contact.
 *
 * The racket must be AT REST at both ends of the window — the window is only
 * a slice of the leg, and outside it the racket sits at its idle angle. So the
 * curve starts at 0, swings NEGATIVE (cocking back) over w ∈ [−1, 0], crosses
 * zero exactly at the ball, and swings POSITIVE (following through) over
 * w ∈ [0, 1] before returning to 0. Letting it end at ±1 instead teleported
 * the racket 83° between two frames as the window closed.
 *
 * Within each half it is monotonic — back, then forward through the ball and
 * on round, never reversing before the finish. The original curve was a sine
 * hump on each side of contact whose peaks sat right AT the ball, so the head
 * rebounded the way it came the instant after impact.
 *
 * Crucially the crossing at w = 0 is steep: peak angular speed lands on the
 * ball, which is what makes the motion read as a strike rather than a waft.
 */
function swingPhase(w: number): number {
  // sin(πw) is 0 at w = ±1 and at w = 0, with its extremes at w = ∓0.5 —
  // fully cocked half way through the wind-up, fully extended half way
  // through the finish — and its steepest crossing exactly on the ball.
  return Math.sin(Math.PI * w);
}

/**
 * Where the ball is at `u` (0..1) on a leg flown from A to B: two arcs, the
 * flight over the first 62 % peaking 1.9 m up, the bounce over the rest
 * peaking 0.6 m. This is the prototype's own path, lifted out of `rallyAt` so
 * the rackets can ASK where the ball is (and where it is heading) instead of
 * guessing from the players' positions.
 */
export function ballAt(A: Vec3, B: Vec3, u: number): Vec3 {
  const bounce = { ...lerp3(A, B, 0.8), y: BALL_RADIUS };
  if (u < 0.62) {
    const w = u / 0.62;
    return { ...lerp3(A, bounce, w), y: lerp(A.y, bounce.y, w) + 1.9 * Math.sin(Math.PI * w) };
  }
  const w = (u - 0.62) / 0.38;
  return { ...lerp3(bounce, B, w), y: lerp(bounce.y, B.y, w) + 0.6 * Math.sin(Math.PI * w) };
}

/**
 * The ball's heading on the court at `u`, as an atan2 yaw — the direction the
 * ball is actually travelling, sampled across a short step of the real path
 * rather than inferred from who is hitting to whom. Near the bounce the two
 * arcs meet at an angle, but only in Y: the ground track is a straight line
 * from A to B throughout, so this is stable across it.
 */
export function ballHeading(A: Vec3, B: Vec3, u: number): number {
  const d = 0.02;
  const p = ballAt(A, B, Math.max(0, u - d));
  const q = ballAt(A, B, Math.min(1, u + d));
  return Math.atan2(q.x - p.x, q.z - p.z);
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

  // The HANDS — the prototype's own positions, and the pivots the rackets
  // swing about. Only the rotations below may alter them.
  const positions = PLAYERS.map((pl) =>
    v3(
      pl.x + Math.sin(t * 0.9 + pl.seed) * 0.25,
      lerp(RACKET_Y.flat, RACKET_Y.standing, camK) + Math.sin(t * 1.6 + pl.seed) * 0.06,
      pl.z + Math.cos(t * 0.7 + pl.seed) * 0.2,
    ),
  );

  // Where the ball actually leaves from and lands on: the CENTRE OF THE
  // STRING BED, not the hand.
  //
  // Standing, the head sits REACH·sin(STANDING_PITCH) — about 1.27 m — above
  // and in front of the grip, so a ball flown hand-to-hand passed that far
  // BELOW the racket faces and met the handle instead of the hitting area.
  // Lifting the endpoints by the head's own offset puts the ball in the
  // middle of the strings at both ends of every leg.
  //
  // Only in the pitched view (× camK): the top view already solves this the
  // other way round, planting the racket so its strings reach the ball, and
  // doubling up would push the ball off the face again.
  const ballEnds = positions.map((p, i) => {
    const pl = PLAYERS[i]!;
    const yaw = playerYaw(pl);
    const rise = REACH * Math.sin(STANDING_PITCH) * camK;
    const run = REACH * Math.cos(STANDING_PITCH) * camK;
    return v3(p.x - run * Math.sin(yaw), p.y + rise, p.z - run * Math.cos(yaw));
  });

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
      x: ball.x - ball.y * (14 / 13),
      z: ball.z - ball.y * (9 / 13),
      scale: 0.8 + 0.3 * hs,
      opacity: 0.16 + 0.14 * hs,
    },
  };
}
