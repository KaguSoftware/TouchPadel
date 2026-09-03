import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  DEFAULT_ISO,
  composePhone,
  countryByIso,
  defaultCountry,
  flagOf,
  formatNational,
  parsePhone,
  sanitizeNationalInput,
  stripTrunk,
  validatePhone,
} from '../phone';

describe('country table', () => {
  it('defaults to Iraq — the venue\'s country', () => {
    expect(DEFAULT_ISO).toBe('IQ');
    expect(defaultCountry()).toMatchObject({ iso: 'IQ', dial: '964' });
  });

  it('lists Iraq first so the picker opens on it', () => {
    expect(COUNTRIES[0]?.iso).toBe('IQ');
  });

  it('has no duplicate ISO codes', () => {
    const seen = new Set(COUNTRIES.map((c) => c.iso));
    expect(seen.size).toBe(COUNTRIES.length);
  });

  it('stores dial codes as bare digits — the plus is presentation', () => {
    for (const c of COUNTRIES) expect(c.dial).toMatch(/^\d{1,4}$/);
  });

  it('falls back to the default for an unknown ISO rather than throwing', () => {
    expect(countryByIso('ZZ').iso).toBe('IQ');
    expect(countryByIso('').iso).toBe('IQ');
  });
});

describe('flagOf', () => {
  it('builds the flag from regional indicators', () => {
    expect(flagOf('IQ')).toBe('\u{1F1EE}\u{1F1F6}');
    expect(flagOf('gb')).toBe('\u{1F1EC}\u{1F1E7}');
  });

  it('returns empty for a non-letter code instead of mojibake', () => {
    expect(flagOf('1A')).toBe('');
  });
});

describe('parsePhone', () => {
  it('empties to Iraq with a blank national part', () => {
    expect(parsePhone(null)).toEqual({ iso: 'IQ', national: '' });
    expect(parsePhone('')).toEqual({ iso: 'IQ', national: '' });
    expect(parsePhone('   ')).toEqual({ iso: 'IQ', national: '' });
  });

  it('splits the E.164 this app writes', () => {
    expect(parsePhone('+9647701234567')).toEqual({ iso: 'IQ', national: '7701234567' });
  });

  it('reads the 00 international prefix — the seeded venue number is written that way', () => {
    // The client's own (wrong-country) number from docs/client/06.
    expect(parsePhone('00995419010203')).toEqual({ iso: 'GE', national: '419010203' });
  });

  it('treats a bare national number as Iraqi and drops the trunk zero', () => {
    expect(parsePhone('07701234567')).toEqual({ iso: 'IQ', national: '7701234567' });
  });

  it('ignores spaces, dashes and parens the guest typed', () => {
    expect(parsePhone('+964 (770) 123-4567')).toEqual({ iso: 'IQ', national: '7701234567' });
  });

  it('prefers the LONGEST matching dial code', () => {
    // +964 must not be shortened to +96 or +9 by a first-match scan.
    expect(parsePhone('+9647701234567').iso).toBe('IQ');
    expect(parsePhone('+447700900123').iso).toBe('GB');
  });

  it('keeps the digits of an unattributable + number rather than dropping them', () => {
    const parsed = parsePhone('+9991234');
    expect(parsed.national).toContain('9991234');
  });

  it('does not match a dial code with nothing after it', () => {
    // '+964' alone is a country, not a number — it must not yield an empty
    // national part that then reads as "no phone".
    expect(parsePhone('+964').national).toBe('964');
  });
});

describe('composePhone', () => {
  it('joins to E.164', () => {
    expect(composePhone('IQ', '7701234567')).toBe('+9647701234567');
  });

  it('strips the trunk zero the guest habitually types', () => {
    expect(composePhone('IQ', '07701234567')).toBe('+9647701234567');
  });

  it('strips separators', () => {
    expect(composePhone('IQ', '770 123 4567')).toBe('+9647701234567');
  });

  it('is empty when there are no digits — so the required check still fires', () => {
    expect(composePhone('IQ', '')).toBe('');
    expect(composePhone('IQ', '   ')).toBe('');
    expect(composePhone('IQ', '0')).toBe('');
  });

  it('round-trips a stored number unchanged', () => {
    const stored = '+9647701234567';
    const p = parsePhone(stored);
    expect(composePhone(p.iso, p.national)).toBe(stored);
  });

  it('normalizes an old-shape number to E.164 on round-trip', () => {
    const p = parsePhone('00964 770 123 4567');
    expect(composePhone(p.iso, p.national)).toBe('+9647701234567');
  });
});

describe('validatePhone', () => {
  it('requires digits', () => {
    expect(validatePhone('IQ', '')).toBe('PHONE_REQUIRED');
    expect(validatePhone('IQ', '0')).toBe('PHONE_REQUIRED');
  });

  it('accepts a real Iraqi mobile', () => {
    expect(validatePhone('IQ', '7701234567')).toBeNull();
    expect(validatePhone('IQ', '07701234567')).toBeNull();
  });

  it('rejects a stub too short to be any number', () => {
    expect(validatePhone('IQ', '123')).toBe('PHONE_INVALID');
  });

  it('rejects a number past the E.164 15-digit ceiling', () => {
    expect(validatePhone('IQ', '1234567890123')).toBe('PHONE_INVALID');
  });

  it('counts the dial code toward the ceiling', () => {
    // 3-digit dial + 12 national = 15, the limit exactly.
    expect(validatePhone('IQ', '123456789012')).toBeNull();
  });

  it('does not guess at carrier prefixes — an unusual but plausible number passes', () => {
    expect(validatePhone('IQ', '7511111111')).toBeNull();
  });
});

describe('input helpers', () => {
  it('keeps only digits as the guest types', () => {
    expect(sanitizeNationalInput('+964 (770) abc 12-34')).toBe('9647701234');
  });

  it('strips leading zeros only', () => {
    expect(stripTrunk('007701234567')).toBe('7701234567');
    expect(stripTrunk('7700')).toBe('7700');
  });

  it('groups for display in threes', () => {
    expect(formatNational('7701234567')).toBe('770 123 456 7');
  });
});
