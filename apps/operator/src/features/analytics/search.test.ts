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
});
