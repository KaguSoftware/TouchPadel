import { describe, expect, it } from 'vitest';
import { asLocale, hrefForLocale, otherLocale } from './locales';

describe('asLocale', () => {
  it('narrows to en, defaulting everything else to ar', () => {
    expect(asLocale('en')).toBe('en');
    expect(asLocale('ar')).toBe('ar');
    expect(asLocale('fr')).toBe('ar');
    expect(asLocale('')).toBe('ar');
  });

  it('otherLocale flips', () => {
    expect(otherLocale('ar')).toBe('en');
    expect(otherLocale('en')).toBe('ar');
  });
});

describe('hrefForLocale', () => {
  it('rewrites an existing locale prefix', () => {
    expect(hrefForLocale('/ar', '', 'en')).toBe('/en');
    expect(hrefForLocale('/en', '', 'ar')).toBe('/ar');
  });

  it('keeps the rest of the path', () => {
    expect(hrefForLocale('/ar/t/abc123', '', 'en')).toBe('/en/t/abc123');
  });

  it('prefixes a locale-less printed table URL', () => {
    expect(hrefForLocale('/t/abc123', '', 'ar')).toBe('/ar/t/abc123');
  });

  it('preserves the query string', () => {
    expect(hrefForLocale('/ar/t/abc', '?analytics=off', 'en')).toBe('/en/t/abc?analytics=off');
  });

  it('does not eat a path that merely STARTS with the locale letters', () => {
    expect(hrefForLocale('/entry', '', 'ar')).toBe('/ar/entry');
    expect(hrefForLocale('/arabica', '', 'en')).toBe('/en/arabica');
  });

  it('handles the bare root', () => {
    expect(hrefForLocale('/', '', 'en')).toBe('/en/');
  });
});
