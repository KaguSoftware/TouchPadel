import { describe, expect, it } from 'vitest';
import {
  applyEulerYXZ,
  applyRotX,
  faceOffset,
  HAND_HOLD,
  HEAD_ARM,
  mirrorRotation,
  RACKET_SCALE,
  SWING_CONTACT,
  SWING_DURATION,
  SWING_KEYS,
  SWING_TRAVEL,
  swingAt,
  v3,
} from '../swing';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('the swing clip (padel-racket.html)', () => {
  it('sits on the rest stance outside its window, at both ends and beyond', () => {
    const rest = swingAt(-1);
    const first = SWING_KEYS[0]!;
    expect(rest.rotation).toEqual(v3(first[1]!, first[2]!, first[3]!));
    expect(rest.position).toEqual(v3(first[4]!, first[5]!, first[6]!));
    expect(rest.hit).toBe(0);
    expect(swingAt(0)).toEqual(rest);
    expect(swingAt(SWING_DURATION)).toEqual(rest);
    expect(swingAt(SWING_DURATION + 3)).toEqual(rest);
  });

  it('passes exactly through every key', () => {
    for (const [t, rx, ry, rz, px, py, pz] of SWING_KEYS.slice(1, -1)) {
      const p = swingAt(t!);
      expect(near(p.rotation.x, rx!)).toBe(true);
      expect(near(p.rotation.y, ry!)).toBe(true);
      expect(near(p.rotation.z, rz!)).toBe(true);
      expect(near(p.position.x, px!)).toBe(true);
      expect(near(p.position.y, py!)).toBe(true);
      expect(near(p.position.z, pz!)).toBe(true);
    }
  });

  it('leaves and re-enters the rest stance at a standstill (clamped end tangents)', () => {
    // A Catmull-Rom secant at the ends would kick the racket into motion out of
    // nowhere; the clip has to start and finish from rest, so both are ~0.
    const rest = swingAt(-1);
    const h = 1e-4;
    const startSpeed = len(swingAt(h).position) - len(rest.position);
    const endSpeed = len(swingAt(SWING_DURATION - h).position) - len(rest.position);
    expect(Math.abs(startSpeed / h)).toBeLessThan(1e-3);
    expect(Math.abs(endSpeed / h)).toBeLessThan(1e-3);
  });

  it('is fastest through the strike: the contact pass beats the backswing', () => {
    const speed = (t: number) => {
      const a = swingAt(t - 0.01).position;
      const b = swingAt(t + 0.01).position;
      return len(v3(b.x - a.x, b.y - a.y, b.z - a.z)) / 0.02;
    };
    const strike = speed(SWING_CONTACT);
    expect(strike).toBeGreaterThan(speed(0.3)); // winding up
    expect(strike).toBeGreaterThan(speed(0.55)); // held at the top of the backswing
    expect(strike).toBeGreaterThan(speed(1.6)); // easing out of the follow-through
  });

  it('hit peaks at 1 on contact and falls to 0 at both ends', () => {
    expect(swingAt(SWING_CONTACT).hit).toBe(1);
    expect(swingAt(SWING_CONTACT / 2).hit).toBeGreaterThan(0);
    expect(swingAt(SWING_CONTACT / 2).hit).toBeLessThan(1);
    expect(swingAt(1e-9).hit).toBeLessThan(0.001);
    expect(swingAt(SWING_DURATION - 1e-9).hit).toBeLessThan(0.001);
  });

  it('the other hand plays the same stroke mirrored in x', () => {
    for (const t of [0.2, SWING_CONTACT, 1.5]) {
      const r = swingAt(t, 1);
      const l = swingAt(t, -1);
      expect(near(l.position.x, -r.position.x)).toBe(true);
      expect(near(l.position.y, r.position.y)).toBe(true);
      expect(near(l.rotation.y, -r.rotation.y)).toBe(true);
      expect(near(l.rotation.z, -r.rotation.z)).toBe(true);
      expect(near(l.rotation.x, r.rotation.x)).toBe(true);
      expect(l.hit).toBe(r.hit);
    }
  });
});

describe('the rig (mount → pivot → lay → hold → racket)', () => {
  it('YXZ maths matches three: R = Ry·Rx·Rz', () => {
    const e = v3(0.3, -0.7, 0.2);
    const v = v3(0.4, 1.1, -0.6);
    // Ry·(Rx·(Rz·v)), by hand.
    const rz = v3(
      v.x * Math.cos(e.z) - v.y * Math.sin(e.z),
      v.x * Math.sin(e.z) + v.y * Math.cos(e.z),
      v.z,
    );
    const rx = applyRotX(rz, e.x);
    const ry = v3(
      rx.x * Math.cos(e.y) + rx.z * Math.sin(e.y),
      rx.y,
      -rx.x * Math.sin(e.y) + rx.z * Math.cos(e.y),
    );
    const got = applyEulerYXZ(v, e);
    expect(near(got.x, ry.x)).toBe(true);
    expect(near(got.y, ry.y)).toBe(true);
    expect(near(got.z, ry.z)).toBe(true);
  });

  it('the head hangs one rigid arm off the hand, whatever the view or the stroke', () => {
    const arm = HEAD_ARM * RACKET_SCALE;
    for (const lay of [-Math.PI / 2, -0.6, 0]) {
      for (const t of [-1, 0.3, SWING_CONTACT, 1.2]) {
        for (const hand of [1, -1] as const) {
          const pose = swingAt(t, hand);
          const reach = faceOffset(pose, lay, hand);
          // faceOffset = the hand's travel + the arm; take the travel back out.
          const off = v3(
            reach.x - pose.position.x * SWING_TRAVEL,
            reach.y - pose.position.y * SWING_TRAVEL,
            reach.z - pose.position.z * SWING_TRAVEL,
          );
          expect(near(len(off), arm, 1e-9)).toBe(true);
        }
      }
    }
  });

  it('the top view lays the head into the court plane; the front view stands it up', () => {
    const rest = swingAt(-1);
    const flat = faceOffset(rest, -Math.PI / 2);
    const up = faceOffset(rest, 0);
    expect(Math.abs(flat.y)).toBeLessThan(0.15); // barely off the turf
    expect(up.y).toBeGreaterThan(0.7); // head well above the hand
  });

  it('the FACE leads the head through contact, both hands', () => {
    // The design file's own clip fails this — it sends the hand one way and
    // builds the face the other, so the racket meets the ball back-first.
    // swing.ts mirrors the travel; this is what says which way is right.
    for (const hand of [1, -1] as const) {
      const h = 1e-3;
      const a = faceOffset(swingAt(SWING_CONTACT - h, hand), 0, hand);
      const b = faceOffset(swingAt(SWING_CONTACT + h, hand), 0, hand);
      const vel = v3(b.x - a.x, b.y - a.y, b.z - a.z);
      const normal = applyEulerYXZ(
        applyRotX(applyEulerYXZ(v3(0, 0, 1), mirrorRotation(HAND_HOLD, hand)), 0),
        swingAt(SWING_CONTACT, hand).rotation,
      );
      const cos =
        (vel.x * normal.x + vel.y * normal.y + vel.z * normal.z) / (len(vel) * len(normal));
      expect(cos).toBeGreaterThan(0.9);
    }
  });

  it('the top view turns the face UP at the camera instead', () => {
    // The lay cheat trades the strike direction for a readable silhouette: from
    // 60 m straight above you have to be looking at the strings.
    const normal = applyEulerYXZ(
      applyRotX(applyEulerYXZ(v3(0, 0, 1), HAND_HOLD), -Math.PI / 2),
      swingAt(-1).rotation,
    );
    expect(normal.y / len(normal)).toBeGreaterThan(0.95);
  });

  it('the stroke throws the head a metre and a half off its resting spot', () => {
    // The reach is what makes the swing read from 46 m up: the hand travels
    // ≈ 1 m, the head sweeps four.
    for (const lay of [0, -Math.PI / 2]) {
      const rest = faceOffset(swingAt(-1), lay);
      let far = 0;
      for (let t = 0; t <= SWING_DURATION; t += 0.01) {
        const f = faceOffset(swingAt(t), lay);
        far = Math.max(far, len(v3(f.x - rest.x, f.y - rest.y, f.z - rest.z)));
      }
      expect(far).toBeGreaterThan(1.5);
    }
  });
});
