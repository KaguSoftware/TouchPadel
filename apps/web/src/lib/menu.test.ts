import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAFE_SETTINGS,
  activeGroups,
  decorateFeatured,
  fetchBranches,
  fetchCafeSettings,
  fetchMenu,
  fetchTableBranch,
  foldCafeSettings,
  pickBranch,
  toVenueBranch,
  resolveReveals,
  type MenuCategory,
  type MenuItem,
  type RawModifierGroup,
  type VenueBranch,
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
  const map = resolveReveals(
    [{ modifier_id: 'm-oat', group_id: 'g-syrup', sort_order: 1 }],
    groups,
  );
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

describe('fetchMenu', () => {
  it('asks only for café sections: Touch Shop sections never reach the table menu (0144)', async () => {
    const calls: [string, string, unknown][] = [];
    const chain = (table: string) => {
      const q = {
        select: () => q,
        order: () => q,
        eq: (col: string, val: unknown) => {
          calls.push([table, col, val]);
          return q;
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: [], error: null }),
      };
      return q;
    };
    const client = { from: (t: string) => chain(t) } as unknown as Parameters<typeof fetchMenu>[0];
    await expect(fetchMenu(client)).resolves.toEqual([]);
    expect(calls).toContainEqual(['menu_categories', 'kind', 'cafe']);
    expect(calls).toContainEqual(['menu_categories', 'is_active', true]);
  });
});

/** A fake PostgREST chain: records every `eq`, resolves each table to `rows[table]`. */
function fakeClient(rows: Record<string, unknown[]> = {}, errors: Record<string, unknown> = {}) {
  const calls: [string, string, unknown][] = [];
  const chain = (table: string) => {
    const q = {
      select: () => q,
      order: () => q,
      eq: (col: string, val: unknown) => {
        calls.push([table, col, val]);
        return q;
      },
      then: (resolve: (v: { data: unknown[] | null; error: unknown }) => void) =>
        resolve(
          errors[table]
            ? { data: null, error: errors[table] }
            : { data: rows[table] ?? [], error: null },
        ),
    };
    return q;
  };
  const client = { from: (t: string) => chain(t) } as unknown as Parameters<typeof fetchMenu>[0];
  return { client, calls };
}

describe('per-branch reads (multi-venue slice 4)', () => {
  it('filters the menu’s categories and items to the branch, and nothing else', async () => {
    const { client, calls } = fakeClient();
    await fetchMenu(client, 'venue-b');
    expect(calls).toContainEqual(['menu_categories', 'venue_id', 'venue-b']);
    expect(calls).toContainEqual(['menu_items', 'venue_id', 'venue-b']);
    expect(calls.filter(([, col]) => col === 'venue_id')).toHaveLength(2);
  });

  it('reads the menu unfiltered with no branch (the branch list failed)', async () => {
    const { client, calls } = fakeClient();
    await fetchMenu(client);
    expect(calls.some(([, col]) => col === 'venue_id')).toBe(false);
  });

  it('reads one branch’s café settings; a key it has not set stays the default', async () => {
    const { client, calls } = fakeClient({
      cafe_settings_public: [{ key: 'ticker_en', value: ['Hi'] }],
    });
    const s = await fetchCafeSettings(client, 'venue-b');
    expect(calls).toEqual([['cafe_settings_public', 'venue_id', 'venue-b']]);
    expect(s.ticker_en).toEqual(['Hi']);
    expect(s.hero_mode).toBe(DEFAULT_CAFE_SETTINGS.hero_mode);
  });

  const row = (id: string, slug: string) => ({
    venue_id: id as string | null,
    venue_slug: slug as string | null,
    venue_name: 'Touch Padel',
    venue_name_en: `EN ${slug}` as string | null,
    venue_name_ar: `AR ${slug}`,
    opening_hours: {},
    closed_dates: [],
    phone: null,
    cancellation_window_hours: 4,
    address_en: null,
    address_ar: null,
    map_url: null,
    currency: null,
    max_booking_horizon_days: null,
    protected_horizon_hours: null,
    table_token_ttl_minutes: null,
    timezone: null,
  });

  it('orders the open branches oldest first, whatever order the view returns', async () => {
    const { client } = fakeClient({
      venue_settings_public: [row('b', 'riverside'), row('a', 'main')],
      venues: [{ id: 'a' }, { id: 'b' }],
    });
    const branches = await fetchBranches(client);
    expect(branches.map((b) => b.slug)).toEqual(['main', 'riverside']);
    expect(branches[0]).toMatchObject({ id: 'a', name_en: 'EN main', name_ar: 'AR main' });
  });

  it('keeps the view’s order when the order read fails, and throws when the view read fails', async () => {
    const ok = fakeClient(
      { venue_settings_public: [row('b', 'riverside'), row('a', 'main')] },
      { venues: { message: 'nope' } },
    );
    expect((await fetchBranches(ok.client)).map((b) => b.slug)).toEqual(['riverside', 'main']);
    const bad = fakeClient({}, { venue_settings_public: { message: 'down' } });
    await expect(fetchBranches(bad.client)).rejects.toEqual({ message: 'down' });
  });

  it('drops a row with no branch id and falls back to the venue name', () => {
    expect(toVenueBranch({ ...row('a', 'main'), venue_id: null })).toBeNull();
    expect(
      toVenueBranch({ ...row('a', 'main'), venue_name_en: null, venue_slug: null }),
    ).toMatchObject({ name_en: 'Touch Padel', slug: 'a' });
  });

  it('picks the named branch, else the only one, else none', () => {
    const a = { id: 'a', slug: 'main' } as VenueBranch;
    const b = { id: 'b', slug: 'riverside' } as VenueBranch;
    expect(pickBranch([a], null)).toBe(a);
    expect(pickBranch([a], 'unknown')).toBe(a);
    expect(pickBranch([a, b], 'riverside')).toBe(b);
    expect(pickBranch([a, b], null)).toBeNull();
    expect(pickBranch([a, b], 'unknown')).toBeNull();
    expect(pickBranch([], 'main')).toBeNull();
  });
});

describe('fetchTableBranch (0225)', () => {
  const clientAnswering = (answer: () => { data: unknown; error: unknown }) => {
    const calls: [string, string, unknown][] = [];
    const client = {
      schema: (schema: string) => ({
        rpc: (fn: string, args: unknown) => {
          calls.push([schema, fn, args]);
          return Promise.resolve(answer());
        },
      }),
    } as unknown as Parameters<typeof fetchTableBranch>[0];
    return { client, calls };
  };

  it('asks app.table_branch with the token and returns the branch id', async () => {
    const { client, calls } = clientAnswering(() => ({ data: 'venue-b', error: null }));
    await expect(fetchTableBranch(client, 'tok')).resolves.toBe('venue-b');
    expect(calls).toEqual([['app', 'table_branch', { p_token: 'tok' }]]);
  });

  it('is null for an unplaceable token, an error or a throw, never a failure', async () => {
    const none = clientAnswering(() => ({ data: null, error: null }));
    await expect(fetchTableBranch(none.client, 'tok')).resolves.toBeNull();
    const failed = clientAnswering(() => ({ data: 'venue-b', error: { message: 'x' } }));
    await expect(fetchTableBranch(failed.client, 'tok')).resolves.toBeNull();
    const threw = clientAnswering(() => {
      throw new Error('offline');
    });
    await expect(fetchTableBranch(threw.client, 'tok')).resolves.toBeNull();
  });
});
