import { describe, expect, it } from 'vitest';
import { formatIQD } from '@touch/i18n';
import { formatFigureIqd, wholeIqd } from './money';

describe('panel money figures (F-58)', () => {
  it('rounds to whole dinars, half away from zero, never -0', () => {
    expect(wholeIqd(12_345.5)).toBe(12_346);
    expect(wholeIqd(12_345.49)).toBe(12_345);
    expect(wholeIqd(-2.5)).toBe(-3);
    expect(Object.is(wholeIqd(-0.2), 0)).toBe(true);
    expect(wholeIqd(Number.NaN)).toBe(0);
  });

  it('a fractional average order value is still IQD, in both languages', () => {
    expect(formatFigureIqd(8_333.33, 'en')).toBe(formatIQD(8_333, 'en'));
    expect(formatFigureIqd(8_333.33, 'en')).toContain('IQD');
    expect(formatFigureIqd(8_333.67, 'ar')).toBe(formatIQD(8_334, 'ar'));
    expect(formatFigureIqd(25_000, 'en')).toBe(formatIQD(25_000, 'en'));
  });
});
