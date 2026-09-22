import { describe, expect, it } from 'vitest';
import { compareForBasis, componentParams, componentQueryKey } from './params';

describe('componentParams', () => {
  it('is canonical: optional keys absent, never null or undefined', () => {
    const p = componentParams({ range: { from: '2026-09-14', to: '2026-09-20' }, compareBasis: 'prev', locale: 'en', courtId: null, scope: null });
    expect(p).toEqual({ from: '2026-09-14', to: '2026-09-20', lang: 'en', compare: 'previousPeriod' });
    expect(Object.keys(p)).not.toContain('court');
    expect(Object.keys(p)).not.toContain('scope');
  });

  it('carries the scope and a lower-cased court id when given', () => {
    const p = componentParams({ range: { from: '2026-09-14', to: '2026-09-20' }, compareBasis: '52w', locale: 'ar', scope: 'courts', courtId: 'AAAAAAAA-0000-4000-8000-000000000001' });
    expect(p).toEqual({ from: '2026-09-14', to: '2026-09-20', lang: 'ar', compare: 'sameLastYear', scope: 'courts', court: 'aaaaaaaa-0000-4000-8000-000000000001' });
  });

  it('maps the page bases onto the tools vocabulary; 4w falls back to the previous period', () => {
    expect(compareForBasis('prev')).toBe('previousPeriod');
    expect(compareForBasis('4w')).toBe('previousPeriod');
    expect(compareForBasis('52w')).toBe('sameLastYear');
    expect(compareForBasis(undefined)).toBe('previousPeriod');
  });

  it('keys the query by component and parameters under the analytics tree', () => {
    const p = componentParams({ range: { from: '2026-09-14', to: '2026-09-20' }, compareBasis: 'prev', locale: 'en' });
    expect(componentQueryKey('week_paragraph', p)).toEqual(['analytics', 'component', 'week_paragraph', p]);
  });
});
