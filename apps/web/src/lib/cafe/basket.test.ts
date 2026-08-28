import { describe, expect, it } from 'vitest';
import {
  activeGroups,
  basketCount,
  basketDiscountTotal,
  basketFingerprint,
  basketSubtotal,
  basketTotal,
  buildLine,
  fingerprintHash,
  lineTotal,
  mergeDrafts,
  parseDraft,
  reconcile,
  subtreeModifierIds,
  toOrderPayload,
  violatedGroup,
  type BasketDraft,
  type BasketLine,
} from './basket';
import {
  DEFAULT_CAFE_SETTINGS,
  decorateFeatured,
  type CafeSettings,
  type MenuCategory,
  type MenuItem,
  type MenuModifierGroup,
} from '../menu';

/** Syrup group is NOT linked to the item — only revealed by choosing Oat milk. */
const syrupGroup: MenuModifierGroup = {
  id: 'g-syrup',
  name_en: 'Syrup',
  name_ar: 'شراب',
  min_select: 1,
  max_select: 1,
  sort_order: 1,
  modifiers: [
    { id: 'm-vanilla', name_en: 'Vanilla', name_ar: 'فانيلا', price_delta_iqd: 500, sort_order: 1, reveals: [] },
    { id: 'm-caramel', name_en: 'Caramel', name_ar: 'كراميل', price_delta_iqd: 500, sort_order: 2, reveals: [] },
  ],
};

/** Cappuccino-like fixture: two sizes, milk group (0..1), extra-shot group (0..2). */
const item: MenuItem = {
  id: 'item-1',
  category_id: 'cat-1',
  name_en: 'Cappuccino',
  name_ar: 'كابتشينو',
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
  suggestedItemIds: [],
  variants: [
    { id: 'v-s', name_en: 'Small', name_ar: 'صغير', price_iqd: 4000, is_default: true, sort_order: 1 },
    { id: 'v-l', name_en: 'Large', name_ar: 'كبير', price_iqd: 5500, is_default: false, sort_order: 2 },
  ],
  allergens: [],
  modifierGroups: [
    {
      id: 'g-milk',
      name_en: 'Milk Type',
      name_ar: 'نوع الحليب',
      min_select: 0,
      max_select: 1,
      sort_order: 1,
      modifiers: [
        { id: 'm-whole', name_en: 'Whole', name_ar: 'كامل', price_delta_iqd: 0, sort_order: 1, reveals: [] },
        { id: 'm-oat', name_en: 'Oat', name_ar: 'شوفان', price_delta_iqd: 1000, sort_order: 2, reveals: [syrupGroup] },
      ],
    },
    {
      id: 'g-shot',
      name_en: 'Extra Shot',
      name_ar: 'جرعة إضافية',
      min_select: 0,
      max_select: 2,
      sort_order: 2,
      modifiers: [
        { id: 'm-shot', name_en: 'Extra Shot', name_ar: 'جرعة', price_delta_iqd: 1000, sort_order: 1, reveals: [] },
      ],
    },
  ],
};

const withPrice = (price: number, pct: number): MenuItem => ({
  ...item,
  discountPct: pct,
  variants: [{ ...item.variants[0]!, price_iqd: price }],
});

const menu: MenuCategory[] = [
  {
    id: 'cat-1',
    name_en: 'Coffee',
    name_ar: 'قهوة',
    sort_order: 1,
    serve_temp: 'none',
    photo_path: null,
    photo_url: null,
    photo_blur: null,
    items: [item],
  },
];

const featured = (pct: number): CafeSettings => ({
  ...DEFAULT_CAFE_SETTINGS,
  hero_mode: 'featured',
  featured_item_id: 'item-1',
  featured_discount_pct: pct,
});

describe('buildLine / lineTotal', () => {
  it('prices (unit + Σ modifier deltas × mqty) × qty, mirroring app.add_order_items', () => {
    // Large 5500 + oat 1000 + vanilla 500 (revealed, required) + double shot (1000 × 2) = 9000; × 2 = 18000
    const line = buildLine(
      item,
      'v-l',
      2,
      [
        { modifierId: 'm-oat', qty: 1 },
        { modifierId: 'm-vanilla', qty: 1 },
        { modifierId: 'm-shot', qty: 2 },
      ],
      '  extra hot  ',
    );
    expect(lineTotal(line)).toBe(18_000);
    expect(line.notes).toBe('extra hot');
    expect(line.unit_price_iqd).toBe(5500);
    expect(line.list_unit_price_iqd).toBe(5500);
    expect(line.discount_pct).toBe(0);
  });

  it('a plain default-size line is unit × qty', () => {
    const line = buildLine(item, 'v-s', 3, [], null);
    expect(lineTotal(line)).toBe(12_000);
  });

  it('rejects unknown variants/modifiers and bad quantities', () => {
    expect(() => buildLine(item, 'v-x', 1, [], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 0, [], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 100, [], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 1, [{ modifierId: 'nope', qty: 1 }], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 1, [{ modifierId: 'm-shot', qty: 10 }], null)).toThrow();
  });

  it('rejects a modifier from a group that has not been revealed (server: MODIFIER_INVALID)', () => {
    expect(() =>
      buildLine(item, 'v-s', 1, [{ modifierId: 'm-vanilla', qty: 1 }], null),
    ).toThrow(/not active/);
    // revealed by Oat → accepted
    const ok = buildLine(
      item,
      'v-s',
      1,
      [
        { modifierId: 'm-oat', qty: 1 },
        { modifierId: 'm-vanilla', qty: 1 },
      ],
      null,
    );
    expect(ok.modifiers.map((m) => m.modifierId)).toEqual(['m-oat', 'm-vanilla']);
  });
});

describe('featured discount parity with app.apply_pct_discount (0030)', () => {
  it.each([
    [1250, 15, 1063],
    [999, 10, 899],
    [8000, 15, 6800],
    [5500, 0, 5500],
  ])('%i × %i%% → %i', (list, pct, expected) => {
    const line = buildLine(withPrice(list, pct), 'v-s', 1, [], null);
    expect(line.unit_price_iqd).toBe(expected);
    expect(line.list_unit_price_iqd).toBe(list);
    expect(lineTotal(line)).toBe(expected);
  });

  it('modifiers are never discounted', () => {
    // list 8000 −15 % = 6800; + oat 1000 (undiscounted) = 7800; × 2 = 15600
    const line = buildLine(withPrice(8000, 15), 'v-s', 2, [{ modifierId: 'm-oat', qty: 1 }], null);
    expect(lineTotal(line)).toBe(15_600);
    expect(basketSubtotal([line])).toBe(18_000);
    expect(basketDiscountTotal([line])).toBe(2400);
    expect(basketTotal([line])).toBe(15_600);
  });
});

describe('basketTotal / basketCount', () => {
  it('sums line totals with integer IQD arithmetic', () => {
    const a = buildLine(item, 'v-s', 1, [], null); // 4000
    const b = buildLine(item, 'v-l', 2, [{ modifierId: 'm-oat', qty: 1 }], null); // (5500+1000)*2
    expect(basketTotal([a, b])).toBe(4000 + 13_000);
    expect(basketCount([a, b])).toBe(3);
    expect(basketDiscountTotal([a, b])).toBe(0);
  });

  it('empty basket totals zero', () => {
    expect(basketTotal([])).toBe(0);
    expect(basketSubtotal([])).toBe(0);
    expect(basketCount([])).toBe(0);
  });
});

describe('activeGroups / violatedGroup with reveals', () => {
  it('a hidden required group is ignored until revealed', () => {
    expect(activeGroups(item, []).map((g) => g.id)).toEqual(['g-milk', 'g-shot']);
    expect(violatedGroup(activeGroups(item, []), [])).toBeNull();
    expect(violatedGroup(activeGroups(item, ['m-whole']), [{ modifierId: 'm-whole' }])).toBeNull();
  });

  it('a revealed required group blocks until satisfied', () => {
    const active = activeGroups(item, ['m-oat']);
    expect(active.map((g) => g.id)).toEqual(['g-milk', 'g-syrup', 'g-shot']);
    expect(violatedGroup(active, [{ modifierId: 'm-oat' }])?.id).toBe('g-syrup');
    expect(
      violatedGroup(active, [{ modifierId: 'm-oat' }, { modifierId: 'm-caramel' }]),
    ).toBeNull();
  });

  it('accepts selections inside every group min/max', () => {
    expect(violatedGroup(item.modifierGroups, [{ modifierId: 'm-oat' }])).toBeNull();
  });

  it('flags a group over max (distinct choices count)', () => {
    const over = violatedGroup(item.modifierGroups, [
      { modifierId: 'm-whole' },
      { modifierId: 'm-oat' },
    ]);
    expect(over?.id).toBe('g-milk');
  });

  it('flags a group under min', () => {
    const milk = item.modifierGroups[0]!;
    const groups = [{ ...milk, min_select: 1 }];
    expect(violatedGroup(groups, [])?.id).toBe('g-milk');
    expect(violatedGroup(groups, [{ modifierId: 'm-whole' }])).toBeNull();
  });
});

describe('subtreeModifierIds', () => {
  it('lists the modifiers of the groups a modifier reveals', () => {
    expect(subtreeModifierIds(item, 'm-oat')).toEqual(['m-vanilla', 'm-caramel']);
    expect(subtreeModifierIds(item, 'm-whole')).toEqual([]);
    expect(subtreeModifierIds(item, 'nope')).toEqual([]);
  });
});

describe('toOrderPayload', () => {
  it('carries ids and quantities only — never prices', () => {
    const line = buildLine(withPrice(5500, 15), 'v-s', 1, [{ modifierId: 'm-shot', qty: 2 }], 'no sugar');
    const payload = (toOrderPayload([line]) as Record<string, unknown>[])[0]!;
    expect(payload).toEqual({
      variant_id: 'v-s',
      qty: 1,
      notes: 'no sugar',
      modifiers: [{ modifier_id: 'm-shot', qty: 2 }],
    });
    expect(JSON.stringify(payload)).not.toContain('price');
    expect(JSON.stringify(payload)).not.toContain('discount');
    expect(JSON.stringify(payload)).not.toContain('5500');
  });

  it('omits empty notes', () => {
    const line = buildLine(item, 'v-s', 1, [], '   ');
    const payload = (toOrderPayload([line]) as Record<string, unknown>[])[0]!;
    expect('notes' in payload).toBe(false);
  });
});

describe('draft persistence', () => {
  it('migrates a v1 array draft (no list/discount fields) to v2', () => {
    const v1 = [
      {
        key: 'k1',
        itemId: 'item-1',
        variantId: 'v-s',
        qty: 2,
        notes: null,
        modifiers: [],
        item_name_en: 'Cappuccino',
        item_name_ar: 'كابتشينو',
        variant_name_en: 'Small',
        variant_name_ar: 'صغير',
        unit_price_iqd: 4000,
      },
    ];
    const draft = parseDraft(JSON.stringify(v1));
    expect(draft.note).toBe('');
    expect(draft.idemKey).toBeNull();
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0]).toMatchObject({
      key: 'k1',
      list_unit_price_iqd: 4000,
      discount_pct: 0,
      unit_price_iqd: 4000,
    });
  });

  it('round-trips a v2 draft and rejects garbage', () => {
    const line = buildLine(withPrice(1250, 15), 'v-s', 1, [], null);
    const raw = JSON.stringify({ v: 2, lines: [line], note: 'less ice', idemKey: 'abc' });
    const draft = parseDraft(raw);
    expect(draft).toEqual({ lines: [line], note: 'less ice', idemKey: 'abc' });
    expect(parseDraft('{"v":1}')).toEqual({ lines: [], note: '', idemKey: null });
    expect(parseDraft('not json')).toEqual({ lines: [], note: '', idemKey: null });
    expect(parseDraft(null)).toEqual({ lines: [], note: '', idemKey: null });
  });

  it('mergeDrafts keeps table lines first, appends walk-in, table note/idemKey win', () => {
    const a = buildLine(item, 'v-s', 1, [], null);
    const b = buildLine(item, 'v-l', 1, [], null);
    const walkin: BasketDraft = { lines: [a, b], note: 'walkin note', idemKey: 'w' };
    const table: BasketDraft = { lines: [b], note: '', idemKey: null };
    const merged = mergeDrafts(walkin, table);
    expect(merged.lines.map((l) => l.key)).toEqual([b.key, a.key]);
    expect(merged.note).toBe('walkin note');
    expect(merged.idemKey).toBe('w');
    expect(mergeDrafts(walkin, { lines: [], note: 't', idemKey: 't' })).toMatchObject({
      note: 't',
      idemKey: 't',
    });
  });
});

describe('reconcile', () => {
  it('re-snapshots prices/discount from the fresh menu and reports repriced lines', () => {
    const line = buildLine(item, 'v-s', 1, [], null); // 4000, no promo
    const fresh = decorateFeatured(menu, featured(15));
    const { lines, removed, repriced } = reconcile([line], fresh);
    expect(removed).toEqual([]);
    expect(repriced).toEqual([line.key]);
    expect(lines[0]).toMatchObject({ list_unit_price_iqd: 4000, discount_pct: 15, unit_price_iqd: 3400 });
  });

  it('applies settings when given explicitly (undecorated menu)', () => {
    const line = buildLine(item, 'v-s', 1, [], null);
    const { lines, repriced } = reconcile([line], menu, featured(10));
    expect(repriced).toHaveLength(1);
    expect(lines[0]!.unit_price_iqd).toBe(3600);
    // promo gone → back to list, repriced again
    const back = reconcile(lines, menu, DEFAULT_CAFE_SETTINGS);
    expect(back.repriced).toHaveLength(1);
    expect(back.lines[0]!.unit_price_iqd).toBe(4000);
  });

  it('drops lines whose item is sold out / not orderable / variant vanished / modifier gone', () => {
    const a = buildLine(item, 'v-s', 1, [], null);
    const b = buildLine(item, 'v-l', 1, [], null);
    const c = buildLine(item, 'v-s', 1, [{ modifierId: 'm-oat', qty: 1 }], null);
    const soldOut: MenuCategory[] = [{ ...menu[0]!, items: [{ ...item, sold_out: true, orderable: false }] }];
    expect(reconcile([a], soldOut).removed).toEqual([a.key]);

    const noLarge: MenuCategory[] = [{ ...menu[0]!, items: [{ ...item, variants: [item.variants[0]!] }] }];
    const r = reconcile([a, b], noLarge);
    expect(r.removed).toEqual([b.key]);
    expect(r.lines.map((l) => l.key)).toEqual([a.key]);

    const noOat: MenuCategory[] = [
      {
        ...menu[0]!,
        items: [
          {
            ...item,
            modifierGroups: [
              { ...item.modifierGroups[0]!, modifiers: [item.modifierGroups[0]!.modifiers[0]!] },
              item.modifierGroups[1]!,
            ],
          },
        ],
      },
    ];
    expect(reconcile([c], noOat).removed).toEqual([c.key]);

    expect(reconcile([a], []).removed).toEqual([a.key]);
    const unchanged: BasketLine[] = reconcile([a], menu).lines;
    expect(unchanged).toEqual([a]);
  });
});

describe('basketFingerprint / fingerprintHash (idempotency key input)', () => {
  const line = (over: Partial<BasketLine> = {}): BasketLine => ({
    key: 'k1',
    itemId: 'i1',
    variantId: 'v1',
    qty: 1,
    notes: null,
    modifiers: [],
    item_name_en: '',
    item_name_ar: '',
    variant_name_en: '',
    variant_name_ar: '',
    list_unit_price_iqd: 1_000,
    discount_pct: 0,
    unit_price_iqd: 1_000,
    ...over,
  });

  it('is stable across reorderings of the same basket', () => {
    const a = [line({ key: 'a', variantId: 'v1' }), line({ key: 'b', variantId: 'v2' })];
    const b = [line({ key: 'b', variantId: 'v2' }), line({ key: 'a', variantId: 'v1' })];
    expect(basketFingerprint(a, 'hi')).toBe(basketFingerprint(b, 'hi'));
  });

  it('changes when anything that gets SENT changes', () => {
    const base = basketFingerprint([line()], '');
    expect(basketFingerprint([line({ qty: 2 })], '')).not.toBe(base);
    expect(basketFingerprint([line({ variantId: 'v2' })], '')).not.toBe(base);
    expect(basketFingerprint([line({ notes: 'no sugar' })], '')).not.toBe(base);
    expect(basketFingerprint([line()], 'note')).not.toBe(base);
    expect(
      basketFingerprint(
        [line({ modifiers: [{ modifierId: 'm1', qty: 1, name_en: '', name_ar: '', price_delta_iqd: 0 }] })],
        '',
      ),
    ).not.toBe(base);
    // A second line is a different basket — this is the case that used to be
    // silently swallowed as a "duplicate" of the first order.
    expect(basketFingerprint([line({ key: 'a' }), line({ key: 'b', variantId: 'v2' })], '')).not.toBe(base);
  });

  it('ignores display-only fields the server re-snapshots anyway', () => {
    const base = basketFingerprint([line()], '');
    expect(basketFingerprint([line({ item_name_en: 'Tea', unit_price_iqd: 9_999 })], '')).toBe(base);
  });

  it('hashes to a compact stable string', () => {
    const s = basketFingerprint([line()], '');
    expect(fingerprintHash(s)).toBe(fingerprintHash(s));
    expect(fingerprintHash(s)).toMatch(/^[a-z0-9]+$/);
    expect(fingerprintHash(s)).not.toBe(fingerprintHash(`${s}x`));
  });
});
