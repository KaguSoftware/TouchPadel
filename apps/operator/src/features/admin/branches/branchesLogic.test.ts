import { describe, it, expect } from 'vitest';
import {
  createBranchArgs,
  draftProblems,
  readyToOpen,
  sortReadiness,
  suggestSlug,
  type NewBranchDraft,
  type ReadinessRow,
} from './branchesLogic';

const draft = (over: Partial<NewBranchDraft> = {}): NewBranchDraft => ({
  sourceVenueId: 'c0000000-0000-4000-8000-000000000001',
  nameEn: 'Touch Mansour',
  nameAr: 'تتش المنصور',
  slug: 'touch-mansour',
  phone: '',
  addressEn: '',
  addressAr: '',
  timezone: '',
  ...over,
});

describe('branchesLogic', () => {
  it('suggests a slug the server accepts', () => {
    expect(suggestSlug('Touch Mansour')).toBe('touch-mansour');
    expect(suggestSlug('  Touch — Karrada 2 ')).toBe('touch-karrada-2');
    expect(suggestSlug('x'.repeat(40))).toHaveLength(32);
  });

  it('lists what the form must fix', () => {
    expect(draftProblems(draft())).toEqual([]);
    expect(draftProblems(draft({ nameAr: '' }))).toEqual(['nameAr']);
    expect(draftProblems(draft({ slug: 'Touch Mansour' }))).toEqual(['slug']);
    expect(draftProblems(draft({ phone: 'call me' }))).toEqual(['phone']);
    expect(draftProblems(draft({ sourceVenueId: '' }))).toEqual(['source']);
  });

  it('sends blanks as null and trims', () => {
    const args = createBranchArgs(draft({ nameEn: ' Touch Mansour ', addressEn: '  ' }));
    expect(args.p_name_en).toBe('Touch Mansour');
    expect(args.p_address_en).toBeNull();
    expect(args.p_timezone).toBeNull();
  });

  it('opens only when every required row is done', () => {
    const rows: ReadinessRow[] = [
      { key: 'telegram', required: false, ok: false },
      { key: 'manager', required: true, ok: true },
      { key: 'till', required: true, ok: false },
    ];
    expect(sortReadiness(rows).map((r) => r.key)).toEqual(['manager', 'till', 'telegram']);
    expect(readyToOpen(rows)).toBe(false);
    expect(readyToOpen(rows.map((r) => (r.key === 'till' ? { ...r, ok: true } : r)))).toBe(true);
    expect(readyToOpen([])).toBe(false);
  });
});
