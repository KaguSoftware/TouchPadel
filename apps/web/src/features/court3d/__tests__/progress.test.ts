import { describe, expect, it } from 'vitest';
import { follow, SCROLL_OUT_AT, SCROLL_P_MAX, scrollProgress } from '../progress';

describe('scroll progress', () => {
  const VH = 900;
  const H = 600;

  it('is 0 while the stage top is still in the viewport (upper third or lower)', () => {
    expect(scrollProgress(120, H, VH)).toBe(0);
    expect(scrollProgress(VH / 3, H, VH)).toBe(0);
    expect(scrollProgress(700, H, VH)).toBe(0);
    expect(scrollProgress(0, H, VH)).toBe(0);
  });

  it('reaches SCROLL_P_MAX while part of the stage is still on screen', () => {
    expect(scrollProgress(-H * SCROLL_OUT_AT, H, VH)).toBeCloseTo(SCROLL_P_MAX, 6);
    expect(scrollProgress(-H, H, VH)).toBeCloseTo(SCROLL_P_MAX, 6);
    expect(scrollProgress(-5000, H, VH)).toBeCloseTo(SCROLL_P_MAX, 6);
  });

  it('rises monotonically in between', () => {
    let last = -1;
    for (let top = VH / 3; top >= -H; top -= 25) {
      const p = scrollProgress(top, H, VH);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it('never divides by nothing', () => {
    expect(scrollProgress(0, 0, 0)).toBe(0);
  });
});

describe('follow', () => {
  it('closes on the target at the same rate whatever the frame interval', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = follow(a, 1, 1 / 60);
    let b = 0;
    for (let i = 0; i < 120; i++) b = follow(b, 1, 1 / 120);
    expect(a).toBeCloseTo(b, 6);
  });

  it('snaps when close enough and ignores a non-positive step', () => {
    expect(follow(0.99995, 1, 1 / 60)).toBe(1);
    expect(follow(0.2, 1, 0)).toBe(0.2);
  });
});
