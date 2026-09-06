import { describe, expect, it } from 'vitest';
import {
  formatIraqiNational,
  gotruePhone,
  isIraqiMobile,
  phoneCanon,
  phoneDigits,
  toE164Iraq,
} from './iraq';

import { IRAQ_PHONE_FIXTURES } from './iraq.fixtures';

describe('phoneDigits / phoneCanon (twins of app.phone_digits / app.phone_canon, 0065)', () => {
  it.each(IRAQ_PHONE_FIXTURES)('$raw -> digits $digits, canon $canon', ({ raw, digits, canon }) => {
    expect(phoneDigits(raw)).toBe(digits);
    expect(phoneCanon(raw)).toBe(canon);
  });

  it('is total over non-strings', () => {
    expect(phoneDigits(undefined)).toBe('');
    expect(phoneDigits(null)).toBe('');
    expect(phoneDigits(770 as unknown as string)).toBe('');
    expect(phoneCanon(undefined)).toBe('');
  });

  it('strips ONE prefix only, like the SQL regexp', () => {
    // '^(964|0)' removes a single alternative: 9640770… keeps the trunk 0.
    expect(phoneCanon('9640770123456')).toBe('0770123456');
  });
});

describe('toE164Iraq / isIraqiMobile', () => {
  it.each(IRAQ_PHONE_FIXTURES)('$raw -> $e164', ({ raw, e164 }) => {
    expect(toE164Iraq(raw)).toBe(e164);
    expect(isIraqiMobile(raw)).toBe(e164 !== null);
  });
});

describe('gotruePhone', () => {
  it('drops the plus and nothing else', () => {
    expect(gotruePhone('+9647701234567')).toBe('9647701234567');
    expect(gotruePhone('9647701234567')).toBe('9647701234567');
  });
});

describe('formatIraqiNational', () => {
  it('renders the national 07XX XXX XXXX form', () => {
    expect(formatIraqiNational('+9647701234567')).toBe('0770 123 4567');
    expect(formatIraqiNational('07701234567')).toBe('0770 123 4567');
  });

  it('leaves anything else alone and never throws', () => {
    expect(formatIraqiNational('+995419010203')).toBe('+995419010203');
    expect(formatIraqiNational('')).toBe('');
    expect(formatIraqiNational(null)).toBe('');
    expect(formatIraqiNational(undefined)).toBe('');
  });
});
