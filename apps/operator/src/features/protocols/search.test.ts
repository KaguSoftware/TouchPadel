import { describe, expect, it } from 'vitest';
import { PRICE_CHANGE_KINDS as CORE_PRICE_CHANGE_KINDS } from '@touch/core/protocols';
import { priceChangeSearch } from '../admin/promotions/priceChange';
import { PRICE_CHANGE_KINDS, validateProtocolsSearch } from './search';

const ID = '5f0c2a9e-1b3d-4c6e-8f7a-9b0c1d2e3f40';

describe('validateProtocolsSearch', () => {
  it('lands a bare or mangled link on the plain page', () => {
    expect(validateProtocolsSearch({})).toEqual({});
    expect(validateProtocolsSearch({ run: 'R-12', step: 42, item: null, junk: 'x' })).toEqual({});
    expect(validateProtocolsSearch({ start: 'refund', variant: 'type4', change: 'discount', filter: 'all' })).toEqual({});
    // Enum values are exact: a case slip is a different word.
    expect(validateProtocolsSearch({ start: 'Tournament', filter: ['waiting'] })).toEqual({});
  });

  it('keeps a run and a step, lower-cased', () => {
    expect(validateProtocolsSearch({ run: ID.toUpperCase(), step: ID })).toEqual({ run: ID, step: ID });
  });

  it('keeps every start kind, tournament type and list filter', () => {
    for (const start of ['product_release', 'tournament', 'hiring', 'price_promo'] as const) {
      expect(validateProtocolsSearch({ start })).toEqual({ start });
    }
    expect(validateProtocolsSearch({ start: 'tournament', variant: 'type2' })).toEqual({ start: 'tournament', variant: 'type2' });
    for (const filter of ['waiting', 'active', 'finished'] as const) {
      expect(validateProtocolsSearch({ filter })).toEqual({ filter });
    }
  });

  it('keeps the eleven price or promo change kinds and their targets (§5.5 links)', () => {
    expect(PRICE_CHANGE_KINDS).toHaveLength(11);
    // The local copy (no core import in the route file) is the core list, in its order.
    expect([...PRICE_CHANGE_KINDS]).toEqual([...CORE_PRICE_CHANGE_KINDS]);
    for (const change of PRICE_CHANGE_KINDS) {
      expect(validateProtocolsSearch({ start: 'price_promo', change })).toEqual({ start: 'price_promo', change });
    }
    expect(validateProtocolsSearch({ start: 'price_promo', change: 'price', item: ID })).toEqual({
      start: 'price_promo',
      change: 'price',
      item: ID,
    });
    expect(validateProtocolsSearch({ change: 'addon_price', addon: ID })).toEqual({ change: 'addon_price', addon: ID });
    expect(validateProtocolsSearch({ change: 'promotion_edit', promotion: ID })).toEqual({ change: 'promotion_edit', promotion: ID });
    expect(validateProtocolsSearch({ change: 'rate', rule: ID, item: 'not-a-uuid' })).toEqual({ change: 'rate', rule: ID });
  });

  it('keeps a lesson price start’s type and coach (coaching operator.md §5.14.2)', () => {
    expect(PRICE_CHANGE_KINDS.slice(-3)).toEqual(['lesson_price', 'lesson_launch', 'coach_price']);
    expect(validateProtocolsSearch({ start: 'price_promo', change: 'lesson_price', lessonType: ID.toUpperCase() })).toEqual({
      start: 'price_promo',
      change: 'lesson_price',
      lessonType: ID,
    });
    expect(validateProtocolsSearch({ change: 'coach_price', coach: ID, lessonType: ID })).toEqual({
      change: 'coach_price',
      coach: ID,
      lessonType: ID,
    });
    expect(validateProtocolsSearch({ change: 'lesson_launch', lessonType: 'type-1', coach: 3 })).toEqual({ change: 'lesson_launch' });
    // /admin/coaches links in through priceChangeSearch, and the link survives the route's parser.
    const link = priceChangeSearch({ change: 'coach_price', lessonType: ID, coach: ID });
    expect(link).toEqual({ start: 'price_promo', change: 'coach_price', lessonType: ID, coach: ID });
    expect(validateProtocolsSearch({ ...link })).toEqual(link);
    expect(priceChangeSearch({ change: 'lesson_price', lessonType: ID })).toEqual({ start: 'price_promo', change: 'lesson_price', lessonType: ID });
  });

  it('keeps the role spec links: a start from an idea, a recipe change', () => {
    expect(validateProtocolsSearch({ start: 'product_release', idea: ID })).toEqual({ start: 'product_release', idea: ID });
    expect(validateProtocolsSearch({ recipeChange: ID.toUpperCase() })).toEqual({ recipeChange: ID });
    expect(validateProtocolsSearch({ idea: 'idea-1', recipeChange: 7 })).toEqual({});
  });
});
