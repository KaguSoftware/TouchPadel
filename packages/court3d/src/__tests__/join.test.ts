import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  JOIN_CHANGE,
  JOIN_LEAD,
  JOIN_REST_LOCAL,
  JOIN_SEATS,
  JOIN_TIMING,
  legSeconds,
  racketPresence,
  seatPlayer,
  seatSpot,
  spotPresence,
  takenPlayers,
  warmupAt,
  warmupBallSampler,
  warmupOrder,
} from '../join';
import { BALL_RADIUS, PLAYERS, RALLY_ORDER, RACKET_Y } from '../rally';
import { makeCamera, poseTopCamera, projectTop } from '../camera';
import { SWING_CONTACT, SWING_DURATION } from '../swing';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const ground = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** The Play stage: full width, the court-sized stage (CourtStage, topStageFor) on a 390 pt phone. */
const W = 390;
const H = 292;
const ndc = (x: number, y: number, z: number) => {
  const camera = makeCamera(W / H);
  poseTopCamera(camera);
  const v = new Vector3(x, y, z).project(camera);
  return { x: v.x, y: v.y };
};

/** Every order the page can ask for: 1 to 4 taken seats, both directions. */
const ORDERS = [false, true].flatMap((mirror) =>
  [1, 2, 3, 4].map((taken) => ({
    mirror,
    taken,
    order: warmupOrder(takenPlayers({ taken, mirror })),
  })),
);

describe('seats fill in the match card’s order (MiniCourt)', () => {
  it('left to right: top-left, bottom-left, then top-right, bottom-right', () => {
    const at = [0, 1, 2, 3].map((s) => {
      const p = seatSpot(s, false);
      return ndc(p.x, RACKET_Y.flat, p.z);
    });
    expect(at[0]!.x).toBeLessThan(0);
    expect(at[1]!.x).toBeLessThan(0);
    expect(at[2]!.x).toBeGreaterThan(0);
    expect(at[3]!.x).toBeGreaterThan(0);
    expect(at[0]!.y).toBeGreaterThan(at[1]!.y);
    expect(at[2]!.y).toBeGreaterThan(at[3]!.y);
  });

  it('right to left: the pairs swap halves, top still first', () => {
    const at = [0, 1, 2, 3].map((s) => {
      const p = seatSpot(s, true);
      return ndc(p.x, RACKET_Y.flat, p.z);
    });
    expect(at[0]!.x).toBeGreaterThan(0);
    expect(at[1]!.x).toBeGreaterThan(0);
    expect(at[2]!.x).toBeLessThan(0);
    expect(at[3]!.x).toBeLessThan(0);
    expect(at[0]!.y).toBeGreaterThan(at[1]!.y);
  });

  it('every seat is a different rally player, in both directions', () => {
    for (const mirror of [false, true]) {
      const players = [0, 1, 2, 3].map((s) => seatPlayer(s, mirror));
      expect(new Set(players).size).toBe(JOIN_SEATS);
    }
  });

  it('takes the first N seats, and clamps what the server could never send', () => {
    expect(takenPlayers({ taken: 2, mirror: false })).toEqual([2, 3]);
    expect(takenPlayers({ taken: 0, mirror: false })).toEqual([]);
    expect(takenPlayers({ taken: -1, mirror: false })).toEqual([]);
    expect(takenPlayers({ taken: 9, mirror: false })).toHaveLength(4);
  });

  it('projectTop lands each spot where the camera draws it, inside the stage', () => {
    for (let s = 0; s < 4; s++) {
      const p = seatSpot(s, false);
      const px = projectTop({ x: p.x, y: 0, z: p.z }, W, H);
      const n = ndc(p.x, 0, p.z);
      expect(px.x).toBeCloseTo(((n.x + 1) / 2) * W, 6);
      expect(px.y).toBeCloseTo(((1 - n.y) / 2) * H, 6);
      expect(px.x).toBeGreaterThan(0);
      expect(px.x).toBeLessThan(W);
      expect(px.y).toBeGreaterThan(0);
      expect(px.y).toBeLessThan(H);
    }
  });
});

describe('the order the ball goes round', () => {
  it('a full court is the rally’s own order', () => {
    expect(warmupOrder([0, 1, 2, 3])).toEqual([...RALLY_ORDER]);
  });

  it('three rackets cross the net on two legs of three', () => {
    for (const { order, taken } of ORDERS) {
      if (taken !== 3) continue;
      const crossings = order.filter(
        (p, j) => Math.sign(PLAYERS[p]!.z) !== Math.sign(PLAYERS[order[(j + 1) % 3]!]!.z),
      ).length;
      expect(crossings).toBe(2);
    }
  });
});

describe('the warm-up', () => {
  it('no ball before the cycle, then it grows into being over JOIN_TIMING.emerge', () => {
    const order = warmupOrder([2, 3]);
    expect(warmupAt(order, -0.1, 5, 0).ballScale).toBe(0);
    expect(warmupAt(order, 0, 5, 0).ballScale).toBe(0);
    expect(warmupAt(order, JOIN_TIMING.emerge / 2, 5, 0).ballScale).toBeCloseTo(0.5, 6);
    expect(warmupAt(order, JOIN_TIMING.emerge, 5, 0).ballScale).toBe(1);
  });

  it('no racket, no ball', () => {
    const s = warmupAt([], 3, 0, 0);
    expect(s.ballScale).toBe(0);
    expect(s.trailFrom).toBe(Infinity);
  });

  it('the ball leaves and lands ON a face: at every strike it is on the striker’s sweet spot', () => {
    for (const { order } of ORDERS) {
      const n = order.length;
      const leg = legSeconds(n);
      for (const tau0 of [0, 7.3]) {
        for (let k = 0; k < 2 * n + 1; k++) {
          const tau = JOIN_LEAD + k * leg;
          const s = warmupAt(order, tau, tau0, 0);
          const striker = order[k % n]!;
          expect(dist(s.ball, s.rackets[striker]!.contact)).toBeLessThan(1e-6);
        }
        // The opening toss leaves from the first racket's face.
        const toss = warmupAt(order, 0, tau0, 0);
        expect(dist(toss.ball, toss.rackets[order[0]!]!.contact)).toBeLessThan(1e-6);
      }
    }
  });

  it('each strike is the Book tab’s swing at its contact, and one racket’s swings never overlap', () => {
    for (const { order } of ORDERS) {
      const n = order.length;
      if (n < 2) continue;
      const leg = legSeconds(n);
      expect(n * leg).toBeGreaterThanOrEqual(SWING_DURATION);
      for (let k = 0; k < 2 * n; k++) {
        const s = warmupAt(order, JOIN_LEAD + k * leg, 0, 0);
        expect(s.rackets[order[k % n]!]!.hit).toBeCloseTo(1, 6);
      }
    }
    // The opening toss leaves the first racket room for its whole wind-up.
    expect(JOIN_LEAD).toBeGreaterThanOrEqual(SWING_CONTACT);
  });

  it('a racket alone never swings: keepy-ups, the ball back on its face every JOIN_TIMING.keepy', () => {
    const order = warmupOrder(takenPlayers({ taken: 1, mirror: false }));
    expect(order).toHaveLength(1);
    for (let tau = 0; tau < 6; tau += 0.05) {
      expect(warmupAt(order, tau, 0, 0).rackets[order[0]!]!.hit).toBe(0);
    }
    for (let k = 0; k < 4; k++) {
      const s = warmupAt(order, JOIN_LEAD + k * JOIN_TIMING.keepy, 0, 0);
      expect(dist(s.ball, s.rackets[order[0]!]!.contact)).toBeLessThan(1e-6);
    }
  });

  it('the ball never goes to an open spot', () => {
    for (const { order, mirror } of ORDERS) {
      if (order.length === 4) continue;
      const open = [0, 1, 2, 3].filter((s) => !order.includes(seatPlayer(s, mirror)));
      const spots = open.map((s) => seatSpot(s, mirror));
      const cycle = JOIN_LEAD + 3 * order.length * legSeconds(order.length);
      for (let tau = 0; tau < cycle; tau += 0.02) {
        const b = warmupAt(order, tau, 0, 0).ball;
        for (const sp of spots) expect(ground(b, sp)).toBeGreaterThan(1.4);
      }
    }
  });

  it('stays on the court, and only touches the turf to bounce', () => {
    for (const { order } of ORDERS) {
      const cycle = JOIN_LEAD + 2 * order.length * legSeconds(order.length);
      for (let tau = 0; tau < cycle; tau += 0.02) {
        const b = warmupAt(order, tau, 0, 0).ball;
        expect(Math.abs(b.x)).toBeLessThan(5);
        expect(Math.abs(b.z)).toBeLessThan(10);
        expect(b.y).toBeGreaterThanOrEqual(BALL_RADIUS - 1e-9);
      }
    }
  });

  it('the trail starts at the current leg: never back through the racket that struck', () => {
    const order = warmupOrder([0, 1, 2, 3]);
    const leg = legSeconds(4);
    expect(warmupAt(order, 0.5, 0, 0).trailFrom).toBe(0);
    expect(warmupAt(order, JOIN_LEAD + 0.2, 0, 0).trailFrom).toBeCloseTo(JOIN_LEAD, 9);
    expect(warmupAt(order, JOIN_LEAD + leg + 0.2, 0, 0).trailFrom).toBeCloseTo(JOIN_LEAD + leg, 9);
  });

  it('the ball sampler is warmupAt’s ball and scale to the bit', () => {
    const sample = warmupBallSampler();
    for (const { order } of ORDERS) {
      for (let tau = -0.2; tau < 8; tau += 0.137) {
        const a = warmupAt(order, tau, 2.5, 0);
        const b = sample(order, tau, 2.5, 0);
        expect(b.scale).toBe(a.ballScale);
        if (a.ballScale > 0) expect(b.ball).toEqual(a.ball);
      }
    }
  });

  it('Reduce Motion’s still frame is the first strike: the ball whole, on the first face', () => {
    for (const { order } of ORDERS) {
      const s = warmupAt(order, JOIN_REST_LOCAL, 0, 0);
      expect(s.ballScale).toBe(1);
      expect(dist(s.ball, s.rackets[order[0]!]!.contact)).toBeLessThan(1e-6);
    }
  });
});

describe('seats coming and going', () => {
  it('a racket lands: 1.3× on arrival, settled at 1× by JOIN_CHANGE.racketIn, and stays', () => {
    expect(racketPresence(true, 0)).toBeCloseTo(1.3, 9);
    expect(racketPresence(true, JOIN_CHANGE.racketIn)).toBe(1);
    expect(racketPresence(true, Infinity)).toBe(1);
  });

  it('a racket leaves: shrinks to nothing by JOIN_CHANGE.racketOut, faster than it arrives', () => {
    expect(racketPresence(false, 0)).toBe(1);
    expect(racketPresence(false, JOIN_CHANGE.racketOut)).toBe(0);
    expect(racketPresence(false, Infinity)).toBe(0);
    expect(JOIN_CHANGE.racketOut).toBeLessThan(JOIN_CHANGE.racketIn);
  });

  it('a spot settles in from 0.9× as it fades up, and fades out subtler than it came', () => {
    expect(spotPresence(true, 0)).toEqual({ opacity: 0, scale: 0.9 });
    expect(spotPresence(true, JOIN_CHANGE.spotIn)).toEqual({ opacity: 1, scale: 1 });
    expect(spotPresence(false, 0)).toEqual({ opacity: 1, scale: 1 });
    const gone = spotPresence(false, JOIN_CHANGE.spotOut);
    expect(gone.opacity).toBe(0);
    expect(gone.scale).toBeGreaterThan(0.9);
    expect(JOIN_CHANGE.spotOut).toBeLessThan(JOIN_CHANGE.spotIn);
  });
});
