import { describe, expect, it } from 'vitest';
import { isValidScore, otherSide } from './score';

describe('isValidScore (TD-9)', () => {
  it('takes any split that adds up to the target exactly', () => {
    expect(isValidScore(13, 11, 24)).toBe(true);
    expect(isValidScore(12, 12, 24)).toBe(true);
    expect(isValidScore(24, 0, 24)).toBe(true); // a forfeit (review N4)
    expect(isValidScore(0, 24, 24)).toBe(true);
    expect(isValidScore(17, 15, 32)).toBe(true);
  });

  it('refuses a short or long total', () => {
    expect(isValidScore(12, 11, 24)).toBe(false);
    expect(isValidScore(13, 12, 24)).toBe(false);
    expect(isValidScore(0, 0, 24)).toBe(false);
  });

  it('refuses negatives, fractions and non-numbers', () => {
    expect(isValidScore(-1, 25, 24)).toBe(false);
    expect(isValidScore(12.5, 11.5, 24)).toBe(false);
    expect(isValidScore(Number.NaN, 24, 24)).toBe(false);
    expect(isValidScore(12, 12, 0)).toBe(false);
    expect(isValidScore(12, 12, 24.5)).toBe(false);
  });
});

describe('otherSide', () => {
  it('fills the other side as target − a', () => {
    expect(otherSide(13, 24)).toBe(11);
    expect(otherSide(0, 24)).toBe(24);
    expect(otherSide(24, 24)).toBe(0);
  });

  it('answers null for a side that cannot score', () => {
    expect(otherSide(25, 24)).toBeNull();
    expect(otherSide(-1, 24)).toBeNull();
    expect(otherSide(1.5, 24)).toBeNull();
  });
});
