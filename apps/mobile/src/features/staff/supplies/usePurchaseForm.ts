/**
 * What the purchase form's three pages share (build-contracts-2026-09-23 §6.1,
 * §2.24.10; plan #70): the queries, the lines and the shop, read from the draft
 * (`purchaseDraft.ts`) and the shopping list.
 *
 * The ticked lines (`?itemIds=`) fill the form once the list and the pack sizes
 * are in. Until the driver changes something the form follows the list (a line
 * bought meanwhile drops out and counts as gone); after that it is the driver's
 * own, and a refresh never puts back a line they removed. The form always has
 * at least one item: the ticked lines, or a blank new one.
 */
import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useStaffStatus } from '../StaffStatusProvider';
import { staffKeys } from '../keys';
import {
  fetchIngredientOptions,
  fetchMyPurchases,
  fetchShoppingList,
  type IngredientOption,
  type ShoppingItem,
} from './api';
import {
  boughtUnit,
  emptyFreeLine,
  listLineFor,
  missingItemIds,
  parseItemIds,
  recentShops,
  type PurchaseLineDraft,
} from './logic';
import { patchPurchaseDraft, usePurchaseDraft } from './purchaseDraft';

export function usePurchaseForm() {
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ itemIds?: string }>();
  const draft = usePurchaseDraft();

  const role = status.kind === 'staff' ? status.staff.role : null;
  const buyer = role === 'driver';
  const venue = venueId ?? '';
  const itemIds = useMemo(() => parseItemIds(params.itemIds), [params.itemIds]);

  const open = useQuery({
    queryKey: staffKeys.shopping(venue, 'open'),
    queryFn: () => fetchShoppingList(venue, 'open'),
    enabled: venue !== '' && buyer,
  });
  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venue),
    queryFn: () => fetchIngredientOptions(venue),
    enabled: venue !== '' && buyer,
  });
  const purchases = useQuery({
    queryKey: staffKeys.purchases(venue),
    queryFn: () => fetchMyPurchases(venue),
    enabled: venue !== '',
  });

  const ingredientById = useMemo(() => {
    const map = new Map<string, IngredientOption>();
    for (const o of ingredients.data?.ingredients ?? []) map.set(o.id, o);
    return map;
  }, [ingredients.data]);
  const itemById = useMemo(() => {
    const map = new Map<string, ShoppingItem>();
    for (const i of open.data?.items ?? []) map.set(i.id, i);
    return map;
  }, [open.data]);
  const openItems = useMemo(() => open.data?.items ?? [], [open.data]);

  const ready = open.data !== undefined && (ingredients.data !== undefined || ingredients.isError);
  const seeded = itemIds.length === 0 || ready;
  const initial = useMemo<PurchaseLineDraft[]>(() => {
    const ticked = ready
      ? itemIds
          .map((id) => itemById.get(id))
          .filter((i): i is ShoppingItem => i !== undefined)
          .map((i) =>
            listLineFor(i, i.ingredient_id ? ingredientById.get(i.ingredient_id) : undefined),
          )
      : [];
    return ticked.length === 0 && (itemIds.length === 0 || ready) ? [emptyFreeLine()] : ticked;
  }, [ready, itemIds, itemById, ingredientById]);
  const lines = draft.edited ?? initial;
  const setLines = (next: (all: PurchaseLineDraft[]) => PurchaseLineDraft[]) =>
    patchPurchaseDraft({ edited: next(lines) });
  const gone = ready ? missingItemIds(itemIds, openItems).length : 0;

  // The shop is the one the driver named last time until they type another
  // (Sait, 2026-10-17: fill in what the app already knows).
  const shops = useMemo(() => recentShops(purchases.data?.purchases ?? []), [purchases.data]);
  const shop = draft.shopTyped ?? shops[0] ?? '';

  /** The unit a line's amount is typed in, which decides whether its price is each or a total. */
  const unitOf = (line: PurchaseLineDraft) => {
    if (line.kind !== 'list') return null;
    const item = itemById.get(line.itemId);
    return item
      ? boughtUnit(item, item.ingredient_id ? ingredientById.get(item.ingredient_id) : undefined)
          .unit
      : null;
  };

  return {
    status,
    buyer,
    venue,
    itemIds,
    itemById,
    ingredientById,
    seeded,
    gone,
    lines,
    setLines,
    unitOf,
    shop,
    shops,
    receipt: draft.receipt,
  };
}
