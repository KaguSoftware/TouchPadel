/**
 * Quick-add — SOW L440-441 "built for speed, keyboard-first". A bottle of
 * water used to take tile → modal → variant select → Add: four interactions
 * for an item with nothing to choose. An item with exactly one variant and no
 * modifier groups adds straight to the basket on click (right-click still
 * opens the sheet for notes); same-variant plain lines merge into one row.
 */

export interface QuickVariantShape {
  id: string;
  price_iqd: number;
  is_default: boolean;
}

export interface QuickItemShape {
  menu_item_variants: QuickVariantShape[];
  menu_item_modifier_groups: { group_id: string }[];
}

/** The variant a plain click adds — or null when the sheet is genuinely needed. */
export function quickVariant<T extends QuickItemShape>(
  item: T,
): T['menu_item_variants'][number] | null {
  if (item.menu_item_modifier_groups.length > 0) return null;
  if (item.menu_item_variants.length !== 1) return null;
  return item.menu_item_variants[0] ?? null;
}

export interface MergeableLine {
  key: string;
  variantId: string;
  qty: number;
  notes: string;
  modifiers: readonly unknown[];
}

/**
 * Merge a plain quick-add into an existing plain line of the same variant
 * (qty+1 reads better on the bill than five duplicate rows); anything with
 * notes or modifiers stays its own line.
 */
export function mergeQuickLine<T extends MergeableLine>(basket: readonly T[], line: T): T[] {
  const target = basket.find(
    (b) => b.variantId === line.variantId && b.notes === '' && b.modifiers.length === 0,
  );
  if (target && line.notes === '' && line.modifiers.length === 0) {
    return basket.map((b) => (b.key === target.key ? { ...b, qty: b.qty + line.qty } : b));
  }
  return [...basket, line];
}
