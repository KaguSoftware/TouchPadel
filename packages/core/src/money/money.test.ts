import { describe, expect, it } from 'vitest';
import { addIqd, iqd, isIqd, mulIqd, subIqd, sumIqd, MoneyError, ZERO_IQD } from './iqd';

describe('iqd branded type', () => {
  it('accepts non-negative safe integers', () => {
    expect(iqd(0)).toBe(0);
    expect(iqd(12500)).toBe(12500);
    expect(iqd(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ZERO_IQD).toBe(0);
  });

  it('rejects fractional amounts', () => {
    expect(() => iqd(1.5)).toThrowError(MoneyError);
    expect(() => iqd(0.0001)).toThrowError(/integer/);
    try {
      iqd(2.5);
      expect.unreachable();
    } catch (e) {
      expect((e as MoneyError).code).toBe('NOT_AN_INTEGER');
    }
  });

  it('rejects negatives, NaN, Infinity, unsafe integers', () => {
    expect(() => iqd(-1)).toThrowError(MoneyError);
    expect(() => iqd(Number.NaN)).toThrowError(MoneyError);
    expect(() => iqd(Number.POSITIVE_INFINITY)).toThrowError(MoneyError);
    expect(() => iqd(2 ** 53)).toThrowError(MoneyError);
  });

  it('isIqd guards correctly', () => {
    expect(isIqd(1000)).toBe(true);
    expect(isIqd(0)).toBe(true);
    expect(isIqd(-1)).toBe(false);
    expect(isIqd(1.2)).toBe(false);
    expect(isIqd('1000')).toBe(false);
    expect(isIqd(2 ** 53)).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds and sums', () => {
    expect(addIqd(1000, 2500, 500)).toBe(4000);
    expect(sumIqd([])).toBe(0);
    expect(sumIqd([250, 750])).toBe(1000);
  });

  it('rejects non-integer operands in add', () => {
    expect(() => addIqd(1000, 0.5)).toThrowError(MoneyError);
  });

  it('guards overflow on addition', () => {
    expect(() => addIqd(Number.MAX_SAFE_INTEGER, 1)).toThrowError(MoneyError);
  });

  it('subtracts and refuses to go negative', () => {
    expect(subIqd(5000, 2000)).toBe(3000);
    expect(subIqd(5000, 5000)).toBe(0);
    expect(() => subIqd(2000, 5000)).toThrowError(/negative/);
  });

  it('multiplies by integer quantities only', () => {
    expect(mulIqd(2500, 3)).toBe(7500);
    expect(mulIqd(2500, 0)).toBe(0);
    expect(() => mulIqd(2500, 1.5)).toThrowError(MoneyError);
    expect(() => mulIqd(2500, -2)).toThrowError(MoneyError);
    expect(() => mulIqd(2500.5, 2)).toThrowError(MoneyError);
  });
});
