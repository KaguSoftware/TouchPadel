import { describe, expect, it } from 'vitest';
import { en } from '../catalogs/en';
import { ar } from '../catalogs/ar';
import { countPhrase, PLURAL_FORMS } from '../plural';

/**
 * The phone's coaching catalog (`coaching.*`, docs/design/coaching/guest.md
 * §4.15). Parity and placeholders are t.test.ts's; this holds what is
 * coaching's own: the glossary's words (C-30, R55) and the counted phrases.
 */

/** Arabic text without its marks (shadda, harakat, tanwin, superscript alef), so «المدرب» and «المدرّب» compare equal. */
const bare = (s: string): string => s.replace(/[ً-ْٰ]/g, '');
const FORBIDDEN = ['درس', 'حصة الملعب', 'حصة المدرّب'].map(bare);

const leaves = (obj: object, prefix = ''): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : leaves(v as object, `${prefix}${k}.`),
  );

describe('coaching.* in Arabic', () => {
  const lines = leaves(ar.coaching, 'coaching.');

  it('never uses «درس», «حصة الملعب» or «حصة المدرّب» (C-30, R55)', () => {
    expect(lines.length).toBeGreaterThan(100);
    for (const [key, value] of lines) {
      for (const word of FORBIDDEN) expect(bare(value), key).not.toContain(word);
    }
  });

  it('is Arabic wherever English has words (Qi Card and placeholders aside)', () => {
    for (const [key, value] of lines) {
      const words = value.replace(/\{\w+\}/g, '').replace(/Qi Card/g, '');
      if (/[A-Za-z]{3,}/.test(words)) throw new Error(`${key} reads Latin: ${value}`);
    }
  });
});

describe('coaching.common.count.*', () => {
  const keys = Object.keys(en.coaching.common.count) as (keyof typeof en.coaching.common.count)[];

  it('every counted key has all six forms in both languages', () => {
    for (const key of keys) {
      expect(Object.keys(en.coaching.common.count[key]).sort(), key).toEqual(
        [...PLURAL_FORMS].sort(),
      );
      expect(Object.keys(ar.coaching.common.count[key]).sort(), key).toEqual(
        [...PLURAL_FORMS].sort(),
      );
    }
  });

  it.each([
    [0, 'لا أماكن متاحة'],
    [1, 'مكان واحد متاح'],
    [2, 'مكانان متاحان'],
    [3, '\u20663\u2069 أماكن متاحة'],
    [11, '\u206611\u2069 مكانًا متاحًا'],
    [100, '\u2066100\u2069 مكان متاح'],
  ])('placesLeft at %i reads its Arabic form', (n, expected) => {
    expect(countPhrase('coaching.common.count.placesLeft', n, 'ar')).toBe(expected);
  });

  it('English reads one, other and zero', () => {
    expect(countPhrase('coaching.common.count.sessions', 1, 'en')).toBe('1 session');
    expect(countPhrase('coaching.common.count.sessions', 5, 'en')).toBe('\u20665\u2069 sessions');
    expect(countPhrase('coaching.common.count.placesLeft', 0, 'en')).toBe('No places left');
  });
});
