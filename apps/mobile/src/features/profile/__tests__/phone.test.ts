import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  DEFAULT_ISO,
  composePhone,
  countryByIso,
  defaultCountry,
  flagOf,
  formatNational,
  maxNationalDigits,
  parsePhone,
  sanitizeNationalInput,
  stripTrunk,
  phoneChangeNeedsCode,
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
    // Iraq groups 3-3-4, so the last four stay together — the old blind
    // threes-grouper left a stranded '7' on the end.
    expect(formatNational('IQ', '7701234567')).toBe('770 123 4567');
  });

  it('uses each country\'s own grouping', () => {
    expect(formatNational('TR', '5551234567')).toBe('(555) 123 45 67');
    expect(formatNational('US', '4155550123')).toBe('(415) 555 0123');
    expect(formatNational('GB', '7700900123')).toBe('7700 900123');
    expect(formatNational('AE', '501234567')).toBe('50 123 4567');
  });

  it('closes the paren only once a digit follows, so the group stays erasable', () => {
    // The bracket must never be the LAST character: if it were, a backspace
    // would delete it, the digits would be unchanged, and the formatter would
    // put it straight back — the field freezes and those digits cannot be
    // erased. Reported from the device, 2026-09-06.
    expect(formatNational('TR', '5')).toBe('(5');
    expect(formatNational('TR', '555')).toBe('(555');
    expect(formatNational('TR', '5551')).toBe('(555) 1');
    expect(formatNational('US', '415')).toBe('(415');
    expect(formatNational('US', '4155')).toBe('(415) 5');
  });

  it('never ends on a separator, at any length', () => {
    // The general form of the bug above: a trailing space would strand the
    // caret the same way a trailing bracket did.
    for (const iso of ['TR', 'US', 'IQ', 'GB', 'AE', 'FR']) {
      for (let n = 1; n <= 12; n++) {
        const shown = formatNational(iso, '5'.repeat(n));
        expect(/[\d)]$/.test(shown), `${iso} @ ${n}: ${shown}`).toBe(true);
      }
    }
  });

  it('deletes down to empty one digit at a time', () => {
    // Simulates the field: the shown string loses its last character, and what
    // survives as digits is re-formatted. Every step must lose exactly one.
    let shown = formatNational('TR', '5551234567');
    let guard = 0;
    while (shown !== '' && guard++ < 50) {
      const next = formatNational('TR', sanitizeNationalInput(shown.slice(0, -1)));
      expect(next, `stuck at ${shown}`).not.toBe(shown);
      shown = next;
    }
    expect(shown).toBe('');
  });

  it('keeps digits the shape did not account for', () => {
    // Never drop what the guest typed: the shapes are the common case, not a
    // length rule, and validation is length-based and lives elsewhere.
    expect(formatNational('KW', '123456789012')).toBe('1234 5678 9012');
  });

  it('caps input at the country\'s own length', () => {
    // Turkish mobiles are 10 national digits: the 11th is simply not accepted.
    expect(sanitizeNationalInput('55512345678', 'TR')).toBe('5551234567');
    expect(sanitizeNationalInput('7701234567', 'IQ')).toBe('7701234567');
    expect(sanitizeNationalInput('77012345678999', 'IQ')).toBe('7701234567');
  });

  it('caps by the stated max where a country runs longer than its pattern', () => {
    // `fmt` is the COMMON shape, not a length rule. German numbers run 10-11
    // digits, so capping at the pattern's 11 must not clip a real one.
    expect(maxNationalDigits('DE')).toBe(11);
    expect(sanitizeNationalInput('15112345678', 'DE')).toBe('15112345678');
  });

  it('never lets the cap exceed what E.164 allows', () => {
    // 15 digits total, dial code included — no country's field may accept more
    // than the remainder, whatever its own table row claims.
    for (const c of COUNTRIES) {
      expect(maxNationalDigits(c.iso) + c.dial.length, c.iso).toBeLessThanOrEqual(15);
    }
  });

  it('leaves the uncapped form alone for every other caller', () => {
    // Without an iso it is the old digits-only helper, which parsePhone and
    // composePhone both rely on.
    expect(sanitizeNationalInput('+964 (770) abc 12-34')).toBe('9647701234');
  });

  it('a full number always fits the formatted width the field caps at', () => {
    // The input's `maxLength` is the formatted length of a complete number, so
    // an off-by-one here would refuse the last legitimate digit — the field
    // would look broken on exactly the numbers it is meant to accept.
    for (const c of COUNTRIES) {
      const max = maxNationalDigits(c.iso);
      const full = formatNational(c.iso, '0'.repeat(max));
      expect(sanitizeNationalInput(full, c.iso).length, c.iso).toBe(max);
    }
  });

  it('is display only — never changes what gets stored', () => {
    expect(composePhone('TR', formatNational('TR', '5551234567'))).toBe('+905551234567');
  });
});

describe('phoneChangeNeedsCode', () => {
  const IQ = '+9647701234567';
  const OTHER = '+9647509876543';

  it('never asks for a code while the OTP scaffold is dormant', () => {
    expect(phoneChangeNeedsCode({ enabled: false, current: IQ, next: OTHER })).toBe(false);
  });

  it('asks when an Iraqi mobile actually changes', () => {
    expect(phoneChangeNeedsCode({ enabled: true, current: IQ, next: OTHER })).toBe(true);
    expect(phoneChangeNeedsCode({ enabled: true, current: null, next: OTHER })).toBe(true);
  });

  it('spends nothing when the number is unchanged, however it was written', () => {
    for (const current of [IQ, '009647701234567', '0770 123 4567']) {
      expect(phoneChangeNeedsCode({ enabled: true, current, next: IQ })).toBe(false);
    }
  });

  it('skips the code for a number the SMS gate could never deliver to', () => {
    // Non-Iraqi, and an Iraqi landline: allowed_prefixes / the mobile rule
    // refuse both, so demanding a code would make the field unsaveable.
    expect(phoneChangeNeedsCode({ enabled: true, current: IQ, next: '+905551234567' })).toBe(false);
    expect(phoneChangeNeedsCode({ enabled: true, current: IQ, next: '+9641234567' })).toBe(false);
  });

  it('treats an empty new number as nothing to verify (validatePhone rejects it)', () => {
    expect(phoneChangeNeedsCode({ enabled: true, current: IQ, next: '' })).toBe(false);
  });
});
