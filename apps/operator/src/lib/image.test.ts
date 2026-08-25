import { describe, expect, it } from 'vitest';
import { fitWithin } from './image';

describe('fitWithin', () => {
  it('keeps images already inside the limit', () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1200, 1200, 1200)).toEqual({ width: 1200, height: 1200 });
  });

  it('scales the longest edge down and preserves aspect', () => {
    expect(fitWithin(2400, 1200, 1200)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });

  it('never produces a zero dimension', () => {
    expect(fitWithin(10_000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
});
