import { describe, expect, it } from 'vitest';
import { flattenCatalogue, matchesProductLine, sizeArgs, sizeProblem, type SizeDraft } from './productsLogic';
import type { IngredientRow, OnHandRow, ShopCatalogue, SupplierRow } from '../stockKeys';

const catalogue: ShopCatalogue = {
  sections: [{ id: 's1', name_en: 'Rackets', name_ar: 'مضارب', is_active: true }],
  products: [
    {
      id: 'p1',
      category_id: 's1',
      name_en: 'Bullpadel Vertex',
      name_ar: 'بولبادل فيرتكس',
      is_active: true,
      sort_order: 0,
      menu_item_variants: [
        { id: 'v-l', item_id: 'p1', name_en: 'L', name_ar: 'كبير', price_iqd: 300_000, is_default: false, sort_order: 2, sku: 'VTX-L', barcode: '8435000000022' },
        { id: 'v-m', item_id: 'p1', name_en: 'M', name_ar: 'وسط', price_iqd: 290_000, is_default: true, sort_order: 1, sku: 'VTX-M', barcode: '8435000000015' },
      ],
    },
  ],
};

const ing = (over: Partial<IngredientRow>): IngredientRow => ({
  id: 'i',
  kind: 'retail',
  name_en: 'x',
  name_ar: 'x',
  unit: 'pc',
  pack_size: 1,
  pack_cost_iqd: null,
  supplier_name: null,
  shelf_life_days: null,
  yield_percent: 100,
  waste_allowance_percent: 0,
  par_level: null,
  low_stock_threshold: null,
  is_active: true,
  ...over,
});

const supplier: SupplierRow = { id: 'sup', name: 'Rafidain Sports', phone: null, notes: null, is_active: true };

describe('flattenCatalogue', () => {
  it('lists one row per size in size order, with its own stock and supplier', () => {
    const ingredients = [ing({ id: 'i-m', variant_id: 'v-m', supplier_id: 'sup', pack_cost_iqd: 200_000, low_stock_threshold: 2 })];
    const onHand = [{ ingredient_id: 'i-m', on_hand: 4 } as OnHandRow];
    const rows = flattenCatalogue(catalogue, ingredients, onHand, [supplier]);
    expect(rows.map((r) => r.variant.id)).toEqual(['v-m', 'v-l']);
    expect(rows[0]).toMatchObject({ ingredientId: 'i-m', onHand: 4, packCostIqd: 200_000, lowStockThreshold: 2, supplier });
    // A size made in the menu editor has no stock row yet.
    expect(rows[1]).toMatchObject({ ingredientId: null, onHand: null, supplier: null });
  });
});

describe('matchesProductLine', () => {
  const [row] = flattenCatalogue(catalogue, [], [], []);
  it('matches names in both scripts, SKU and barcode', () => {
    expect(matchesProductLine(row!, 'vertex')).toBe(true);
    expect(matchesProductLine(row!, 'فيرتكس')).toBe(true);
    expect(matchesProductLine(row!, 'vtx-m')).toBe(true);
    expect(matchesProductLine(row!, '8435000000015')).toBe(true);
    expect(matchesProductLine(row!, 'wilson')).toBe(false);
    expect(matchesProductLine(row!, '  ')).toBe(true);
  });
});

describe('sizeProblem / sizeArgs', () => {
  const ok: SizeDraft = { nameEn: 'M', nameAr: 'وسط', price: '290000', sku: 'VTX-M', barcode: '8435000000015', cost: '', low: '' };
  it('accepts a complete size and blank optional fields', () => {
    expect(sizeProblem(ok)).toBeNull();
    expect(sizeProblem({ ...ok, sku: '', barcode: '' })).toBeNull();
  });
  it('names the first problem', () => {
    expect(sizeProblem({ ...ok, nameAr: ' ' })).toBe('names');
    expect(sizeProblem({ ...ok, price: '12.5' })).toBe('price');
    expect(sizeProblem({ ...ok, sku: 'has space' })).toBe('sku');
    expect(sizeProblem({ ...ok, barcode: '12' })).toBe('barcode');
    expect(sizeProblem({ ...ok, cost: '-1' })).toBe('cost');
    expect(sizeProblem({ ...ok, low: 'two' })).toBe('low');
  });
  it('turns a draft into RPC arguments, blanks as null', () => {
    expect(sizeArgs({ ...ok, sku: ' ', cost: '200000', low: '2' }, 'sup')).toEqual({
      p_name_en: 'M',
      p_name_ar: 'وسط',
      p_price_iqd: 290_000,
      p_sku: null,
      p_barcode: '8435000000015',
      p_supplier_id: 'sup',
      p_pack_cost_iqd: 200_000,
      p_low_stock_threshold: 2,
    });
    expect(sizeArgs(ok, '').p_supplier_id).toBeNull();
  });
});
