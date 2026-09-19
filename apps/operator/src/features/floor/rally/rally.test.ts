// Copied from apps/mobile/src/features/courtTransition/__tests__/rally.test.ts
// (2026-09-18); the camera cases stayed with the phone. FLOOR cases at the end.
import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  layAngle,
  LEG_SECONDS,
  orderFor,
  LOOP_SECONDS,
  nextLegStart,
  PLAYERS,
  playerYaw,
  RACKET_Y,
  RALLY_ORDER,
  rallyAt,
} from './rally';
import { applyEulerYXZ, HEAD_ARM, RACKET_SCALE, SWING_CONTACT, SWING_DURATION } from './swing';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('rally (prototype updateRally)', () => {
  it('cycles A → D → B → C, 1.3 s a leg', () => {
    expect(RALLY_ORDER).toEqual([0, 3, 1, 2]);
    expect(rallyAt(0, 0).from).toBe(0);
    expect(rallyAt(0, 0).to).toBe(3);
    expect(rallyAt(LEG_SECONDS + 0.01, 0).from).toBe(3);
    expect(rallyAt(2 * LEG_SECONDS + 0.01, 0).from).toBe(1);
    expect(rallyAt(3 * LEG_SECONDS + 0.01, 0).from).toBe(2);
    expect(rallyAt(4 * LEG_SECONDS + 0.01, 0).from).toBe(0);
  });

  it('the ball leaves the striking FACE and lands on the receiving one', () => {
    const start = rallyAt(0, 0);
    expect(start.ball).toEqual(start.rackets[0]!.contact);
    const end = rallyAt(LEG_SECONDS - 1e-9, 0);
    const recv = end.rackets[3]!.contact;
    expect(near(end.ball.x, recv.x, 1e-6)).toBe(true);
    expect(near(end.ball.z, recv.z, 1e-6)).toBe(true);
    expect(near(end.ball.y, recv.y, 1e-6)).toBe(true);
  });

  it('the arc is fixed at the strike, so the follow-through does not drag it', () => {
    // A and B are read at the leg's own boundaries; the hitter's face keeps
    // moving for another 1.34 s and must not pull the ball's start with it.
    const legStart = rallyAt(0, 0).ball;
    for (const u of [0.2, 0.5, 0.9]) {
      const later = rallyAt(u * LEG_SECONDS, 0);
      const w = Math.min(u / 0.62, 1);
      if (u >= 0.62) continue;
      // The flight arc is a straight lerp in x/z from where the ball was struck.
      const bounceX = later.ball.x;
      expect(Math.sign(bounceX - legStart.x)).toBe(Math.sign(w));
    }
    // Same leg sampled twice: the launch point is the same both times.
    expect(rallyAt(0.4 * LEG_SECONDS, 0).ball).not.toEqual(rallyAt(0.5 * LEG_SECONDS, 0).ball);
    const a = rallyAt(0, 0).ball;
    const b = rallyAt(1e-12, 0).ball;
    expect(near(a.x, b.x, 1e-6) && near(a.z, b.z, 1e-6)).toBe(true);
  });

  it('two arcs: bounces on the ground at 62 % of the leg, peaks 1.9 m up in flight', () => {
    const atBounce = rallyAt(0.62 * LEG_SECONDS, 0);
    expect(near(atBounce.ball.y, BALL_RADIUS, 1e-6)).toBe(true);
    const mid = rallyAt(0.31 * LEG_SECONDS, 0);
    // halfway through the flight arc: lerp(A.y, 0.22, .5) + 1.9, where A is the
    // face that struck it, AT the strike (rallyAt(0) is that instant).
    const a = rallyAt(0, 0).rackets[0]!.contact.y;
    expect(near(mid.ball.y, (a + BALL_RADIUS) / 2 + 1.9, 1e-6)).toBe(true);
    expect(rallyAt(0.81 * LEG_SECONDS, 0).ball.y).toBeLessThan(1.2); // the low bounce arc
  });

  it('newLeg flags the first 2 % of a leg (trail reset)', () => {
    expect(rallyAt(0.01, 0).newLeg).toBe(true);
    expect(rallyAt(0.5, 0).newLeg).toBe(false);
  });

  it('rackets lie flat in the top view and stand up in the front view', () => {
    // The lay angle is the whole cheat, and it lives on a group nested inside
    // the swing — so the pose's own rotation.x is always 0.
    expect(near(layAngle(0), -Math.PI / 2)).toBe(true);
    expect(layAngle(1)).toBe(0);
    const flat = rallyAt(0.5 * LEG_SECONDS, 0);
    for (const r of flat.rackets) {
      expect(r.rotation.x).toBe(0);
      // The SWEET SPOT is what sits at racket height, not the group's origin.
      expect(near(r.contact.y, RACKET_Y.flat, 0.3)).toBe(true);
    }
    const up = rallyAt(0.5 * LEG_SECONDS, 1);
    for (const r of up.rackets) {
      expect(near(r.rotation.z, 0)).toBe(true); // the flat-view roll is gone
      expect(near(r.contact.y, RACKET_Y.standing, 0.3)).toBe(true);
      // Upright: the hand is down at hip height, the head up at the ball.
      expect(r.position.y).toBeLessThan(r.contact.y - 0.5);
    }
  });

  it('the racket goes INTO the ball: the head drives the way the ball leaves', () => {
    // The design file's clip travels the other way (its own "-Z is forward"
    // fights the face it builds); swing.ts mirrors it, and this is the guard.
    for (const [slot, from] of RALLY_ORDER.entries()) {
      const t = (slot + 4) * LEG_SECONDS; // a whole loop in, so t is never < 0
      const before = rallyAt(t - 0.02, 1).rackets[from]!.contact;
      const after = rallyAt(t + 0.02, 1).rackets[from]!.contact;
      const head = { x: after.x - before.x, y: after.y - before.y, z: after.z - before.z };
      const launch = rallyAt(t + 0.1, 1).ball;
      const start = rallyAt(t, 1).ball;
      const ball = { x: launch.x - start.x, y: launch.y - start.y, z: launch.z - start.z };
      const cos =
        (head.x * ball.x + head.y * ball.y + head.z * ball.z) /
        (Math.hypot(head.x, head.y, head.z) * Math.hypot(ball.x, ball.y, ball.z));
      expect(cos).toBeGreaterThan(0.7);
      // …and the drive is down the court, not across it.
      expect(Math.sign(head.z)).toBe(-Math.sign(PLAYERS[from]!.z));
    }
  });

  it('the head hangs one rigid arm off the hand, in every pose', () => {
    const arm = HEAD_ARM * RACKET_SCALE;
    for (const camK of [0, 0.5, 1]) {
      for (const t of [0, 0.4, 1.9, 4.4]) {
        for (const r of rallyAt(t, camK).rackets) {
          const hand = applyEulerYXZ(r.swing.position, r.rotation);
          expect(
            near(
              Math.hypot(
                r.contact.x - r.position.x - hand.x,
                r.contact.y - r.position.y - hand.y,
                r.contact.z - r.position.z - hand.z,
              ),
              arm,
              1e-9,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it('every player strikes on their own leg, once a loop', () => {
    // Contact is exact on the leg start: hit is 1 there and nowhere else.
    for (const [legIdx, player] of RALLY_ORDER.entries()) {
      const s = rallyAt(legIdx * LEG_SECONDS, 0);
      expect(s.from).toBe(player);
      expect(s.rackets[player]!.hit).toBe(1);
      for (const [i, r] of s.rackets.entries()) if (i !== player) expect(r.hit).toBeLessThan(1);
    }
    // …and holds the rest stance for the 3 s between strokes.
    const idle = SWING_DURATION + 0.1 - SWING_CONTACT;
    expect(rallyAt(idle, 0).rackets[0]!.hit).toBe(0);
    expect(near(rallyAt(idle, 0).rackets[0]!.hit, rallyAt(idle + LOOP_SECONDS, 0).rackets[0]!.hit))
      .toBe(true);
  });

  it('the receiver winds up through the leg the ball is flying at them', () => {
    // 0.86 s of anticipation: player 3 receives at the end of leg 0, so their
    // backswing starts two thirds of the way through it and builds to contact.
    const early = rallyAt(0.2 * LEG_SECONDS, 0);
    expect(early.rackets[3]!.hit).toBe(0); // still at rest
    const winding = rallyAt(0.6 * LEG_SECONDS, 0).rackets[3]!.hit;
    const later = rallyAt(0.85 * LEG_SECONDS, 0).rackets[3]!.hit;
    expect(winding).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(winding);
    expect(rallyAt(LEG_SECONDS, 0).rackets[3]!.hit).toBe(1); // the strike
  });

  it('the pair on each side of the court swing off opposite hands', () => {
    expect(PLAYERS.map((p) => p.hand)).toEqual([1, -1, 1, -1]);
    // Each at their OWN strike, so both are on the same frame of the clip.
    const at = (i: number) => rallyAt(RALLY_ORDER.indexOf(i as 0 | 1 | 2 | 3) * LEG_SECONDS, 0);
    for (const [a, b] of [
      [0, 1],
      [2, 3],
    ] as const) {
      const l = at(a).rackets[a]!.swing;
      const r = at(b).rackets[b]!.swing;
      expect(near(l.position.x, -r.position.x, 1e-9)).toBe(true);
      expect(near(l.position.z, r.position.z, 1e-9)).toBe(true);
      expect(near(l.rotation.y, -r.rotation.y, 1e-9)).toBe(true);
      expect(l.position.x).not.toBe(0);
    }
  });

  it('yaw: far pair faces −z, near pair +z, each angled toward the centre', () => {
    expect(playerYaw(PLAYERS[0]!)).toBe(0.3);
    expect(playerYaw(PLAYERS[1]!)).toBe(-0.3);
    expect(near(playerYaw(PLAYERS[2]!), Math.PI - 0.3)).toBe(true);
    expect(near(playerYaw(PLAYERS[3]!), Math.PI + 0.3)).toBe(true);
  });

  it('the ground disc sits opposite the sun and fades with height', () => {
    const s = rallyAt(0.31 * LEG_SECONDS, 0); // high ball
    expect(s.shade.x).toBeLessThan(s.ball.x);
    expect(s.shade.z).toBeLessThan(s.ball.z);
    const low = rallyAt(0.62 * LEG_SECONDS, 0);
    expect(low.shade.opacity).toBeGreaterThan(s.shade.opacity);
    expect(low.shade.scale).toBeGreaterThan(s.shade.scale);
  });
});

describe('nextLegStart (where the idle hold lands)', () => {
  it('is the next multiple of LEG_SECONDS, itself when already on one', () => {
    expect(near(nextLegStart(0), 0)).toBe(true);
    expect(near(nextLegStart(0.01), LEG_SECONDS)).toBe(true);
    expect(near(nextLegStart(LEG_SECONDS), LEG_SECONDS)).toBe(true);
    expect(near(nextLegStart(3 * LEG_SECONDS + 1.2), 4 * LEG_SECONDS)).toBe(true);
  });

  it('holds on the instant of contact: the ball ON the striking face', () => {
    for (const t of [0.4, 5.7, 12.9]) {
      const s = rallyAt(nextLegStart(t), 0);
      const striker = s.rackets[s.from]!;
      expect(near(s.ball.x, striker.contact.x, 1e-6)).toBe(true);
      expect(near(s.ball.z, striker.contact.z, 1e-6)).toBe(true);
      expect(near(s.ball.y, striker.contact.y, 1e-6)).toBe(true);
      expect(near(striker.hit, 1, 1e-6)).toBe(true);
      expect(s.newLeg).toBe(true);
    }
  });
});

describe('FLOOR: the player count', () => {
  it('two play singles corner to corner, three leave one spot empty, four is the prototype', () => {
    expect(orderFor(2)).toEqual([0, 3]);
    expect(orderFor(1)).toEqual([0, 3]);
    expect(orderFor(3)).toEqual([0, 3, 1]);
    expect(orderFor(4)).toEqual([0, 3, 1, 2]);
    expect(orderFor(9)).toEqual([0, 3, 1, 2]);
  });

  it('with two on court the ball goes A → D → A and the empty spots never swing', () => {
    const s0 = rallyAt(0, 1, 2);
    expect([s0.from, s0.to]).toEqual([0, 3]);
    const s1 = rallyAt(LEG_SECONDS, 1, 2);
    expect([s1.from, s1.to]).toEqual([3, 0]);
    const s2 = rallyAt(2 * LEG_SECONDS, 1, 2);
    expect([s2.from, s2.to]).toEqual([0, 3]);
    for (const t of [0, 0.4, 1.3, 2.2, 3.9]) {
      const s = rallyAt(t, 1, 2);
      expect(s.rackets.map((r) => r.present)).toEqual([true, false, false, true]);
      expect(s.rackets[1]!.hit).toBe(0);
      expect(s.rackets[2]!.hit).toBe(0);
    }
  });

  it('the ball still leaves and lands on a racket that is there', () => {
    for (const count of [2, 3, 4]) {
      const order = orderFor(count);
      for (const [slot, player] of order.entries()) {
        const s = rallyAt(slot * LEG_SECONDS, 1, count);
        expect(s.from).toBe(player);
        expect(s.rackets[player]!.present).toBe(true);
        expect(near(s.ball.x, s.rackets[player]!.contact.x)).toBe(true);
        expect(near(s.ball.z, s.rackets[player]!.contact.z)).toBe(true);
      }
    }
  });
});
