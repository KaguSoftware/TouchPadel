import { addIqd, applyPctDiscountIqd, mulIqd, sumIqd } from '@touch/core';
import { subtreeModifierIds } from '@/lib/cafe/basket';
import { activeGroups, type MenuItem, type MenuModifierGroup } from '@/lib/menu';
import type { ChosenModifier } from './types';

/**
 * Modifier selection reducer for the item sheet — pure, so the sheet stays a
 * thin renderer and the rules are unit-testable.
 *
 * Selection is an ORDERED list of modifier ids (the UI never picks the same
 * modifier twice; `qty` is always 1 — `buildLine` accepts up to 9 but nothing
 * in the guest UI produces it).
 */
export type Selection = readonly string[];

export function isSelected(selection: Selection, modifierId: string): boolean {
  return selection.includes(modifierId);
}

/** How many distinct choices the selection holds inside `group`. */
export function groupCount(group: MenuModifierGroup, selection: Selection): number {
  const ids = new Set(group.modifiers.map((m) => m.id));
  return selection.filter((id) => ids.has(id)).length;
}

/** A group is satisfied when its distinct count sits inside [min, max]. */
export function groupSatisfied(group: MenuModifierGroup, selection: Selection): boolean {
  const n = groupCount(group, selection);
  return n >= group.min_select && n <= group.max_select;
}

/**
 * Drop `modifierId` and every pick inside the groups it reveals (and, for
 * safety, anything those reveal in turn — the DB caps reveals at depth 1).
 */
export function clearSubtree(
  item: Pick<MenuItem, 'modifierGroups'>,
  selection: Selection,
  modifierId: string,
): string[] {
  const doomed = new Set<string>([modifierId]);
  const queue = [modifierId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const child of subtreeModifierIds(item, id)) {
      if (doomed.has(child)) continue;
      doomed.add(child);
      queue.push(child);
    }
  }
  return selection.filter((id) => !doomed.has(id));
}

/**
 * Toggle one modifier:
 *  - selected → deselect it and clear everything its reveals exposed;
 *  - `max_select === 1` → radio: replace the sibling choice (clearing the old
 *    choice's revealed picks too);
 *  - otherwise → checkbox, ignored once the group is at its cap.
 */
export function toggleModifier(
  item: Pick<MenuItem, 'modifierGroups'>,
  group: MenuModifierGroup,
  modifierId: string,
  selection: Selection,
): string[] {
  if (isSelected(selection, modifierId)) return clearSubtree(item, selection, modifierId);

  const ids = new Set(group.modifiers.map((m) => m.id));
  const siblings = selection.filter((id) => ids.has(id));

  if (group.max_select === 1) {
    let next: string[] = [...selection];
    for (const sibling of siblings) next = clearSubtree(item, next, sibling);
    return [...next, modifierId];
  }
  if (siblings.length >= group.max_select) return [...selection];
  return [...selection, modifierId];
}

/** Selection → the `buildLine` payload (ids in pick order, qty 1). */
export function chosenModifiers(selection: Selection): ChosenModifier[] {
  return selection.map((modifierId) => ({ modifierId, qty: 1 }));
}

/** Σ price deltas of the selected modifiers that are still active. */
export function modifierDeltaTotal(item: MenuItem, selection: Selection): number {
  const active = activeGroups(item, selection);
  const byId = new Map(active.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)));
  return sumIqd(selection.map((id) => byId.get(id)?.price_delta_iqd ?? 0));
}

export interface PricePreview {
  /** list price × qty (no promo) */
  list: number;
  /** what the guest pays — mirrors `lineTotal` / app.add_order_items */
  total: number;
  /** promo percent applied to the variant base only */
  discountPct: number;
}

/**
 * Live price row for the CTA. Same integer maths as `lineTotal`: the featured
 * promo applies to the variant base only, modifiers are never discounted.
 */
export function pricePreview(
  item: MenuItem,
  variantId: string,
  selection: Selection,
  qty: number,
): PricePreview {
  const variant = item.variants.find((v) => v.id === variantId);
  const pct = item.discountPct ?? 0;
  if (!variant) return { list: 0, total: 0, discountPct: pct };
  const mods = modifierDeltaTotal(item, selection);
  return {
    list: mulIqd(addIqd(variant.price_iqd, mods), qty),
    total: mulIqd(addIqd(applyPctDiscountIqd(variant.price_iqd, pct), mods), qty),
    discountPct: pct,
  };
}
