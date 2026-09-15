import { describe, expect, it } from 'vitest';
import { advance, MAX_STEP_S } from '../rallyClock';

/**
 * THE JUMPING RALLY, as a table.
 *
 * Reported as: on the Book tab, opening the booking sheet or picking a
 * different day stops the court's padel animation for roughly a fifth of a
 * second and it looks glitchy (owner, 2026-09-10).
 *
 * Two separate faults hide in that sentence. The block itself is the JS thread
 * being busy, and it is fought elsewhere — the ICU caching in @touch/core's
 * `localParts` cut a trading night's assembly from ~620 `formatToParts` calls
 * to ~41, and the sheet's grid now reconciles in place rather than rebuilding
 * every cell. What is left after that is a frame or two, and a frame or two
 * only READ as a glitch because the old clock caught them up in one step.
 *
 * These pin the cap that stops it.
 */
describe('advance', () => {
  it('runs at real time for an ordinary frame', () => {
    // 60 fps: 16.7 ms is well under the cap, so it passes through untouched.
    expect(advance(1, 1000 / 60)).toBeCloseTo(1 + 1 / 60, 10);
  });

  it('caps a frame the JS thread was too busy to draw', () => {
    // The whole bug in one assertion: 200 ms of contention moves the rally on
    // by one ordinary step, not by 200 ms of flight.
    expect(advance(1, 200)).toBeCloseTo(1 + MAX_STEP_S, 10);
  });

  it('never jumps, however long the block', () => {
    for (const blockedMs of [50, 200, 1_000, 60_000]) {
      expect(advance(0, blockedMs) - 0).toBeLessThanOrEqual(MAX_STEP_S + 1e-12);
    }
  });

  it('holds still when there is no previous frame to measure from', () => {
    // A stop — the idle hold, leaving the tab, backgrounding — clears the
    // interval, so resuming does not bill the rally for the time it was away.
    expect(advance(4.2, null)).toBe(4.2);
  });

  it('never runs backwards', () => {
    expect(advance(4.2, -100)).toBe(4.2);
  });

  it('still adds up to real time when nothing is blocking', () => {
    // Sixty ordinary frames of a 60 fps second land on a second of rally.
    let t = 0;
    for (let i = 0; i < 60; i++) t = advance(t, 1000 / 60);
    expect(t).toBeCloseTo(1, 6);
  });
});
