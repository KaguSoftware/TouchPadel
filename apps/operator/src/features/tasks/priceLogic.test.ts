import { describe, expect, it } from 'vitest';
import { startForm } from '@touch/core/protocols';
import { emptyDraft, toRecord, withoutUnchangedRenames } from './formModel';
import { currentNames, deriveDraft, needsTargets, readTargets, renameKeyOf, startDraft, targetSources } from './priceLogic';

// A price or promotion change from /tasks: picking a target fills the rest
// from app.price_promo_targets, the way the phone's start form does (§2.8).

const targets = readTargets({
  items: [
    {
      menu_item_id: 'item-1',
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_kind: 'cafe',
      sizes: [
        { variant_id: 'v-s', name_en: 'Small', name_ar: 'صغير', price_iqd: 3000 },
        { variant_id: 'v-l', name_en: 'Large', name_ar: 'كبير', price_iqd: 4500 },
      ],
    },
  ],
  addons: [
    { modifier_id: 'm-1', group_name_en: 'Milk', group_name_ar: 'حليب', name_en: 'Oat', name_ar: 'شوفان', price_delta_iqd: 500, is_active: true, launched: true },
    { modifier_id: 'm-2', group_name_en: 'Milk', group_name_ar: 'حليب', name_en: 'Almond', name_ar: 'لوز', price_delta_iqd: 750, is_active: false, launched: false },
  ],
  promotions: [{ promotion_id: 'p-1', name_en: 'Happy hour', name_ar: 'ساعة سعيدة', type: 'percent', value: 15, weekdays: [0, 1], hour_from: '14:00:00', hour_to: '16:00:00', scope: {}, enabled: false }],
  rules: [{ rule_id: 'r-1', name: 'Weekday', court_id: null, days_of_week: [0, 1, 2], start_time: '08:00:00', end_time: '16:00:00', priority: 1, is_active: true, prices: { '60': 20000, '90': 28000 } }],
  featured_item_id: 'item-1',
  featured_discount_pct: 10,
});

describe('price targets', () => {
  it('reads every kind of target and offers them by the form paths', () => {
    expect(targets.items[0]!.sizes.map((s) => s.priceIqd)).toEqual([3000, 4500]);
    const sources = targetSources(targets, { menu_item_id: 'item-1' }, 'ar');
    expect(sources.menu_item_id).toEqual([{ value: 'item-1', label: 'لاتيه' }]);
    expect(sources['prices.variant_id']!.map((o) => o.label)).toEqual(['صغير', 'كبير']);
    expect(sources['addons.modifier_id']![0]!.label).toBe('حليب · شوفان');
  });

  it('asks the server for targets for every kind but a brand-new promotion', () => {
    expect(needsTargets('promotion')).toBe(false);
    expect(needsTargets('price')).toBe(true);
    expect(needsTargets('featured_discount')).toBe(true);
  });

  it('brings an item in at today’s prices, one row a size', () => {
    const fields = startForm('price_promo', { change: 'price' }).fields;
    const prev = startDraft('price', fields, { reason: 'Milk went up' }, targets);
    const next = deriveDraft('price', prev, { ...prev, menu_item_id: 'item-1' }, targets);
    expect(next.prices).toEqual([
      { variant_id: 'v-s', price_iqd: 3000 },
      { variant_id: 'v-l', price_iqd: 4500 },
    ]);
    expect(next.reason).toBe('Milk went up');
  });

  it('fills an add-on’s current charge once, and never over a typed one', () => {
    const prev = { addons: [{ modifier_id: '', price_delta_iqd: null }] };
    const picked = deriveDraft('addon_price', prev, { addons: [{ modifier_id: 'm-1', price_delta_iqd: null }] }, targets);
    expect(picked.addons).toEqual([{ modifier_id: 'm-1', price_delta_iqd: 500 }]);
    const typed = deriveDraft('addon_price', picked, { addons: [{ modifier_id: 'm-1', price_delta_iqd: 750 }] }, targets);
    expect(typed.addons).toEqual([{ modifier_id: 'm-1', price_delta_iqd: 750 }]);
  });

  it('opens a promotion or a rate as it stands', () => {
    const promo = deriveDraft('promotion_edit', { promotion_id: '' }, { promotion_id: 'p-1' }, targets);
    expect((promo.promotion as Record<string, unknown>).value).toBe(15);
    expect((promo.promotion as Record<string, unknown>).hour_from).toBe('14:00');
    const rate = deriveDraft('rate', { rule_id: '' }, { rule_id: 'r-1' }, targets);
    expect((rate.rule as Record<string, unknown>).prices).toEqual([
      { duration: 60, price: 20000 },
      { duration: 90, price: 28000 },
    ]);
    // Clearing the rate goes back to a new, switched-on rule.
    const fresh = deriveDraft('rate', rate, { ...rate, rule_id: '' }, targets);
    expect((fresh.rule as Record<string, unknown>).is_active).toBe(true);
  });

  it('opens the featured discount on what is stored today', () => {
    const fields = startForm('price_promo', { change: 'featured_discount' }).fields;
    const draft = startDraft('featured_discount', fields, emptyDraft(fields), targets);
    expect(draft.menu_item_id).toBe('item-1');
    expect(draft.discount_pct).toBe(10);
    expect(draft.change).toBe('featured_discount');
  });
});

// Wave 5 (wave5-addendum-2026-09-25 §2.2, #9): marketing's start on /tasks
// renames a size or an option on sale through the same change.
describe('renames on a price or add-on price start', () => {
  it('offers the item’s sizes, and only the options on sale', () => {
    const sources = targetSources(targets, { menu_item_id: 'item-1' }, 'en');
    expect(sources['renames.variant_id']!.map((o) => o.label)).toEqual(['Small', 'Large']);
    expect(sources['renames.modifier_id']!.map((o) => o.value)).toEqual(['m-1']);
    expect(renameKeyOf('price')).toBe('variant_id');
    expect(renameKeyOf('addon_price')).toBe('modifier_id');
    expect(renameKeyOf('shop_launch')).toBeNull();
  });

  it('opens a picked size on its names today, and keeps what was typed after', () => {
    const base = { menu_item_id: 'item-1', renames: [{ variant_id: '', name_en: '', name_ar: '' }] };
    const picked = deriveDraft('price', base, { ...base, renames: [{ variant_id: 'v-s', name_en: '', name_ar: '' }] }, targets);
    expect(picked.renames).toEqual([{ variant_id: 'v-s', name_en: 'Small', name_ar: 'صغير' }]);
    const typed = deriveDraft('price', picked, { ...picked, renames: [{ variant_id: 'v-s', name_en: 'Large', name_ar: 'صغير' }] }, targets);
    expect(typed.renames).toEqual([{ variant_id: 'v-s', name_en: 'Large', name_ar: 'صغير' }]);
  });

  it('keeps a typed row as it is when a row above it is removed', () => {
    const two = {
      menu_item_id: 'item-1',
      renames: [
        { variant_id: 'v-s', name_en: 'Large', name_ar: 'كبير' },
        { variant_id: 'v-l', name_en: 'Small', name_ar: 'صغير' },
      ],
    };
    const removed = deriveDraft('price', two, { ...two, renames: [two.renames[1]!] }, targets);
    expect(removed.renames).toEqual([{ variant_id: 'v-l', name_en: 'Small', name_ar: 'صغير' }]);
  });

  it('drops the renames of the last item’s sizes when another item is picked', () => {
    const prev = { menu_item_id: 'item-1', renames: [{ variant_id: 'v-s', name_en: 'Large', name_ar: 'كبير' }] };
    const next = deriveDraft('price', prev, { ...prev, menu_item_id: 'item-2' }, targets);
    expect(next.renames).toEqual([]);
  });

  it('opens a picked option on its names today', () => {
    const base = { addons: [], renames: [{ modifier_id: '', name_en: '', name_ar: '' }] };
    const picked = deriveDraft('addon_price', base, { ...base, renames: [{ modifier_id: 'm-1', name_en: '', name_ar: '' }] }, targets);
    expect(picked.renames).toEqual([{ modifier_id: 'm-1', name_en: 'Oat', name_ar: 'شوفان' }]);
  });

  it('sends only the rows that rename something (a Small↔Large swap stays whole)', () => {
    const fields = startForm('price_promo', { change: 'price' }).fields;
    const draft = {
      ...emptyDraft(fields),
      change: 'price',
      reason: 'Cup sizes were printed the wrong way round',
      expected_effect: 'Guests get the cup they order',
      menu_item_id: 'item-1',
      prices: [],
      renames: [
        { variant_id: 'v-s', name_en: 'Large', name_ar: 'كبير' },
        { variant_id: 'v-l', name_en: 'Small', name_ar: 'صغير' },
        { variant_id: 'v-l', name_en: ' Large ', name_ar: 'كبير' },
      ],
    };
    const names = currentNames('price', targets, draft);
    const record = withoutUnchangedRenames(toRecord(fields, draft), renameKeyOf('price'), names);
    expect(record.renames).toEqual([
      { variant_id: 'v-s', name_en: 'Large', name_ar: 'كبير' },
      { variant_id: 'v-l', name_en: 'Small', name_ar: 'صغير' },
    ]);
    const untouched = withoutUnchangedRenames(
      toRecord(fields, { ...draft, renames: [{ variant_id: 'v-s', name_en: 'Small ', name_ar: 'صغير' }] }),
      'variant_id',
      names,
    );
    expect('renames' in untouched).toBe(false);
  });
});
