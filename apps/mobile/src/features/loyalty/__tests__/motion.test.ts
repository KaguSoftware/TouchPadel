import { describe, expect, it } from 'vitest';
import { LEAN_REST, stepLean, type CardLean } from '../motion';

/** Feed `n` readings of the same rate, `dt` apart. */
const run = (
  rate: { x: number; y: number },
  n: number,
  dt = 1 / 60,
  from: CardLean = LEAN_REST,
) => {
  let lean = from;
  for (let i = 0; i < n; i++) lean = stepLean(lean, rate, dt);
  return lean;
};

describe('the points card lean from the gyroscope', () => {
  it('stays at rest while the phone is still or only trembles', () => {
    expect(run({ x: 0, y: 0 }, 60)).toEqual(LEAN_REST);
    expect(run({ x: 0.01, y: -0.01 }, 60)).toEqual(LEAN_REST);
  });

  it('leans against the turn: right edge away brings the card’s right edge forward', () => {
    const lean = run({ x: 0, y: 1 }, 10);
    expect(lean.x).toBeLessThan(0);
    expect(lean.y).toBe(0);
  });

  it('leans against the turn: top edge forward sends the card’s top edge away', () => {
    const lean = run({ x: 1, y: 0 }, 10);
    expect(lean.y).toBeLessThan(0);
    expect(lean.x).toBe(0);
  });

  it('never leans past the edge', () => {
    const lean = run({ x: -20, y: 20 }, 120);
    expect(lean.x).toBe(-1);
    expect(lean.y).toBe(1);
  });

  it('settles back once the phone is held still, at any angle', () => {
    const turned = run({ x: 0, y: 2 }, 20);
    expect(Math.abs(turned.x)).toBeGreaterThan(0.5);
    const settled = run({ x: 0, y: 0 }, 90, 1 / 60, turned);
    expect(Math.abs(settled.x)).toBeLessThan(0.1);
  });

  it('counts a stall or a bad timestamp as at most one short step', () => {
    const stalled = stepLean(LEAN_REST, { x: 0, y: 1 }, 5);
    const short = stepLean(LEAN_REST, { x: 0, y: 1 }, 0.1);
    expect(stalled).toEqual(short);
    expect(stepLean(LEAN_REST, { x: 0, y: 1 }, Number.NaN)).toEqual(LEAN_REST);
    expect(stepLean(LEAN_REST, { x: 0, y: 1 }, -1)).toEqual(LEAN_REST);
  });
});
