import { describe, expect, it } from 'vitest';
import { addIqd, iqd, isIqd, mulIqd, subIqd, sumIqd, MoneyError, ZERO_IQD } from './iqd';
import { calcTaxIqd, toIqdHalfUp } from './tax';
import { formatIQD } from './format';

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

describe('tax (basis points, half-up, integer arithmetic)', () => {
  it('computes 10% (1000 bp) exactly', () => {
    expect(calcTaxIqd(10000, 1000)).toBe(1000);
    expect(calcTaxIqd(0, 1000)).toBe(0);
    expect(calcTaxIqd(10000, 0)).toBe(0);
  });

  it('rounds half-up', () => {
    expect(calcTaxIqd(5, 1000)).toBe(1); // 0.5 -> 1
    expect(calcTaxIqd(4, 1000)).toBe(0); // 0.4 -> 0
    expect(calcTaxIqd(15, 1000)).toBe(2); // 1.5 -> 2
    expect(calcTaxIqd(25, 500)).toBe(1); // 1.25 -> 1
  });

  it('rejects invalid rates', () => {
    expect(() => calcTaxIqd(1000, -1)).toThrowError(MoneyError);
    expect(() => calcTaxIqd(1000, 10001)).toThrowError(MoneyError);
    expect(() => calcTaxIqd(1000, 10.5)).toThrowError(MoneyError);
  });

  it('property: tax is integer and bounded by subtotal', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 500; i++) {
      const subtotal = Math.floor(rand() * 1_000_000);
      const rateBp = Math.floor(rand() * 10001);
      const tax = calcTaxIqd(subtotal, rateBp);
      expect(Number.isSafeInteger(tax)).toBe(true);
      expect(tax).toBeGreaterThanOrEqual(0);
      expect(tax).toBeLessThanOrEqual(subtotal);
    }
  });
});

describe('toIqdHalfUp (fractional internals -> whole dinars)', () => {
  it('rounds half-up on non-negative values', () => {
    expect(toIqdHalfUp(2.5)).toBe(3);
    expect(toIqdHalfUp(2.4)).toBe(2);
    expect(toIqdHalfUp(0)).toBe(0);
  });

  it('rejects negatives and non-finite values', () => {
    expect(() => toIqdHalfUp(-0.4)).toThrowError(MoneyError);
    expect(() => toIqdHalfUp(Number.NaN)).toThrowError(MoneyError);
  });
});

describe('formatIQD', () => {
  it('formats en with Western digits and grouping', () => {
    const out = formatIQD(iqd(1250000), 'en');
    expect(out).toContain('1,250,000');
    expect(out).toMatch(/IQD/);
  });

  it('formats ar with WESTERN digits by default (plan decision)', () => {
    const out = formatIQD(iqd(1250000), 'ar');
    expect(out).not.toMatch(/[٠-٩]/); // no Arabic-Indic digits
    expect(out).toContain('1');
    expect(out).toContain('250');
  });

  it('exposes arabic-indic digits as an option for later', () => {
    const out = formatIQD(iqd(12500), 'ar', { digits: 'arabic-indic' });
    expect(out).toMatch(/[٠-٩]/);
  });

  it('never shows decimals (zero-decimal currency)', () => {
    expect(formatIQD(iqd(999), 'en')).not.toMatch(/999[.,]0/);
  });

  it('rejects fractional input', () => {
    expect(() => formatIQD(10.5, 'en')).toThrowError(MoneyError);
  });
});
