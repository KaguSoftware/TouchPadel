import { describe, expect, it } from 'vitest';
import {
  formatLocal,
  identifierKind,
  limitIdentifier,
  normalizeIdentifier,
  phoneFromIdentifier,
  splitCountryCode,
} from '../identifier';

describe('identifierKind', () => {
  it('reads an address as email', () => {
    expect(identifierKind('sara@example.com')).toBe('email');
    expect(identifierKind(' sara')).toBe('email');
  });
  it('reads digits as a phone number', () => {
    expect(identifierKind('0770 123 4567')).toBe('phone');
    expect(identifierKind('+964 770 123 4567')).toBe('phone');
  });
  it('knows nothing from nothing', () => {
    expect(identifierKind('')).toBe('none');
    expect(identifierKind('  + ')).toBe('none');
  });
});

describe('phoneFromIdentifier', () => {
  it('takes the country from a leading + or 00', () => {
    const p = phoneFromIdentifier('+44 7700 900123');
    expect(p).toMatchObject({ iso: 'GB', national: '7700900123', plausible: true });
    expect(phoneFromIdentifier('0044 7700 900123').iso).toBe('GB');
  });
  it('reads a local number as Iraqi, with or without the leading 0', () => {
    expect(phoneFromIdentifier('0770 123 4567')).toMatchObject({ iso: 'IQ', plausible: true });
    expect(phoneFromIdentifier('770-123-4567')).toMatchObject({ iso: 'IQ', plausible: true });
  });
  it('refuses a local number that is not an Iraqi mobile', () => {
    expect(phoneFromIdentifier('0552 123 4567').plausible).toBe(false);
    expect(phoneFromIdentifier('0770 123').plausible).toBe(false);
  });
  it('does not add a second 964 to a bare country code', () => {
    const p = phoneFromIdentifier('964 770 123 4567');
    expect(p).toMatchObject({ iso: 'IQ', national: '7701234567', plausible: true });
  });
});

describe('limitIdentifier', () => {
  it('stops an Iraqi local number at 11 digits with the 0, 10 without', () => {
    expect(limitIdentifier('077012345678999')).toBe('07701234567');
    expect(limitIdentifier('77012345678999')).toBe('7701234567');
    expect(limitIdentifier('0770 123 4567')).toBe('07701234567');
  });
  it('limits a country-coded number to E.164', () => {
    expect(limitIdentifier('+4477009001231234567')).toBe('+447700900123123');
    expect(limitIdentifier('9647701234567890')).toBe('9647701234567');
  });
  it('leaves an email alone', () => {
    expect(limitIdentifier('sara.123456789012345678@example.com')).toBe(
      'sara.123456789012345678@example.com',
    );
  });
});

describe('normalizeIdentifier', () => {
  it('turns 00 and a bare 964 into the + form', () => {
    expect(normalizeIdentifier('0044 7700')).toBe('+447700');
    expect(normalizeIdentifier('9647701234567')).toBe('+9647701234567');
  });
  it('leaves local numbers and emails alone', () => {
    expect(normalizeIdentifier('0770 123')).toBe('0770123');
    expect(normalizeIdentifier('00')).toBe('00');
    expect(normalizeIdentifier('sara@mail.com')).toBe('sara@mail.com');
  });
});

describe('splitCountryCode', () => {
  it('names the country once the code is complete', () => {
    expect(splitCountryCode('+44')).toEqual({ iso: 'GB', dial: '44', rest: '' });
    expect(splitCountryCode('+9647701234567')).toEqual({ iso: 'IQ', dial: '964', rest: '7701234567' });
  });
  it('knows nothing before the code is complete, or without a +', () => {
    expect(splitCountryCode('+9')).toBeNull();
    expect(splitCountryCode('+96')).toBeNull();
    expect(splitCountryCode('07701234567')).toBeNull();
  });
});

describe('formatLocal', () => {
  it('groups as written', () => {
    expect(formatLocal('07701234567')).toBe('0770 123 4567');
    expect(formatLocal('0770')).toBe('0770');
    expect(formatLocal('0770123')).toBe('0770 123');
    expect(formatLocal('7701234567')).toBe('770 123 4567');
  });
});
