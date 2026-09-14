import { describe, expect, it } from 'vitest';
import { validateSearch } from './search';

describe('validateSearch', () => {
  it('defaults to 30d and drops unknown values', () => {
    expect(validateSearch({})).toEqual({ range: '30d' });
    expect(validateSearch({ range: 'yesterday', cmp: 'nope' })).toEqual({ range: '30d' });
  });
  it('accepts presets and compare bases', () => {
    expect(validateSearch({ range: '7d', cmp: '4w' })).toEqual({ range: '7d', cmp: '4w' });
    expect(validateSearch({ range: 'today', cmp: '52w' })).toEqual({ range: 'today', cmp: '52w' });
  });
  it('keeps custom only with two valid ISO dates', () => {
    expect(validateSearch({ range: 'custom', from: '2026-08-01', to: '2026-08-10' })).toEqual({
      range: 'custom',
      from: '2026-08-01',
      to: '2026-08-10',
    });
    expect(validateSearch({ range: 'custom', from: '2026-08-01' })).toEqual({ range: '30d' });
    expect(validateSearch({ range: 'custom', from: '2026-02-30', to: '2026-03-01' })).toEqual({ range: '30d' });
  });
  it('ignores non-string params', () => {
    expect(validateSearch({ range: 7, from: 1, cmp: ['prev'] })).toEqual({ range: '30d' });
  });
  it('refuses a custom range that is inverted or longer than the server cap', () => {
    expect(validateSearch({ range: 'custom', from: '2026-08-10', to: '2026-08-01' })).toEqual({ range: '30d' });
    expect(validateSearch({ range: 'custom', from: '2025-01-01', to: '2026-03-01' })).toEqual({ range: '30d' });
    // Exactly 400 days apart is still allowed.
    expect(validateSearch({ range: 'custom', from: '2025-01-01', to: '2026-02-05' })).toEqual({
      range: 'custom',
      from: '2025-01-01',
      to: '2026-02-05',
    });
  });
  it('keeps a court filter only when it is a uuid', () => {
    const id = '7B3D8E2A-1C4F-4A6B-9D0E-2F5A7C9B1D3E';
    expect(validateSearch({ range: '7d', court: id })).toEqual({ range: '7d', court: id.toLowerCase() });
    expect(validateSearch({ range: '7d', court: 'court-1' })).toEqual({ range: '7d' });
    expect(validateSearch({ range: '7d', court: 42 })).toEqual({ range: '7d' });
  });
});
