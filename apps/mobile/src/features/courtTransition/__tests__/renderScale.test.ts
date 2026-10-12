import { describe, expect, it } from 'vitest';
import { bufferPx, glBoxFor, glScaleFor, MAX_RENDER_RATIO } from '../renderScale';

describe('the court render scale', () => {
  it('leaves a 2× screen and anything below it alone', () => {
    expect(glScaleFor(1)).toBe(1);
    expect(glScaleFor(2)).toBe(1);
    expect(glScaleFor(Number.NaN)).toBe(1);
  });

  it.each([2.625, 2.75, 3, 3.5])('draws a %s× screen at 2× pixels', (ratio) => {
    const k = glScaleFor(ratio);
    expect(k).toBeLessThan(1);
    expect(k * ratio).toBeCloseTo(MAX_RENDER_RATIO, 12);
    // The Play stage on a 390 pt phone: 780 px across, wherever the ratio lands.
    expect(bufferPx(390, k, ratio)).toBe(780);
  });

  it('centres the smaller view and scales it back up to cover the box exactly', () => {
    const k = glScaleFor(3);
    const box = glBoxFor(390, 265, k);
    expect(box.width).toBeCloseTo(260, 9);
    expect(box.start).toBeCloseTo(65, 9);
    expect(box.top).toBeCloseTo(44.1666, 3);
    // Scaled about its centre, it spans the whole box.
    expect(box.width * box.scale).toBeCloseTo(390, 9);
    expect(box.start - (box.width * (box.scale - 1)) / 2).toBeCloseTo(0, 9);
    expect(box.top - (box.height * (box.scale - 1)) / 2).toBeCloseTo(0, 9);
  });

  it('is the identity at full size', () => {
    expect(glBoxFor(390, 265, 1)).toEqual({ width: 390, height: 265, start: 0, top: 0, scale: 1 });
  });
});
