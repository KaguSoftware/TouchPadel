/**
 * The Play (Join) tab's court: the next open match, as pure numbers (Majed,
 * 2026-10-12: "make the court show the next match's empty spots, tap one to
 * get to it, and make the taken seats warm up"). The sibling of rally.ts and
 * drill.ts: unit-tested here, merely applied to meshes in scene.ts
 * (`scene: 'join'`).
 *
 * WHAT IT CLAIMS, AND FROM WHAT. Every open match has four seats
 * (match_seats.seat_no 1..4). The server sends a seat COUNT (open_matches
 * `seats_taken` / `seats_left`, match_slots `seats_left`), never who sits where
 * and never a name, so the court claims the count and nothing else: N rackets
 * and 4 − N open spots. Seats fill in the order the match card's little court
 * fills them (apps/mobile components/play.tsx, MiniCourt: one pair first, the
 * reading start's, then the other), so the big court and the card always
 * agree. The page decides which match, and what the court shows when there is
 * none (`JoinSeats`); this file only draws it.
 *
 * THE TAKEN SEATS WARM UP. One ball, passed between the taken rackets only,
 * softer and slower than the Book tab's rally: a cross-court ball bounces once,
 * a pass to a partner on the same side is a volley with no bounce, and a racket
 * alone does keepy-ups. The ball never goes to an open spot. Each strike is the
 * Book tab's swing clip (rally.racketPose), as the drill's are; the keepy-ups
 * are not strokes, so a racket alone holds its ready stance and the ball comes
 * back to its face.
 *
 * ONE CYCLE, FROM A STANDING START. Whenever the taken seats change the warm-up
 * starts again: the first racket tosses the ball up off its own face (the ball
 * grows into being, as the drill's does out of the barrel), strikes it on the
 * way down at JOIN_LEAD, and from then on every leg runs from the racket that
 * struck to the next one in the order (warmupOrder). Local time τ is seconds
 * since that start; τ < 0 is the gap while a new racket lands, with no ball.
 *
 * SEEN FROM ABOVE, HORIZONTAL (camera.ts, topCameraPose): screen right is the
 * court's −z half, screen up −x. The spots are the rally's four (PLAYERS).
 *
 * Units are rally.ts's: metres, seconds, radians; +z is the near end.
 */
import { clamp01, lerp } from './spec';
import {
  BALL_RADIUS,
  PLAYERS,
  playerYaw,
  RALLY_ORDER,
  racketPose,
  type RacketPose,
} from './rally';
import { SWING_CONTACT, v3, type Vec3 } from './swing';

/** Four seats, always (match_seats.seat_no 1..4). */
export const JOIN_SEATS = 4;

/**
 * What the page asks the court to show. `taken` seats get a warming-up racket
 * (0..4), and when `spots` is on every other seat gets the open-spot mark.
 * `mirror` puts the first seats on the right, as the card's court does in a
 * right-to-left layout.
 *
 *   · the next open match: taken = its seats taken, spots on;
 *   · no open match at all: taken 0, spots on (all four are open: start one);
 *   · nothing to claim (still loading): taken 0, spots off, an empty court;
 *   · nothing to show (matches off, the Tournaments filter): taken 4, spots off.
 */
export interface JoinSeats {
  taken: number;
  spots: boolean;
  mirror: boolean;
}

/**
 * Seat → rally player (PLAYERS index), in fill order. Left to right the card's
 * first seat is its top-left one: screen-left is the court's +z half and
 * screen-up −x, so PLAYERS[2] (x −2.3, z +6.3), then its partner below, then
 * the far pair top to bottom. Mirrored, the pairs swap halves.
 */
const SEAT_PLAYER = {
  ltr: [2, 3, 0, 1],
  rtl: [0, 1, 2, 3],
} as const;

/** The rally player standing in seat `seat` (0-based, fill order). */
export function seatPlayer(seat: number, mirror: boolean): number {
  return SEAT_PLAYER[mirror ? 'rtl' : 'ltr'][seat]!;
}

/**
 * How far an open spot's mark sits nearer the net than the racket stands: the
 * rally's spots are 0.7 m inside the service line, which a 1.4 m mark would
 * touch. A racket that lands on the spot lands on its own spot, 0.25 m away,
 * which no eye can tell from above.
 */
const SPOT_IN = 0.25;

/** Where rally player `player`'s open-spot mark is on the turf: ground x, z. */
export function playerSpot(player: number): { x: number; z: number } {
  const p = PLAYERS[player]!;
  return { x: p.x, z: p.z - Math.sign(p.z) * SPOT_IN };
}

/** Where seat `seat`'s open-spot mark is on the turf: ground x, z. The page's touch target sits on it. */
export function seatSpot(seat: number, mirror: boolean): { x: number; z: number } {
  return playerSpot(seatPlayer(seat, mirror));
}

/** The players (PLAYERS indices) in the first `taken` seats. */
export function takenPlayers(seats: Pick<JoinSeats, 'taken' | 'mirror'>): number[] {
  const n = Math.max(0, Math.min(JOIN_SEATS, Math.floor(seats.taken)));
  const out: number[] = [];
  for (let s = 0; s < n; s++) out.push(seatPlayer(s, seats.mirror));
  return out;
}

/**
 * The order the ball goes round: the taken players in the rally's own order
 * (RALLY_ORDER, A → D → B → C), which alternates the two halves wherever the
 * seats allow, so a full court crosses the net on every leg and a partial one
 * crosses it as often as it can.
 */
export function warmupOrder(players: readonly number[]): number[] {
  return RALLY_ORDER.filter((p) => players.includes(p));
}

/** The warm-up's tempo, seconds. */
export const JOIN_TIMING = {
  /** The opening toss: off the first racket's face, struck on the way down. */
  lead: 1.0,
  /** A leg between two rackets (the rally's is 1.3: this is a warm-up). */
  leg: 1.5,
  /** A keepy-up, for a racket alone. */
  keepy: 1.0,
  /** The ball growing into being at the start of a cycle. */
  emerge: 0.2,
} as const;

/** Local time of the first strike. */
export const JOIN_LEAD = JOIN_TIMING.lead;

/**
 * Reduce Motion's still frame, in local time: the first strike, the ball on the
 * first racket's face. The rally's still frame is its first strike too.
 */
export const JOIN_REST_LOCAL = JOIN_LEAD;

/** One leg's length for an order of n rackets. */
export const legSeconds = (n: number): number => (n <= 1 ? JOIN_TIMING.keepy : JOIN_TIMING.leg);

/** Arc heights, metres over the chord. */
const KEEPY_H = 1.2;
const VOLLEY_H = 0.9;
const CROSS = { split: 0.6, bounceAt: 0.75, h1: 1.5, h2: 0.5 } as const;

/** Positive remainder, exact for a v already inside [0, m). */
const mod = (v: number, m: number): number => {
  const r = v % m;
  return r < 0 ? r + m : r;
};
const smooth = (u: number): number => u * u * (3 - 2 * u);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

/**
 * Racket `player` at local time τ, wall time t: rally.racketPose, with the clip
 * phased so SWING_CONTACT lands on each of its strikes. Strike k (k ≥ 0) is at
 * JOIN_LEAD + k · leg by order[k mod n], so the racket at place j strikes every
 * n legs from JOIN_LEAD + j · leg. Its clip's 2.2 s window fits between its
 * strikes for any n ≥ 2 (two rackets: 3 s apart). Alone, a racket never swings.
 * Not in the order (an open seat), it stands at rest: the scene hides it.
 */
function racketAt(
  player: number,
  order: readonly number[],
  tau: number,
  t: number,
  camK: number,
): RacketPose {
  const pl = PLAYERS[player]!;
  const yaw = playerYaw(pl);
  const j = order.indexOf(player);
  const n = order.length;
  if (j < 0 || n < 2) return racketPose(pl, yaw, -1, t, camK);
  const leg = legSeconds(n);
  const since = tau - (JOIN_LEAD + j * leg) + SWING_CONTACT;
  return racketPose(pl, yaw, since < 0 ? -1 : mod(since, n * leg), t, camK);
}

/** Which leg τ falls in: −1 is the opening toss. `u` is 0..1 through it. */
function legAt(tau: number, n: number): { leg: number; u: number; start: number } {
  if (tau < JOIN_LEAD) return { leg: -1, u: clamp01(tau / JOIN_LEAD), start: 0 };
  const len = legSeconds(n);
  const s = (tau - JOIN_LEAD) / len;
  let leg = Math.floor(s);
  let u = s - leg;
  // A τ on a leg's start within float noise is that leg's u = 0, not the last one's u ≈ 1.
  if (u > 1 - 1e-9) {
    leg += 1;
    u = 0;
  }
  return { leg, u, start: JOIN_LEAD + leg * len };
}

interface LegEnds {
  from: number;
  to: number;
  A: Vec3;
  B: Vec3;
}

/**
 * A leg's two ends, each read off its racket at ITS OWN moment (rally.legEnds):
 * the striker's face when the ball leaves, the receiver's when it arrives. The
 * toss (leg −1) runs from the first racket's face back to it.
 */
function legEnds(
  leg: number,
  order: readonly number[],
  tau0: number,
  camK: number,
): LegEnds {
  const n = order.length;
  const len = legSeconds(n);
  const startTau = leg < 0 ? 0 : JOIN_LEAD + leg * len;
  const endTau = leg < 0 ? JOIN_LEAD : startTau + len;
  const from = leg < 0 ? order[0]! : order[mod(leg, n)]!;
  const to = leg < 0 ? order[0]! : order[mod(leg + 1, n)]!;
  // Wall time and local time run together: t = τ + tau0.
  return {
    from,
    to,
    A: racketAt(from, order, startTau, startTau + tau0, camK).contact,
    B: racketAt(to, order, endTau, endTau + tau0, camK).contact,
  };
}

/** The ball u of the way along a leg. */
function ballOnLeg(e: LegEnds, u: number): Vec3 {
  if (e.from === e.to) {
    // A keepy-up (or the opening toss): straight up off the face and back down onto it.
    return { ...lerp3(e.A, e.B, u), y: lerp(e.A.y, e.B.y, u) + KEEPY_H * Math.sin(Math.PI * u) };
  }
  if (Math.sign(PLAYERS[e.from]!.z) === Math.sign(PLAYERS[e.to]!.z)) {
    // Partners on one side: a volley across to the other, no bounce.
    return { ...lerp3(e.A, e.B, u), y: lerp(e.A.y, e.B.y, u) + VOLLEY_H * Math.sin(Math.PI * u) };
  }
  // Over the net: rally.ts's two arcs, lower.
  const bounce = { ...lerp3(e.A, e.B, CROSS.bounceAt), y: BALL_RADIUS };
  if (u < CROSS.split) {
    const w = u / CROSS.split;
    return { ...lerp3(e.A, bounce, w), y: lerp(e.A.y, bounce.y, w) + CROSS.h1 * Math.sin(Math.PI * w) };
  }
  const w = (u - CROSS.split) / (1 - CROSS.split);
  return { ...lerp3(bounce, e.B, w), y: lerp(bounce.y, e.B.y, w) + CROSS.h2 * Math.sin(Math.PI * w) };
}

/** The ball's scale at τ: nothing before the cycle, growing into being, then whole. */
function ballScaleAt(tau: number): number {
  if (tau < 0) return 0;
  return tau < JOIN_TIMING.emerge ? smooth(tau / JOIN_TIMING.emerge) : 1;
}

export interface WarmupState {
  /** Every rally player's racket (the scene shows only the taken seats'). */
  rackets: RacketPose[];
  ball: Vec3;
  /** 0 = not drawn (no cycle yet, or no racket at all); grows to 1 at a cycle's start. */
  ballScale: number;
  /**
   * The local time the ball's current flight began: the trail's ghosts draw only
   * after it, so they never reach back through the racket that struck it.
   * Infinity when there is no ball.
   */
  trailFrom: number;
  /** The ball's ground disc, as rally.ts casts it, scaled with the ball. */
  shade: { x: number; z: number; scale: number; opacity: number };
}

/**
 * The warm-up at local time τ (seconds since this cycle began; t = τ + tau0 is
 * the wall time the rackets' idle drift runs on) for the players in `order`
 * (warmupOrder), at eased pitch progress camK (0 in the top view).
 */
export function warmupAt(
  order: readonly number[],
  tau: number,
  tau0: number,
  camK: number,
): WarmupState {
  const t = tau + tau0;
  const rackets = PLAYERS.map((_, i) => racketAt(i, order, tau, t, camK));
  const n = order.length;
  if (n === 0 || tau < 0) {
    return {
      rackets,
      ball: v3(0, BALL_RADIUS, 0),
      ballScale: 0,
      trailFrom: Infinity,
      shade: { x: 0, z: 0, scale: 0, opacity: 0 },
    };
  }
  const { leg, u, start } = legAt(tau, n);
  const ball = ballOnLeg(legEnds(leg, order, tau0, camK), u);
  const scale = ballScaleAt(tau);
  const hs = 1 - Math.min(1, ball.y / 3);
  return {
    rackets,
    ball,
    ballScale: scale,
    trailFrom: start,
    shade: {
      x: ball.x - ball.y * 0.2,
      z: ball.z - ball.y * 0.33,
      scale: (0.8 + 0.3 * hs) * scale,
      opacity: (0.16 + 0.14 * hs) * scale,
    },
  };
}

/**
 * The ball alone, for the trail's ghosts: `warmupAt(…).ball` and `.ballScale`
 * to the bit, re-posing the leg's two rackets only when the leg, the order, the
 * cycle or camK changes (the same saving as rally.ballSampler). One per scene.
 */
export function warmupBallSampler(): (
  order: readonly number[],
  tau: number,
  tau0: number,
  camK: number,
) => { ball: Vec3; scale: number } {
  let key = '';
  let ends: LegEnds | null = null;
  return (order, tau, tau0, camK) => {
    const n = order.length;
    if (n === 0 || tau < 0) return { ball: v3(0, BALL_RADIUS, 0), scale: 0 };
    const { leg, u } = legAt(tau, n);
    const k = `${order.join()}|${leg}|${tau0}|${camK}`;
    if (ends === null || k !== key) {
      ends = legEnds(leg, order, tau0, camK);
      key = k;
    }
    return { ball: ballOnLeg(ends, u), scale: ballScaleAt(tau) };
  };
}

// ── Coming and going (only ever because the server said so) ────────────────

/**
 * How long a seat's change takes, seconds. A racket that arrives drops onto its
 * spot (seen from above, nearer is bigger: it settles from 1.3× to 1×); one that
 * leaves shrinks away, faster, because the eye has already moved on. An open
 * spot settles in from 0.9× as it fades up, and fades out a touch smaller.
 * Never looped: each plays once, when a refetch changed the count.
 */
export const JOIN_CHANGE = {
  racketIn: 0.35,
  racketOut: 0.2,
  spotIn: 0.3,
  spotOut: 0.2,
} as const;

const easeOutQuart = (u: number): number => 1 - (1 - u) ** 4;
const easeInQuad = (u: number): number => u * u;

/** A racket's scale `since` seconds after it started arriving (`in`) or leaving. 0 = not drawn. */
export function racketPresence(entering: boolean, since: number): number {
  if (entering) {
    const s = clamp01(since / JOIN_CHANGE.racketIn);
    return 1 + 0.3 * (1 - easeOutQuart(s));
  }
  const s = clamp01(since / JOIN_CHANGE.racketOut);
  return 1 - easeInQuad(s);
}

/** An open spot's opacity and scale `since` seconds after it started appearing or going. */
export function spotPresence(entering: boolean, since: number): { opacity: number; scale: number } {
  if (entering) {
    const e = easeOutQuart(clamp01(since / JOIN_CHANGE.spotIn));
    return { opacity: e, scale: lerp(0.9, 1, e) };
  }
  const s = clamp01(since / JOIN_CHANGE.spotOut);
  return { opacity: 1 - s, scale: lerp(1, 0.96, s) };
}
