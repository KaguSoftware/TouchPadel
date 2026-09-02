import { describe, expect, it } from 'vitest';
import { courtTopFraction, makeCamera, projectNet } from '../camera';

describe('net tape projection (the on-net button follows it)', () => {
  const W = 390;
  const H = 591;

  it('at rest the tape is centred horizontally, a little below the middle, and spans most of the width', () => {
    const n = projectNet(0, W, H);
    expect(Math.abs(n.centreX - W / 2)).toBeLessThan(0.5);
    // look-at is 0.8 m past the net, so the net sits below centre
    expect(n.centreY).toBeGreaterThan(H / 2);
    expect(n.centreY).toBeLessThan(H * 0.62);
    // 10.3 m of net in a ~25.5 m tall, ~16.8 m wide field of view
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
