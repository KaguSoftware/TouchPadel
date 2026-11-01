import { describe, expect, it } from 'vitest';
import { MANAGER_PIN_RE } from '@touch/core';
import { PIN_MAX, PIN_MIN, pinDigits, pinLongEnough } from './pinRules';

describe('pinRules (F-50)', () => {
  it('is 4 to 12 digits', () => {
    expect([PIN_MIN, PIN_MAX]).toEqual([4, 12]);
    expect(pinLongEnough('123')).toBe(false);
    expect(pinLongEnough('1234')).toBe(true);
  });

  it('keeps digits only and stops at PIN_MAX', () => {
    expect(pinDigits('12a3 4')).toBe('1234');
    expect(pinDigits('1234567890123456')).toBe('123456789012');
  });

  it('agrees with the queued payloads’ MANAGER_PIN_RE at both ends', () => {
    expect(MANAGER_PIN_RE.test('1'.repeat(PIN_MIN))).toBe(true);
    expect(MANAGER_PIN_RE.test('1'.repeat(PIN_MIN - 1))).toBe(false);
    expect(MANAGER_PIN_RE.test('1'.repeat(PIN_MAX))).toBe(true);
    expect(MANAGER_PIN_RE.test('1'.repeat(PIN_MAX + 1))).toBe(false);
  });
});
