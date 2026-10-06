import { describe, expect, it } from 'vitest';
import { looksLikeCardNumber } from './card';

// R74 amended (DB-21, OP-04): the same answer as app.looks_like_card (0293).

describe('looksLikeCardNumber', () => {
  it('a run of 12 Latin digits, typed in groups or not, is a card', () => {
    expect(looksLikeCardNumber('123456789012')).toBe(true);
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('4111-1111-1111-1111')).toBe(true);
    expect(looksLikeCardNumber('4111.1111.1111.1111')).toBe(true);
    expect(looksLikeCardNumber('4111–1111—1111−1111')).toBe(true);
  });

  it('Arabic-Indic and Extended Arabic-Indic digits count too', () => {
    expect(looksLikeCardNumber('٤١١١ ٢٢٢٢ ٣٣٣٣')).toBe(true);
    expect(looksLikeCardNumber('۴۱۱۱.۲۲۲۲.۳۳۳۳')).toBe(true);
    // Mixed scripts make one run.
    expect(looksLikeCardNumber('4111 ٢٢٢٢ ۳۳۳۳')).toBe(true);
  });

  it('11 digits, or ordinary references, are not', () => {
    expect(looksLikeCardNumber('12345678901')).toBe(false);
    expect(looksLikeCardNumber('١٢٣٤٥٦٧٨٩٠١')).toBe(false);
    expect(looksLikeCardNumber('REF 2026/10/01 #44')).toBe(false);
    expect(looksLikeCardNumber('Receipt 4471')).toBe(false);
    expect(looksLikeCardNumber('')).toBe(false);
  });
});
