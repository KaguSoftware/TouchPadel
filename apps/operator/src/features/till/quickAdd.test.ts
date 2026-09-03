import { describe, expect, it } from 'vitest';
import { mergeQuickLine, quickVariant } from './quickAdd';

const variant = (id: string, is_default = true) => ({ id, price_iqd: 1000, is_default });

describe('quickVariant', () => {
  it('returns the single variant of a modifier-free item', () => {
    const item = { menu_item_variants: [variant('v1')], menu_item_modifier_groups: [] };
    expect(quickVariant(item)?.id).toBe('v1');
  });

  it('demands the sheet for multi-variant or modifier-carrying items', () => {
    expect(
      quickVariant({
        menu_item_variants: [variant('v1'), variant('v2', false)],
        menu_item_modifier_groups: [],
      }),
    ).toBeNull();
    expect(
      quickVariant({
        menu_item_variants: [variant('v1')],
        menu_item_modifier_groups: [{ group_id: 'g1' }],
      }),
    ).toBeNull();
  });
});

describe('mergeQuickLine', () => {
  const plain = (key: string, variantId: string, qty = 1) => ({
    key,
    variantId,
    qty,
    notes: '',
    modifiers: [] as unknown[],
  });

  it('merges a plain quick-add into an existing plain line of the same variant', () => {
    const merged = mergeQuickLine([plain('a', 'v1', 2)], plain('b', 'v1'));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.qty).toBe(3);
  });

  it('keeps different variants, noted lines and modified lines separate', () => {
    expect(mergeQuickLine([plain('a', 'v1')], plain('b', 'v2'))).toHaveLength(2);
    expect(
      mergeQuickLine([{ ...plain('a', 'v1'), notes: 'no ice' }], plain('b', 'v1')),
    ).toHaveLength(2);
    expect(
      mergeQuickLine([{ ...plain('a', 'v1'), modifiers: [{ id: 'm' }] }], plain('b', 'v1')),
    ).toHaveLength(2);
  });
});
