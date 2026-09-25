import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import {
  applySeen,
  readsAllSuggestions,
  suggestionIntent,
  suggestionIssue,
  type SuggestionsPage,
} from '../logic';

const page = (): SuggestionsPage => ({
  suggestions: [
    { id: 'a', author_name: 'Yusuf', author_role: 'barista', body: 'More cups', created_at: 'x', seen_by_name: null, seen_at: null },
    { id: 'b', author_name: 'Maha', author_role: 'cashier', body: 'Card reader', created_at: 'y', seen_by_name: null, seen_at: null },
  ],
  new_count: 2,
  total: 2,
});

describe('the suggestion box (#63)', () => {
  it('lets only the manager and the owner read everyone’s', () => {
    expect(STAFF_ROLES.filter(readsAllSuggestions).sort()).toEqual(['manager', 'owner']);
  });

  it('needs text, at most 1000 characters', () => {
    expect(suggestionIssue('   ')).toBe('required');
    expect(suggestionIssue('x'.repeat(1001))).toBe('tooLong');
    expect(suggestionIssue(` ${'x'.repeat(1000)} `)).toBeNull();
  });

  it('keeps one key per suggestion as sent, per venue', () => {
    expect(suggestionIntent('v1', ' Idea ')).toBe(suggestionIntent('v1', 'Idea'));
    expect(suggestionIntent('v1', 'Idea')).not.toBe(suggestionIntent('v2', 'Idea'));
  });

  it('drops a read one from the new list and marks it on any other', () => {
    const fromNew = applySeen(page(), 'a', 'new', '2026-09-25T09:00:00Z', 'Owner');
    expect(fromNew.suggestions.map((s) => s.id)).toEqual(['b']);
    expect(fromNew).toMatchObject({ new_count: 1, total: 1 });

    const fromAll = applySeen(page(), 'a', 'all', '2026-09-25T09:00:00Z', 'Owner');
    expect(fromAll.suggestions[0]).toMatchObject({ seen_at: '2026-09-25T09:00:00Z', seen_by_name: 'Owner' });
    expect(fromAll).toMatchObject({ new_count: 1, total: 2 });

    // A repeat keeps the first mark, as the server does.
    expect(applySeen(fromAll, 'a', 'all', 'later', 'Manager')).toBe(fromAll);
  });
});
