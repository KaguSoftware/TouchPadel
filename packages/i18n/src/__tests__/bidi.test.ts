import { describe, expect, it } from 'vitest';
import { FSI, LRI, PDI, dirAttr, isolate, isolateLtr } from '../bidi';
import { dir, isRtl, logicalSign, oppositeDir } from '../rtl';

describe('isolate', () => {
  it('wraps with FSI (U+2068) and PDI (U+2069)', () => {
    const out = isolate('+964 770 123 4567');
    expect(out.codePointAt(0)).toBe(0x2068);
    expect(out.codePointAt(out.length - 1)).toBe(0x2069);
    expect(out).toBe(`${FSI}+964 770 123 4567${PDI}`);
  });

  it('keeps the inner string intact', () => {
    expect(isolate('Ali').slice(1, -1)).toBe('Ali');
  });
});

describe('isolateLtr', () => {
  it('wraps with LRI (U+2066) and PDI (U+2069)', () => {
    const out = isolateLtr('+964 770 123 4567');
    expect(out.codePointAt(0)).toBe(0x2066);
    expect(out.codePointAt(out.length - 1)).toBe(0x2069);
    expect(out).toBe(`${LRI}+964 770 123 4567${PDI}`);
  });

  it('forces LTR even when the value leads with a strong RTL character', () => {
    // FSI would resolve this run to RTL; LRI must not.
    expect(isolateLtr('محمد العلي').codePointAt(0)).toBe(0x2066);
  });

  it('keeps the inner string intact', () => {
    expect(isolateLtr('ali@example.com').slice(1, -1)).toBe('ali@example.com');
  });
});

describe('direction helpers', () => {
  it('dirAttr / dir map locales', () => {
    expect(dirAttr('ar')).toBe('rtl');
    expect(dirAttr('en')).toBe('ltr');
    expect(dir('ar')).toBe('rtl');
    expect(isRtl('en')).toBe(false);
  });

  it('oppositeDir and logicalSign', () => {
    expect(oppositeDir('rtl')).toBe('ltr');
    expect(logicalSign('rtl')).toBe(-1);
    expect(logicalSign('ltr')).toBe(1);
  });
});
