import { describe, expect, it } from 'vitest';
import { follow, K_FROM, K_TO, kFor, sectionProgress } from '../progress';

describe('section progress → camera pitch', () => {
  const VH = 900;
  const H = 1600;

  it('runs 0 → 1 from the section entering at the bottom to leaving at the top, clamped outside', () => {
    expect(sectionProgress(VH, H, VH)).toBe(0);
    expect(sectionProgress(VH + 500, H, VH)).toBe(0);
    expect(sectionProgress(-H, H, VH)).toBe(1);
    expect(sectionProgress(-H - 500, H, VH)).toBe(1);
    expect(sectionProgress(0, 0, 0)).toBe(0);
  });

  it('pitches monotonically from K_FROM to K_TO, and never past either', () => {
    let last = -Infinity;
    for (let top = VH + 200; top >= -H - 200; top -= 50) {
      const k = kFor(sectionProgress(top, H, VH));
      expect(k).toBeGreaterThanOrEqual(last);
      expect(k).toBeGreaterThanOrEqual(K_FROM);
      expect(k).toBeLessThanOrEqual(K_TO);
      last = k;
    }
    expect(kFor(0)).toBe(K_FROM);
    expect(kFor(1)).toBe(K_TO);
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
