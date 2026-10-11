import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  COACH,
  COACH_YAW,
  coachHand,
  coachShoulder,
  DRILL_CONTACT,
  DRILL_LAUNCH,
  DRILL_LOOP,
  DRILL_PERIOD,
  DRILL_PLAYERS,
  DRILL_REST_T,
  DRILL_TIMING,
  drillAt,
  drillBallSampler,
  MACHINE,
  machineAim,
  machineMouth,
} from '../drill';
import { BALL_RADIUS, RACKET_Y } from '../rally';
import { makeCamera, NET, poseTopCamera } from '../camera';
import { SWING_CONTACT, SWING_DURATION, swingAt } from '../swing';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Rally time of period k's contact. */
const contactAt = (k: number) => k * DRILL_PERIOD + DRILL_CONTACT;

describe("left and right, as the top view frames them (bird's-eye, horizontal)", () => {
  /** The Coaches stage: full width, about 44 % of an 844 pt screen plus 82 pt. */
  const ASPECT = 390 / (Math.round(844 * 0.44) + 82);
  /** NDC of a world point through the top camera (x: −1 left … +1 right; y: −1 bottom … +1 top). */
  const ndc = (x: number, y: number, z: number, aspect = ASPECT) => {
    const camera = makeCamera(aspect);
    poseTopCamera(camera);
    const v = new Vector3(x, y, z).project(camera);
    return { x: v.x, y: v.y };
  };

  it('machine x > net x > every racket x, all inside the frame', () => {
    const machine = ndc(MACHINE.x, MACHINE.pivotY, MACHINE.z);
    const coach = ndc(COACH.x, 1.9, COACH.z);
    const net = ndc(0, NET.y, 0);
    const rackets = DRILL_PLAYERS.map((p) => ndc(p.x, RACKET_Y.flat, p.z));
    expect(machine.x).toBeGreaterThan(net.x);
    expect(coach.x).toBeGreaterThan(net.x);
    for (const r of rackets) expect(net.x).toBeGreaterThan(r.x);
    for (const pt of [machine, coach, net, ...rackets]) {
      expect(Math.abs(pt.x)).toBeLessThan(1);
      expect(Math.abs(pt.y)).toBeLessThan(1);
    }
    // Clearly to either side, not hugging the net.
    expect(machine.x).toBeGreaterThan(0.3);
    for (const r of rackets) expect(r.x).toBeLessThan(-0.3);
  });

  it('the coach stands beside the machine', () => {
    const coach = ndc(COACH.x, 1.9, COACH.z);
    const machine = ndc(MACHINE.x, MACHINE.pivotY, MACHINE.z);
    expect(Math.hypot(coach.x - machine.x, coach.y - machine.y)).toBeLessThan(0.3);
  });

  it('the column reads top to bottom on the screen, in feed order', () => {
    const ys = DRILL_PLAYERS.map((p) => ndc(p.x, RACKET_Y.flat, p.z).y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!);
  });

  it('every feed flies right to left on the screen, every return left to right', () => {
    for (let k = 0; k < 4; k++) {
      const at = (u: number) => {
        const b = drillAt(k * DRILL_PERIOD + u, 0).ball;
        return ndc(b.x, b.y, b.z).x;
      };
      expect(at(DRILL_CONTACT - 0.01)).toBeLessThan(at(DRILL_LAUNCH + 0.01));
      expect(at(DRILL_CONTACT + DRILL_TIMING.ret - 0.01)).toBeGreaterThan(at(DRILL_CONTACT + 0.01));
    }
  });

  it('every return lands on the machine side of the net, inside the court', () => {
    for (const p of DRILL_PLAYERS) {
      expect(p.z).toBeGreaterThan(0);
      expect(p.returnTo.z).toBeLessThan(0);
      expect(Math.abs(p.returnTo.x)).toBeLessThan(5 - BALL_RADIUS);
    }
    expect(MACHINE.z).toBeLessThan(0);
    expect(COACH.z).toBeLessThan(0);
  });

  it('the racket heads never meet: neighbours stay a head apart through every swing', () => {
    for (let t = 0; t < 2 * DRILL_LOOP; t += 0.01) {
      for (const camK of [0, 1]) {
        const r = drillAt(t, camK).rackets;
        for (let i = 1; i < r.length; i++) {
          const a = r[i]!.contact;
          const b = r[i - 1]!.contact;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1.5);
        }
      }
    }
  });
});

describe('the feed schedule', () => {
  it('feeds the four rackets in order, far to near, one per period, looping', () => {
    const order = Array.from({ length: 12 }, (_, k) => drillAt(k * DRILL_PERIOD + 1, 0).feed);
    expect(order).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    expect(DRILL_LOOP).toBe(4 * DRILL_PERIOD);
  });

  it('runs emerge → hold → feed → return → vanish inside every period', () => {
    const T = DRILL_TIMING;
    const at = (u: number) => drillAt(2 * DRILL_PERIOD + u, 0).phase;
    expect(at(0.01)).toBe('emerge');
    expect(at(T.emerge + 0.01)).toBe('hold');
    expect(at(DRILL_LAUNCH + 0.01)).toBe('feed');
    expect(at(DRILL_CONTACT + 0.01)).toBe('return');
    expect(at(DRILL_CONTACT + T.ret + 0.01)).toBe('vanish');
    expect(DRILL_PERIOD).toBeCloseTo(T.emerge + T.hold + T.feed + T.ret + T.vanish, 12);
  });

  it('the ball is in the barrel until the launch, then leaves its mouth', () => {
    const k = 1;
    const mouth = machineMouth(machineAim(drillAt(k * DRILL_PERIOD, 0).feed));
    for (const u of [0.05, DRILL_TIMING.emerge + 0.05, DRILL_LAUNCH - 0.01]) {
      expect(drillAt(k * DRILL_PERIOD + u, 0).ball).toEqual(mouth);
    }
    expect(dist(drillAt(k * DRILL_PERIOD + DRILL_LAUNCH, 0).ball, mouth)).toBeLessThan(1e-9);
    expect(dist(drillAt(k * DRILL_PERIOD + DRILL_LAUNCH + 0.1, 0).ball, mouth)).toBeGreaterThan(
      0.3,
    );
  });

  it('the barrel is aimed at the racket it is feeding, and still while a ball is in it', () => {
    for (let k = 0; k < 8; k++) {
      const s = drillAt(k * DRILL_PERIOD + 0.05, 0);
      const aim = machineAim(s.feed);
      for (const u of [0, 0.1, DRILL_LAUNCH, DRILL_CONTACT]) {
        expect(drillAt(k * DRILL_PERIOD + u, 0).machine.yaw).toBe(aim);
      }
      // …and has turned to the next racket by the period's end.
      expect(
        near(
          drillAt((k + 1) * DRILL_PERIOD - 1e-6, 0).machine.yaw,
          machineAim((s.feed + 1) % 4),
          1e-4,
        ),
      ).toBe(true);
      // The aim really points at the racket.
      const p = DRILL_PLAYERS[s.feed]!;
      const m = machineMouth(aim);
      const toward = Math.atan2(p.x - MACHINE.x, p.z - MACHINE.z);
      expect(near(Math.atan2(m.x - MACHINE.x, m.z - MACHINE.z), toward, 1e-9)).toBe(true);
    }
  });

  it('the barrel kicks back at the launch and settles', () => {
    const k = 3 * DRILL_PERIOD;
    expect(drillAt(k + DRILL_LAUNCH - 0.01, 0).machine.kick).toBe(0);
    expect(drillAt(k + DRILL_LAUNCH, 0).machine.kick).toBeCloseTo(1, 9);
    expect(drillAt(k + DRILL_LAUNCH + 0.2, 0).machine.kick).toBeGreaterThan(0);
    expect(drillAt(k + DRILL_LAUNCH + 0.4, 0).machine.kick).toBe(0);
  });
});

describe('contact', () => {
  it("the ball meets the fed racket's sweet spot at the clip's SWING_CONTACT", () => {
    for (const camK of [0, 0.5, 1]) {
      for (let k = 0; k < 8; k++) {
        const s = drillAt(contactAt(k), camK);
        const r = s.rackets[s.feed]!;
        expect(dist(s.ball, r.contact)).toBeLessThan(1e-6);
        expect(r.hit).toBeCloseTo(1, 9);
        // The clip time the racket is drawn at, at contact, is SWING_CONTACT.
        const clip = swingAt(SWING_CONTACT, 1);
        expect(r.swing.rotation.y).toBeCloseTo(clip.rotation.y, 9);
      }
    }
  });

  it('within a frame either side, the ball is within a racket head of the face (no near miss)', () => {
    for (let k = 0; k < 4; k++) {
      for (const dt of [-1 / 60, 1 / 60]) {
        const s = drillAt(contactAt(k) + dt, 0);
        expect(dist(s.ball, s.rackets[s.feed]!.contact)).toBeLessThan(0.45);
      }
    }
  });

  it('the racket goes INTO the ball: the head drives the way the return leaves', () => {
    for (const camK of [0, 1]) {
      for (let k = 4; k < 8; k++) {
        const t = contactAt(k);
        const i = drillAt(t, camK).feed;
        const before = drillAt(t - 0.02, camK).rackets[i]!.contact;
        const after = drillAt(t + 0.02, camK).rackets[i]!.contact;
        const head = { x: after.x - before.x, y: after.y - before.y, z: after.z - before.z };
        const a = drillAt(t, camK).ball;
        const b = drillAt(t + 0.1, camK).ball;
        const ball = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const cos =
          (head.x * ball.x + head.y * ball.y + head.z * ball.z) /
          (Math.hypot(head.x, head.y, head.z) * Math.hypot(ball.x, ball.y, ball.z));
        expect(cos).toBeGreaterThan(0.7);
        expect(ball.z).toBeLessThan(0); // back across the net, toward the machine
      }
    }
  });

  it('the wind-up runs while the ball is in the air toward the racket', () => {
    const k = 5;
    const i = drillAt(contactAt(k), 0).feed;
    const hit = (dt: number) => drillAt(contactAt(k) + dt, 0).rackets[i]!.hit;
    expect(hit(-SWING_CONTACT - 0.05)).toBe(0); // before the wind-up: at rest
    expect(hit(-0.5)).toBeGreaterThan(0);
    expect(hit(-0.1)).toBeGreaterThan(hit(-0.5));
    // The wind-up starts after the launch: the ball is already out of the barrel.
    expect(DRILL_CONTACT - SWING_CONTACT).toBeGreaterThan(DRILL_LAUNCH);
  });
});

describe('only the racket whose turn it is swings', () => {
  it('at every instant at most one racket is off its rest stance, and it is the one fed last', () => {
    let swung = 0;
    for (let t = 0; t < 3 * DRILL_LOOP; t += 1 / 120) {
      const s = drillAt(t, 0);
      const active = s.rackets.map((r, i) => (r.hit > 0 ? i : -1)).filter((i) => i >= 0);
      expect(active.length).toBeLessThanOrEqual(1);
      if (active.length === 1) {
        swung += 1;
        // Either this period's racket, or the last one's follow-through running out.
        expect([s.feed, (s.feed + 3) % 4]).toContain(active[0]);
        if (active[0] !== s.feed) expect(s.u).toBeLessThan(DRILL_LAUNCH);
      }
    }
    expect(swung).toBeGreaterThan(0);
  });

  it('the others hold the rally rest pose of the clip', () => {
    const s = drillAt(contactAt(6), 0);
    const rest = swingAt(-1, 1);
    for (const [i, r] of s.rackets.entries()) {
      if (i === s.feed) continue;
      expect(r.hit).toBe(0);
      expect(r.swing.rotation).toEqual(rest.rotation);
    }
  });

  it('there is a beat of stillness between one stroke and the next', () => {
    const gap = DRILL_PERIOD - SWING_DURATION;
    expect(gap).toBeGreaterThan(0.2);
  });

  it('a racket that has not been fed yet does not follow through from nowhere on the first loop', () => {
    for (let t = 0; t < DRILL_LOOP; t += 1 / 60) {
      const s = drillAt(t, 0);
      for (const [i, r] of s.rackets.entries()) {
        if (t < i * DRILL_PERIOD + DRILL_CONTACT - SWING_CONTACT) expect(r.hit).toBe(0);
      }
    }
  });
});

describe('the ball leaves the play', () => {
  it('clears the net wherever a flight crosses it', () => {
    for (const camK of [0, 1]) {
      for (let k = 0; k < 4; k++) {
        let prev = drillAt(k * DRILL_PERIOD + DRILL_LAUNCH, camK).ball;
        for (let u = DRILL_LAUNCH; u < DRILL_PERIOD; u += 0.002) {
          const b = drillAt(k * DRILL_PERIOD + u, camK).ball;
          if (Math.sign(b.z) !== Math.sign(prev.z) && Math.abs(b.x) < NET.halfSpan) {
            expect(b.y - BALL_RADIUS).toBeGreaterThan(NET.y);
          }
          prev = b;
        }
      }
    }
  });

  it('every return lands and rolls out clear of the machine and the coach', () => {
    for (let k = 0; k < 4; k++) {
      for (let u = DRILL_CONTACT; u < DRILL_PERIOD - 0.005; u += 0.01) {
        const b = drillAt(k * DRILL_PERIOD + u, 0).ball;
        expect(Math.hypot(b.x - MACHINE.x, b.z - MACHINE.z)).toBeGreaterThan(1.2);
        expect(Math.hypot(b.x - COACH.x, b.z - COACH.z)).toBeGreaterThan(1.2);
      }
    }
  });

  it('is gone before the next ball appears: one ball at a time, never two to collide', () => {
    for (let k = 0; k < 6; k++) {
      const end = drillAt((k + 1) * DRILL_PERIOD - 1e-6, 0);
      expect(end.phase).toBe('vanish');
      expect(end.ballScale).toBeLessThan(1e-3);
      const next = drillAt((k + 1) * DRILL_PERIOD, 0);
      expect(next.phase).toBe('emerge');
      expect(next.ballScale).toBe(0);
      expect(next.ball).toEqual(machineMouth(machineAim(next.feed)));
    }
  });

  it('lands on the turf and sinks into it as it shrinks', () => {
    const k = 2;
    const landed = drillAt(k * DRILL_PERIOD + DRILL_CONTACT + DRILL_TIMING.ret + 1e-6, 0);
    expect(landed.ball.y).toBeCloseTo(BALL_RADIUS, 4);
    const mid = drillAt(k * DRILL_PERIOD + DRILL_PERIOD - DRILL_TIMING.vanish / 2, 0);
    expect(mid.ball.y).toBeCloseTo(BALL_RADIUS * mid.ballScale, 9);
  });
});

describe('the trail', () => {
  it('draws only inside the current flight, and not at all while the ball sits in the barrel', () => {
    const k = 3;
    expect(drillAt(k * DRILL_PERIOD + 0.1, 0).trailFrom).toBe(Infinity);
    expect(drillAt(k * DRILL_PERIOD + DRILL_TIMING.emerge + 0.1, 0).trailFrom).toBe(Infinity);
    expect(drillAt(k * DRILL_PERIOD + DRILL_LAUNCH + 0.1, 0).trailFrom).toBeCloseTo(
      k * DRILL_PERIOD + DRILL_LAUNCH,
      9,
    );
    expect(drillAt(contactAt(k) + 0.1, 0).trailFrom).toBeCloseTo(contactAt(k), 9);
    expect(drillAt(contactAt(k) + DRILL_TIMING.ret + 0.1, 0).trailFrom).toBeCloseTo(
      contactAt(k),
      9,
    );
  });

  it("the sampler is drillAt's ball and scale to the bit, across periods and pitch changes", () => {
    const sample = drillBallSampler();
    for (let frame = 0; frame < 900; frame++) {
      const camK = Math.min(1, Math.max(0, Math.sin(frame / 37) * 0.6 + 0.4));
      const t = frame / 60;
      for (let i = 0; i <= 36; i++) {
        const at = t - (i * (22 / 60)) / 36;
        if (at < 0) continue;
        const s = drillAt(at, camK);
        expect(sample(at, camK)).toStrictEqual({ ball: s.ball, scale: s.ballScale });
      }
    }
  });
});

describe('loop continuity', () => {
  it('the schedule repeats every DRILL_LOOP', () => {
    for (let t = DRILL_LOOP; t < 2 * DRILL_LOOP; t += 0.137) {
      const a = drillAt(t, 0);
      const b = drillAt(t + DRILL_LOOP, 0);
      expect(b.feed).toBe(a.feed);
      expect(b.phase).toBe(a.phase);
      expect(b.ballScale).toBeCloseTo(a.ballScale, 6);
      expect(b.machine.yaw).toBeCloseTo(a.machine.yaw, 9);
      expect(b.coach.head).toBeCloseTo(a.coach.head, 9);
      for (let i = 0; i < 4; i++) expect(b.rackets[i]!.hit).toBeCloseTo(a.rackets[i]!.hit, 6);
    }
  });

  it('nothing jumps: ball, rackets, barrel and head move continuously across every boundary', () => {
    const dt = 1 / 240;
    let prev = drillAt(0, 0);
    for (let t = dt; t < 2.2 * DRILL_LOOP; t += dt) {
      const s = drillAt(t, 0);
      // The ball may only relocate while it is not drawn (back to the nozzle):
      // scene.ts draws nothing at a scale of 1e-3 or less.
      if (s.ballScale > 1e-3 && prev.ballScale > 1e-3)
        expect(dist(s.ball, prev.ball)).toBeLessThan(25 * dt);
      for (let i = 0; i < 4; i++) {
        expect(dist(s.rackets[i]!.contact, prev.rackets[i]!.contact)).toBeLessThan(30 * dt);
      }
      expect(Math.abs(s.machine.yaw - prev.machine.yaw)).toBeLessThan(4 * dt);
      expect(Math.abs(s.coach.head - prev.coach.head)).toBeLessThan(4 * dt);
      prev = s;
    }
  });
});

describe('the coach watches, and stays put', () => {
  it('turns the head toward the racket the machine is aimed at, within a natural range', () => {
    const heads = new Set<number>();
    for (let k = 0; k < 4; k++) {
      const h = drillAt(contactAt(k), 0).coach.head;
      expect(Math.abs(h)).toBeLessThanOrEqual(1.2);
      heads.add(Math.round(h * 1000));
    }
    expect(heads.size).toBe(4); // a different look for each racket
  });

  it('only sways a few degrees', () => {
    for (let t = 0; t < DRILL_LOOP; t += 0.1) {
      const { sway } = drillAt(t, 0).coach;
      expect(Math.abs(sway.x)).toBeLessThan(0.05);
      expect(Math.abs(sway.z)).toBeLessThan(0.05);
    }
  });
});

describe('Reduce Motion', () => {
  it('rests on the ball loaded in the barrel, aimed at the first racket, every racket at rest', () => {
    const s = drillAt(DRILL_REST_T, 0);
    expect(s.phase).toBe('hold');
    expect(s.feed).toBe(0);
    expect(s.ballScale).toBe(1);
    expect(s.ball).toEqual(machineMouth(machineAim(0)));
    expect(s.machine.yaw).toBe(machineAim(0));
    expect(s.machine.kick).toBe(0);
    expect(s.trailFrom).toBe(Infinity);
    for (const r of s.rackets) expect(r.hit).toBe(0);
    // The same frame a loop later, too: every racket's window is out of reach of it.
    for (const r of drillAt(DRILL_REST_T + DRILL_LOOP, 0).rackets) expect(r.hit).toBe(0);
  });

  it('is a real frame at every pitch (the scroll still pitches the court under Reduce Motion)', () => {
    for (const camK of [0, 0.5, 1]) {
      const s = drillAt(DRILL_REST_T, camK);
      expect(s.ballScale).toBe(1);
      expect(s.shade.opacity).toBe(0); // no disc under a ball still in the machine
      for (const r of s.rackets) {
        expect(Number.isFinite(r.contact.x + r.contact.y + r.contact.z)).toBe(true);
      }
    }
  });
});

describe("the coach's arms", () => {
  /** A body-frame point in court metres (the coach's sway and shift left out). */
  const toCourt = (v: { x: number; y: number; z: number }) => {
    const c = Math.cos(COACH_YAW);
    const sn = Math.sin(COACH_YAW);
    return { x: COACH.x + v.x * c + v.z * sn, y: v.y, z: COACH.z - v.x * sn + v.z * c };
  };
  const handAt = (t: number, side: -1 | 1) => {
    const { arms } = drillAt(t, 0).coach;
    return toCourt(coachHand(side < 0 ? arms.right : arms.left, side));
  };
  const angle = (a: number, b: number) => {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };

  it('as the ball flies, the right arm points at the racket being fed', () => {
    for (let k = 0; k < 8; k++) {
      const t = k * DRILL_PERIOD + (DRILL_LAUNCH + DRILL_CONTACT) / 2 + 0.1;
      const feed = drillAt(t, 0).feed;
      const p = DRILL_PLAYERS[feed]!;
      const s = coachShoulder(-1);
      const h = handAt(t, -1);
      const toward = Math.atan2(p.x - s.x, p.z - s.z);
      const arm = Math.atan2(h.x - s.x, h.z - s.z);
      expect(angle(arm, toward)).toBeLessThan(0.05);
      // Out at arm's length, near shoulder height: a point, not a wave.
      expect(Math.hypot(h.x - s.x, h.z - s.z)).toBeGreaterThan(0.5);
      expect(Math.abs(h.y - s.y)).toBeLessThan(0.2);
    }
  });

  it('the point moves with the feed: a different direction for each racket', () => {
    const dirs = [0, 1, 2, 3].map((k) => {
      const t = k * DRILL_PERIOD + DRILL_CONTACT - 0.3;
      const s = coachShoulder(-1);
      const h = handAt(t, -1);
      return Math.atan2(h.x - s.x, h.z - s.z);
    });
    for (let i = 1; i < 4; i++) expect(angle(dirs[i]!, dirs[i - 1]!)).toBeGreaterThan(0.1);
  });

  it('the arm only swings out once the ball has left the barrel', () => {
    const k = 2 * DRILL_PERIOD;
    expect(drillAt(k + DRILL_LAUNCH - 0.01, 0).coach.arms.right).toEqual(
      drillAt(k + 0.05, 0).coach.arms.right,
    );
    expect(drillAt(k + DRILL_LAUNCH + 0.2, 0).coach.arms.right.lift).toBeGreaterThan(
      drillAt(k + DRILL_LAUNCH, 0).coach.arms.right.lift,
    );
  });

  it('just after the contact the hands meet in front of the chest: a clap', () => {
    for (let k = 0; k < 4; k++) {
      const t = contactAt(k) + 0.17;
      const r = handAt(t, -1);
      const l = handAt(t, 1);
      expect(Math.hypot(r.x - l.x, r.y - l.y, r.z - l.z)).toBeLessThan(0.15);
      // In front of the coach, not at the sides.
      const { arms } = drillAt(t, 0).coach;
      expect(coachHand(arms.right, -1).z).toBeGreaterThan(0.4);
      // …and apart again before and after it.
      for (const dt of [-0.15, 0.4]) {
        const a = handAt(contactAt(k) + dt, -1);
        const b = handAt(contactAt(k) + dt, 1);
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.3);
      }
    }
  });

  it('between balls, hands on hips: elbows out to the sides, hands at the waist', () => {
    const t = 3 * DRILL_PERIOD + 0.2;
    const { arms } = drillAt(t, 0).coach;
    for (const [pose, side] of [
      [arms.right, -1],
      [arms.left, 1],
    ] as const) {
      const hand = coachHand(pose, side);
      expect(hand.y).toBeGreaterThan(1.0);
      expect(hand.y).toBeLessThan(1.3);
      expect(Math.abs(hand.x)).toBeLessThan(0.3); // at the torso's edge
      expect(Math.sign(Math.sin(pose.yaw))).toBe(side); // the elbow goes out on its own side
    }
  });

  it('is seamless over the loop and never sweeps faster than a 45 fps frame can carry', () => {
    const dt = 1 / 45;
    let prev = drillAt(0, 0).coach;
    let fastest = 0;
    for (let t = dt; t < 2 * DRILL_LOOP; t += dt) {
      const c = drillAt(t, 0).coach;
      for (const side of ['right', 'left'] as const) {
        for (const ch of ['yaw', 'lift', 'bend'] as const) {
          fastest = Math.max(fastest, Math.abs(c.arms[side][ch] - prev.arms[side][ch]));
        }
      }
      expect(Math.abs(c.shift - prev.shift)).toBeLessThan(0.01);
      prev = c;
    }
    // ≈ 9 rad/s at most: a gesture, not a twitch.
    expect(fastest).toBeLessThan(0.2);
    // The period begins and ends on the same pose.
    const a = drillAt(DRILL_PERIOD - 1e-9, 0).coach.arms;
    const b = drillAt(DRILL_PERIOD, 0).coach.arms;
    expect(a.right.yaw).toBeCloseTo(b.right.yaw, 6);
    expect(a.left.lift).toBeCloseTo(b.left.lift, 6);
  });

  it('the feet stay put: the weight shift is a few centimetres', () => {
    for (let t = 0; t < DRILL_LOOP; t += 0.1) {
      expect(Math.abs(drillAt(t, 0).coach.shift)).toBeLessThanOrEqual(0.05);
    }
  });

  it('Reduce Motion rests with both hands on the hips', () => {
    const { arms } = drillAt(DRILL_REST_T, 0).coach;
    const rest = drillAt(3 * DRILL_PERIOD + 0.2, 0).coach.arms;
    expect(arms).toEqual(rest);
  });
});
