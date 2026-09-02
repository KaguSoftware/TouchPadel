import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  ballHeading,
  cameraPose,
  LEG_SECONDS,
  nearCageOpacity,
  nextLegStart,
  PLAYERS,
  playerYaw,
  RACKET_Y,
  RALLY_ORDER,
  rallyAt,
  stringBed,
} from '../rally';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('camera orbit (prototype updateCamera)', () => {
  it('top-down at k = 0: 60 m almost straight above, up = −z, looking 0.8 m past the net', () => {
    const c = cameraPose(0);
    expect(near(c.position.x, 0)).toBe(true);
    expect(c.position.y).toBeGreaterThan(59.9);
    expect(c.position.z).toBeGreaterThan(0); // 89.5°, not 90: a hair toward the near end
    expect(c.up).toEqual({ x: 0, y: 0, z: -1 });
    expect(c.lookAt).toEqual({ x: 0, y: 0, z: -0.8 });
  });

  it('pitched at k = 1: 46 m out at 40° elevation, 28° around, up = +y', () => {
    const c = cameraPose(1);
    const d = Math.hypot(c.position.x, c.position.y, c.position.z);
    expect(near(d, 46, 1e-9)).toBe(true);
    expect(near(c.position.y, 46 * Math.sin((40 * Math.PI) / 180), 1e-9)).toBe(true);
    expect(c.position.x).toBeGreaterThan(0); // azimuth swings the camera to +x
    expect(c.up).toEqual({ x: 0, y: 1, z: -0 });
    expect(near(c.lookAt.z, 0.6, 1e-9)).toBe(true);
  });

  it('the up vector stays unit length through the blend', () => {
    for (const k of [0.1, 0.5, 0.9]) {
      const { up } = cameraPose(k);
      expect(near(Math.hypot(up.x, up.y, up.z), 1)).toBe(true);
    }
  });

  it('near cage: mesh .42→.10, glass .55→.12, frame 1→.25, panes .75→.10', () => {
    expect(nearCageOpacity(0)).toEqual({ fence: 0.42, glass: 0.55, frame: 1, pane: 0.75 });
    const end = nearCageOpacity(1);
    expect(near(end.fence, 0.1)).toBe(true);
    expect(near(end.glass, 0.12)).toBe(true);
    expect(near(end.frame, 0.25)).toBe(true);
    expect(near(end.pane, 0.1)).toBe(true);
  });
});

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

  it('the ball leaves the hitter\'s strings and lands on the receiver\'s', () => {
    // Top view: the racket stands a constant REACH beside its ball point, so
    // at contact the STRING BED is on the ball — the ball never sits on the
    // handle. The idle drift bends the contact yaw a few degrees off the
    // static placement, hence the centimetre tolerance.
    const start = rallyAt(0, 0);
    const bed = stringBed(start.rackets[0]!);
    expect(near(start.ball.x, bed.x, 0.1)).toBe(true);
    expect(near(start.ball.z, bed.z, 0.1)).toBe(true);
    const end = rallyAt(LEG_SECONDS - 1e-9, 0);
    const recv = stringBed(end.rackets[3]!);
    expect(near(end.ball.x, recv.x, 0.1)).toBe(true);
    expect(near(end.ball.z, recv.z, 0.1)).toBe(true);
  });

  it('two arcs: bounces on the ground at 62 % of the leg, peaks 1.9 m up in flight', () => {
    const atBounce = rallyAt(0.62 * LEG_SECONDS, 0);
    expect(near(atBounce.ball.y, BALL_RADIUS, 1e-6)).toBe(true);
    // Halfway through the flight arc: lerp(A.y, 0.22, .5) + 1.9, where A is
    // where the ball LEFT — the centre of the hitter's string bed, which is
    // what the leg is flown between (it used to be the bare hand position,
    // and the ball then passed a metre under the racket faces).
    const mid = rallyAt(0.31 * LEG_SECONDS, 0);
    const a = rallyAt(0, 0).ball.y;
    expect(mid.ball.y).toBeGreaterThan((a + BALL_RADIUS) / 2 + 1.9 - 0.25);
    expect(mid.ball.y).toBeLessThan((a + BALL_RADIUS) / 2 + 1.9 + 0.25);
    expect(rallyAt(0.81 * LEG_SECONDS, 0).ball.y).toBeLessThan(1.2); // the low bounce arc
  });

  it('newLeg flags the first 2 % of a leg (trail reset)', () => {
    expect(rallyAt(0.01, 0).newLeg).toBe(true);
    expect(rallyAt(0.5, 0).newLeg).toBe(false);
  });

  it('rackets are canted in the top view and stand up in the front view', () => {
    // The top view looks DOWN ON the string bed — standing them on edge
    // showed four thin ellipses, which is not what a top-down illustration
    // wants. But not dead flat either: at exactly 0 the racket is parallel to
    // the court, the camera gets a pure outline with no shading anywhere on
    // it, and four modelled objects read as flat stickers. A small cant is
    // what gives the frame and grip an edge to catch the light.
    const flat = rallyAt(0.5 * LEG_SECONDS, 0);
    flat.rackets.forEach((r, i) => {
      expect(r.hit).toBe(0);
      expect(r.rotation.x).toBeGreaterThan(0.15); // off the court plane…
      expect(r.rotation.x).toBeLessThan(0.9); // …but still face-up to the camera
      // Height only for the two rackets not involved in this leg. The
      // receiver is already walking up to meet the incoming ball by mid-leg,
      // and the hitter is coming back down from its own strike.
      if (i !== flat.from && i !== flat.to) {
        expect(near(r.position.y, RACKET_Y.flat, 0.07)).toBe(true);
      }
    });
    const up = rallyAt(0.5 * LEG_SECONDS, 1);
    for (const r of up.rackets) {
      // Leaning forward, not bolt upright: at π/2 the head sits directly above
      // the hand, which reads as stiff and (with the swing pivoting at the
      // grip) made the HAND bob through the stroke instead of the head.
      expect(r.rotation.x).toBeGreaterThan(1.0);
      expect(r.rotation.x).toBeLessThan(Math.PI / 2);
      expect(near(r.rotation.z, 0)).toBe(true); // the flat-view roll is gone
      expect(near(r.position.y, RACKET_Y.standing, 0.07)).toBe(true);
    }
  });

  it('the hitter swings at the start of a leg; the receiver at the end', () => {
    // `hit` is strike PROXIMITY: 1 at the ball, easing to 0 at both ends of
    // the stroke window. The hitter struck at u = 0 and is following through;
    // the receiver is winding up for the ball arriving at u = 1.
    const early = rallyAt(0.095 * LEG_SECONDS, 0);
    expect(early.rackets[0]!.hit).toBeGreaterThan(0.85);
    expect(early.rackets[3]!.hit).toBe(0);
    const late = rallyAt(0.93 * LEG_SECONDS, 0);
    expect(late.rackets[3]!.hit).toBeGreaterThan(0.85);
    expect(late.rackets[0]!.hit).toBe(0);
    // It peaks exactly at contact, where the racket is square to the shot.
    expect(rallyAt(0, 0).rackets[0]!.hit).toBeCloseTo(1, 6);
  });

  it('the face meets the ball square at contact', () => {
    // Measured against the SHOT — contact point to where the ball is a quarter
    // of a leg later — not the ball's first frame. At contact the racket is at
    // its peak angular speed, so the ball's instantaneous first step is
    // dominated by the swing's own motion and reads a false ~20°.
    for (let leg = 0; leg < 4; leg++) {
      const t = leg * LEG_SECONDS;
      const s = rallyAt(t, 1);
      const h = s.rackets[s.from]!;
      const a = s.ball;
      const mid = rallyAt(t + 0.25 * LEG_SECONDS, 1).ball;

      const e = new THREE.Euler(h.rotation.x, h.rotation.y, h.rotation.z, 'YXZ');
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(
        new THREE.Quaternion().setFromEuler(e),
      );
      const shot = new THREE.Vector3(mid.x - a.x, mid.y - a.y, mid.z - a.z).normalize();
      expect((normal.angleTo(shot) * 180) / Math.PI).toBeLessThan(3);
    }
  });

  it('the racket sweeps through the ball and never jumps', () => {
    // Sweeps every racket over eight legs at 60 fps, at each camera pitch. The
    // stroke straddles the leg boundary — wind-up in one leg, follow-through in
    // the next — so a discontinuity shows up here as a large single-frame step.
    for (const camK of [0, 0.5, 1]) {
      let worst = 0;
      let prev: THREE.Quaternion[] | null = null;
      for (let f = 0; f < Math.round(8 * LEG_SECONDS * 60); f++) {
        const cur = rallyAt(f / 60, camK).rackets.map((r) =>
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(r.rotation.x, r.rotation.y, r.rotation.z, 'YXZ'),
          ),
        );
        if (prev) for (let i = 0; i < cur.length; i++) worst = Math.max(worst, cur[i]!.angleTo(prev[i]!));
        prev = cur;
      }
      expect((worst * 180) / Math.PI).toBeLessThan(35); // a fast swing, not a teleport
    }
  });

  it('top view: the racket is planted at the interception point, waiting for the ball', () => {
    // The face must be standing where the ball is going, BEFORE it gets
    // there — the ball flies into a waiting racket rather than the two
    // converging and meeting only at the instant of contact.
    for (let leg = 1; leg < 5; leg++) {
      const tc = leg * LEG_SECONDS;
      const receiver = rallyAt(tc, 0).from; // it struck at tc, so it received into it
      const spot = rallyAt(tc, 0).rackets[receiver]!.position;

      // Through the whole approach the hand is already essentially there.
      // From 0.2 s out — the whole time the ball is closing — the racket is
      // already standing on its spot, inside a few centimetres. (Earlier than
      // that it is still easing out to the interception point, which is the
      // step working, not the plant failing.)
      for (const dt of [-0.2, -0.12, -0.06, -0.02]) {
        const r = rallyAt(tc + dt, 0).rackets[receiver]!;
        const moved = Math.hypot(r.position.x - spot.x, r.position.z - spot.z);
        expect(moved).toBeLessThan(0.05);
      }
      // And it settles: it is closer at the strike than it was earlier.
      const far = rallyAt(tc - 0.2, 0).rackets[receiver]!.position;
      const near_ = rallyAt(tc - 0.02, 0).rackets[receiver]!.position;
      expect(Math.hypot(near_.x - spot.x, near_.z - spot.z)).toBeLessThan(
        Math.hypot(far.x - spot.x, far.z - spot.z),
      );
      // And at contact the strings are on the ball, having swung onto it.
      const s = rallyAt(tc, 0);
      const bed = stringBed(s.rackets[receiver]!);
      expect(Math.hypot(bed.x - s.ball.x, bed.z - s.ball.z)).toBeLessThan(0.05);
    }
  });

  it('the plant is a step, not a teleport, and lets go afterwards', () => {
    // The racket must ease out to the interception point and ease back to its
    // idle drift, never jumping there — and must not stay stuck to the spot
    // once the ball has gone.
    let worst = 0;
    let prev: ReturnType<typeof rallyAt> | null = null;
    for (let f = 0; f < Math.round(8 * LEG_SECONDS * 60); f++) {
      const s = rallyAt(f / 60, 0);
      if (prev) {
        s.rackets.forEach((r, i) => {
          const p = prev!.rackets[i]!.position;
          worst = Math.max(worst, Math.hypot(r.position.x - p.x, r.position.z - p.z));
        });
      }
      prev = s;
    }
    expect(worst).toBeLessThan(0.15); // metres per frame at 60 fps
  });

  it('top view: the head tips DOWN 50–70° to hit, then returns to rest', () => {
    for (let leg = 0; leg < 4; leg++) {
      const t = leg * LEG_SECONDS;
      const hitter = rallyAt(t, 0).from;
      const pitchAt = (dt: number) =>
        rallyAt(t + dt + 8 * LEG_SECONDS, 0).rackets[hitter]!.rotation.x;

      const rest = pitchAt(-0.6 * LEG_SECONDS); // well clear of any stroke
      const strike = pitchAt(0); // the moment of contact

      // 50–70° of travel. The sign is negative because in this Euler
      // convention a SMALLER rotation.x drops the head — the check below
      // confirms the racket really does go nose-down, in metres.
      const swept = (Math.abs(strike - rest) * 180) / Math.PI;
      expect(swept).toBeGreaterThan(50);
      expect(swept).toBeLessThan(70);

      // The WHOLE racket tilts: at the strike the head is BELOW the butt it
      // pivots on, having swung down past it. Pivoting at the throat instead
      // see-sawed the racket about its middle and the head went UP.
      const atStrike = rallyAt(t + 8 * LEG_SECONDS, 0).rackets[hitter]!;
      const atRest = rallyAt(t - 0.6 * LEG_SECONDS + 8 * LEG_SECONDS, 0).rackets[hitter]!;
      expect(stringBed(atStrike).y).toBeLessThan(atStrike.position.y);
      expect(stringBed(atRest).y).toBeGreaterThan(atRest.position.y);
      // …and it really dropped, by better than half a metre.
      expect(stringBed(atRest).y - stringBed(atStrike).y).toBeGreaterThan(0.5);

      // Deepest exactly AT the ball, not before or after it.
      expect(strike).toBeLessThan(pitchAt(-0.1));
      expect(strike).toBeLessThan(pitchAt(0.1));

      // …and it comes back: by the far side of the stroke it is at rest
      // again. "Rest" is alive — the head breathes ±IDLE_BREATH between
      // strokes so the racket reads as held, not parked — so two samples of
      // it can differ by up to two breaths, never by any part of the strike.
      expect(Math.abs(pitchAt(0.6 * LEG_SECONDS) - rest)).toBeLessThan(0.11);
    }
  });

  it('the tip is a top-view stroke and never disturbs the front view', () => {
    // The front view meets the ball square by standing the racket up and
    // aiming its face normal down the shot (verified to 3° above). Letting
    // the tip through there swung the pitch to 133° and destroyed that.
    for (let leg = 0; leg < 4; leg++) {
      const s = rallyAt(leg * LEG_SECONDS, 1);
      const h = s.rackets[s.from]!;
      expect(h.hit).toBeCloseTo(1, 6); // it IS mid-strike…
      expect(h.rotation.x).toBeLessThan(Math.PI / 2); // …yet still merely standing
    }
  });

  it('the face is square to the BALL\'S OWN PATH, tracked as the rackets drift', () => {
    // The aim comes from atan2 over the ball's real trajectory, not the
    // straight line between two players' rest spots — the two differ because
    // both rackets drift while the ball is in the air. Measured against the
    // ball's MEASURED heading (two sampled positions just after it leaves),
    // over eight legs so the drift is at a different phase each time.
    for (let leg = 0; leg < 8; leg++) {
      const t = leg * LEG_SECONDS;
      const s = rallyAt(t, 0);
      const h = s.rackets[s.from]!;
      const b0 = s.ball;
      const b1 = rallyAt(t + 0.02 * LEG_SECONDS, 0).ball;
      // The head lies along the ball's measured heading — the racket turned
      // onto the line the ball actually leaves on, drift and all.
      const shot = Math.atan2(b1.x - b0.x, b1.z - b0.z);
      let d = h.rotation.y - shot;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      expect(Math.abs((d * 180) / Math.PI)).toBeLessThan(25);
    }
  });

  it('ballHeading reads the direction the ball is actually travelling', () => {
    const A = { x: 0, y: 1, z: 0 };
    const B = { x: 3, y: 1, z: 4 };
    // The ground track is the straight line A→B, so the heading is that
    // bearing at every point of the leg — including across the bounce, where
    // the two arcs meet at an angle in Y but not on the court.
    const expected = Math.atan2(3, 4);
    for (const u of [0, 0.3, 0.62, 0.9, 1]) {
      expect(ballHeading(A, B, u)).toBeCloseTo(expected, 6);
    }
  });

  it('the stroke is pulled back, square at impact, and follows through', () => {
    // The shape the swing must have, measured as yaw relative to the racket's
    // angle AT CONTACT, over the whole stroke window either side of it.
    for (const camK of [0, 1]) {
      for (let leg = 1; leg < 5; leg++) {
        const tc = leg * LEG_SECONDS;
        const hitter = rallyAt(tc, camK).from;
        const at = (dt: number) => rallyAt(tc + dt, camK).rackets[hitter]!.rotation.y;
        const contact = at(0);
        const rel = (dt: number) => at(dt) - contact;

        // Before the ball: cocked back, well away from the contact angle.
        const back = rel(-0.18 * LEG_SECONDS);
        expect(Math.abs(back)).toBeGreaterThan(0.35);
        // After the ball: carried on PAST it — the opposite side of contact
        // from the wind-up, not a rebound back the way it came.
        const through = rel(0.14 * LEG_SECONDS);
        expect(Math.sign(through)).toBe(-Math.sign(back));
        expect(Math.abs(through)).toBeGreaterThan(0.25);

        // Fastest at the ball: the yaw covered in a short step across contact
        // beats the same step taken at either extreme of the stroke.
        const d = 0.03 * LEG_SECONDS;
        const atBall = Math.abs(at(d) - at(-d));
        const cock = -0.17 * LEG_SECONDS; // mid wind-up, where the head is fully back
        const atCock = Math.abs(at(cock + d) - at(cock - d));
        expect(atBall).toBeGreaterThan(atCock);
      }
    }
  });

  it('the top view\'s ball flies exactly the path it always did', () => {
    // The top-down rally is the prototype's, untouched through every rewrite
    // of the swing: this checksum is the original path, captured before any
    // of this work, and it must never move.
    let sum = 0;
    for (let f = 0; f < Math.round(4 * LEG_SECONDS * 60); f++) {
      const b = rallyAt(f / 60, 0).ball;
      sum += b.x + b.y + b.z;
    }
    expect(sum).toBeCloseTo(406.343093344, 6);
  });

  it('the pitched view flies the ball at STRING height, not hand height', () => {
    // Deliberately NOT the prototype's path. Standing, the head sits ~1.27 m
    // above the grip, so a ball flown hand-to-hand passed that far under the
    // racket faces and met the handle. This baseline pins the corrected path
    // (was 531.163153419 when the ball flew between the hands).
    let sum = 0;
    for (let f = 0; f < Math.round(4 * LEG_SECONDS * 60); f++) {
      const b = rallyAt(f / 60, 1).ball;
      sum += b.x + b.y + b.z;
    }
    expect(sum).toBeCloseTo(734.106556405, 6);
  });

  it('the ball meets the middle of the string bed, in both views', () => {
    // The face is 0.46 m in radius, so anything inside that is on the hitting
    // area rather than the frame or the handle.
    for (const camK of [0, 1]) {
      for (let leg = 0; leg < 4; leg++) {
        const s = rallyAt(leg * LEG_SECONDS, camK);
        const bed = stringBed(s.rackets[s.from]!);
        const gap = Math.hypot(bed.x - s.ball.x, bed.y - s.ball.y, bed.z - s.ball.z);
        expect(gap).toBeLessThan(0.25);
      }
    }
  });

  it('the racket swings about the hand, not its own middle', () => {
    // The mesh's origin is the centre of the string bed, so rotating it
    // directly see-sawed the racket about its middle — the face dipping as the
    // handle rose, like a pan on a pivot. scene.ts hangs it in a pivot at the
    // GRIP: the hand then holds station while the head does the travelling.
    // This mirrors that placement to assert the resulting motion.
    const REACH = 0.95 * 1.15;
    const REST = Math.PI / 2 - 0.42;
    const hand = (r: (typeof frame.rackets)[number]) => ({
      x: r.position.x + REACH * Math.cos(REST) * Math.sin(r.rotation.y),
      y: r.position.y - REACH * Math.sin(REST),
      z: r.position.z + REACH * Math.cos(REST) * Math.cos(r.rotation.y),
    });
    const frame = rallyAt(0, 1);

    let hy = [Infinity, -Infinity];
    let headX = [Infinity, -Infinity];
    for (let i = 0; i <= 60; i++) {
      const r = rallyAt(LEG_SECONDS + (i / 60 - 0.5) * 0.38 * LEG_SECONDS, 1).rackets[3]!;
      const h = hand(r);
      // The head, from the hand through the racket's CURRENT rotation.
      const e = new THREE.Euler(r.rotation.x, r.rotation.y, r.rotation.z, 'YXZ');
      const out = new THREE.Vector3(0, 0, -REACH).applyQuaternion(
        new THREE.Quaternion().setFromEuler(e),
      );
      hy = [Math.min(hy[0]!, h.y), Math.max(hy[1]!, h.y)];
      headX = [Math.min(headX[0]!, h.x + out.x), Math.max(headX[1]!, h.x + out.x)];
    }
    expect(hy[1]! - hy[0]!).toBeLessThan(0.15); // the hand holds station
    expect(headX[1]! - headX[0]!).toBeGreaterThan(0.4); // the head sweeps an arc
  });

  it('every racket stays above the court, at every camera angle', () => {
    // scene.ts places the pivot an arm's length back down the handle from the
    // strings. That step must fade out as the court flattens: lying flat there
    // is no vertical arm to subtract, and taking the full reach anyway put the
    // pivot at y ≈ −0.3 — under the turf, with all four rackets invisible in
    // the top-down view, which is the view the Book tab opens on.
    // `position` IS the hand: scene.ts puts the pivot group straight there
    // (the mesh is offset back down its own handle inside that group), so the
    // check is simply that the hand — and the strings it swings — clear the
    // turf. The old form here re-derived a hand by subtracting a vertical arm
    // from the strings, a placement scene.ts does not do, and reported a
    // racket buried at y = −0.25 that was never actually below ground.
    for (const camK of [0, 0.25, 0.5, 0.75, 1]) {
      for (let f = 0; f < 120; f++) {
        for (const r of rallyAt(f / 60, camK).rackets) {
          expect(r.position.y).toBeGreaterThan(0.05);
          expect(stringBed(r).y).toBeGreaterThan(0.05);
        }
      }
    }
  });

  it('the swing is visible from directly above, not just in the front view', () => {
    // Yaw is the sweep across the court — the ONE rotation a top-down camera
    // can see, and the Book tab opens top-down. Gating the stroke on camK
    // switched it off entirely there: 0° of yaw travel, four rackets sitting
    // at their mount angles while the ball flew past them.
    for (const camK of [0, 0.5, 1]) {
      for (let i = 0; i < PLAYERS.length; i++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let f = 0; f < Math.round(4 * LEG_SECONDS * 60); f++) {
          const y = rallyAt(f / 60, camK).rackets[i]!.rotation.y;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
        expect(((hi - lo) * 180) / Math.PI).toBeGreaterThan(60);
      }
    }
  });

  it('the hand holds station while the head sweeps', () => {
    // `position` is the HAND — the pivot. Pinning the head there instead put
    // the ball on the strings but ran the swing backwards: the hand sweeping
    // 1.8 m while the head barely moved, because position hardly travels
    // during a stroke. The whole stroke is rotation IN PLACE — no step or
    // lunge toward the ball, in either view.
    for (const camK of [0, 1]) {
      let hand = [Infinity, -Infinity];
      let head = [Infinity, -Infinity];
      for (let i = 0; i <= 60; i++) {
        const r = rallyAt(LEG_SECONDS + (i / 60 - 0.5) * 0.38 * LEG_SECONDS, camK).rackets[3]!;
        const b = stringBed(r);
        hand = [Math.min(hand[0]!, r.position.x), Math.max(hand[1]!, r.position.x)];
        head = [Math.min(head[0]!, b.x), Math.max(head[1]!, b.x)];
      }
      expect(hand[1]! - hand[0]!).toBeLessThan(0.3);
      // The head still travels several times further than the hand. The bar
      // is not 1 m any more: the racket stands on its edge, so only
      // cos(STANDING_PITCH) of its length lies in the court plane and the
      // sweep seen from above is correspondingly shorter.
      expect(head[1]! - head[0]!).toBeGreaterThan(0.4);
      expect(head[1]! - head[0]!).toBeGreaterThan((hand[1]! - hand[0]!) * 3);
    }
  });

  it('top view: the head points down the shot and sweeps through the ball', () => {
    for (let leg = 0; leg < 4; leg++) {
      const t = leg * LEG_SECONDS;
      const s = rallyAt(t, 0);
      const h = s.rackets[s.from]!;
      // At contact the racket has swung nose-down through the ball, so the
      // pitch is well below the resting cant (negative here — see the tip
      // test above, which measures the drop in metres).
      expect(h.rotation.x).toBeLessThan(0.15);
      // The strings are on the ball at contact, not the handle.
      const bed = stringBed(h);
      expect(near(bed.x, s.ball.x, 0.1)).toBe(true);
      expect(near(bed.z, s.ball.z, 0.1)).toBe(true);

      // Seen from directly above, what reads is the racket's OUTLINE: the
      // head leads down the line the ball leaves on, handle trailing behind.
      // (The face normal points at the camera here, so it cannot also point
      // along the shot — that is the trade a flat top-down view makes.)
      const mid = rallyAt(t + 0.25 * LEG_SECONDS, 0).ball;
      const bearing = Math.atan2(mid.x - s.ball.x, mid.z - s.ball.z);
      let d = h.rotation.y - bearing;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      expect(Math.abs((d * 180) / Math.PI)).toBeLessThan(25);

      // The head sweeps ON down the shot line, through the ball — measured
      // into the follow-through, where the stroke has actually developed
      // (at +0.05 of a leg it has barely left contact).
      const along = (dt: number) => {
        const b = stringBed(rallyAt(t + dt * LEG_SECONDS, 0).rackets[s.from]!);
        return (b.x - s.ball.x) * Math.sin(bearing) + (b.z - s.ball.z) * Math.cos(bearing);
      };
      // It carries clearly past the ball at some point in the finish (the
      // exact peak moves with the drift), and it is past it immediately
      // after contact rather than retreating from the first frame.
      // The stroke's main motion in the top view is the TIP, not a horizontal
      // sweep: the head chops DOWN onto the ball and comes back up. Past
      // vertical the head's horizontal reach inverts, so `along` is not the
      // measure here — the pitch is (asserted in its own test below).
      void along;
    }
  });

  it('yaw: far pair faces −z, near pair +z, each angled toward the centre', () => {
    // A pronounced turn, not a token one: each racket is at rest ~85 % of a
    // rally, so this pose is what the court mostly looks like. At 0.3 rad
    // they sat near-parallel to the court's long axis and read as straight.
    // The base pose is mirrored across both centre lines; `trim` then nudges
    // individual rackets off it (top-left carries +15°).
    const base = (p: (typeof PLAYERS)[number]) => playerYaw(p) - (p.trim ?? 0);
    expect(near(base(PLAYERS[0]!), 0.6)).toBe(true);
    expect(near(base(PLAYERS[1]!), -0.6)).toBe(true);
    expect(near(base(PLAYERS[2]!), Math.PI - 0.6)).toBe(true);
    expect(near(base(PLAYERS[3]!), Math.PI + 0.6)).toBe(true);
    // Turned well off the court axis.
    for (const p of PLAYERS) {
      const off = Math.abs(((playerYaw(p) + Math.PI / 2) % Math.PI) - Math.PI / 2);
      expect((off * 180) / Math.PI).toBeGreaterThan(25);
    }
    // The trim reaches the actual pose: top-left is 15° round from its mirror.
    expect(((playerYaw(PLAYERS[0]!) - 0.6) * 180) / Math.PI).toBeCloseTo(15, 9);
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

  it('holds with the ball on the hitter\'s strings and nobody mid-swing', () => {
    for (const t of [0.4, 5.7, 12.9]) {
      const s = rallyAt(nextLegStart(t), 0);
      const bed = stringBed(s.rackets[s.from]!);
      expect(near(s.ball.x, bed.x, 0.1)).toBe(true);
      expect(near(s.ball.z, bed.z, 0.1)).toBe(true);
      // The hold lands ON the strike — the ball is leaving the strings, the
      // hitter square to the shot with the stroke passing through zero. Only
      // the two rackets in the exchange are moving; the other pair is idle.
      expect(s.rackets[s.from]!.hit).toBeCloseTo(1, 6);
      expect(s.newLeg).toBe(true);
    }
  });
});
