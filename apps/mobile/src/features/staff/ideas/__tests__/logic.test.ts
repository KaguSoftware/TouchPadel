import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import {
  IDEA_FIELDS,
  canWithdrawIdea,
  focusFirst,
  ideaName,
  isIdeaAuthor,
  isIdeaReviewer,
  validateIdea,
} from '../logic';

/**
 * New-item ideas (build-contracts-2026-09-23 §2.9, role spec #65): a barista's
 * or chef assistant's proposal with no category, reviewed by the head of their
 * team.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const IDEA = {
  name_ar: 'كنافة بالفستق',
  item_kind: 'dessert',
  lines: [{ ingredient_id: UUID, qty: 120, unit: 'g' }],
  sizes: [{ name_ar: 'قطعة' }],
};

describe('ideas', () => {
  it('asks for the proposal’s fields, never the category (the head or the manager picks it)', () => {
    const names = IDEA_FIELDS.map((f) => f.name);
    expect(names).toContain('lines');
    expect(names).toContain('sizes');
    expect(names).not.toContain('category_id');
  });

  it('accepts an idea in one language with its lines and sizes', () => {
    expect(validateIdea(IDEA, 2)).toEqual([]);
  });

  it('refuses a category, too many photos, and an idea with no lines', () => {
    expect(validateIdea({ ...IDEA, category_id: UUID }, 0)).toContainEqual({ field: 'category_id', code: 'RECORD_INVALID' });
    expect(validateIdea(IDEA, 7)).toContainEqual({ field: 'photos', code: 'RECORD_INVALID' });
    expect(validateIdea({ ...IDEA, lines: [] }, 0)).toContainEqual({ field: 'lines', code: 'RECORD_INVALID' });
  });

  it('names an idea in the reader’s language, else the other', () => {
    expect(ideaName(IDEA, 'en')).toBe('كنافة بالفستق');
    expect(ideaName({ name_en: 'Kunafa', name_ar: 'كنافة' }, 'ar')).toBe('كنافة');
    expect(ideaName({}, 'en')).toBeNull();
  });

  it('lets the author withdraw only a waiting idea', () => {
    expect(canWithdrawIdea({ status: 'waiting' })).toBe(true);
    for (const status of ['started', 'declined', 'withdrawn'] as const) expect(canWithdrawIdea({ status })).toBe(false);
  });

  it('gives ideas to barista and chef, and the review to the heads and management', () => {
    expect(STAFF_ROLES.filter(isIdeaAuthor)).toEqual(['barista', 'chef']);
    expect(STAFF_ROLES.filter(isIdeaReviewer)).toEqual(['manager', 'owner', 'head_barista', 'head_chef']);
    expect(isIdeaAuthor('driver')).toBe(false);
    expect(isIdeaReviewer('marketing')).toBe(false);
  });

  it('lists the idea a link named first', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(focusFirst(rows, 'b').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(focusFirst(rows, undefined).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
