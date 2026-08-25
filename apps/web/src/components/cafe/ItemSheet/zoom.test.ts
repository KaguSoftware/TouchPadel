import { describe, expect, it } from 'vitest';
import {
  clampPan,
  clampScale,
  dismissOpacity,
  nextTapScale,
  pinchDistance,
  shouldDismiss,
} from './zoom';

const VIEW = { width: 400, height: 800 };

describe('lightbox zoom', () => {
  it('clamps the scale to 1–5', () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(9)).toBe(5);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('double tap toggles between fit and 2.5×', () => {
    expect(nextTapScale(1)).toBe(2.5);
    expect(nextTapScale(2.5)).toBe(1);
    expect(nextTapScale(5)).toBe(1);
  });

  it('pins the pan at fit scale and bounds it when zoomed', () => {
    expect(clampPan({ x: 120, y: -90 }, 1, VIEW)).toEqual({ x: 0, y: 0 });
    // at 2× the image overhangs by width/2 = 200 and height/2 = 400
    expect(clampPan({ x: 500, y: -500 }, 2, VIEW)).toEqual({ x: 200, y: -400 });
    expect(clampPan({ x: 50, y: 60 }, 2, VIEW)).toEqual({ x: 50, y: 60 });
  });

  it('measures pinch distance', () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('lightbox dismiss', () => {
  it('fires past 100 px on either axis', () => {
    expect(shouldDismiss({ x: 0, y: 99 })).toBe(false);
    expect(shouldDismiss({ x: 0, y: 100 })).toBe(true);
    expect(shouldDismiss({ x: -140, y: 0 })).toBe(true);
  });

  it('tracks the backdrop opacity against the drag', () => {
    expect(dismissOpacity({ x: 0, y: 0 })).toBe(1);
    expect(dismissOpacity({ x: 0, y: 100 })).toBeCloseTo(0.5);
    expect(dismissOpacity({ x: 0, y: 400 })).toBe(0);
  });
});
