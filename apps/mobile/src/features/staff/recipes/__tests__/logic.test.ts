import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import {
  RECIPE_CHANGE_ROLES,
  RECIPE_ROLES,
  addableIngredients,
  asksRecipeChanges,
  canApprove,
  changeLines,
  declineIssue,
  decidesRecipeChanges,
  emptyRecipeDraft,
  filterRecipeItems,
  findTarget,
  lineOp,
  recipeChangeArgs,
  recipeChangeIntent,
  recipeTargets,
  validateRecipeChange,
  withAdded,
  withLineOp,
  withQty,
  withoutOp,
  type IngredientOption,
  type RecipeView,
} from '../logic';

const view: RecipeView = {
  items: [
    {
      menu_item_id: 'latte',
      name_en: 'Latte',
      name_ar: 'لاتيه',
      category_name_en: 'Coffee',
      category_name_ar: 'قهوة',
      sizes: [
        {
          variant_id: 'latte-s',
          name_en: 'Small',
          name_ar: 'صغير',
          lines: [
            { recipe_line_id: 'l1', ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب' },
            { recipe_line_id: 'l2', ingredient_id: 'beans', name_en: 'Beans', name_ar: 'بن' },
          ],
        },
        { variant_id: 'latte-l', name_en: 'Large', name_ar: 'كبير', lines: [] },
      ],
    },
    {
      menu_item_id: 'tea',
      name_en: 'Tea',
      name_ar: 'شاي',
      category_name_en: 'Hot',
      category_name_ar: 'ساخن',
      sizes: [{ variant_id: 'tea-1', name_en: 'Regular', name_ar: 'عادي', lines: [] }],
    },
  ],
  prepared: [
    {
      ingredient_id: 'syrup',
      name_en: 'Vanilla syrup',
      name_ar: 'شراب الفانيلا',
      lines: [{ recipe_line_id: 'p1', ingredient_id: 'sugar', name_en: 'Sugar', name_ar: 'سكر' }],
    },
  ],
};

const targets = recipeTargets(view);
const latteS = findTarget(targets, 'variant', 'latte-s')!;
const syrup = findTarget(targets, 'output', 'syrup')!;

describe('who does what with recipes (#71, #72)', () => {
  it('lets the bar and kitchen family and management read, the heads ask, the owner decide', () => {
    expect(STAFF_ROLES.filter((r) => RECIPE_ROLES.includes(r)).sort()).toEqual(
      ['barista', 'chef', 'head_barista', 'head_chef', 'manager', 'owner'],
    );
    expect(STAFF_ROLES.filter(asksRecipeChanges).sort()).toEqual(['head_barista', 'head_chef']);
    expect(STAFF_ROLES.filter(decidesRecipeChanges)).toEqual(['owner']);
    expect([...RECIPE_CHANGE_ROLES].sort()).toEqual(['head_barista', 'head_chef', 'manager', 'owner']);
  });

  it('carries no amount in anything a reader sees', () => {
    const keys = JSON.stringify(view);
    expect(keys).not.toMatch(/"qty"|"quantity"|"unit"|_iqd"/);
  });
});

describe('targets', () => {
  it('lists every size, named by the item alone when it has one size, and the prepared items', () => {
    expect(targets.map((t) => `${t.kind}:${t.id}:${t.size_en ?? '-'}`)).toEqual([
      'variant:latte-s:Small',
      'variant:latte-l:Large',
      'variant:tea-1:-',
      'output:syrup:-',
    ]);
    expect(findTarget(targets, 'output', 'latte-s')).toBeNull();
    expect(findTarget(targets, null, 'x')).toBeNull();
  });

  it('finds items by name, category or ingredient, in either language', () => {
    expect(filterRecipeItems(view.items, 'حليب').map((i) => i.menu_item_id)).toEqual(['latte']);
    expect(filterRecipeItems(view.items, 'hot').map((i) => i.menu_item_id)).toEqual(['tea']);
    expect(filterRecipeItems(view.items, '').length).toBe(2);
  });
});

describe('the head’s draft', () => {
  const start = emptyRecipeDraft({ kind: 'variant', id: 'latte-s' });

  it('gives each current line at most one op, and undoes it', () => {
    const set = withLineOp(start, latteS.lines[0]!, 'set');
    expect(lineOp(set, 'l1')).toMatchObject({ op: 'set', lineId: 'l1', ingredientId: 'milk' });
    const removed = withLineOp(set, latteS.lines[0]!, 'remove');
    expect(removed.ops).toEqual([{ op: 'remove', lineId: 'l1', ingredientId: 'milk' }]);
    expect(withLineOp(removed, latteS.lines[0]!, null).ops).toEqual([]);
  });

  it('adds an ingredient once, and drops an op by index', () => {
    const added = withAdded(withAdded(start, 'honey'), 'honey');
    expect(added.ops).toEqual([{ op: 'add', ingredientId: 'honey', qty: '' }]);
    expect(withoutOp(added, 0).ops).toEqual([]);
  });

  it('checks the server’s rules before the round trip', () => {
    expect(validateRecipeChange(emptyRecipeDraft(), null)).toEqual([{ field: 'target', code: 'required' }]);
    expect(validateRecipeChange(start, latteS)).toEqual([{ field: 'ops', code: 'required' }]);

    let d = withLineOp(start, latteS.lines[0]!, 'set');
    expect(validateRecipeChange(d, latteS)).toEqual([{ field: 'qty', index: 0, code: 'required' }]);
    d = withQty(d, 0, '1,5');
    expect(validateRecipeChange(d, latteS)).toEqual([{ field: 'qty', index: 0, code: 'invalid' }]);
    d = withQty(d, 0, '200');
    expect(validateRecipeChange(d, latteS)).toEqual([]);

    // An add of an ingredient already on the recipe, or of the item itself.
    const onRecipe = withQty(withAdded(start, 'beans'), 0, '5');
    expect(validateRecipeChange(onRecipe, latteS)).toEqual([{ field: 'ingredient', index: 0, code: 'onRecipe' }]);
    const self = withQty(withAdded(emptyRecipeDraft({ kind: 'output', id: 'syrup' }), 'syrup'), 0, '5');
    expect(validateRecipeChange(self, syrup)).toEqual([{ field: 'ingredient', index: 0, code: 'self' }]);

    // Taking every line out and adding nothing leaves no recipe.
    const empty = withLineOp(emptyRecipeDraft({ kind: 'output', id: 'syrup' }), syrup.lines[0]!, 'remove');
    expect(validateRecipeChange(empty, syrup)).toEqual([{ field: 'ops', code: 'emptyResult' }]);

    const longNote = { ...d, note: 'x'.repeat(1001) };
    expect(validateRecipeChange(longNote, latteS)).toEqual([{ field: 'note', code: 'tooLong' }]);
  });

  it('sends the ops the server reads, amounts as numbers, and a note only when written', () => {
    let d = withQty(withLineOp(start, latteS.lines[0]!, 'set'), 0, '٢٠٠');
    d = withLineOp(d, latteS.lines[1]!, 'remove');
    d = withQty(withAdded(d, 'honey'), 2, '12.5');
    const args = recipeChangeArgs(d, 'v1');
    expect(args).toEqual({
      p_target: 'variant',
      p_target_id: 'latte-s',
      p_ops: [
        { op: 'set', recipe_line_id: 'l1', qty: 200 },
        { op: 'remove', recipe_line_id: 'l2' },
        { op: 'add', ingredient_id: 'honey', qty: 12.5 },
      ],
      p_venue_id: 'v1',
    });
    expect(recipeChangeArgs({ ...d, note: ' less sweet ' }, 'v1').p_note).toBe('less sweet');
    expect(recipeChangeIntent(args)).toBe(recipeChangeIntent(recipeChangeArgs(d, 'v1')));
    expect(recipeChangeIntent(args)).not.toBe(recipeChangeIntent(recipeChangeArgs({ ...d, note: 'x' }, 'v1')));
  });

  it('offers only bought-in or made-here ingredients not on the recipe yet', () => {
    const options: IngredientOption[] = [
      { id: 'milk', name_en: 'Milk', name_ar: 'حليب', unit: 'ml', kind: 'purchased', pack_size: null },
      { id: 'honey', name_en: 'Honey', name_ar: 'عسل', unit: 'g', kind: 'purchased', pack_size: null },
      { id: 'syrup', name_en: 'Vanilla syrup', name_ar: 'شراب', unit: 'ml', kind: 'prepared', pack_size: null },
      { id: 'grip', name_en: 'Overgrip', name_ar: 'غريب', unit: 'pc', kind: 'retail', pack_size: null },
    ];
    expect(addableIngredients(options, latteS, start, '').map((o) => o.id)).toEqual(['honey', 'syrup']);
    expect(addableIngredients(options, latteS, withAdded(start, 'honey'), '').map((o) => o.id)).toEqual(['syrup']);
    expect(addableIngredients(options, syrup, emptyRecipeDraft({ kind: 'output', id: 'syrup' }), 'عس').map((o) => o.id)).toEqual(['honey']);
    expect(addableIngredients(options, null, start, '')).toEqual([]);
  });
});

describe('the owner’s decision', () => {
  it('needs a reason to decline and a waiting, current recipe to approve', () => {
    expect(declineIssue(' ')).toBe('required');
    expect(declineIssue('x'.repeat(1001))).toBe('tooLong');
    expect(declineIssue('Too sweet')).toBeNull();
    expect(canApprove({ status: 'waiting', stale: false })).toBe(true);
    expect(canApprove({ status: 'waiting', stale: true })).toBe(false);
    expect(canApprove({ status: 'approved', stale: false })).toBe(false);
  });

  it('reads a change as each ingredient before and after', () => {
    const lines = changeLines({
      before: [
        { recipe_line_id: 'l1', ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', qty: 180, unit: 'ml' },
        { recipe_line_id: 'l2', ingredient_id: 'beans', name_en: 'Beans', name_ar: 'بن', qty: 18, unit: 'g' },
      ],
      after: [
        { ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', qty: 200, unit: 'ml' },
        { ingredient_id: 'honey', name_en: 'Honey', name_ar: 'عسل', qty: 12.5, unit: 'g' },
      ],
    });
    expect(lines.map((l) => [l.ingredient_id, l.before, l.after])).toEqual([
      ['milk', 180, 200],
      ['beans', 18, null],
      ['honey', null, 12.5],
    ]);
  });
});
