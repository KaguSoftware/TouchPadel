import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import { makeT } from '@touch/i18n';
import type { IngredientOption, ShoppingItem } from '../api';
import {
  CAPS,
  PURCHASE_ROLES,
  SHOPPING_ROLES,
  boughtUnit,
  canCancel,
  emptyFreeLine,
  emptyShoppingDraft,
  formatQty,
  intentFor,
  lineName,
  listLineFor,
  matchIngredients,
  missingItemIds,
  parseItemIds,
  parseTypedIqd,
  parseTypedQty,
  pickIngredient,
  pruneTicks,
  purchaseArgs,
  purchaseTotal,
  shoppingArgs,
  shoppingStatusesFor,
  shoppingView,
  tickedInOrder,
  toggleTick,
  unitsFor,
  validatePurchase,
  validateShoppingDraft,
  type ShoppingDraft,
} from '../logic';

const VENUE = 'c0000000-0000-4000-8000-000000000001';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const flour: IngredientOption = {
  id: ID(1),
  name_en: 'Flour',
  name_ar: 'طحين',
  unit: 'g',
  kind: 'purchased',
  pack_size: 1000,
};
const milk: IngredientOption = { id: ID(2), name_en: 'Milk', name_ar: 'حليب', unit: 'ml', kind: 'purchased', pack_size: null };

function item(patch: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: ID(10),
    ingredient_id: null,
    name_en: null,
    name_ar: null,
    label: 'Dish soap',
    qty: 2,
    unit: 'pc',
    note: null,
    requested_by_name: 'Rusul',
    requested_at: '2026-09-25T08:00:00Z',
    status: 'open',
    mine: false,
    decline_reason: null,
    ...patch,
  };
}

describe('who does what on the shopping page (§6.1, #26, #66, #70)', () => {
  it('lets the heads and MGMT add straight to the driver, and the chef assistant add for an OK', () => {
    expect(shoppingView('head_barista')).toMatchObject({ canAdd: true, addWaitsForOk: false, canDecide: false });
    expect(shoppingView('head_chef')).toMatchObject({ canAdd: true, addWaitsForOk: false, canDecide: true });
    expect(shoppingView('chef')).toMatchObject({ canAdd: true, addWaitsForOk: true, canDecide: false });
    for (const role of ['manager', 'owner'] as const) {
      expect(shoppingView(role)).toMatchObject({ canAdd: true, canDecide: true, cancelsAny: true });
    }
  });

  it('gives the barista the list to read and the driver the run, and neither adds', () => {
    expect(shoppingView('barista')).toEqual({
      canAdd: false,
      addWaitsForOk: false,
      canDecide: false,
      runChecklist: false,
      cancelsAny: false,
    });
    expect(shoppingView('driver')).toMatchObject({ canAdd: false, runChecklist: true, canDecide: false });
    for (const role of STAFF_ROLES) {
      expect(shoppingView(role).runChecklist, role).toBe(role === 'driver');
    }
  });

  it('never asks for a waiting or declined line on a driver’s behalf', () => {
    expect(shoppingStatusesFor(shoppingView('driver'))).toEqual(['open']);
    expect(shoppingStatusesFor(shoppingView('barista'))).toEqual(['open']);
    expect(shoppingStatusesFor(shoppingView('head_chef'))).toEqual(['open', 'pending']);
    expect(shoppingStatusesFor(shoppingView('chef'))).toEqual(['open', 'pending', 'declined']);
  });

  it('keeps the page to the roles the server answers', () => {
    expect([...SHOPPING_ROLES].sort()).toEqual(
      ['barista', 'chef', 'driver', 'head_barista', 'head_chef', 'manager', 'owner'],
    );
    expect(SHOPPING_ROLES).not.toContain('marketing');
    expect(SHOPPING_ROLES).not.toContain('cashier');
    expect([...PURCHASE_ROLES].sort()).toEqual(['driver', 'manager', 'owner']);
  });

  it('cancels one’s own open or waiting line, and anyone’s for MGMT', () => {
    const chef = shoppingView('chef');
    expect(canCancel(chef, item({ mine: true, status: 'pending' }))).toBe(true);
    expect(canCancel(chef, item({ mine: true, status: 'open' }))).toBe(true);
    expect(canCancel(chef, item({ mine: false }))).toBe(false);
    expect(canCancel(chef, item({ mine: true, status: 'bought' }))).toBe(false);
    expect(canCancel(shoppingView('manager'), item({ mine: false }))).toBe(true);
    expect(canCancel(shoppingView('manager'), item({ status: 'declined' }))).toBe(false);
  });
});

describe('typed numbers', () => {
  it('reads a quantity in either digit set, with either decimal mark', () => {
    expect(parseTypedQty('2')).toBe(2);
    expect(parseTypedQty(' 1.5 ')).toBe(1.5);
    expect(parseTypedQty('1,25')).toBe(1.25);
    expect(parseTypedQty('٢٫٥')).toBe(2.5);
    expect(parseTypedQty('.5')).toBe(0.5);
  });

  it('refuses a quantity of nothing, a fourth decimal or one past the column', () => {
    for (const bad of ['', '0', '0.000', '1.2345', '-1', 'abc', '1e3', String(CAPS.qtyBelow)]) {
      expect(parseTypedQty(bad), bad).toBeNull();
    }
  });

  it('reads a whole IQD price with separators, 0 included, never a fraction', () => {
    expect(parseTypedIqd('12,000')).toBe(12000);
    expect(parseTypedIqd('١٢٬٥٠٠')).toBe(12500);
    expect(parseTypedIqd('0')).toBe(0);
    expect(parseTypedIqd('12.5')).toBeNull();
    expect(parseTypedIqd('-3')).toBeNull();
    expect(parseTypedIqd('')).toBeNull();
  });
});

describe('adding to the list', () => {
  const draft = (patch: Partial<ShoppingDraft>): ShoppingDraft => ({ ...emptyShoppingDraft(), ...patch });

  it('offers a stock line its base unit, and packs only with a pack size', () => {
    expect(unitsFor(null)).toEqual(['g', 'ml', 'pc', 'pack']);
    expect(unitsFor(flour)).toEqual(['g', 'pack']);
    expect(unitsFor(milk)).toEqual(['ml']);
  });

  it('moves the unit onto one the picked item allows', () => {
    expect(pickIngredient(draft({ unit: 'pc' }), flour).unit).toBe('g');
    expect(pickIngredient(draft({ unit: 'pack' }), flour).unit).toBe('pack');
    expect(pickIngredient(draft({ unit: 'pack' }), milk)).toMatchObject({ ingredientId: milk.id, unit: 'ml' });
    expect(pickIngredient(draft({ ingredientId: flour.id, unit: 'g' }), null)).toMatchObject({
      ingredientId: null,
      unit: 'g',
    });
  });

  it('needs a name for a label line, an amount and a unit, and keeps the caps', () => {
    expect(validateShoppingDraft(draft({}), null).map((i) => `${i.field}:${i.code}`)).toEqual([
      'label:required',
      'qty:required',
      'unit:required',
    ]);
    expect(
      validateShoppingDraft(draft({ label: 'x'.repeat(81), qty: '0', unit: 'pc', note: 'n'.repeat(201) }), null),
    ).toEqual([
      { field: 'label', code: 'tooLong' },
      { field: 'qty', code: 'invalid' },
      { field: 'note', code: 'tooLong' },
    ]);
    expect(validateShoppingDraft(draft({ ingredientId: milk.id, qty: '2', unit: 'pack' }), milk)).toEqual([
      { field: 'unit', code: 'invalid' },
    ]);
    expect(validateShoppingDraft(draft({ ingredientId: flour.id, qty: '2', unit: 'pack' }), flour)).toEqual([]);
  });

  it('sends a stock line without its label, and a label line without an ingredient', () => {
    expect(shoppingArgs(draft({ label: 'flo', qty: '2', unit: 'pack', note: ' ' }), flour, VENUE)).toEqual({
      p_venue_id: VENUE,
      p_ingredient_id: flour.id,
      p_label: null,
      p_qty: 2,
      p_unit: 'pack',
      p_note: null,
    });
    expect(shoppingArgs(draft({ label: ' Ice ', qty: '3', unit: 'pack', note: 'big bags' }), null, VENUE)).toEqual({
      p_venue_id: VENUE,
      p_ingredient_id: null,
      p_label: 'Ice',
      p_qty: 3,
      p_unit: 'pack',
      p_note: 'big bags',
    });
  });

  it('matches ingredients by either name once something is typed', () => {
    expect(matchIngredients([flour, milk], '')).toEqual([]);
    expect(matchIngredients([flour, milk], 'MIL')).toEqual([milk]);
    expect(matchIngredients([flour, milk], 'طحين')).toEqual([flour]);
    expect(matchIngredients(Array(20).fill(flour), 'f')).toHaveLength(8);
  });

  it('keys an intent by what it sends, so a changed form is a new write', () => {
    const a = intentFor('shopping.add', { p_qty: 1 });
    expect(intentFor('shopping.add', { p_qty: 1 })).toBe(a);
    expect(intentFor('shopping.add', { p_qty: 2 })).not.toBe(a);
  });
});

describe('the driver’s run', () => {
  it('keeps a tick only while its line is still open', () => {
    const ticks = new Set([ID(1), ID(2)]);
    expect([...pruneTicks(ticks, [ID(2), ID(3)])]).toEqual([ID(2)]);
    expect([...toggleTick(new Set([ID(1)]), ID(1))]).toEqual([]);
    expect([...toggleTick(new Set([ID(1)]), ID(2))]).toEqual([ID(1), ID(2)]);
  });

  it('hands the purchase page the ticked lines in list order', () => {
    const items = [item({ id: ID(3) }), item({ id: ID(1) }), item({ id: ID(2) })];
    expect(tickedInOrder(items, new Set([ID(2), ID(3)]))).toEqual([ID(3), ID(2)]);
  });

  it('reads the itemIds param as ids once each, dropping anything else, forty at most', () => {
    expect(parseItemIds(`${ID(1)},${ID(2)},${ID(1)},nope,`)).toEqual([ID(1), ID(2)]);
    expect(parseItemIds([ID(3)])).toEqual([ID(3)]);
    expect(parseItemIds(undefined)).toEqual([]);
    const many = Array.from({ length: 45 }, (_, i) => ID(i + 1)).join(',');
    expect(parseItemIds(many)).toHaveLength(CAPS.purchaseLines);
  });
});

describe('the purchase form', () => {
  const packFlour = item({ id: ID(20), ingredient_id: flour.id, name_en: 'Flour', label: null, qty: 2, unit: 'pack' });

  it('turns a pack line into the base unit stock is counted in', () => {
    expect(boughtUnit(packFlour, flour)).toEqual({ unit: 'g', qty: 2000 });
    expect(listLineFor(packFlour, flour)).toEqual({ kind: 'list', itemId: ID(20), qty: '2000', price: '' });
    // Unknown pack size: the driver types the base amount.
    expect(boughtUnit(packFlour, { ...flour, pack_size: null })).toEqual({ unit: 'g', qty: null });
    expect(listLineFor(packFlour, undefined).qty).toBe('');
  });

  it('keeps a base-unit line and a label line as the list asked', () => {
    expect(boughtUnit(item({ ingredient_id: milk.id, unit: 'ml', qty: 1500 }), milk)).toEqual({ unit: 'ml', qty: 1500 });
    expect(boughtUnit(item({ unit: 'pack', qty: 3 }), undefined)).toEqual({ unit: 'pack', qty: 3 });
  });

  it('needs a line, and on each an amount and a whole price; a free line needs its name', () => {
    expect(validatePurchase({ lines: [], shop: '' })).toEqual([{ field: 'lines', code: 'required' }]);
    const issues = validatePurchase({
      lines: [
        { kind: 'list', itemId: ID(1), qty: '', price: '1.5' },
        { ...emptyFreeLine(), label: ' ', price: '100' },
      ],
      shop: 's'.repeat(81),
    });
    expect(issues).toEqual([
      { field: 'qty', code: 'required', line: 0 },
      { field: 'price', code: 'invalid', line: 0 },
      { field: 'label', code: 'required', line: 1 },
      { field: 'shop', code: 'tooLong' },
    ]);
  });

  it('refuses more lines than one purchase holds', () => {
    const lines = Array.from({ length: 41 }, () => ({ ...emptyFreeLine(), label: 'x', price: '1' }));
    expect(validatePurchase({ lines, shop: '' })).toEqual([{ field: 'lines', code: 'tooLong' }]);
  });

  it('sends list lines by id, free lines by label, and the lines’ sum as the total', () => {
    const draft = {
      lines: [
        { kind: 'list' as const, itemId: ID(20), qty: '2000', price: '60,000' },
        { kind: 'free' as const, label: ' Ice ', qty: '2', price: '3000' },
      ],
      shop: ' Al-Rasheed ',
    };
    expect(purchaseTotal(draft.lines)).toBe(63000);
    expect(purchaseArgs(draft, VENUE, 'v/receipts/x.jpg')).toEqual({
      p_venue_id: VENUE,
      p_lines: [
        { shopping_item_id: ID(20), qty: 2000, price_iqd: 60000 },
        { label: 'Ice', qty: 2, price_iqd: 3000 },
      ],
      p_total_iqd: 63000,
      p_shop: 'Al-Rasheed',
      p_receipt_path: 'v/receipts/x.jpg',
    });
    expect(purchaseArgs({ lines: draft.lines, shop: '' }, VENUE, null)).toMatchObject({ p_shop: null, p_receipt_path: null });
  });

  it('counts only prices typed properly in the running total', () => {
    expect(
      purchaseTotal([
        { kind: 'list', itemId: ID(1), qty: '1', price: '1000' },
        { kind: 'list', itemId: ID(2), qty: '1', price: 'abc' },
      ]),
    ).toBe(1000);
  });

  it('names the ticked lines no longer open', () => {
    expect(missingItemIds([ID(1), ID(2)], [item({ id: ID(2) })])).toEqual([ID(1)]);
  });
});

describe('showing a line', () => {
  it('writes the amount with its unit word, singular for exactly one', () => {
    const en = makeT('en');
    const ar = makeT('ar');
    expect(formatQty(en, 'en', 2, 'pack')).toBe('2 packs');
    expect(formatQty(en, 'en', 1, 'pack')).toBe('1 pack');
    expect(formatQty(en, 'en', 500, 'g')).toBe('500 g');
    expect(formatQty(ar, 'ar', 2, 'pack')).toContain('عبوات');
    // A purchase line's unit can be missing: the number alone.
    expect(formatQty(en, 'en', 3, null)).toBe('3');
  });

  it('names a stock line in the reader’s language, and a label line as typed', () => {
    const stock = { name_en: 'Flour', name_ar: 'طحين', label: null };
    expect(lineName(stock, 'en')).toBe('Flour');
    expect(lineName(stock, 'ar')).toBe('طحين');
    expect(lineName({ name_en: 'Flour', name_ar: null, label: null }, 'ar')).toBe('Flour');
    expect(lineName({ name_en: null, name_ar: null, label: 'Dish soap' }, 'ar')).toBe('Dish soap');
  });
});
