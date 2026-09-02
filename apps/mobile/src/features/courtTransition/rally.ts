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
  /**
   * Per-racket tweak to the resting yaw, radians. Positive turns the racket
   * anticlockwise ON SCREEN in the top view — the camera's up vector is −z
   * there, which flips the usual sense, so this is worth checking rather than
   * assuming. Purely cosmetic: it moves where the racket idles, not where it
   * must be to meet the ball.
   */
  trim?: number;
}

/**
 * Four rackets stand in for players: far pair at z −6.3, near pair at z +6.3.
 * In the top-down view +x is screen right and +z is screen down, so [0] is the
 * TOP-LEFT racket, [1] top-right, [2] bottom-left, [3] bottom-right.
 */
export const PLAYERS: readonly Player[] = [
  // Top-left sits 15° further round to the left than the mirror pose gives it.
  { x: -2.3, z: -6.3, face: -1, seed: 0.0, trim: (15 * Math.PI) / 180 },
  { x: 2.3, z: -6.3, face: -1, seed: 1.7 },
  { x: -2.3, z: 6.3, face: 1, seed: 3.1 },
  { x: 2.3, z: 6.3, face: 1, seed: 4.4 },
];

/** One leg of the rally, seconds; four legs A(0) → D(3) → B(1) → C(2) → A … */
export const LEG_SECONDS = 1.3;
export const RALLY_ORDER = [0, 3, 1, 2] as const;
/** Racket height: flat on the court in the top view, upright at chest height in the front view. */
export const RACKET_Y = { flat: 0.75, standing: 1.55 } as const;
export const BALL_RADIUS = 0.22;

/**
 * Pivot to the centre of the strings, in world units — scene.ts's GRIP (1.15,
 * the BUTT of the handle, where the hand is) times the racket's 1.15 scale.
 * `RacketPose.position` is that pivot point.
 *
 * MUST match scene.ts's own REACH: the placement maths here puts the pivot so
 * that the strings — this far out along the racket's axis — land on the ball,
 * and scene.ts hangs the mesh off the same offset. If the two drift apart the
 * ball misses the strings by the difference.
 */
export const REACH = 1.15 * 1.15;

/**
 * Where a pose's string bed sits in the world: the head reaches REACH out of
 * the hand along the racket's local −z, carried through the pose's yaw and
 * pitch in the same 'YXZ' order scene.ts applies to the mesh.
 */
export function stringBed(pose: {
  position: Vec3;
  rotation: Vec3;
}): Vec3 {
  const { x: rx, y: ry } = pose.rotation;
  const h = -Math.cos(rx);
  return {
    x: pose.position.x + REACH * h * Math.sin(ry),
    y: pose.position.y + REACH * Math.sin(rx),
    z: pose.position.z + REACH * h * Math.cos(ry),
  };
}

/**
 * The first leg start at or after t: the ball sits on the hitter's racket
 * (u = 0 → the ball is AT the from-racket, the swing pulse is 0, the trail
 * has just reset), so a rally held here reads as a player holding the ball.
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

  const rackets = PLAYERS.map((pl, i) => {
    // The strike pulse: 1 at the ball, falling away through the follow-through
    // and the wind-up. It marks HOW CLOSE to contact we are, for anything that
    // wants to flash on the hit.
    const hit =
      i === from && u < FOLLOW_U
        ? Math.cos((Math.PI / 2) * (u / FOLLOW_U))
        : i === to && u > 1 - WINDUP_U
          ? Math.cos((Math.PI / 2) * ((1 - u) / WINDUP_U))
          : 0;
    const position = positions[i]!;
    const rest = playerYaw(pl);

    // The stroke, and where it is aimed. It is ONE motion straddling the leg
    // boundary: the racket cocks back over the tail of the leg the ball is
    // arriving on, strikes AT the boundary (the instant the ball leaves), and
    // follows through over the head of the next leg. `w` is where we are in
    // that window, −1 (fully cocked) → 0 (contact) → +1 (fully through).
    let w = 0;
    let swinging = false;
    let aim = rest;
    // Where the ball is at THIS racket's moment of contact — the point the
    // face has to be standing at, and the point the top view steps it to
    // early so the ball arrives at a waiting racket.
    let intercept: Vec3 | null = null;
    if (i === from && u < FOLLOW_U) {
      // Follow-through half: this racket struck at u = 0 and is carrying on.
      // Aimed along the ball's OUTGOING heading — the direction the ball is
      // genuinely travelling as it leaves the strings, read off the path it
      // actually flies (atan2 over a step of the real trajectory), not the
      // straight line to the receiver's box. The two differ because both
      // rackets drift while the ball is in the air.
      w = u / FOLLOW_U;
      swinging = true;
      aim = ballHeading(ballEnds[from]!, ballEnds[to]!, 0);
      // It struck at u = 0, where the ball was leaving: the launch point.
      intercept = ballAt(ballEnds[from]!, ballEnds[to]!, 0);
    } else if (i === to && u > 1 - WINDUP_U) {
      // Wind-up half: the ball is on its way and this racket is pulling back,
      // reaching full cock at the START of the window and unwinding into the
      // ball as the leg ends — where it becomes `from` and the branch above
      // carries the same motion on without a step.
      w = (u - 1) / WINDUP_U; // −1 at the window's start → 0 at the boundary
      swinging = true;
      // Aimed along the ball's OUTGOING heading — the bearing it will leave on
      // when this racket strikes it at the end of the leg, taken from the path
      // the ball actually flies next.
      //
      // Not the incoming bearing, though the racket is facing an oncoming
      // ball: the two are ~160° apart (the ball arrives, is struck, and goes
      // back the other way), and a face cannot be perpendicular to both. It is
      // the OUTGOING line that a racket face is square to in real play —
      // that is the line the face projects the ball along. Aiming at the
      // incoming bearing instead flipped the racket ~154° between the last
      // frame of the wind-up and the first of the follow-through.
      //
      // This is the same line the follow-through branch above uses one frame
      // later, which is what makes the stroke continuous across the strike.
      const nextTo = RALLY_ORDER[(legIdx + 2) % 4]!;
      aim = ballHeading(ballEnds[to]!, ballEnds[nextTo]!, 0);
      // It will strike at the end of this leg, where the ball arrives.
      intercept = ballAt(ballEnds[from]!, ballEnds[to]!, 1);
    }

    // The stroke's angle about the contact facing: negative behind the ball
    // (pulled back), 0 exactly ON it, positive past it (followed through).
    // Asymmetric, as a real stroke is — a short cock back, a long finish.
    const s = swingPhase(w);
    const rawPhase = s * (s < 0 ? BACKSWING : FOLLOW_THROUGH);

    // Turn onto the shot's line by the shortest way round, so a ball played
    // across the body never spins the racket the long way.
    //
    // `onLine` is 1 AT CONTACT — the racket exactly square to the shot, which
    // is the one instant that must be right — and eases to 0 with ZERO SLOPE
    // at both ends of the window, where the racket is back at its resting
    // angle. Squaring the cosine is what buys the zero slope: the plain
    // cosine arrived at the window edge still turning, so the swing angle and
    // this blend were both moving at the seam and the racket snapped ~86°
    // between two frames. It cannot be `hit` either: hit is 0 exactly at the
    // leg boundary, which is where contact is, so the aim was blended out at
    // the very instant it mattered.
    const onLine = swinging ? Math.cos((Math.PI / 2) * w) ** 2 : 0;
    // `rawPhase` is NOT faded by `onLine`: it already arrives at ±1 with zero
    // slope, and multiplying the two crushed the follow-through to a twelfth
    // of its arc — the racket stopping at the ball instead of swinging past.
    const phase = swinging ? rawPhase : 0;
    const sweep = pl.x < 0 ? 1 : -1;
    // The contact yaw: the head points ALONG the outgoing shot, so the string
    // bed faces down the line the ball leaves on and the face pushes it away.
    //
    // The head is the racket's local −z and the face normal its local +y, so
    // a yaw of `aim` puts the head on +shot. Opening the yaw out by 90°
    // instead — which is what "perpendicular" wrongly meant here — laid the
    // racket ACROSS the ball's path, presenting its RIM to the ball: the head
    // swept past sideways and the ball skimmed the edge instead of the
    // strings. Perpendicular is a property of the FACE NORMAL, not the
    // racket's long axis; the normal is square to the face by construction,
    // so pointing the head down the shot is what squares the face to it.
    const square = aim;
    // NOT gated on camK. Yaw is the sweep across the court — the one rotation
    // a top-down camera can actually see — and the Book tab opens top-down.
    // Scaling it by camK switched the entire stroke off in that view, leaving
    // four rackets sitting at their mount angles while the ball flew past.
    const facing = rest + angleDelta(rest, square) * onLine;
    // The racket does NOT translate through the stroke: the swing is rotation
    // in place (plus the idle drift every racket always has). A step toward
    // the ball mid-stroke read as the racket lunging about the court. Instead
    // the flat view PLACES the racket a constant REACH beside its ball point
    // (FLAT_OFFSET, fading out as the court pitches), so the ball meets the
    // strings at contact rather than the handle.
    const off = FLAT_OFFSET[i]!;
    // The resting flat placement: beside this racket's own ball point.
    const restX = position.x + off.x * (1 - camK);
    const restZ = position.z + off.z * (1 - camK);

    // Top view only: step to the interception point and WAIT there. The hand
    // goes REACH back from the ball along the contact perpendicular, so it is
    // the STRINGS that stand on the point the ball is flying to. `plantEase`
    // holds this at full extension from mid wind-up through contact, which is
    // what makes the ball fly into a planted face instead of meeting a racket
    // that is still closing on it.
    let px = restX;
    let py = position.y;
    let pz = restZ;
    // The receiver's approach runs on its OWN clock, starting at APPROACH_U
    // and reaching the interception point by the time the wind-up begins —
    // the racket walks to the ball over most of the leg instead of covering
    // 2 m inside the 27-frame stroke window (a 0.17 m/frame lurch).
    const approaching = i === to && u > APPROACH_U && camK < 1;
    if ((intercept || approaching) && camK < 1) {
      const target = intercept ?? ballAt(ballEnds[from]!, ballEnds[to]!, 1);
      // Plant the HAND, not the strings: the hand goes REACH back from the
      // interception point along the CONTACT yaw, so at the moment of contact
      // — and only then, since that is when the racket's yaw equals the
      // contact yaw — the head swings onto the ball exactly.
      //
      // Pinning the strings there instead held the head still on the ball
      // through the whole stroke: the position cancelled the rotation, so the
      // racket stopped sweeping and simply rotated about its own head. The
      // hand is the pivot; it is what stands and waits while the head swings.
      // `square` IS that contact yaw: the angle the racket passes through as
      // it strikes, before `onLine` blends it back toward rest and before the
      // stroke's own rotation is added. Both of those are zero at contact.
      // Lying flat, the head's full reach separates hand from strings.
      const yaw = intercept ? square : ballHeading(ballEnds[to]!, ballEnds[RALLY_ORDER[(legIdx + 2) % 4]!]!, 0);
      // At contact the head is tipped fully down, so it is CONTACT_PITCH —
      // not the resting cant — that sets how much of the reach is horizontal.
      const flat = REACH * Math.cos(CONTACT_PITCH);
      const handX = target.x + flat * Math.sin(yaw);
      const handZ = target.z + flat * Math.cos(yaw);
      // Before the stroke window opens, `w` is undefined for this racket —
      // ease in on the approach's own progress instead, arriving at 1 exactly
      // as the wind-up (and with it plantEase) takes over.
      const e =
        (intercept
          ? plantEase(w)
          : smooth(Math.min(1, (u - APPROACH_U) / (1 - WINDUP_U - APPROACH_U)))) *
        (1 - camK);
      px = restX + (handX - restX) * e;
      pz = restZ + (handZ - restZ) * e;
      // …and the same for HEIGHT. The plant used to set x and z only, so the
      // head was steered onto the ball horizontally while still hanging
      // REACH·sin(CONTACT_PITCH) below it — the ball passing over a racket
      // that was in the right place on the floor plan but the wrong place in
      // the air. At contact the racket is tipped nose-down, so the head sits
      // BELOW the hand and the hand must ride correspondingly higher.
      const handY = target.y - REACH * Math.sin(CONTACT_PITCH);
      py = position.y + (handY - position.y) * e;
    }

    return {
      position: v3(px, py, pz),
      rotation: v3(
        // Pitch: canted at rest, TIPPING DOWN through the strike.
        //
        // At rest the top view keeps the face turned toward the camera — you
        // look DOWN ON the racket, which is the point of the view — but not
        // dead flat. At exactly 0 the racket lies parallel to the court, the
        // camera sees a pure silhouette with no depth anywhere on it, and
        // four solid objects read as four 2D cut-outs pasted on the turf.
        // TOP_CANT tips them off that plane just far enough for the frame,
        // the rim and the grip to catch the light down one side and throw
        // their own shadow.
        //
        // Then the stroke drives the head DOWN onto the ball: STRIKE_TIP more
        // pitch at the moment of contact, easing back to the resting cant
        // either side of it. It rides `hit` — the strike-proximity pulse,
        // which is 1 exactly at the ball — not `phase`, which is 0 there and
        // would have put the deepest tip at the two ends of the stroke, the
        // racket dipping where it should be level and level where it should
        // be chopping through the ball.
        // SUBTRACTED, not added: in this Euler convention a larger rotation.x
        // lifts the head (the racket rocking back), so adding the tip raised
        // the head 55 cm instead of dropping it. Subtracting swings the whole
        // racket — head and grip together about the butt — nose DOWN onto the
        // ball, which is the strike.
        //
        // Gated on (1 − camK): this is a TOP-VIEW effect. The front view
        // already meets the ball square by standing the racket up and aiming
        // its face normal down the shot — a verified 3° — and letting the tip
        // through there swung it to 133° and destroyed that.
        //
        // On top of the chop, the WRIST: the head cocks UP through the
        // wind-up (max(0, −phase), the backswing half), carries LOW a beat
        // into the follow-through (max(0, phase)), and breathes a few degrees
        // while idle — each zero at contact, so the strings still land
        // exactly on the ball.
        lerp(TOP_CANT, STANDING_PITCH, camK) -
          STRIKE_TIP * hit * hit * (1 - camK) +
          (1 - camK) *
            (COCK_UP * Math.max(0, -phase) -
              CARRY_LOW * Math.max(0, phase) +
              IDLE_BREATH * Math.sin(t * 1.35 + pl.seed * 2.1) * (1 - hit)) -
          camK * HEAD_TILT * Math.abs(phase),
        // The stroke itself: `facing` is square to the shot AT the ball, and
        // `phase` carries the head back behind it, forward through it, and on
        // round into the follow-through — one continuous rotation, fastest at
        // the moment of contact. The idle wander is the hand making small
        // aimless adjustments between strokes; it fades with the aim blend
        // (× (1 − onLine)) so the contact yaw is untouched.
        facing +
          phase * sweep +
          (1 - camK) * IDLE_WANDER * Math.sin(t * 0.7 + pl.seed * 1.7) * (1 - onLine),
        // Flat view: lazy roll while idle plus the wrist ROLLING through the
        // stroke — the forearm turning over as the head whips through, which
        // costs nothing in accuracy (roll spins the racket about its own
        // handle axis, so the string bed stays put). Standing, the head lags
        // then leads as before.
        (1 - camK) * (0.12 * Math.sin(t * 1.1 + pl.seed) + 0.3 * phase) + camK * 0.4 * phase,
      ),
      hit,
    };
  });

  const ball = ballAt(ballEnds[from]!, ballEnds[to]!, u);

  // The disc lands where the sun (14, 13, 9) would cast it — the ratios are
  // that sun's x/y and z/y, so the ball's disc slides out from under it by
  // the same amount the rackets' real shadows do.
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
