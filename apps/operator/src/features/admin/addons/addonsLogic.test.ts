import { describe, expect, it } from 'vitest';
import {
  addonLaunched,
  addonLock,
  newOptionActive,
  choiceRule,
  diffLinks,
  eligibleRevealGroups,
  isRequiredAddonRefusal,
  minMaxError,
  moveInList,
  partitionGroups,
  revealedGroupIds,
  revealersOf,
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

describe('choiceRule', () => {
  it('says optional when nothing is required', () => {
    expect(choiceRule(0, 2)).toEqual({ kind: 'upTo', max: 2 });
  });
  it('says exactly when min equals max', () => {
    expect(choiceRule(1, 1)).toEqual({ kind: 'exactly', count: 1 });
  });
  it('says a range otherwise', () => {
    expect(choiceRule(1, 3)).toEqual({ kind: 'range', min: 1, max: 3 });
  });
});

describe('revealersOf', () => {
  it('lists the options that reveal a sub-group', () => {
    const modifiers = [
      { id: 'make-meal', group_id: 'meal' },
      { id: 'no-meal', group_id: 'meal' },
      { id: 'oat', group_id: 'milk' },
    ];
    const reveals = [
      { modifier_id: 'make-meal', group_id: 'drink', sort_order: 0 },
      { modifier_id: 'oat', group_id: 'side', sort_order: 0 },
    ];
    expect(revealersOf('drink', reveals, modifiers).map((m) => m.id)).toEqual(['make-meal']);
    expect(revealersOf('nothing', reveals, modifiers)).toEqual([]);
  });
});

describe('addonLaunched / addonLock / newOptionActive (#51, #53)', () => {
  const manager = { editLaunchedPrices: false, launchDirectly: false };
  const owner = { editLaunchedPrices: true, launchDirectly: true };
  const opt = (over: Partial<{ launched_at: string | null; is_active: boolean; price_delta_iqd: number }>) => ({
    launched_at: null,
    is_active: false,
    price_delta_iqd: 1000,
    ...over,
  });

  it('counts an option as launched once stamped, or while it is on', () => {
    expect(addonLaunched(opt({ launched_at: '2026-01-01T00:00:00Z' }))).toBe(true);
    expect(addonLaunched(opt({ is_active: true }))).toBe(true);
    expect(addonLaunched(opt({}))).toBe(false);
  });

  it('locks a manager out of a launched option’s price, on or off', () => {
    expect(addonLock(opt({ is_active: true }), manager)).toEqual({ priceLocked: true, needsLaunch: false });
    expect(addonLock(opt({ launched_at: '2026-01-01T00:00:00Z' }), manager)).toEqual({ priceLocked: true, needsLaunch: false });
  });

  it('holds a manager’s never-launched paid option until the owner approves its price', () => {
    expect(addonLock(opt({}), manager)).toEqual({ priceLocked: false, needsLaunch: true });
  });

  it('lets a free option go on directly', () => {
    expect(addonLock(opt({ price_delta_iqd: 0 }), manager)).toEqual({ priceLocked: false, needsLaunch: false });
  });

  it('changes nothing for the owner', () => {
    expect(addonLock(opt({ is_active: true }), owner)).toEqual({ priceLocked: false, needsLaunch: false });
    expect(addonLock(opt({}), owner)).toEqual({ priceLocked: false, needsLaunch: false });
  });

  it('saves a manager’s new paid option hidden, and everything else on', () => {
    expect(newOptionActive(1000, false)).toBe(false);
    expect(newOptionActive(0, false)).toBe(true);
    expect(newOptionActive(1000, true)).toBe(true);
  });
});

describe('isRequiredAddonRefusal', () => {
  it('knows the compulsory add-on refusal from the other price refusals', () => {
    expect(isRequiredAddonRefusal({ code: 'PRICE_VIA_PROTOCOL', hint: 'required_addon' })).toBe(true);
    expect(isRequiredAddonRefusal({ code: 'PRICE_VIA_PROTOCOL' })).toBe(false);
    expect(isRequiredAddonRefusal({ code: 'LAUNCH_VIA_PROTOCOL', hint: 'required_addon' })).toBe(false);
    expect(isRequiredAddonRefusal(null)).toBe(false);
    expect(isRequiredAddonRefusal('PRICE_VIA_PROTOCOL')).toBe(false);
  });
});
