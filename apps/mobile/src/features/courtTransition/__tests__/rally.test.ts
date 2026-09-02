import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  cameraPose,
  LEG_SECONDS,
  nearCageOpacity,
  nextLegStart,
  PLAYERS,
  playerYaw,
  RACKET_Y,
  RALLY_ORDER,
  rallyAt,
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

  it('the ball leaves the hitter and lands on the receiver', () => {
    const start = rallyAt(0, 0);
    expect(start.ball).toEqual(start.rackets[0]!.position);
    const end = rallyAt(LEG_SECONDS - 1e-9, 0);
    const recv = end.rackets[3]!.position;
    expect(near(end.ball.x, recv.x, 1e-6)).toBe(true);
    expect(near(end.ball.z, recv.z, 1e-6)).toBe(true);
    expect(near(end.ball.y, recv.y, 1e-6)).toBe(true);
  });

  it('two arcs: bounces on the ground at 62 % of the leg, peaks 1.9 m up in flight', () => {
    const atBounce = rallyAt(0.62 * LEG_SECONDS, 0);
    expect(near(atBounce.ball.y, BALL_RADIUS, 1e-6)).toBe(true);
    const mid = rallyAt(0.31 * LEG_SECONDS, 0);
    // halfway through the flight arc: lerp(A.y, 0.22, .5) + 1.9, where A is the
    // hitter's CURRENT position (rackets drift while the ball is in the air).
    const a = mid.rackets[0]!.position.y;
    expect(near(mid.ball.y, (a + BALL_RADIUS) / 2 + 1.9, 1e-6)).toBe(true);
    expect(rallyAt(0.81 * LEG_SECONDS, 0).ball.y).toBeLessThan(1.2); // the low bounce arc
  });

  it('newLeg flags the first 2 % of a leg (trail reset)', () => {
    expect(rallyAt(0.01, 0).newLeg).toBe(true);
    expect(rallyAt(0.5, 0).newLeg).toBe(false);
  });

  it('rackets lie flat in the top view and stand up in the front view', () => {
    // At u = 0.5 nobody is swinging.
    const flat = rallyAt(0.5 * LEG_SECONDS, 0);
    for (const r of flat.rackets) {
      expect(r.hit).toBe(0);
      expect(r.rotation.x).toBe(0);
      expect(near(r.position.y, RACKET_Y.flat, 0.07)).toBe(true);
    }
    const up = rallyAt(0.5 * LEG_SECONDS, 1);
    for (const r of up.rackets) {
      expect(near(r.rotation.x, Math.PI / 2)).toBe(true);
      expect(near(r.rotation.z, 0)).toBe(true); // the flat-view roll is gone
      expect(near(r.position.y, RACKET_Y.standing, 0.07)).toBe(true);
    }
  });

  it('the hitter swings at the start of a leg; the receiver at the end', () => {
    const early = rallyAt(0.095 * LEG_SECONDS, 0);
    expect(early.rackets[0]!.hit).toBeGreaterThan(0.99);
    expect(early.rackets[3]!.hit).toBe(0);
    const late = rallyAt(0.93 * LEG_SECONDS, 0);
    expect(late.rackets[3]!.hit).toBeGreaterThan(0.59);
    expect(late.rackets[0]!.hit).toBe(0);
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

  it('holds with the ball on the hitter\'s racket and nobody mid-swing', () => {
    for (const t of [0.4, 5.7, 12.9]) {
      const s = rallyAt(nextLegStart(t), 0);
      const hand = s.rackets[s.from]!;
      expect(near(s.ball.x, hand.position.x, 1e-6)).toBe(true);
      expect(near(s.ball.z, hand.position.z, 1e-6)).toBe(true);
      expect(near(s.ball.y, hand.position.y, 1e-6)).toBe(true);
      for (const r of s.rackets) expect(near(r.hit, 0, 1e-6)).toBe(true);
      expect(s.newLeg).toBe(true);
    }
  });
});
