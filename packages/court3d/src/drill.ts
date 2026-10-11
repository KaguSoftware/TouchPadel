/**
 * The Coaches tab's court: a coaching drill, as pure numbers (Majed,
 * 2026-10-11: "a person standing and watching next to a ball dispensing machine
 * on the right side of the court and it shoots balls in order to 4 rackets on
 * the left, at their turn it does the swing animation identical to the one of
 * book page"). The sibling of rally.ts: unit-tested here, merely applied to
 * meshes in scene.ts (`scene: 'drill'`), with the machine's and the coach's
 * meshes in drillProps.ts.
 *
 * SEEN FROM ABOVE, HORIZONTAL (Majed, 2026-10-11). The Coaches page draws
 * the drill in the top view (camera.ts, topCameraPose): straight down, the
 * court's length running left to right, the net (z = 0) a vertical line in the
 * middle, screen-right the court's z < 0 half and screen-up −x. Left and right
 * below are the SCREEN's, and the same in Arabic: the court is a picture, not
 * a reading order. (In the Book view the same layout would read portrait,
 * machine at the top; nothing uses the drill there.)
 *
 *   · The machine stands on the right half (z −6), a little below the
 *     middle, with the coach beside it toward the top, facing the rackets.
 *   · The four rackets stand in a column across the left half (z +5), top to
 *     bottom on the screen (x −3.6 → +3.6), so "in order" reads downward.
 *   · Every feed flies right to left across the net; every return comes back
 *     left to right and lands short of the machine.
 *
 * drill.test.ts projects all of it through the top camera to pin it.
 *
 * ONE FEED A PERIOD, ONE BALL ON THE COURT. Each DRILL_PERIOD (2.5 s) is one
 * ball's whole life, in order:
 *
 *   emerge  0.20 s  the ball grows out of the barrel's mouth (scale 0 → 1)
 *   hold    0.25 s  loaded: it sits in the mouth, the barrel aimed
 *   feed    1.00 s  out of the machine, one bounce, onto the racket's face
 *   ─────── contact at DRILL_CONTACT (1.45 s): the swing clip's SWING_CONTACT
 *   return  0.80 s  struck back to the right half, one bounce, landing clear of
 *                   the machine and the coach
 *   vanish  0.25 s  it rolls on a little and shrinks to nothing on the turf
 *
 * and the next period's ball only appears once this one is gone, so a return
 * can never meet the next feed: there is never a second ball to meet. The
 * period starts and ends at scale 0, so the loop is seamless, and the jump
 * from the landing spot back to the nozzle happens while the ball is not drawn.
 *
 * THE SWING IS THE BOOK TAB'S, NOT A COPY. Every racket is rally.racketPose:
 * the same rig maths, the same idle drift, the same swing.ts clip. The drill
 * only says WHEN: racket i's clip is phased so SWING_CONTACT lands on its
 * feed's contact, 0.86 s of wind-up while the ball is in the air toward it,
 * then 1.34 s of follow-through. Its 2.2 s window [contact − 0.86, contact +
 * 1.34] sits inside [i·P + 0.59, i·P + 2.79], and the next racket's starts at
 * (i + 1)·P + 0.59, so at any instant at most one racket is off its rest
 * stance — the one whose turn it is — and there is a 0.3 s beat of stillness
 * between strokes. The other three hold the rally's ready stance (its idle
 * drift, nothing more).
 *
 * The machine's barrel turns to the NEXT racket only after the current ball
 * has been struck (from contact + 0.3 s to the period's end), so it is still
 * while a ball sits in it. The coach's head follows it there a beat later.
 *
 * THE COACH'S ARMS (Majed, 2026-10-11: "make the person standing in coach do
 * more movement maybe with his hands"). Seen from straight above an arm only
 * reads when it moves in the horizontal plane, so every gesture is a sweep you
 * can see from the top: hands on hips (elbows out to the sides) between balls;
 * as the ball leaves the barrel the right arm swings out and points at the
 * racket being fed; just after the strike both arms come forward and clap, a
 * "good"; then back to the hips. The feet never move: the body sways and
 * shifts its weight a few centimetres, slowly. Keyed on the period (COACH_KEYS),
 * so each gesture lands on the same beat of every ball, and the period starts
 * and ends on the hips, so the loop is seamless. Reduce Motion's frame
 * (DRILL_REST_T) is hands on hips.
 *
 * Units are rally.ts's: metres, seconds, radians; +z is the near end.
 */
import { clamp01, lerp } from './spec';
import { BALL_RADIUS, racketPose, type RacketPose, type RacketSpot } from './rally';
import { addV, applyEulerYXZ, SWING_CONTACT, SWING_DURATION, v3, type Vec3 } from './swing';

/** One ball's life, in seconds (see the header). */
export const DRILL_TIMING = {
  emerge: 0.2,
  hold: 0.25,
  feed: 1.0,
  ret: 0.8,
  vanish: 0.25,
} as const;

/** Period-local time the ball leaves the barrel. */
export const DRILL_LAUNCH = DRILL_TIMING.emerge + DRILL_TIMING.hold;
/** Period-local time the ball meets the racket's face: the swing clip's SWING_CONTACT. */
export const DRILL_CONTACT = DRILL_LAUNCH + DRILL_TIMING.feed;
/** Period-local time the return lands and starts to roll out. */
const LANDED = DRILL_CONTACT + DRILL_TIMING.ret;
/** One feed, one ball, from appearing in the barrel to gone. */
export const DRILL_PERIOD = LANDED + DRILL_TIMING.vanish;

export interface DrillPlayer extends RacketSpot {
  /**
   * The stance's yaw: mount +Z (the way the stroke drives, swing.ts) pointed
   * at this racket's return landing spot, so the head goes into the ball the
   * way the ball then leaves.
   */
  yaw: number;
  /** Where the struck ball lands, on the right half: ground x, z. */
  returnTo: { x: number; z: number };
}

/** The ball machine: on the screen's right half of the court (z < 0), back from the net. */
export const MACHINE = {
  x: 0.6,
  z: -6.0,
  /** The barrel's pivot height (the drum's centre). */
  pivotY: 0.8,
  /** Pivot to the mouth, along the barrel. */
  barrel: 0.95,
  /** The barrel's fixed elevation: a feeding lob. */
  pitch: 0.42,
  /** How far the barrel kicks back at a launch, metres along it. */
  recoil: 0.08,
} as const;

/** The coach: beside the machine, a little above it on the screen. */
export const COACH = { x: -1.5, z: -6.7 } as const;

/** The rackets' column across the left half (z > 0), top of the screen (−x) to bottom. */
const COLUMN_Z = 5.0;
/** Where the returns land: back across the net, short of the machine. */
const RETURN_Z = -3.6;
const SPOTS = [
  { x: -3.6, seed: 0.0 },
  { x: -1.2, seed: 1.7 },
  { x: 1.2, seed: 3.1 },
  { x: 3.6, seed: 4.4 },
] as const;

/** Heading of the ground vector (dx, dz), as a yaw: mount +Z = (sin yaw, cos yaw). */
const heading = (dx: number, dz: number): number => Math.atan2(dx, dz);

/**
 * The four rackets. All forehands (hand +1): a queue of players taking the same
 * drill, where the rally's alternating hands are two pairs facing each other.
 */
export const DRILL_PLAYERS: readonly DrillPlayer[] = SPOTS.map((s) => {
  const returnTo = { x: s.x * 1.1, z: RETURN_Z };
  return {
    x: s.x,
    z: COLUMN_Z,
    seed: s.seed,
    hand: 1 as const,
    yaw: heading(returnTo.x - s.x, returnTo.z - COLUMN_Z),
    returnTo,
  };
});

/** One whole loop: every racket fed once, in order. */
export const DRILL_LOOP = DRILL_PERIOD * DRILL_PLAYERS.length;

/** The barrel's yaw when it feeds racket i: at the racket's spot. */
export function machineAim(i: number): number {
  const p = DRILL_PLAYERS[i]!;
  return heading(p.x - MACHINE.x, p.z - MACHINE.z);
}

/** The coach faces the middle of the rackets' column. */
export const COACH_YAW = heading(0 - COACH.x, COLUMN_Z - COACH.z);

/** How far the coach's head may turn off the body's heading. */
const HEAD_LIMIT = 1.2;

/** The coach's head toward racket i, relative to the body, wrapped and clamped. */
function headToward(i: number): number {
  const p = DRILL_PLAYERS[i]!;
  let a = heading(p.x - COACH.x, p.z - COACH.z) - COACH_YAW;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return Math.max(-HEAD_LIMIT, Math.min(HEAD_LIMIT, a));
}

// ── The coach's arms ────────────────────────────────────────────────────────

/**
 * One arm, as the rig in drillProps.ts holds it. The shoulder turns `yaw` about
 * the body's vertical (0 = forward, +z), then lifts the arm `lift` from hanging
 * down (π/2 = straight out); the elbow then bends the forearm `bend` further the
 * same way (negative folds it back in: the hand on the hip). Euler YXZ on the
 * shoulder: (−lift, yaw, 0); on the elbow: (−bend, 0, 0).
 */
export interface ArmPose {
  yaw: number;
  lift: number;
  bend: number;
}

/** The arm's build, metres, in the coach's body frame (+z forward, +x the coach's left). */
export const COACH_ARM = {
  /** Shoulder height and how far out from the spine. */
  shoulderY: 1.52,
  shoulderX: 0.32,
  upper: 0.3,
  fore: 0.3,
} as const;

/** −1 is the coach's right arm (−x, facing +z), +1 the left. */
export type ArmSide = -1 | 1;

/** Hands on hips, elbows out and a touch back: the resting stance. */
const hips = (side: ArmSide): ArmPose => ({
  yaw: side * (Math.PI / 2 + 0.25),
  lift: 0.75,
  bend: -1.9,
});
/** Both arms forward and a little apart: the clap's wind-up and follow-through. */
const clapOpen = (side: ArmSide): ArmPose => ({ yaw: -side * 0.25, lift: 1.15, bend: 0.35 });
/** Hands together in front of the chest. */
const clap = (side: ArmSide): ArmPose => ({ yaw: -side * 0.56, lift: 1.15, bend: 0.35 });

/** The coach's shoulder in court metres (sway and weight shift left out: a few cm). */
export function coachShoulder(side: ArmSide): Vec3 {
  return addV(
    v3(COACH.x, 0, COACH.z),
    applyEulerYXZ(v3(side * COACH_ARM.shoulderX, COACH_ARM.shoulderY, 0), v3(0, COACH_YAW, 0)),
  );
}

/** The right arm pointing at racket i: aimed from the shoulder itself, a touch under level. */
function point(i: number): ArmPose {
  const p = DRILL_PLAYERS[i]!;
  const s = coachShoulder(-1);
  let yaw = heading(p.x - s.x, p.z - s.z) - COACH_YAW;
  while (yaw > Math.PI) yaw -= 2 * Math.PI;
  while (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { yaw, lift: 1.45, bend: 0.1 };
}

type Key = readonly [u: number, pose: (feed: number) => ArmPose];
/**
 * Each arm's key poses through one period (period-local seconds), eased between
 * with a smoothstep. The right arm points from just after the launch until the
 * ball is nearly there, claps just after the contact (1.45 s), and is back on
 * the hip well before the next ball; the left only joins for the clap, setting
 * off early so no sweep is faster than about 8 rad/s (a 45 fps frame
 * carries under 0.2 rad of it).
 */
export const COACH_KEYS: { right: readonly Key[]; left: readonly Key[] } = {
  right: [
    [0, () => hips(-1)],
    [DRILL_LAUNCH, () => hips(-1)],
    [DRILL_LAUNCH + 0.45, point],
    [DRILL_CONTACT - 0.2, point],
    [DRILL_CONTACT, () => clapOpen(-1)],
    [DRILL_CONTACT + 0.17, () => clap(-1)],
    [DRILL_CONTACT + 0.45, () => clapOpen(-1)],
    [DRILL_CONTACT + 0.95, () => hips(-1)],
    [DRILL_PERIOD, () => hips(-1)],
  ],
  left: [
    [0, () => hips(1)],
    [DRILL_CONTACT - 0.4, () => hips(1)],
    [DRILL_CONTACT, () => clapOpen(1)],
    [DRILL_CONTACT + 0.17, () => clap(1)],
    [DRILL_CONTACT + 0.45, () => clapOpen(1)],
    [DRILL_CONTACT + 0.95, () => hips(1)],
    [DRILL_PERIOD, () => hips(1)],
  ],
};

/** An arm u seconds into a period feeding racket `feed`. */
function armAt(keys: readonly Key[], feed: number, u: number): ArmPose {
  let i = 0;
  while (i < keys.length - 2 && u >= keys[i + 1]![0]) i += 1;
  const [ua, pa] = keys[i]!;
  const [ub, pb] = keys[i + 1]!;
  const w = smooth(clamp01((u - ua) / (ub - ua)));
  const a = pa(feed);
  const b = pb(feed);
  return {
    yaw: lerp(a.yaw, b.yaw, w),
    lift: lerp(a.lift, b.lift, w),
    bend: lerp(a.bend, b.bend, w),
  };
}

/** Where an arm's hand is, in the coach's body frame, for a pose. */
export function coachHand(pose: ArmPose, side: ArmSide): Vec3 {
  const fore = applyEulerYXZ(v3(0, -COACH_ARM.fore, 0), v3(-pose.bend, 0, 0));
  const arm = addV(v3(0, -COACH_ARM.upper, 0), fore);
  return addV(
    v3(side * COACH_ARM.shoulderX, COACH_ARM.shoulderY, 0),
    applyEulerYXZ(arm, v3(-pose.lift, pose.yaw, 0)),
  );
}

/** The barrel's mouth at yaw: where a ball sits loaded and where it leaves from. */
export function machineMouth(yaw: number): Vec3 {
  const reach = Math.cos(MACHINE.pitch) * MACHINE.barrel;
  return v3(
    MACHINE.x + Math.sin(yaw) * reach,
    MACHINE.pivotY + Math.sin(MACHINE.pitch) * MACHINE.barrel,
    MACHINE.z + Math.cos(yaw) * reach,
  );
}

/**
 * Reduce Motion's still frame: the ball loaded in the barrel, aimed at the
 * first racket, every racket at rest. The middle of the stretch where the ball
 * is in the mouth AND the last racket's follow-through from the loop before
 * has ended (it spills 0.29 s into each period, see the header).
 */
export const DRILL_REST_T =
  (Math.max(DRILL_TIMING.emerge, DRILL_CONTACT + (SWING_DURATION - SWING_CONTACT) - DRILL_PERIOD) +
    DRILL_LAUNCH) /
  2;

export type DrillPhase = 'emerge' | 'hold' | 'feed' | 'return' | 'vanish';

export interface DrillState {
  /** Which racket this period's ball is for (index into DRILL_PLAYERS). */
  feed: number;
  phase: DrillPhase;
  /** Seconds into the current period, [0, DRILL_PERIOD). */
  u: number;
  ball: Vec3;
  /** 1 in flight; grows out of the barrel and shrinks away on the turf. 0 = not drawn. */
  ballScale: number;
  /**
   * The rally time the ball's current flight began: the trail's ghosts draw
   * only at times after it, so they never reach back past the barrel or cut a
   * chord through the racket. Infinity while the ball is not flying (in the
   * barrel), when there is no trail at all.
   */
  trailFrom: number;
  rackets: RacketPose[];
  machine: {
    /** The barrel's yaw (mount +Z = (sin, cos)). */
    yaw: number;
    /** 1 at the launch, decaying to 0: the barrel's recoil, × MACHINE.recoil. */
    kick: number;
  };
  coach: {
    /** The head's turn off the body's heading. */
    head: number;
    /** The body's idle lean, radians about its own x (forward) and z (sideways). */
    sway: { x: number; z: number };
    /** The weight shift, metres along the body's own x, in step with the sideways lean. */
    shift: number;
    /** The two arms (see ArmPose). */
    arms: { right: ArmPose; left: ArmPose };
  };
  /** The ball's ground disc, as rally.ts casts it, faded with the ball. */
  shade: { x: number; z: number; scale: number; opacity: number };
}

const smooth = (u: number): number => u * u * (3 - 2 * u);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
/** Positive remainder, exact for a v already inside [0, m). */
const mod = (v: number, m: number): number => {
  const r = v % m;
  return r < 0 ? r + m : r;
};

/** Which period t falls in, and how far into it (s); a t on a boundary is the new period's 0. */
function periodAt(t: number): { k: number; u: number } {
  let k = Math.floor(t / DRILL_PERIOD);
  let u = Math.max(0, t - k * DRILL_PERIOD);
  if (u > DRILL_PERIOD - 1e-9) {
    k += 1;
    u = 0;
  }
  return { k, u };
}

const feedOf = (k: number): number => mod(k, DRILL_PLAYERS.length);

/** Rally time of period k's contact. */
const contactTime = (k: number): number => k * DRILL_PERIOD + DRILL_CONTACT;

/**
 * Racket i at time t: rally.racketPose with the clip phased onto its feeds.
 * Before its first contact's wind-up the racket is simply at rest (the clip's
 * window is never entered "from the loop before" on the first loop).
 */
function racketAt(i: number, t: number, camK: number): RacketPose {
  const pl = DRILL_PLAYERS[i]!;
  const since = t - contactTime(i) + SWING_CONTACT;
  return racketPose(pl, pl.yaw, since < 0 ? -1 : mod(since, DRILL_LOOP), t, camK);
}

interface Flight {
  /** The barrel's mouth when it fired. */
  mouth: Vec3;
  /** The racket's sweet spot AT the contact instant. */
  face: Vec3;
  /** The return's landing spot, on the turf. */
  land: Vec3;
  /** Unit ground direction the return travels, for the roll-out. */
  dir: { x: number; z: number };
}

/** Period k's ball: both ends read off the racket at the contact instant, as rally.legEnds does. */
function flightOf(k: number, camK: number): Flight {
  const i = feedOf(k);
  const face = racketAt(i, contactTime(k), camK).contact;
  const to = DRILL_PLAYERS[i]!.returnTo;
  const land = v3(to.x, BALL_RADIUS, to.z);
  const dx = land.x - face.x;
  const dz = land.z - face.z;
  const len = Math.hypot(dx, dz) || 1;
  return { mouth: machineMouth(machineAim(i)), face, land, dir: { x: dx / len, z: dz / len } };
}

/**
 * A two-arc flight from A to B, s ∈ [0, 1]: through the air to a bounce at
 * `bounceAt` of the way (reached at `split` of the time, peak h1 over the
 * chord), then a lower hop (peak h2) onto B. rally.ts's leg, with its own
 * numbers.
 */
function twoArc(
  A: Vec3,
  B: Vec3,
  s: number,
  split: number,
  bounceAt: number,
  h1: number,
  h2: number,
): Vec3 {
  const bounce = { ...lerp3(A, B, bounceAt), y: BALL_RADIUS };
  if (s < split) {
    const w = s / split;
    return { ...lerp3(A, bounce, w), y: lerp(A.y, bounce.y, w) + h1 * Math.sin(Math.PI * w) };
  }
  const w = (s - split) / (1 - split);
  return { ...lerp3(bounce, B, w), y: lerp(bounce.y, B.y, w) + h2 * Math.sin(Math.PI * w) };
}

/** How far the landed ball rolls on while it shrinks away. */
const ROLL = 0.5;

/** The ball u seconds into its period, given that period's flight. */
function ballOf(f: Flight, u: number): { ball: Vec3; scale: number; phase: DrillPhase } {
  if (u < DRILL_TIMING.emerge) {
    return { ball: f.mouth, scale: smooth(u / DRILL_TIMING.emerge), phase: 'emerge' };
  }
  if (u < DRILL_LAUNCH) return { ball: f.mouth, scale: 1, phase: 'hold' };
  if (u < DRILL_CONTACT) {
    const s = (u - DRILL_LAUNCH) / DRILL_TIMING.feed;
    return { ball: twoArc(f.mouth, f.face, s, 0.62, 0.72, 1.3, 0.55), scale: 1, phase: 'feed' };
  }
  if (u < LANDED) {
    const s = (u - DRILL_CONTACT) / DRILL_TIMING.ret;
    return { ball: twoArc(f.face, f.land, s, 0.66, 0.8, 1.1, 0.3), scale: 1, phase: 'return' };
  }
  const s = clamp01((u - LANDED) / DRILL_TIMING.vanish);
  const roll = ROLL * (1 - (1 - s) * (1 - s));
  const scale = 1 - smooth(s);
  return {
    ball: v3(f.land.x + f.dir.x * roll, BALL_RADIUS * scale, f.land.z + f.dir.z * roll),
    scale,
    phase: 'vanish',
  };
}

/** The barrel's yaw u seconds into period k: on this feed's racket, turning to the next after the strike. */
const TURN_FROM = DRILL_CONTACT + 0.3;
function barrelYaw(k: number, u: number): number {
  const now = machineAim(feedOf(k));
  if (u < TURN_FROM) return now;
  return lerp(now, machineAim(feedOf(k + 1)), smooth((u - TURN_FROM) / (DRILL_PERIOD - TURN_FROM)));
}

/** The coach's head: a beat behind the barrel, toward the racket it will feed next. */
const LOOK_FROM = DRILL_CONTACT + 0.45;
function coachHead(k: number, u: number): number {
  const now = headToward(feedOf(k));
  if (u < LOOK_FROM) return now;
  return lerp(now, headToward(feedOf(k + 1)), smooth((u - LOOK_FROM) / (DRILL_PERIOD - LOOK_FROM)));
}

/** The barrel's recoil: a hard kick at the launch, eased out over 0.35 s. */
function kickAt(u: number): number {
  const s = (u - DRILL_LAUNCH) / 0.35;
  if (s < 0 || s >= 1) return 0;
  return (1 - s) * (1 - s);
}

/** The shade only joins the ball once it has left the machine (it would lie on the drum). */
function shadeOf(ball: Vec3, scale: number, u: number) {
  const hs = 1 - Math.min(1, ball.y / 3);
  const away = u < DRILL_LAUNCH ? 0 : clamp01((u - DRILL_LAUNCH) / 0.15);
  return {
    x: ball.x - ball.y * 0.2,
    z: ball.z - ball.y * 0.33,
    scale: (0.8 + 0.3 * hs) * scale,
    opacity: (0.16 + 0.14 * hs) * scale * away,
  };
}

/**
 * The whole drill at time t (seconds since start) and eased pitch progress
 * camK, which stands the rackets up exactly as in the rally.
 */
export function drillAt(t: number, camK: number): DrillState {
  const { k, u } = periodAt(t);
  const flight = flightOf(k, camK);
  const { ball, scale, phase } = ballOf(flight, u);
  const start = k * DRILL_PERIOD;
  return {
    feed: feedOf(k),
    phase,
    u,
    ball,
    ballScale: scale,
    trailFrom:
      phase === 'feed'
        ? start + DRILL_LAUNCH
        : phase === 'return' || phase === 'vanish'
          ? start + DRILL_CONTACT
          : Infinity,
    rackets: DRILL_PLAYERS.map((_, i) => racketAt(i, t, camK)),
    machine: { yaw: barrelYaw(k, u), kick: kickAt(u) },
    coach: {
      head: coachHead(k, u),
      sway: { x: 0.015 * Math.sin(t * 0.53 + 0.4), z: 0.03 * Math.sin(t * 0.8) },
      shift: 0.05 * Math.sin(t * 0.8),
      arms: {
        right: armAt(COACH_KEYS.right, feedOf(k), u),
        left: armAt(COACH_KEYS.left, feedOf(k), u),
      },
    },
    shade: shadeOf(ball, scale, u),
  };
}

/**
 * The ball alone, for the trail's ghosts: `drillAt(t, camK)`'s ball and scale
 * to the bit, re-posing the racket only when the period or camK changes (the
 * same saving as rally.ballSampler). One sampler per scene.
 */
export function drillBallSampler(): (t: number, camK: number) => { ball: Vec3; scale: number } {
  let lastK = NaN;
  let lastCam = NaN;
  let flight: Flight | null = null;
  return (t, camK) => {
    const { k, u } = periodAt(t);
    if (flight === null || k !== lastK || camK !== lastCam) {
      flight = flightOf(k, camK);
      lastK = k;
      lastCam = camK;
    }
    const { ball, scale } = ballOf(flight, u);
    return { ball, scale };
  };
}
