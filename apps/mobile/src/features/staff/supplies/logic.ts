/**
 * The shopping list and the driver's run, as rules the screens read
 * (build-contracts-2026-09-23 §6.1, §2.15, §2.24.9, §2.24.10; plan #26, #66,
 * #70): who sees which part of the page, the add form, the run's ticks and the
 * purchase form. The server stays the wall; these only shape the page and
 * catch a bad field before the round trip, with the server's own caps.
 *
 * PURE (vitest): no react-native, no client.
 */
import { westernDigits, type StaffRole } from '@touch/core';
import { formatNumber, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import type {
  AddShoppingArgs,
  IngredientOption,
  PurchaseLineArg,
  RecordPurchaseArgs,
  ShoppingItem,
} from './api';

/** The roles `shopping_list` answers (0185): the bar and kitchen family, the driver, MGMT. */
export const SHOPPING_ROLES: readonly StaffRole[] = [
  'head_barista',
  'barista',
  'head_chef',
  'chef',
  'driver',
  'manager',
  'owner',
];

/** The roles `my_purchases` and `record_purchase` answer (0166, 0186). */
export const PURCHASE_ROLES: readonly StaffRole[] = ['driver', 'manager', 'owner'];

/** shopping_items.unit (0166): the base units plus packs. */
export type ShoppingUnit = 'g' | 'ml' | 'pc' | 'pack';
export const SHOPPING_UNITS: readonly ShoppingUnit[] = ['g', 'ml', 'pc', 'pack'];

/** Server caps (0166, 0185, §2.1). */
export const CAPS = {
  label: 80,
  note: 200,
  shop: 80,
  declineReason: 300,
  purchaseLines: 40,
  /** numeric(12,3): refused at or above this. */
  qtyBelow: 1_000_000_000,
  /** The `iqd` domain's ceiling on a line price (0166 record_purchase). */
  priceMax: 9_000_000_000_000_000,
} as const;

/** What one role sees and does on the shopping page. */
export interface ShoppingView {
  /** Adds to the list (`add_shopping_item`): the heads, the chef assistant, MGMT. */
  canAdd: boolean;
  /** The chef assistant's line waits for the head chef's OK before any driver sees it (#66). */
  addWaitsForOk: boolean;
  /** OKs or declines the chef assistant's lines (`decide_shopping_item`): the head chef, MGMT. */
  canDecide: boolean;
  /** The driver's run: the open list as a checklist, then a purchase per shop (#70). */
  runChecklist: boolean;
  /** Takes anyone's line off the list; everyone else only their own (`cancel_shopping_item`). */
  cancelsAny: boolean;
}

const NOTHING: ShoppingView = {
  canAdd: false,
  addWaitsForOk: false,
  canDecide: false,
  runChecklist: false,
  cancelsAny: false,
};

export function shoppingView(role: StaffRole): ShoppingView {
  switch (role) {
    case 'head_barista':
      return { ...NOTHING, canAdd: true };
    case 'head_chef':
      return { ...NOTHING, canAdd: true, canDecide: true };
    case 'chef':
      return { ...NOTHING, canAdd: true, addWaitsForOk: true };
    case 'driver':
      return { ...NOTHING, runChecklist: true };
    case 'manager':
    case 'owner':
      return { ...NOTHING, canAdd: true, canDecide: true, cancelsAny: true };
    default:
      // The barista reads the list and adds nothing (PROPOSAL, §2.24.9).
      return NOTHING;
  }
}

/** The line lists the page asks for, by view: a driver is never sent a waiting or declined line. */
export function shoppingStatusesFor(view: ShoppingView): ('open' | 'pending' | 'declined')[] {
  const out: ('open' | 'pending' | 'declined')[] = ['open'];
  if (view.canDecide || view.addWaitsForOk) out.push('pending');
  if (view.addWaitsForOk) out.push('declined');
  return out;
}

/** Whether the viewer may take this line off the list. */
export function canCancel(view: ShoppingView, item: ShoppingItem): boolean {
  if (item.status !== 'open' && item.status !== 'pending') return false;
  return item.mine || view.cancelsAny;
}

/** How many of the chef assistant's declined lines stay on their page. */
export const DECLINED_SHOWN = 5;

// ── Showing a line ─────────────────────────────────────────────────────────

type Translate = (key: MessageKey, params?: TParams) => string;

function isShoppingUnit(unit: string | null): unit is ShoppingUnit {
  return unit !== null && (SHOPPING_UNITS as readonly string[]).includes(unit);
}

/** "2 packs", "500 g": the unit word follows the quantity; an unknown unit shows the number alone. */
export function formatQty(t: Translate, locale: Locale, qty: number, unit: string | null): string {
  const n = formatNumber(qty, locale);
  if (!isShoppingUnit(unit)) return n;
  return t('staff.supplies.qtyUnit', {
    qty: n,
    unit: t(qty === 1 ? `staff.supplies.units.one.${unit}` : `staff.supplies.units.many.${unit}`),
  });
}

/** A line's name: its stock item in the reader's language (the other if one is missing), or the label as typed. */
export function lineName(
  line: { name_en: string | null; name_ar: string | null; label: string | null },
  locale: Locale,
): string {
  const stock = locale === 'ar' ? (line.name_ar ?? line.name_en) : (line.name_en ?? line.name_ar);
  return stock ?? line.label ?? '';
}

// ── Numbers as typed ────────────────────────────────────────────────────────

/**
 * A typed quantity, or null: above 0, at most three decimals, below the
 * column's ceiling. Arabic-Indic digits and the Arabic decimal separator are
 * read as their Western forms, so an Arabic keyboard types a quantity too.
 */
export function parseTypedQty(text: string): number | null {
  const s = westernDigits(text).trim().replace(/[٫,]/g, '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s) && !/^\.\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < CAPS.qtyBelow ? n : null;
}

/** A typed whole IQD amount, 0 included (a free extra), thousands separators allowed; or null. */
export function parseTypedIqd(text: string): number | null {
  const s = westernDigits(text).trim().replace(/[,\s٬]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= CAPS.priceMax ? n : null;
}

/** A quantity for an input: at most three decimals, no trailing zeros. */
export function qtyText(n: number): string {
  return String(Number(n.toFixed(3)));
}

// ── Adding to the list ──────────────────────────────────────────────────────

export interface ShoppingDraft {
  /** A picked stock ingredient, or null for a line written as a label. */
  ingredientId: string | null;
  label: string;
  qty: string;
  unit: ShoppingUnit | null;
  note: string;
}

export type ShoppingField = 'item' | 'label' | 'qty' | 'unit' | 'note';
export type IssueCode = 'required' | 'invalid' | 'tooLong';
export interface ShoppingIssue {
  field: ShoppingField;
  code: IssueCode;
}

export function emptyShoppingDraft(): ShoppingDraft {
  return { ingredientId: null, label: '', qty: '', unit: null, note: '' };
}

/**
 * The units a line may be in (the server's rule, 0166): a stock line in its
 * ingredient's base unit or in packs, a label line in any of the four. Packs
 * are offered for a stock line only when the ingredient has a pack size, so
 * the driver can turn packs into the base unit a purchase is recorded in.
 */
export function unitsFor(ingredient: IngredientOption | null): ShoppingUnit[] {
  if (!ingredient) return [...SHOPPING_UNITS];
  return ingredient.pack_size ? [ingredient.unit, 'pack'] : [ingredient.unit];
}

/** A picked ingredient with the draft's unit made valid for it (its base unit unless still allowed). */
export function pickIngredient(draft: ShoppingDraft, ingredient: IngredientOption | null): ShoppingDraft {
  const units = unitsFor(ingredient);
  const unit = draft.unit && units.includes(draft.unit) ? draft.unit : (units[0] ?? null);
  return { ...draft, ingredientId: ingredient?.id ?? null, unit: ingredient ? unit : draft.unit };
}

export function validateShoppingDraft(
  draft: ShoppingDraft,
  ingredient: IngredientOption | null,
): ShoppingIssue[] {
  const issues: ShoppingIssue[] = [];
  const label = draft.label.trim();
  if (!ingredient) {
    if (!label) issues.push({ field: 'label', code: 'required' });
    else if (label.length > CAPS.label) issues.push({ field: 'label', code: 'tooLong' });
  }
  if (!draft.qty.trim()) issues.push({ field: 'qty', code: 'required' });
  else if (parseTypedQty(draft.qty) === null) issues.push({ field: 'qty', code: 'invalid' });
  if (!draft.unit) issues.push({ field: 'unit', code: 'required' });
  else if (!unitsFor(ingredient).includes(draft.unit)) issues.push({ field: 'unit', code: 'invalid' });
  if (draft.note.trim().length > CAPS.note) issues.push({ field: 'note', code: 'tooLong' });
  return issues;
}

/** `add_shopping_item`'s arguments for a draft that validated. */
export function shoppingArgs(
  draft: ShoppingDraft,
  ingredient: IngredientOption | null,
  venueId: string,
): AddShoppingArgs {
  return {
    p_venue_id: venueId,
    p_ingredient_id: ingredient?.id ?? null,
    p_label: ingredient ? null : draft.label.trim(),
    p_qty: parseTypedQty(draft.qty) ?? 0,
    p_unit: draft.unit ?? 'pc',
    p_note: draft.note.trim() || null,
  };
}

/**
 * The ingredients whose name holds the typed text, in either language, first
 * `limit` of them. Nothing until something is typed: a list of two hundred is
 * not a picker.
 */
export function matchIngredients(
  options: readonly IngredientOption[],
  query: string,
  limit = 8,
): IngredientOption[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return options
    .filter((o) => o.name_en.toLocaleLowerCase().includes(q) || o.name_ar.includes(query.trim()))
    .slice(0, limit);
}

/**
 * The intent an idempotency key is memoised under: the write and exactly what
 * it sends. A retry of the same form reuses its key; a changed form is a new
 * intent with a new key, so an unseen first save can never swallow a
 * different second one.
 */
export function intentFor(write: string, args: unknown): string {
  return `${write}:${JSON.stringify(args)}`;
}

// ── The driver's run ────────────────────────────────────────────────────────

/** The ticks of lines still on the open list: a line recorded as bought leaves it, and its tick with it. */
export function pruneTicks(ticked: ReadonlySet<string>, openIds: readonly string[]): Set<string> {
  const open = new Set(openIds);
  return new Set([...ticked].filter((id) => open.has(id)));
}

/** Flip one tick. */
export function toggleTick(ticked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ticked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The purchase page's `itemIds` param: the ticked lines, in list order, once each, at most 40. */
export function parseItemIds(param: string | string[] | undefined): string[] {
  const raw = Array.isArray(param) ? param.join(',') : (param ?? '');
  const out: string[] = [];
  for (const id of raw.split(',').map((s) => s.trim())) {
    if (UUID.test(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, CAPS.purchaseLines);
}

/** The ticked lines in the order the list shows them. */
export function tickedInOrder(items: readonly ShoppingItem[], ticked: ReadonlySet<string>): string[] {
  return items.filter((i) => ticked.has(i.id)).map((i) => i.id);
}

// ── The purchase form ───────────────────────────────────────────────────────

/** A line from the shopping list: the item is named by the list, so only quantity and price are typed. */
export interface ListLineDraft {
  kind: 'list';
  itemId: string;
  qty: string;
  price: string;
}

/** Something bought that was not on the list: a label line, which Goods in checks rather than stocks. */
export interface FreeLineDraft {
  kind: 'free';
  label: string;
  qty: string;
  price: string;
}

export type PurchaseLineDraft = ListLineDraft | FreeLineDraft;

export interface PurchaseDraft {
  lines: PurchaseLineDraft[];
  shop: string;
}

/**
 * The unit a list line's bought quantity is typed in, and how much the list
 * asked for in it. A stock line's purchase is recorded in the ingredient's
 * base unit (0166: `receive_purchase` costs it per base unit), so a line the
 * list asked for in packs is converted by the pack size; a label line keeps
 * the list's own unit. `qty` is null when a pack line's size is unknown, and
 * the driver types the base amount.
 */
export function boughtUnit(
  item: ShoppingItem,
  ingredient: IngredientOption | undefined,
): { unit: ShoppingUnit | null; qty: number | null } {
  if (!item.ingredient_id) return { unit: item.unit, qty: item.qty };
  if (item.unit !== 'pack') return { unit: item.unit, qty: item.qty };
  if (!ingredient) return { unit: null, qty: null };
  return {
    unit: ingredient.unit,
    qty: ingredient.pack_size ? item.qty * ingredient.pack_size : null,
  };
}

/** A list line prefilled with what the list asked for. */
export function listLineFor(item: ShoppingItem, ingredient: IngredientOption | undefined): ListLineDraft {
  const { qty } = boughtUnit(item, ingredient);
  return { kind: 'list', itemId: item.id, qty: qty === null ? '' : qtyText(qty), price: '' };
}

export function emptyFreeLine(): FreeLineDraft {
  return { kind: 'free', label: '', qty: '1', price: '' };
}

export type PurchaseField = 'lines' | 'shop' | 'label' | 'qty' | 'price';
export interface PurchaseIssue {
  field: PurchaseField;
  code: IssueCode;
  /** The line's index, for a line field. */
  line?: number;
}

export function validatePurchase(draft: PurchaseDraft): PurchaseIssue[] {
  const issues: PurchaseIssue[] = [];
  if (draft.lines.length === 0) issues.push({ field: 'lines', code: 'required' });
  if (draft.lines.length > CAPS.purchaseLines) issues.push({ field: 'lines', code: 'tooLong' });
  draft.lines.forEach((line, i) => {
    if (line.kind === 'free') {
      const label = line.label.trim();
      if (!label) issues.push({ field: 'label', code: 'required', line: i });
      else if (label.length > CAPS.label) issues.push({ field: 'label', code: 'tooLong', line: i });
    }
    if (!line.qty.trim()) issues.push({ field: 'qty', code: 'required', line: i });
    else if (parseTypedQty(line.qty) === null) issues.push({ field: 'qty', code: 'invalid', line: i });
    if (!line.price.trim()) issues.push({ field: 'price', code: 'required', line: i });
    else if (parseTypedIqd(line.price) === null) issues.push({ field: 'price', code: 'invalid', line: i });
  });
  if (draft.shop.trim().length > CAPS.shop) issues.push({ field: 'shop', code: 'tooLong' });
  return issues;
}

/** What the lines add up to, counting only prices typed properly (the total shown while typing). */
export function purchaseTotal(lines: readonly PurchaseLineDraft[]): number {
  return lines.reduce((sum, line) => sum + (parseTypedIqd(line.price) ?? 0), 0);
}

/**
 * `record_purchase`'s arguments for a draft that validated. The total paid is
 * the lines' sum: the receipt photo is the record of what the shop charged.
 */
export function purchaseArgs(
  draft: PurchaseDraft,
  venueId: string,
  receiptPath: string | null,
): RecordPurchaseArgs {
  const lines: PurchaseLineArg[] = draft.lines.map((line) => {
    const qty = parseTypedQty(line.qty) ?? 0;
    const price_iqd = parseTypedIqd(line.price) ?? 0;
    return line.kind === 'list'
      ? { shopping_item_id: line.itemId, qty, price_iqd }
      : { label: line.label.trim(), qty, price_iqd };
  });
  return {
    p_venue_id: venueId,
    p_lines: lines,
    p_total_iqd: purchaseTotal(draft.lines),
    p_shop: draft.shop.trim() || null,
    p_receipt_path: receiptPath,
  };
}

/** The ids asked for that are no longer open: bought by another run, cancelled, or never there. */
export function missingItemIds(ids: readonly string[], open: readonly ShoppingItem[]): string[] {
  const openIds = new Set(open.map((i) => i.id));
  return ids.filter((id) => !openIds.has(id));
}
