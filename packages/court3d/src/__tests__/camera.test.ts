import { describe, expect, it } from 'vitest';
import { Vector3, type PerspectiveCamera } from 'three';
import {
  courtTopFraction,
  makeCamera,
  NET,
  poseCamera,
  poseTopCamera,
  projectNet,
  TOP_VIEW,
  topBallScale,
  topCameraPose,
} from '../camera';
import { BALL_RADIUS, PLAYERS, RACKET_Y } from '../rally';

describe('net tape projection (the on-net button follows it)', () => {
  const W = 390;
  const H = 591;

  it('at rest the tape is centred horizontally, a little below the middle, and spans most of the width', () => {
    const n = projectNet(0, W, H);
    // ARABIC DEPENDS ON THIS. The Book tab anchors the on-net button with a
    // LOGICAL `start` (net.rest.centreX - width / 2) and then moves it with a
    // PHYSICAL translateX off the same projection. The two agree only because
    // the rest camera sits on the x = 0 plane, which makes an inset from the
    // right edge land on the same pixel as one from the left. Give the orbit a
    // non-zero starting azimuth and the button would sit off the net in RTL
    // only — a bug no LTR run could show.
    expect(Math.abs(n.centreX - W / 2)).toBeLessThan(0.5);
    // look-at is 0.8 m past the net, so the net sits below centre
    expect(n.centreY).toBeGreaterThan(H / 2);
    expect(n.centreY).toBeLessThan(H * 0.62);
    // 9.66 m of net in a ~25.5 m tall, ~16.8 m wide field of view
    expect(n.width).toBeGreaterThan(W * 0.55);
    expect(n.width).toBeLessThan(W * 0.7);
  });

  it('pitched, the tape rises above centre, widens (the camera comes 14 m closer) and drifts with the azimuth', () => {
    const rest = projectNet(0, W, H);
    const full = projectNet(1, W, H);
    expect(full.centreY).toBeLessThan(H / 2);
    expect(full.width).toBeGreaterThan(rest.width);
    expect(full.width).toBeLessThan(rest.width * 1.4);
    expect(Math.abs(full.centreX - rest.centreX)).toBeGreaterThan(2);
  });

  it('moves continuously through the orbit', () => {
    let prev = projectNet(0, W, H);
    for (let i = 1; i <= 20; i++) {
      const cur = projectNet(i / 20, W, H);
      expect(Math.abs(cur.centreY - prev.centreY)).toBeLessThan(H * 0.05);
      expect(Math.abs(cur.width - prev.width)).toBeLessThan(W * 0.05);
      prev = cur;
    }
  });

  it('a reused camera re-fits a changed aspect', () => {
    const cam = makeCamera(1);
    const a = projectNet(0, 390, 591, cam);
    const b = projectNet(0, 390, 591);
    expect(a).toEqual(b);
  });
});

describe('blank band above the court (the Book tab tucks it under the title)', () => {
  it('is a small fraction of the height, the same for every aspect', () => {
    const f = courtTopFraction();
    // 25.5 m of view, look-at 0.8 m past the net: ~11 % above the far wall, ~5 % below the near one
    expect(f).toBeGreaterThan(0.08);
    expect(f).toBeLessThan(0.15);
    // the far wall is above the tape, which is above centre
    const n = projectNet(0, 390, 591);
    expect(f * 591).toBeLessThan(n.centreY);
  });
});

describe("the top view (Play and Coaches tabs: bird's-eye, horizontal, no pitch)", () => {
  const ndc = (camera: PerspectiveCamera, x: number, y: number, z: number) => {
    const v = new Vector3(x, y, z).project(camera);
    return { x: v.x, y: v.y };
  };
  const topCam = (aspect: number) => {
    const camera = makeCamera(aspect);
    poseTopCamera(camera);
    return camera;
  };
  /** The stage: full width, courtHeroHeight (44 % of the frame, 240–400) + 82 pt. */
  const STAGE = 390 / (Math.round(844 * 0.44) + 82);
  /** Stages from a short phone to a tall one, a squarer box, and a very wide one. */
  const ASPECTS = [390 / 482, STAGE, 390 / 322, 1.5, 2.5];

  it('looks straight down, with no pitch', () => {
    const pose = topCameraPose(STAGE);
    expect(pose.position.x).toBe(pose.lookAt.x);
    expect(pose.position.z).toBe(pose.lookAt.z);
    expect(pose.position.y).toBeGreaterThan(40);
    expect(pose.up).toEqual({ x: -1, y: 0, z: 0 });
  });

  it.each(ASPECTS)(
    'at aspect %s the court lies horizontal and fills the width with a margin',
    (aspect) => {
      const c = topCam(aspect);
      const left = ndc(c, 0, 0, 10);
      const right = ndc(c, 0, 0, -10);
      // +z end on the left, −z end on the right, at the same height.
      expect(left.x).toBeLessThan(-0.5);
      expect(right.x).toBeGreaterThan(0.5);
      expect(Math.abs(left.y - right.y)).toBeLessThan(1e-9);
      if (aspect < 2) {
        // Width-bound: the length takes most of it.
        expect(left.x).toBeLessThan(-0.8);
        expect(right.x).toBeGreaterThan(0.8);
      }
      // The whole court is inside the frame: the corner posts to their caps
      // (x ±5, z ±10, 4.08 m up) and the base slab's corners on the ground.
      const extremes = [
        ...[-5, 5].flatMap((x) => [-10, 10].map((z) => [x, 4.08, z] as const)),
        ...[-5.1, 5.1].flatMap((x) => [-10.7, 10.7].map((z) => [x, -0.06, z] as const)),
      ];
      for (const [x, y, z] of extremes) {
        const p = ndc(c, x, y, z);
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(Math.abs(p.y)).toBeLessThan(1);
      }
    },
  );

  it('the net is a vertical line through the middle of the screen', () => {
    const c = topCam(STAGE);
    const a = ndc(c, -NET.halfSpan, NET.y, 0);
    const b = ndc(c, NET.halfSpan, NET.y, 0);
    expect(Math.abs(a.x)).toBeLessThan(1e-9);
    expect(Math.abs(b.x)).toBeLessThan(1e-9);
    expect(a.y - b.y).toBeGreaterThan(0.5); // far sideline at the top
  });

  it('sits the court above the stage middle, in the window the content plate leaves', () => {
    const c = topCam(STAGE);
    const centre = (ndc(c, -5, 0, 0).y + ndc(c, 5, 0, 0).y) / 2;
    expect(centre).toBeCloseTo(TOP_VIEW.raise, 9);
  });

  it("Play: the rally's two pairs stand either side of the net", () => {
    const c = topCam(STAGE);
    const net = ndc(c, 0, NET.y, 0).x;
    for (const p of PLAYERS) {
      const x = ndc(c, p.x, RACKET_Y.flat, p.z).x;
      // The near pair (+z) on the left, the far pair on the right.
      if (p.z > 0) expect(x).toBeLessThan(net - 0.3);
      else expect(x).toBeGreaterThan(net + 0.3);
      expect(Math.abs(x)).toBeLessThan(1);
      expect(Math.abs(ndc(c, p.x, RACKET_Y.flat, p.z).y)).toBeLessThan(1);
    }
  });

  it('draws a ball bigger the higher it is, and true size on the turf', () => {
    expect(topBallScale(BALL_RADIUS)).toBe(1);
    expect(topBallScale(0)).toBe(1);
    expect(topBallScale(2.5)).toBeGreaterThan(1.25);
    expect(topBallScale(2.5)).toBeLessThan(1.4);
  });

  it('leaves the Book camera alone', () => {
    const c = makeCamera(390 / 844);
    poseCamera(c, 0);
    const near = ndc(c, 0, 0, 10);
    const far = ndc(c, 0, 0, -10);
    expect(far.y).toBeGreaterThan(near.y); // the Book's court still stands portrait
    expect(Math.abs(far.x - near.x)).toBeLessThan(0.05);
  });
});
