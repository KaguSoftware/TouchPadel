import { describe, it, expect } from 'vitest';
import {
  createBranchArgs,
  draftProblems,
  readyToOpen,
  sortReadiness,
  checklistOrder,
  requiredLeft,
  branchTone,
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

describe('branch details checklist and colours', () => {
  const rows: ReadinessRow[] = [
    { key: 'courts_and_rates', required: true, ok: true },
    { key: 'manager', required: true, ok: false },
    { key: 'menu', required: false, ok: true },
    { key: 'telegram', required: false, ok: false },
    { key: 'till', required: true, ok: false },
  ];

  it('lists what is left first, required before recommended, done last', () => {
    expect(checklistOrder(rows).map((r) => r.key)).toEqual(['manager', 'till', 'telegram', 'courts_and_rates', 'menu']);
  });

  it('counts the required rows left', () => {
    expect(requiredLeft(rows)).toBe(2);
    expect(requiredLeft(rows.map((r) => ({ ...r, ok: true })))).toBe(0);
  });

  it('gives each branch a card colour by its place, round again after six', () => {
    expect([0, 1, 2, 5, 6].map(branchTone)).toEqual(['green', 'violet', 'rose', 'gold', 'green']);
  });
});
