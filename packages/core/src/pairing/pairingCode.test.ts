import { describe, expect, it } from 'vitest';
import {
  PAIRING_ALPHABET,
  formatPairingCode,
  isPairingCode,
  mintPairingCode,
  normalisePairingCode,
  pairingCodeRegex,
} from './pairingCode';

describe('normalisePairingCode', () => {
  it.each([
    ['ab1o-i l2xy', 'AB10112XY'], // O→0, I→1, L→1, separators dropped
    ['ABCDE-FGHJK', 'ABCDEFGHJK'],
    ['  abcde fghjk ', 'ABCDEFGHJK'],
    ['O0OI1L', '000111'],
  ])('normalises %s', (input, expected) => {
    expect(normalisePairingCode(input)).toBe(expected);
  });
});

describe('isPairingCode', () => {
  it('accepts exactly ten Crockford characters', () => {
    expect(isPairingCode('0123456789')).toBe(true);
    expect(isPairingCode('ABCDEFGHJK')).toBe(true);
    expect(isPairingCode('MNPQRSTVWX')).toBe(true);
  });
  it('refuses the wrong length, lowercase, and the excluded letters', () => {
    expect(isPairingCode('ABCDEFGHJ')).toBe(false);
    expect(isPairingCode('ABCDEFGHJKM')).toBe(false);
    expect(isPairingCode('abcdefghjk')).toBe(false);
    expect(isPairingCode('ABCDEFGHJU')).toBe(false);
    expect(isPairingCode('ABCDEFGHJO')).toBe(false);
    expect(isPairingCode('ABCDE-FGHJ')).toBe(false);
  });
  it('agrees with the exported regex and alphabet', () => {
    for (const ch of PAIRING_ALPHABET) expect(pairingCodeRegex.test(ch.repeat(10))).toBe(true);
    expect(PAIRING_ALPHABET).toHaveLength(32);
    expect(PAIRING_ALPHABET).not.toMatch(/[ILOU]/);
  });
});

describe('formatPairingCode', () => {
  it('splits five and five', () => {
    expect(formatPairingCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
  });
  it('round-trips through normalise', () => {
    expect(normalisePairingCode(formatPairingCode('ABCDEFGHJK'))).toBe('ABCDEFGHJK');
  });
});

describe('mintPairingCode', () => {
  it('maps bytes through the alphabet with & 31', () => {
    expect(mintPairingCode(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe('0123456789');
    expect(mintPairingCode(() => Uint8Array.from(new Array(10).fill(255)))).toBe('ZZZZZZZZZZ');
    expect(mintPairingCode(() => Uint8Array.from(new Array(10).fill(32)))).toBe('0000000000');
  });
  it('asks for exactly ten bytes and produces a valid code', () => {
    let asked = 0;
    const code = mintPairingCode((n) => {
      asked = n;
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (i * 37 + 11) & 255;
      return out;
    });
    expect(asked).toBe(10);
    expect(isPairingCode(code)).toBe(true);
  });
});
