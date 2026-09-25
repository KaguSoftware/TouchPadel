/**
 * The shopping list and the driver's purchases on the staff phone
 * (build-contracts-2026-09-23 §2.15, §2.24.9, §2.24.10; migrations 0166, 0185,
 * 0186). Every call passes `p_venue_id` where the RPC takes one (venue.ts);
 * the row-addressed writes find the venue from the row.
 *
 * Each query stores the RPC's result as it comes, so two screens that share a
 * `staffKeys` entry (Today's counts, this page) never disagree on its shape.
 */
import { staffRpc, type StaffRpcName } from '../api';
import type { ShoppingUnit } from './logic';

/**
 * Role-spec RPCs (lane J, 0185 and 0186) that STAFF_RPCS in ../api.ts, lane
 * B's list of everything the phone may call, does not name yet. Integration
 * appends them there; until then this is the one place the list is widened.
 */
type RoleSpecRpc = 'decide_shopping_item' | 'confirm_purchase_delivery';

function call<T>(fn: StaffRpcName | RoleSpecRpc, args: Record<string, unknown>): Promise<T> {
  return staffRpc<T>(fn as StaffRpcName, args);
}

/** shopping_items.status (0166, widened by 0185). */
export type ShoppingStatus =
  | 'open'
  | 'bought'
  | 'cancelled'
  | 'received'
  | 'acknowledged'
  | 'pending'
  | 'declined';

/** One line of `app.shopping_list`. No price: the list never carries one. */
export interface ShoppingItem {
  id: string;
  /** Set for a stock line; null for a line written as a label. */
  ingredient_id: string | null;
  name_en: string | null;
  name_ar: string | null;
  label: string | null;
  qty: number;
  unit: ShoppingUnit;
  note: string | null;
  requested_by_name: string | null;
  requested_at: string;
  status: ShoppingStatus;
  mine: boolean;
  decline_reason: string | null;
}

export interface ShoppingListPage {
  items: ShoppingItem[];
  open_count: number;
  /** The venue's lines waiting for the head chef; 0 for a driver. */
  pending_count: number;
}

/** The statuses the page reads; a write refreshes all three. */
export const SHOPPING_LIST_STATUSES = ['open', 'pending', 'declined'] as const;
export type ShoppingListStatus = (typeof SHOPPING_LIST_STATUSES)[number];

export function fetchShoppingList(
  venueId: string,
  status: ShoppingListStatus,
): Promise<ShoppingListPage> {
  return call<ShoppingListPage>('shopping_list', { p_venue_id: venueId, p_status: status });
}

/** One row of `app.staff_ingredient_options` (0162): names, base unit and pack size, never a cost. */
export interface IngredientOption {
  id: string;
  name_en: string;
  name_ar: string;
  unit: 'g' | 'ml' | 'pc';
  kind: string;
  pack_size: number | null;
}

export interface IngredientOptions {
  ingredients: IngredientOption[];
}

export function fetchIngredientOptions(venueId: string): Promise<IngredientOptions> {
  return call<IngredientOptions>('staff_ingredient_options', { p_venue_id: venueId });
}

/** `add_shopping_item`'s arguments, all but the key (logic.ts `shoppingArgs`). */
export interface AddShoppingArgs {
  p_venue_id: string;
  p_ingredient_id: string | null;
  p_label: string | null;
  p_qty: number;
  p_unit: ShoppingUnit;
  p_note: string | null;
}

export function addShoppingItem(args: AddShoppingArgs, key: string): Promise<{ id: string }> {
  return call<{ id: string }>('add_shopping_item', { ...args, p_idempotency_key: key });
}

/** The requester, or a manager: an open or waiting line comes off the list. */
export function cancelShoppingItem(id: string): Promise<void> {
  return call<void>('cancel_shopping_item', { p_id: id });
}

/** The head chef or a manager: OK a chef assistant's line (it goes to the driver) or decline it with a reason. */
export function decideShoppingItem(
  id: string,
  approve: boolean,
  reason: string | null,
): Promise<{ id: string; status: ShoppingStatus }> {
  return call('decide_shopping_item', { p_id: id, p_approve: approve, p_reason: reason });
}

// ── Purchases ──────────────────────────────────────────────────────────────

export interface PurchaseRowLine {
  label: string | null;
  name_en: string | null;
  name_ar: string | null;
  qty: number;
  unit: string | null;
  price_iqd: number;
  status: 'to_receive' | 'received' | 'acknowledged';
}

/** One purchase of `app.my_purchases`: the driver's own, or every one for a manager. */
export interface PurchaseRow {
  id: string;
  bought_at: string;
  shop_name: string | null;
  total_iqd: number;
  status: 'to_receive' | 'done';
  /** The buyer's own receipt, readable to them as its uploader (0186). */
  receipt_path: string | null;
  delivered_at: string | null;
  lines: PurchaseRowLine[];
}

export interface MyPurchases {
  purchases: PurchaseRow[];
}

export function fetchMyPurchases(venueId: string): Promise<MyPurchases> {
  return call<MyPurchases>('my_purchases', { p_venue_id: venueId, p_limit: 30 });
}

/** One element of `record_purchase`'s `p_lines`. */
export type PurchaseLineArg =
  | { shopping_item_id: string; qty: number; price_iqd: number }
  | { label: string; qty: number; price_iqd: number };

/** `record_purchase`'s arguments, all but the key (logic.ts `purchaseArgs`). */
export interface RecordPurchaseArgs {
  p_venue_id: string;
  p_lines: PurchaseLineArg[];
  p_total_iqd: number;
  p_shop: string | null;
  p_receipt_path: string | null;
}

export function recordPurchase(
  args: RecordPurchaseArgs,
  key: string,
): Promise<{ purchase_id: string }> {
  return call<{ purchase_id: string }>('record_purchase', { ...args, p_idempotency_key: key });
}

/**
 * "Delivered": the buyer (or a manager) confirms the goods are at the venue.
 * State-idempotent, so it takes no key: a repeat returns the first confirmation.
 */
export function confirmPurchaseDelivery(
  purchaseId: string,
): Promise<{ purchase_id: string; delivered_at: string; delivered_by_name: string | null }> {
  return call('confirm_purchase_delivery', { p_purchase_id: purchaseId });
}
