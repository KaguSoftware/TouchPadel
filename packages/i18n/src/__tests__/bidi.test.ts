import { describe, expect, it } from 'vitest';
import { FSI, PDI, dirAttr, isolate } from '../bidi';
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
