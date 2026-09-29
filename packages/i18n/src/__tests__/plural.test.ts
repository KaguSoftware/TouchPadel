import { describe, expect, it } from 'vitest';
import { isolateLtr, LRI, PDI } from '../bidi';
import { countPhrase, pluralForm } from '../plural';
import { t } from '../t';

describe('pluralForm', () => {
  // Hand-coded because Hermes' Intl is a shim; Node's ICU is the reference.
  it.each(['en', 'ar'] as const)('answers as Intl.PluralRules for 0..300 in %s', (locale) => {
    const rules = new Intl.PluralRules(locale);
    for (let n = 0; n <= 300; n++) {
      expect(pluralForm(n, locale), `${locale} ${n}`).toBe(rules.select(n));
    }
  });

  it('reads a negative count by its size and a fraction as other, as CLDR does', () => {
    for (const locale of ['en', 'ar'] as const) {
      const rules = new Intl.PluralRules(locale);
      for (const n of [-1, -2, -3, -11, -100, 0.5, 1.5, 2.5, 3.5, 11.5]) {
        expect(pluralForm(n, locale), `${locale} ${n}`).toBe(rules.select(n));
      }
    }
  });

  it('gives Arabic all six forms at their CLDR edges', () => {
    const edges: [number, string][] = [
      [0, 'zero'],
      [1, 'one'],
      [2, 'two'],
      [3, 'few'],
      [10, 'few'],
      [11, 'many'],
      [99, 'many'],
      [100, 'other'],
      [101, 'other'],
      [102, 'other'],
      [103, 'few'],
      [111, 'many'],
      [200, 'other'],
    ];
    for (const [n, form] of edges) expect(pluralForm(n, 'ar'), String(n)).toBe(form);
  });
});

describe('countPhrase', () => {
  const n = (count: number) => isolateLtr(String(count));

  it('picks the English form and LTR-isolates the count', () => {
    expect(countPhrase('site.hoursCount', 1, 'en')).toBe('one hour');
    expect(countPhrase('site.hoursCount', 2, 'en')).toBe(`${n(2)} hours`);
    expect(countPhrase('site.hoursCount', 24, 'en')).toBe(`${LRI}24${PDI} hours`);
  });

  it('picks each Arabic form', () => {
    expect(countPhrase('site.hoursCount', 1, 'ar')).toBe('ساعة واحدة');
    expect(countPhrase('site.hoursCount', 2, 'ar')).toBe('ساعتين');
    expect(countPhrase('site.hoursCount', 4, 'ar')).toBe(`${n(4)} ساعات`);
    expect(countPhrase('site.hoursCount', 12, 'ar')).toBe(`${n(12)} ساعة`);
    expect(countPhrase('site.hoursCount', 100, 'ar')).toBe(`${n(100)} ساعة`);
  });

  it('reads the zero form at 0 in both languages', () => {
    for (const locale of ['en', 'ar'] as const) {
      expect(countPhrase('site.hoursCount', 0, locale)).toBe(
        t(locale, 'site.hoursCount.zero', { count: n(0) }),
      );
    }
  });
});
