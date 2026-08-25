import { describe, expect, it } from 'vitest';
import {
  TICKER_MAX_LEN,
  TICKER_MAX_ROWS,
  normalizeTicker,
  pairTicker,
  sameStringArray,
  splitTicker,
  validateTicker,
} from './ticker';

describe('ticker rows', () => {
  it('pairs the two arrays and pads a missing side', () => {
    expect(pairTicker(['a', 'b'], ['أ'])).toEqual([
      { en: 'a', ar: 'أ' },
      { en: 'b', ar: '' },
    ]);
  });

  it('normalize trims and drops fully blank rows only', () => {
    expect(
      normalizeTicker([
        { en: ' a ', ar: ' أ ' },
        { en: '  ', ar: '' },
        { en: 'b', ar: '' },
      ]),
    ).toEqual([
      { en: 'a', ar: 'أ' },
      { en: 'b', ar: '' },
    ]);
  });

  it('validates incomplete pairs, row count and length', () => {
    expect(validateTicker([{ en: 'a', ar: 'أ' }])).toBeNull();
    expect(validateTicker([{ en: 'a', ar: '' }])).toBe('incomplete');
    expect(validateTicker([{ en: '', ar: 'أ' }])).toBe('incomplete');
    expect(
      validateTicker(Array.from({ length: TICKER_MAX_ROWS + 1 }, () => ({ en: 'a', ar: 'أ' }))),
    ).toBe('too_many');
    expect(validateTicker([{ en: 'x'.repeat(TICKER_MAX_LEN + 1), ar: 'أ' }])).toBe('too_long');
    expect(validateTicker([{ en: 'x'.repeat(TICKER_MAX_LEN), ar: 'أ' }])).toBeNull();
  });

  it('split is the inverse of pair', () => {
    const rows = pairTicker(['a', 'b'], ['أ', 'ب']);
    expect(splitTicker(rows)).toEqual({ ticker_en: ['a', 'b'], ticker_ar: ['أ', 'ب'] });
  });

  it('sameStringArray compares element-wise', () => {
    expect(sameStringArray(['a'], ['a'])).toBe(true);
    expect(sameStringArray(['a'], ['a', 'b'])).toBe(false);
    expect(sameStringArray(['a'], ['b'])).toBe(false);
  });
});
