import { describe, expect, it } from 'vitest';
import { exclusionSignature, makeKeepFilter, normalizeExcludedIds } from './exclusions';

describe('normalizeExcludedIds', () => {
  it('accepts arrays and JSON strings, dedupes and trims', () => {
    expect(normalizeExcludedIds(['a', ' b ', 'a', '', 3, null])).toEqual(['a', 'b']);
    expect(normalizeExcludedIds('["x","y","x"]')).toEqual(['x', 'y']);
  });

  it('is safe on garbage', () => {
    expect(normalizeExcludedIds('not json')).toEqual([]);
    expect(normalizeExcludedIds('{"a":1}')).toEqual([]);
    expect(normalizeExcludedIds(null)).toEqual([]);
    expect(normalizeExcludedIds(undefined)).toEqual([]);
    expect(normalizeExcludedIds(42)).toEqual([]);
  });
});

describe('makeKeepFilter', () => {
  it('keeps everything with an empty set and drops excluded ids', () => {
    expect(makeKeepFilter(new Set())('any')).toBe(true);
    const keep = makeKeepFilter(new Set(['e001', 'e002']));
    expect(keep('e001')).toBe(false);
    expect(keep('e002')).toBe(false);
    expect(keep('e003')).toBe(true);
  });
});

describe('exclusionSignature', () => {
  it('is empty with no exclusions', () => {
    expect(exclusionSignature([])).toBe('');
    expect(exclusionSignature(new Set())).toBe('');
    expect(exclusionSignature([''])).toBe('');
  });

  it('is order-independent, dedupes, and changes with the list', () => {
    const a = exclusionSignature(['e001', 'e002']);
    expect(a).toBe(exclusionSignature(['e002', 'e001', 'e001']));
    expect(a).toMatch(/^x:2:[0-9a-z]+$/);
    expect(a).not.toBe(exclusionSignature(['e001']));
    expect(a).not.toBe(exclusionSignature(['e001', 'e003']));
  });
});
