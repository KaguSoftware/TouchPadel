import { describe, expect, it } from 'vitest';
import {
  diffLinks,
  eligibleRevealGroups,
  minMaxError,
  moveInList,
  partitionGroups,
  revealedGroupIds,
  sameOrder,
} from './addonsLogic';

const groups = [{ id: 'milk' }, { id: 'meal' }, { id: 'drink' }, { id: 'side' }];
const links = [
  { item_id: 'latte', group_id: 'milk' },
  { item_id: 'burger', group_id: 'meal' },
];

describe('partitionGroups', () => {
  it('splits linked vs reveal-only groups', () => {
    const { itemGroups, subGroups } = partitionGroups(groups, links);
    expect(itemGroups.map((g) => g.id)).toEqual(['milk', 'meal']);
    expect(subGroups.map((g) => g.id)).toEqual(['drink', 'side']);
  });
});

describe('minMaxError', () => {
  it('enforces 0 ≤ min ≤ max and max ≥ 1', () => {
    expect(minMaxError(0, 1)).toBeNull();
    expect(minMaxError(2, 2)).toBeNull();
    expect(minMaxError(-1, 1)).toBe('min');
    expect(minMaxError(0, 0)).toBe('max');
    expect(minMaxError(3, 2)).toBe('order');
    expect(minMaxError(1.5, 2)).toBe('min');
  });
});

describe('diffLinks', () => {
  it('returns the ids to link and unlink', () => {
    expect(diffLinks(['a', 'b'], ['b', 'c'])).toEqual({ link: ['c'], unlink: ['a'] });
    expect(diffLinks([], [])).toEqual({ link: [], unlink: [] });
  });
});

describe('eligibleRevealGroups', () => {
  const modifiers = [
    { id: 'make-meal', group_id: 'meal' },
    { id: 'cola', group_id: 'drink' },
    { id: 'oat', group_id: 'milk' },
  ];
  it('offers sub-groups only, excluding the own group', () => {
    const out = eligibleRevealGroups(modifiers[0]!, groups, links, [], modifiers);
    expect(out.map((g) => g.id)).toEqual(['drink', 'side']);
  });
  it('excludes sub-groups whose modifiers already reveal (depth)', () => {
    const reveals = [{ modifier_id: 'cola', group_id: 'side', sort_order: 0 }];
    const out = eligibleRevealGroups(modifiers[0]!, groups, links, reveals, modifiers);
    expect(out.map((g) => g.id)).toEqual(['side']);
  });
  it('offers nothing when the own group is a reveal target', () => {
    const reveals = [{ modifier_id: 'make-meal', group_id: 'drink', sort_order: 0 }];
    expect(eligibleRevealGroups(modifiers[1]!, groups, links, reveals, modifiers)).toEqual([]);
  });
});

describe('revealedGroupIds / moveInList / sameOrder', () => {
  it('orders by sort_order', () => {
    const reveals = [
      { modifier_id: 'm', group_id: 'b', sort_order: 1 },
      { modifier_id: 'm', group_id: 'a', sort_order: 0 },
      { modifier_id: 'x', group_id: 'c', sort_order: 0 },
    ];
    expect(revealedGroupIds('m', reveals)).toEqual(['a', 'b']);
  });
  it('moves within bounds only', () => {
    expect(moveInList(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
    expect(moveInList(['a', 'b', 'c'], 2, 'down')).toEqual(['a', 'b', 'c']);
  });
  it('compares order', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
