import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAFE_SETTINGS,
  activeGroups,
  decorateFeatured,
  foldCafeSettings,
  resolveReveals,
  type MenuCategory,
  type MenuItem,
  type RawModifierGroup,
} from './menu';

const raw = (id: string, mods: string[], min = 0, max = 1): RawModifierGroup => ({
  id,
  name_en: id,
  name_ar: id,
  min_select: min,
  max_select: max,
  modifiers: mods.map((m, i) => ({
    id: m,
    name_en: m,
    name_ar: m,
    price_delta_iqd: 0,
    sort_order: i + 1,
  })),
});

const groups: RawModifierGroup[] = [
  raw('g-milk', ['m-whole', 'm-oat']),
  raw('g-syrup', ['m-vanilla', 'm-caramel'], 1, 1),
  raw('g-topping', ['m-cream']),
];

describe('resolveReveals', () => {
  it('attaches revealed groups (sorted by reveal sort_order) with depth-1 modifiers', () => {
    const map = resolveReveals(
      [
        { modifier_id: 'm-oat', group_id: 'g-topping', sort_order: 2 },
        { modifier_id: 'm-oat', group_id: 'g-syrup', sort_order: 1 },
      ],
      groups,
    );
    const revealed = map.get('m-oat')!;
    expect(revealed.map((g) => g.id)).toEqual(['g-syrup', 'g-topping']);
    expect(revealed[0]!.min_select).toBe(1);
    expect(revealed[0]!.modifiers.every((m) => m.reveals.length === 0)).toBe(true);
    expect(map.has('m-whole')).toBe(false);
  });

  it('is cycle-safe: A→B→A and self-reveals never recurse', () => {
    const map = resolveReveals(
      [
        { modifier_id: 'm-oat', group_id: 'g-syrup', sort_order: 1 },
        { modifier_id: 'm-vanilla', group_id: 'g-milk', sort_order: 1 }, // back edge
        { modifier_id: 'm-whole', group_id: 'g-milk', sort_order: 1 }, // self
        { modifier_id: 'm-oat', group_id: 'g-syrup', sort_order: 5 }, // duplicate edge
        { modifier_id: 'm-oat', group_id: 'g-missing', sort_order: 1 }, // unknown group
      ],
      groups,
    );
    expect(map.get('m-oat')!.map((g) => g.id)).toEqual(['g-syrup']);
    expect(map.get('m-vanilla')!.map((g) => g.id)).toEqual(['g-milk']);
    expect(map.get('m-vanilla')![0]!.modifiers.find((m) => m.id === 'm-oat')!.reveals).toEqual([]);
    expect(map.has('m-whole')).toBe(false);
    expect(() => JSON.stringify([...map.values()])).not.toThrow();
  });
});

const item = (id: string, overrides: Partial<MenuItem> = {}): MenuItem => ({
  id,
  category_id: 'c',
  name_en: id,
  name_ar: id,
  hook_en: '',
  hook_ar: '',
  description_en: null,
  description_ar: null,
  highlight: 'none',
  sold_out: false,
  serve_temp: 'none',
  photo_path: null,
  photo_url: null,
  photo_blur: null,
  sort_order: 1,
  orderable: true,
  discountPct: 0,
  variants: [],
  allergens: [],
  modifierGroups: [],
  suggestedItemIds: [],
  ...overrides,
});

describe('decorateFeatured', () => {
  const menu: MenuCategory[] = [
    {
      id: 'c',
      name_en: 'c',
      name_ar: 'c',
      sort_order: 1,
      serve_temp: 'none',
      photo_path: null,
      photo_url: null,
      photo_blur: null,
      items: [item('a'), item('b')],
    },
  ];

  it('stamps discountPct only on the featured item while hero_mode is featured', () => {
    const out = decorateFeatured(menu, {
      ...DEFAULT_CAFE_SETTINGS,
      hero_mode: 'featured',
      featured_item_id: 'b',
      featured_discount_pct: 15,
    });
    expect(out[0]!.items.map((i) => i.discountPct)).toEqual([0, 15]);
    expect(menu[0]!.items[1]!.discountPct).toBe(0); // immutable
  });

  it('zero when the hero is not in featured mode or pct is 0', () => {
    const off = decorateFeatured(menu, {
      ...DEFAULT_CAFE_SETTINGS,
      hero_mode: 'media',
      featured_item_id: 'b',
      featured_discount_pct: 15,
    });
    expect(off[0]!.items.map((i) => i.discountPct)).toEqual([0, 0]);
    const zero = decorateFeatured(menu, {
      ...DEFAULT_CAFE_SETTINGS,
      hero_mode: 'featured',
      featured_item_id: 'b',
    });
    expect(zero[0]!.items.map((i) => i.discountPct)).toEqual([0, 0]);
  });
});

describe('activeGroups', () => {
  const map = resolveReveals([{ modifier_id: 'm-oat', group_id: 'g-syrup', sort_order: 1 }], groups);
  const linked = groups.slice(0, 1).map((g, i) => ({
    ...g,
    sort_order: i + 1,
    modifiers: g.modifiers.map((m) => ({ ...m, reveals: map.get(m.id) ?? [] })),
  }));
  const it1 = item('x', { modifierGroups: linked });

  it('returns linked groups only until a revealing modifier is chosen', () => {
    expect(activeGroups(it1, []).map((g) => g.id)).toEqual(['g-milk']);
    expect(activeGroups(it1, ['m-whole']).map((g) => g.id)).toEqual(['g-milk']);
    expect(activeGroups(it1, ['m-oat']).map((g) => g.id)).toEqual(['g-milk', 'g-syrup']);
  });

  it('ignores chosen ids that are not on a linked group and dedupes', () => {
    expect(activeGroups(it1, ['m-vanilla', 'nope']).map((g) => g.id)).toEqual(['g-milk']);
  });
});

describe('foldCafeSettings', () => {
  it('applies the 0029 public defaults and coerces bad values', () => {
    expect(foldCafeSettings([])).toEqual(DEFAULT_CAFE_SETTINGS);
    const s = foldCafeSettings([
      { key: 'hero_mode', value: 'featured' },
      { key: 'hero_media_path', value: 'hero/قهوة.mp4' },
      { key: 'hero_media_kind', value: 'video' },
      { key: 'featured_item_id', value: 'abc' },
      { key: 'featured_label_ar', value: 'عرض' },
      { key: 'featured_discount_pct', value: 150 },
      { key: 'ticker_en', value: ['A', 1, 'B'] },
      { key: 'bell_tutorial_enabled', value: false },
      { key: 'telegram_chat_id', value: 'never' },
    ]);
    expect(s).toMatchObject({
      hero_mode: 'featured',
      hero_media_path: 'hero/قهوة.mp4',
      hero_media_kind: 'video',
      featured_item_id: 'abc',
      featured_label_ar: 'عرض',
      featured_discount_pct: 0,
      ticker_en: ['A', 'B'],
      bell_tutorial_enabled: false,
    });
    expect('telegram_chat_id' in s).toBe(false);
  });
});
