import { describe, expect, it } from 'vitest';
import {
  formatIraqiNational,
  gotruePhone,
  isIraqiMobile,
  phoneCanon,
  phoneDigits,
  toE164Any,
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

  it('drops the trunk 0 after 964 too, like the SQL app.phone_canon (0430)', () => {
    // "+964 0770…" is how many people write it: the same person as 0770….
    expect(phoneCanon('9640770123456')).toBe('770123456');
    expect(phoneCanon('+964 0770 123 4567')).toBe(phoneCanon('07701234567'));
  });
});

describe('toE164Any (web sign-in: phone sign-in is open worldwide)', () => {
  it('takes any Iraqi spelling, and any country written with its code', () => {
    expect(toE164Any('0770 123 4567')).toBe('+9647701234567');
    expect(toE164Any('+964 0770 123 4567')).toBe('+9647701234567');
    expect(toE164Any('+90 532 123 4567')).toBe('+905321234567');
    expect(toE164Any('0090 532 123 4567')).toBe('+905321234567');
  });
  it('refuses a foreign number without its code, and junk', () => {
    expect(toE164Any('532 123 4567')).toBeNull();
    expect(toE164Any('+12')).toBeNull();
    expect(toE164Any(null)).toBeNull();
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
