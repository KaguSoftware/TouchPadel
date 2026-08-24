import { describe, expect, it } from 'vitest';
import { pickLocale } from './pickLocale';

describe('pickLocale', () => {
  it('returns the requested language when present', () => {
    expect(pickLocale({ en: 'Court 1', ar: 'ملعب ١' }, 'en')).toBe('Court 1');
    expect(pickLocale({ en: 'Court 1', ar: 'ملعب ١' }, 'ar')).toBe('ملعب ١');
  });

  it('falls back to the other language when missing', () => {
    expect(pickLocale({ en: null, ar: 'ملعب ١' }, 'en')).toBe('ملعب ١');
    expect(pickLocale({ en: 'Court 1', ar: null }, 'ar')).toBe('Court 1');
    expect(pickLocale({ en: 'Court 1', ar: undefined }, 'ar')).toBe('Court 1');
  });

  it('returns empty string when both are missing', () => {
    expect(pickLocale({ en: null, ar: null }, 'en')).toBe('');
    expect(pickLocale({ en: undefined, ar: undefined }, 'ar')).toBe('');
  });
});
