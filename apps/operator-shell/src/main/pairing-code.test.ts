import { describe, expect, it } from 'vitest';
import {
  PAIRING_ALPHABET as shellAlphabet,
  formatPairingCode as shellFormat,
  isPairingCode as shellIs,
  mintPairingCode,
  normalisePairingCode as shellNormalise,
  pairingCodeRegex as shellRegex,
} from './pairing-code';
import {
  PAIRING_ALPHABET,
  formatPairingCode,
  isPairingCode,
  normalisePairingCode,
  pairingCodeRegex,
} from '@touch/core/pairing/pairingCode';

// Drift guard: the shell's copy must agree with @touch/core in every detail a
// kitchen screen depends on — a code the renderer accepts is a code the till
// must mint and the validator must pass.
describe('pairing-code mirror', () => {
  it('shares the alphabet and the regex with @touch/core', () => {
    expect(shellAlphabet).toBe(PAIRING_ALPHABET);
    expect(shellRegex.source).toBe(pairingCodeRegex.source);
  });

  it.each(['ab1o-i l2xy', 'ABCDE-FGHJK', '  abcde fghjk ', 'O0OI1L', 'zz-99', ''])(
    'normalises %j the same way',
    (input) => {
      expect(shellNormalise(input)).toBe(normalisePairingCode(input));
    },
  );

  it('formats and validates the same way', () => {
    expect(shellFormat('ABCDEFGHJK')).toBe(formatPairingCode('ABCDEFGHJK'));
    for (const v of ['ABCDEFGHJK', 'ABCDEFGHJ', 'abcdefghjk', 'ABCDEFGHJU']) {
      expect(shellIs(v)).toBe(isPairingCode(v));
    }
  });

  it('mints codes @touch/core accepts, and does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = mintPairingCode();
      expect(isPairingCode(code)).toBe(true);
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });
});
