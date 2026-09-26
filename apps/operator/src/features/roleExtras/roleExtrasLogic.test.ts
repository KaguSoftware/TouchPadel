import { describe, expect, it } from 'vitest';
import {
  bilingual,
  ideasWaiting,
  newSuggestionCount,
  readIdeasToReview,
  readRecipeChangesPage,
  readSuggestionsPage,
  recipeDiff,
} from './roleExtrasLogic';

// The role-spec screens read their RPC payloads as returned; a key the server
// leaves out reads as nothing rather than a crash (§2.24).

describe('suggestions', () => {
  it('reads the page and the badge count', () => {
    const payload = {
      suggestions: [{ id: 's1', author_name: 'Maha', author_role: 'cashier', body: 'More shade by court 2', created_at: '2026-09-25T09:00:00Z', seen_by_name: null, seen_at: null }],
      new_count: 3,
      total: 7,
    };
    const page = readSuggestionsPage(payload);
    expect(page.rows[0]).toMatchObject({ id: 's1', authorRole: 'cashier', seenAt: null });
    expect(page.total).toBe(7);
    expect(newSuggestionCount(payload)).toBe(3);
    expect(newSuggestionCount(undefined)).toBe(0);
  });

  it('reads an unknown role as none rather than printing it', () => {
    expect(readSuggestionsPage({ suggestions: [{ id: 'x', author_role: 'sommelier' }] }).rows[0]!.authorRole).toBeNull();
  });
});

describe('recipe changes', () => {
  const page = readRecipeChangesPage({
    requests: [
      {
        id: 'rc1',
        target: 'variant',
        item_name_en: 'Latte',
        item_name_ar: 'لاتيه',
        size_name_en: 'Large',
        size_name_ar: 'كبير',
        requested_by_name: 'Bareq',
        requested_at: '2026-09-25T08:00:00Z',
        note: 'Less sugar',
        status: 'waiting',
        stale: true,
        before: [
          { recipe_line_id: 'l1', ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', qty: 200, unit: 'ml' },
          { recipe_line_id: 'l2', ingredient_id: 'sugar', name_en: 'Sugar', name_ar: 'سكر', qty: 10, unit: 'g' },
          { recipe_line_id: 'l3', ingredient_id: 'shot', name_en: 'Espresso', name_ar: 'إسبريسو', qty: 2, unit: 'pc' },
        ],
        after: [
          { ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', qty: 200, unit: 'ml' },
          { ingredient_id: 'shot', name_en: 'Espresso', name_ar: 'إسبريسو', qty: 3, unit: 'pc' },
          { ingredient_id: 'vanilla', name_en: 'Vanilla', name_ar: 'فانيلا', qty: 5, unit: 'ml' },
        ],
      },
    ],
    waiting_count: 1,
    total: 1,
  });

  it('reads the request with its lines before and after', () => {
    expect(page.waitingCount).toBe(1);
    expect(page.rows[0]!.stale).toBe(true);
    expect(page.rows[0]!.before).toHaveLength(3);
  });

  it('pairs the lines by ingredient: the same, changed, removed, then added', () => {
    const diff = recipeDiff(page.rows[0]!.before, page.rows[0]!.after);
    expect(diff.map((d) => [d.ingredientId, d.change, d.before, d.after])).toEqual([
      ['milk', 'same', 200, 200],
      ['sugar', 'removed', 10, null],
      ['shot', 'changed', 2, 3],
      ['vanilla', 'added', null, 5],
    ]);
  });
});

describe('ideas', () => {
  it('reads an idea with its record, for the sheet and for a start', () => {
    const payload = {
      ideas: [{ id: 'i1', team: 'bar', author_name: 'Yusuf', submitted_at: '2026-09-25T07:00:00Z', record: { name_ar: 'موكا بالتمر', item_kind: 'drink', lines: [{ label: 'Dates', qty: 30, unit: 'g' }], sizes: [{ name_ar: 'كبير' }] }, photos: ['v/proposals/p.jpg'] }],
      count: 1,
    };
    const { ideas } = readIdeasToReview(payload);
    expect(ideas[0]).toMatchObject({ team: 'bar', itemKind: 'drink', nameAr: 'موكا بالتمر', photos: ['v/proposals/p.jpg'] });
    expect(ideas[0]!.record.item_kind).toBe('drink');
    expect(ideasWaiting(payload)).toBe(1);
    expect(ideasWaiting(null)).toBe(0);
  });
});

describe('bilingual', () => {
  it('falls back to the other language when one is blank (§4)', () => {
    expect(bilingual('en', '', 'كنافة')).toBe('كنافة');
    expect(bilingual('ar', 'Kunafa', null)).toBe('Kunafa');
    expect(bilingual('ar', 'Kunafa', 'كنافة')).toBe('كنافة');
  });
});
