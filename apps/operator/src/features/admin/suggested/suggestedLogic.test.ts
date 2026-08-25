import { describe, expect, it } from 'vitest';
import { SUGGESTION_CAP, canAddSuggestion, suggestionCandidates } from './suggestedLogic';

describe('canAddSuggestion', () => {
  it('rejects self, duplicates and the cap', () => {
    expect(canAddSuggestion('a', [], 'a')).toBe('self');
    expect(canAddSuggestion('a', ['b'], 'b')).toBe('duplicate');
    const full = Array.from({ length: SUGGESTION_CAP }, (_, i) => `x${i}`);
    expect(canAddSuggestion('a', full, 'b')).toBe('cap');
    expect(canAddSuggestion('a', ['b'], 'c')).toBeNull();
  });
});

describe('suggestionCandidates', () => {
  const items = [
    { id: 'a', name_en: 'Latte', name_ar: 'لاتيه', is_active: true },
    { id: 'b', name_en: 'Mocha', name_ar: 'موكا', is_active: true },
    { id: 'c', name_en: 'Old Latte', name_ar: 'قديم', is_active: false },
    { id: 'd', name_en: 'Latte XL', name_ar: 'كبير', is_active: true },
  ];
  it('returns nothing for a blank query', () => {
    expect(suggestionCandidates('a', [], items, '  ')).toEqual([]);
  });
  it('excludes self, inactive and already-added items', () => {
    expect(suggestionCandidates('a', ['d'], items, 'latte').map((i) => i.id)).toEqual([]);
    expect(suggestionCandidates('b', [], items, 'latte').map((i) => i.id)).toEqual(['a', 'd']);
    expect(suggestionCandidates('b', [], items, 'كبير').map((i) => i.id)).toEqual(['d']);
  });
});
