import { describe, expect, it } from 'vitest';
import { finalizeRecord, readNumbers } from './contextLogic';
import {
  dropRename,
  finalizeRenames,
  isSameName,
  putRename,
  readNumbersRenames,
  renameEntries,
  renameIndex,
  renameKeyOf,
  renameReadBack,
} from './renames';

// Size and add-on renames riding on a price change (wave5-addendum-2026-09-25
// §2.2, #9): the form keeps only a real rename, and sends it trimmed.

const SMALL = { id: 'v1', name_en: 'Small', name_ar: 'صغير' };
const LARGE = { id: 'v2', name_en: 'Large', name_ar: 'كبير' };

describe('renameKeyOf', () => {
  it('names a size in a price change and an add-on in an add-on price change, nothing else', () => {
    expect(renameKeyOf('price')).toBe('variant_id');
    expect(renameKeyOf('addon_price')).toBe('modifier_id');
    expect(renameKeyOf('shop_launch')).toBeNull();
    expect(renameKeyOf('rate')).toBeNull();
    expect(renameKeyOf(null)).toBeNull();
  });
});

describe('isSameName', () => {
  it('compares as the server does: whitespace is not a rename, a case change is', () => {
    expect(isSameName(SMALL, ' Small ', 'صغير ')).toBe(true);
    expect(isSameName(SMALL, 'small', 'صغير')).toBe(false);
    expect(isSameName(SMALL, 'Small', 'صغيرة')).toBe(false);
  });
});

describe('putRename / dropRename', () => {
  it('keeps a row only while its names differ from today’s', () => {
    let record: Record<string, unknown> = { change: 'price', prices: [] };
    record = putRename(record, 'variant_id', SMALL, 'Large', 'صغير');
    expect(record.renames).toEqual([{ variant_id: 'v1', name_en: 'Large', name_ar: 'صغير' }]);
    record = putRename(record, 'variant_id', LARGE, 'Small', 'صغير');
    expect(renameEntries(record, 'variant_id').map((r) => r.id)).toEqual(['v1', 'v2']);
    // Typed back to today's: the row leaves, and the other keeps its index-free order.
    record = putRename(record, 'variant_id', SMALL, 'Small ', 'صغير');
    expect(record.renames).toEqual([{ variant_id: 'v2', name_en: 'Small', name_ar: 'صغير' }]);
    expect(renameIndex(record, 'variant_id', 'v2')).toBe(0);
    expect(renameIndex(record, 'variant_id', 'v1')).toBe(-1);
  });

  it('updates a row in place, so an issue at its index still points at it', () => {
    let record: Record<string, unknown> = {};
    record = putRename(record, 'variant_id', SMALL, 'Tall', 'طويل');
    record = putRename(record, 'variant_id', LARGE, 'Grande', 'كبير جدًا');
    record = putRename(record, 'variant_id', SMALL, 'Short', 'قصير');
    expect(renameEntries(record, 'variant_id')).toEqual([
      { id: 'v1', name_en: 'Short', name_ar: 'قصير' },
      { id: 'v2', name_en: 'Grande', name_ar: 'كبير جدًا' },
    ]);
  });

  it('keeps today’s name for a language left empty, as the phone does', () => {
    let record: Record<string, unknown> = {};
    record = putRename(record, 'variant_id', SMALL, 'Tall', '  ');
    expect(record.renames).toEqual([{ variant_id: 'v1', name_en: 'Tall', name_ar: 'صغير' }]);
    // Both empty is today's name: nothing to rename.
    record = putRename(record, 'variant_id', SMALL, '', '');
    expect(record.renames).toEqual([]);
  });

  it('forgets a row on "Keep the name"', () => {
    const record = putRename(
      {},
      'modifier_id',
      { id: 'm1', name_en: 'Oat', name_ar: 'شوفان' },
      'Oat milk',
      'حليب الشوفان',
    );
    expect(dropRename(record, 'modifier_id', 'm1').renames).toEqual([]);
  });
});

describe('finalizeRenames', () => {
  it('sends the names trimmed and drops the check’s own before_* copies', () => {
    const out = finalizeRenames({
      change: 'price',
      renames: [
        {
          variant_id: 'v1',
          name_en: ' Large ',
          name_ar: 'كبير ',
          before_en: 'Small',
          before_ar: 'صغير',
        },
      ],
    });
    expect(out.renames).toEqual([{ variant_id: 'v1', name_en: 'Large', name_ar: 'كبير' }]);
  });

  it('sends no renames key when nothing is renamed, or on a change that cannot rename', () => {
    expect('renames' in finalizeRenames({ change: 'price', renames: [] })).toBe(false);
    expect(
      'renames' in
        finalizeRenames({
          change: 'shop_launch',
          renames: [{ variant_id: 'v1', name_en: 'A', name_ar: 'ب' }],
        }),
    ).toBe(false);
    const untouched = { change: 'price', prices: [] };
    expect(finalizeRenames(untouched)).toBe(untouched);
  });

  it('rides on finalizeRecord for both change kinds', () => {
    const current = new Map<string, number | null>([['v1', 4000]]);
    const price = finalizeRecord(
      'price_promo',
      'propose',
      {
        change: 'price',
        menu_item_id: 'i1',
        prices: [{ variant_id: 'v1', price_iqd: 4000 }],
        renames: [{ variant_id: 'v1', name_en: 'Large ', name_ar: 'كبير' }],
      },
      current,
    );
    expect(price).toEqual({
      change: 'price',
      menu_item_id: 'i1',
      prices: [],
      renames: [{ variant_id: 'v1', name_en: 'Large', name_ar: 'كبير' }],
    });
    const addon = finalizeRecord(
      'price_promo',
      'propose',
      { change: 'addon_price', addons: [], renames: [] },
      new Map(),
    );
    expect(addon).toEqual({ change: 'addon_price', addons: [] });
  });
});

describe('the numbers and the run sheet', () => {
  it('reads price_promo_numbers.renames defensively', () => {
    expect(
      readNumbersRenames([
        {
          target: 'size',
          id: 'v1',
          from_en: 'Small',
          from_ar: 'صغير',
          to_en: 'Large',
          to_ar: 'كبير',
          price_iqd: 4000,
        },
        {
          target: 'addon',
          id: 'm1',
          from_en: 'Oat',
          from_ar: 'شوفان',
          to_en: 'Oat milk',
          to_ar: 'حليب الشوفان',
          price_iqd: null,
        },
        { target: 'size', from_en: 'no id' },
        'junk',
      ]),
    ).toEqual([
      {
        target: 'size',
        id: 'v1',
        from_en: 'Small',
        from_ar: 'صغير',
        to_en: 'Large',
        to_ar: 'كبير',
        price_iqd: 4000,
      },
      {
        target: 'addon',
        id: 'm1',
        from_en: 'Oat',
        from_ar: 'شوفان',
        to_en: 'Oat milk',
        to_ar: 'حليب الشوفان',
        price_iqd: null,
      },
    ]);
    expect(readNumbersRenames(undefined)).toEqual([]);
    // An older server's numbers carry no renames: none is shown.
    expect(readNumbers({ change: 'price', sizes: [], addons: [] }).renames).toEqual([]);
  });

  it('reads a sent rename back from the names the check stored, else the names it knows', () => {
    expect(
      renameReadBack(
        {
          variant_id: 'v1',
          name_en: 'Large',
          name_ar: 'كبير',
          before_en: 'Small',
          before_ar: 'صغير',
        },
        'variant_id',
        {},
      ),
    ).toEqual({
      from_en: 'Small',
      from_ar: 'صغير',
      to_en: 'Large',
      to_ar: 'كبير',
    });
    expect(
      renameReadBack({ variant_id: 'v1', name_en: 'Large', name_ar: 'كبير' }, 'variant_id', {
        v1: { en: 'Small', ar: 'صغير' },
      }),
    ).toMatchObject({
      from_en: 'Small',
    });
    expect(renameReadBack({ name_en: 'Large' }, 'variant_id', {})).toBeNull();
  });
});
