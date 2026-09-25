import { describe, expect, it } from 'vitest';
import { validateStep } from '@touch/core/protocols';
import { NEW_RULE, pickTarget, priceProposalPrefill, readTargets } from './priceTargets';

const ITEM = '0a000000-0000-4000-8000-000000000001';
const V1 = '0b000000-0000-4000-8000-000000000001';
const V2 = '0b000000-0000-4000-8000-000000000002';
const ADDON = '0c000000-0000-4000-8000-000000000001';
const PROMO = '0d000000-0000-4000-8000-000000000001';
const RULE = '0e000000-0000-4000-8000-000000000001';

const items = readTargets({
  items: [
    {
      menu_item_id: ITEM,
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_kind: 'cafe',
      is_active: true,
      sizes: [
        { variant_id: V1, name_en: 'Small', name_ar: 'صغير', price_iqd: 4000 },
        { variant_id: V2, name_en: 'Large', name_ar: 'كبير', price_iqd: 5000 },
      ],
    },
    { name_en: 'no id' },
  ],
});

describe('price_promo_targets', () => {
  it('reads each kind’s shape and drops rows with no id', () => {
    expect(items.items).toHaveLength(1);
    const promos = readTargets({
      promotions: [{ promotion_id: PROMO, name_en: 'Mornings', name_ar: 'الصباح', type: 'percent', value: 10, weekdays: [0, 1], scope: { courtIds: ['c'] }, limits: { total: 50 }, enabled: false, hour_from: '07:00:00' }],
    });
    expect(promos.promotions[0]!.fields).toMatchObject({ type: 'percent', value: 10, weekdays: [0, 1], scope: { courtIds: ['c'], categoryIds: [], itemIds: [] }, limits: { total: 50, perCustomer: null } });
    const rules = readTargets({ rules: [{ rule_id: RULE, name: 'Evenings', days_of_week: [5, 6], start_time: '18:00:00', end_time: '23:00:00', prices: { '60': 30000, '90': 'x' }, is_active: true }] });
    expect(rules.rules[0]!.fields).toMatchObject({ name: 'Evenings', prices: { '60': 30000 }, court_id: '' });
    expect(readTargets({ featured_item_id: ITEM, featured_discount_pct: 15, hero_mode: 'media', items: [] }).featured).toEqual({ item_id: ITEM, pct: 15, hero_mode: 'media' });
    expect(readTargets(null)).toEqual({ items: [], addons: [], promotions: [], rules: [], featured: null });
  });
});

describe('a start linked in from another screen (§5.5)', () => {
  it('prices an item at today’s prices', () => {
    expect(priceProposalPrefill('price', items, { item: ITEM })).toEqual({
      change: 'price',
      menu_item_id: ITEM,
      prices: [
        { variant_id: V1, price_iqd: 4000 },
        { variant_id: V2, price_iqd: 5000 },
      ],
    });
    // A target the list does not hold is left for the person to pick.
    expect(priceProposalPrefill('price', items, { item: ADDON })).toEqual({ change: 'price', prices: [] });
  });

  it('starts an add-on at its price, a promotion edit with its fields, a rate with its rule or a new one', () => {
    const addons = readTargets({ addons: [{ modifier_id: ADDON, group_name_en: 'Milk', name_en: 'Oat', price_delta_iqd: 500, launched: true, is_active: true }] });
    expect(priceProposalPrefill('addon_price', addons, { addon: ADDON })).toEqual({ change: 'addon_price', addons: [{ modifier_id: ADDON, price_delta_iqd: 500 }] });
    const promos = readTargets({ promotions: [{ promotion_id: PROMO, name_en: 'Mornings', name_ar: 'الصباح', type: 'amount', value: 2000, weekdays: [], scope: {} }] });
    expect(priceProposalPrefill('promotion_edit', promos, { promotion: PROMO })).toMatchObject({ change: 'promotion_edit', promotion_id: PROMO, promotion: { type: 'amount', value: 2000 } });
    expect(priceProposalPrefill('promotion_enable', promos, { promotion: PROMO })).toEqual({ change: 'promotion_enable', promotion_id: PROMO });
    expect(priceProposalPrefill('rate', readTargets({}), {})).toEqual({ change: 'rate', rule: NEW_RULE });
  });

  it('starts the featured discount on the item and discount stored today', () => {
    const t = readTargets({ featured_item_id: ITEM, featured_discount_pct: 15, items: [{ menu_item_id: ITEM, name_en: 'Latte', name_ar: 'لاتيه', sizes: [] }] });
    expect(priceProposalPrefill('featured_discount', t, {})).toEqual({ change: 'featured_discount', menu_item_id: ITEM, discount_pct: 15 });
  });

  it('picks a target and brings its figures, forgetting the last one’s', () => {
    const record = { change: 'price', reason: 'Milk went up', menu_item_id: 'old', prices: [{ variant_id: 'x', price_iqd: 1 }], new_sizes: [{ name_en: 'XL', price_iqd: 1 }] };
    const next = pickTarget('price', items, record, ITEM);
    expect(next).toMatchObject({ reason: 'Milk went up', menu_item_id: ITEM, new_sizes: [] });
    expect(next.prices).toHaveLength(2);
    expect(pickTarget('rate', readTargets({}), { change: 'rate', rule_id: RULE }, '')).toEqual({ change: 'rate', rule_id: '', rule: NEW_RULE });
  });

  it('gives the core check a proposal it accepts once the reason is in', () => {
    const record = { ...priceProposalPrefill('price', items, { item: ITEM }), reason: 'Milk went up', expected_effect: 'Margin back to 70%' };
    expect(validateStep('price_promo', 'propose', record)).toEqual([]);
  });
});
