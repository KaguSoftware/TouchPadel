/**
 * @vitest-environment jsdom
 *
 * Needs a real localStorage; the default environment for *.test.ts is node so
 * the existing pure suites stay fast.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  COVERS_MULTIPLIER_KEY,
  COVERS_MULTIPLIER_OPTIONS,
  DEFAULT_COVERS_MULTIPLIER,
  isCoversMultiplier,
  readCoversMultiplier,
  writeCoversMultiplier,
} from './coversMultiplier';

// One localStorage key was read and written from three places with three
// different ideas of what was valid: the settings screen offered six values and
// defaulted to 1, the analytics deck offered six DIFFERENT values, and the data
// hook accepted 1-10 and defaulted to 2. The visible symptom was a settings
// screen showing x1 while the dashboard computed x2 — and picking x3 in the
// deck made the settings screen show x1 and write 1 back if touched.

beforeEach(() => {
  localStorage.clear();
});

describe('coversMultiplier', () => {
  it('defaults to what the dashboard has always computed', () => {
    // Not 1. Changing this moves every covers figure the owner has already seen.
    expect(DEFAULT_COVERS_MULTIPLIER).toBe(2);
    expect(readCoversMultiplier()).toBe(2);
  });

  it('accepts every offered option and nothing else', () => {
    for (const n of COVERS_MULTIPLIER_OPTIONS) expect(isCoversMultiplier(n)).toBe(true);
    for (const n of [0, 0.5, 1.1, 2.2, 5, 10, -1]) expect(isCoversMultiplier(n)).toBe(false);
  });

  it('keeps every value either picker used to offer', () => {
    // The union is deliberate: an owner who already stored 1.25 (settings) or
    // 3 (deck) must not have it silently reset on the next read.
    for (const n of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]) {
      expect(isCoversMultiplier(n)).toBe(true);
    }
  });

  it('round-trips a stored choice', () => {
    writeCoversMultiplier(2.5);
    expect(localStorage.getItem(COVERS_MULTIPLIER_KEY)).toBe('2.5');
    expect(readCoversMultiplier()).toBe(2.5);
  });

  it('falls back to the default for a value outside the option list', () => {
    localStorage.setItem(COVERS_MULTIPLIER_KEY, '7');
    expect(readCoversMultiplier()).toBe(DEFAULT_COVERS_MULTIPLIER);
  });

  it('falls back to the default for junk', () => {
    localStorage.setItem(COVERS_MULTIPLIER_KEY, 'two');
    expect(readCoversMultiplier()).toBe(DEFAULT_COVERS_MULTIPLIER);
  });

  it('survives storage being unavailable', () => {
    // Kiosk browsers can throw on access, not merely return null.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readCoversMultiplier()).toBe(DEFAULT_COVERS_MULTIPLIER);
    expect(() => writeCoversMultiplier(2)).not.toThrow();
  });
});
