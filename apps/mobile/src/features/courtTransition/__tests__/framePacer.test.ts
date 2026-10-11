import { describe, expect, it } from 'vitest';
import { paceFrame } from '../framePacer';

const PERIOD = 1000 / 45;

/** Drives the pacer with display ticks every `hz`, returning the times drawn. */
function run(hz: number, seconds: number, jitterMs = 0): number[] {
  const tick = 1000 / hz;
  const drawn: number[] = [];
  let due: number | null = null;
  for (let i = 0; i * tick < seconds * 1000; i++) {
    const now = i * tick + (i % 2 === 0 ? jitterMs : -jitterMs);
    const r = paceFrame(due, now, PERIOD);
    due = r.nextDueAt;
    if (r.draw) drawn.push(now);
  }
  return drawn;
}

describe('top-view frame pacer (45 fps on any display)', () => {
  it.each([60, 90, 120])('averages 45 fps on a %i Hz display', (hz) => {
    const drawn = run(hz, 10);
    expect(drawn.length / 10).toBeGreaterThan(44.5);
    expect(drawn.length / 10).toBeLessThan(45.5);
  });

  it('holds 45 with a millisecond of tick jitter', () => {
    const drawn = run(60, 10, 1);
    expect(drawn.length / 10).toBeGreaterThan(44.5);
    expect(drawn.length / 10).toBeLessThan(45.5);
  });

  it('draws 3 of every 4 ticks on 60 Hz, never leaving a gap past two ticks', () => {
    const drawn = run(60, 2);
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]! - drawn[i - 1]!).toBeLessThan((1000 / 60) * 2 + 0.01);
    }
  });

  it('draws every second tick, evenly, on 90 Hz', () => {
    const drawn = run(90, 2);
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i]! - drawn[i - 1]!).toBeCloseTo((1000 / 90) * 2, 5);
    }
  });

  it('always draws the first frame after a start or a stop', () => {
    expect(paceFrame(null, 12_345, PERIOD).draw).toBe(true);
  });

  it('restarts from now after a stall instead of drawing a burst to catch up', () => {
    const after = paceFrame(100, 1_000, PERIOD);
    expect(after.draw).toBe(true);
    expect(after.nextDueAt).toBeCloseTo(1_000 + PERIOD, 5);
    expect(paceFrame(after.nextDueAt, 1_000 + 1000 / 60, PERIOD).draw).toBe(false);
  });
});
