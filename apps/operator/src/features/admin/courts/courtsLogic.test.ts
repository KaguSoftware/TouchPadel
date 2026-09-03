import { describe, expect, it } from 'vitest';
import { durationsValid, toggleDuration } from './courtsLogic';

describe('toggleDuration', () => {
  it('adds, removes and keeps the list sorted', () => {
    expect(toggleDuration([60, 90], 45)).toEqual([45, 60, 90]);
    expect(toggleDuration([45, 60, 90], 60)).toEqual([45, 90]);
  });
});

describe('durationsValid', () => {
  it('mirrors the 0062 contract: non-empty, 30-300, 15-minute steps', () => {
    expect(durationsValid([60, 90])).toBe(true);
    expect(durationsValid([])).toBe(false);
    expect(durationsValid([20])).toBe(false);
    expect(durationsValid([65])).toBe(false);
    expect(durationsValid([330])).toBe(false);
  });
});
