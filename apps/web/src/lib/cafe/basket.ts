import { addIqd, applyPctDiscountIqd, mulIqd, sumIqd } from '@touch/core';
import {
  activeGroups,
  featuredDiscountPct,
  itemsById,
  type CafeSettings,
  type MenuCategory,
  type MenuItem,
  type MenuModifierGroup,
} from '../menu';

export { activeGroups };

/**
 * Guest basket — CLIENT STATE ONLY. Drafts never hit the server (0015 folds
 * send into order creation); prices here are display-only previews mirrored
 * from the menu read model. The server re-snapshots every price at send time
 * (app.add_order_items, 0030) — nothing in this file is trusted.
 */

export interface BasketModifier {
  modifierId: string;
  qty: number;
  /** display snapshot */
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
}

export interface BasketLine {
  /** stable client key for list rendering / removal */
  key: string;
  itemId: string;
  variantId: string;
  qty: number;
  notes: string | null;
  modifiers: BasketModifier[];
  /** display snapshots */
  item_name_en: string;
  item_name_ar: string;
  variant_name_en: string;
  variant_name_ar: string;
  /** variant list price before any promo (order_items.list_price_iqd) */
  list_unit_price_iqd: number;
  /** featured promo percent at snapshot time (0 = none) */
  discount_pct: number;
  /** discounted unit price = applyPctDiscountIqd(list, pct) (order_items.unit_price_iqd) */
  unit_price_iqd: number;
}

/** Discounted unit price — the same integer the server stamps (0030 formula). */
export function discountedUnit(line: Pick<BasketLine, 'list_unit_price_iqd' | 'discount_pct'>) {
  return applyPctDiscountIqd(line.list_unit_price_iqd, line.discount_pct);
}

function modifierDeltas(line: Pick<BasketLine, 'modifiers'>): number {
  return sumIqd(line.modifiers.map((m) => mulIqd(m.price_delta_iqd, m.qty)));
}

/**
 * (discounted unit + Σ modifier deltas × mqty) × qty — mirrors app.add_order_items
 * exactly: the promo applies to the variant base price only; modifiers are never
 * discounted.
 */
export function lineTotal(line: BasketLine): number {
  return mulIqd(addIqd(discountedUnit(line), modifierDeltas(line)), line.qty);
}

/** The same line at list price (no promo). */
export function lineListTotal(line: BasketLine): number {
  return mulIqd(addIqd(line.list_unit_price_iqd, modifierDeltas(line)), line.qty);
}

/** Undiscounted subtotal (what the guest would pay without the promo). */
export function basketSubtotal(lines: readonly BasketLine[]): number {
  return sumIqd(lines.map(lineListTotal));
}

/** Total promo effect across the basket (subtotal − total). */
export function basketDiscountTotal(lines: readonly BasketLine[]): number {
  return sumIqd(lines.map((l) => lineListTotal(l) - lineTotal(l)));
}

export function basketTotal(lines: readonly BasketLine[]): number {
  return sumIqd(lines.map(lineTotal));
}

export function basketCount(lines: readonly BasketLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

/**
 * Per-group min/max check over the groups passed in (callers pass
 * `activeGroups(item, chosen)` so hidden required groups are ignored until
 * revealed). Distinct choices count — a doubled modifier is one choice,
 * matching the SQL. Returns the first violated group or null.
 */
export function violatedGroup(
  groups: readonly MenuModifierGroup[],
  chosen: readonly { modifierId: string }[],
): MenuModifierGroup | null {
  for (const group of groups) {
    const ids = new Set(group.modifiers.map((m) => m.id));
    const count = new Set(chosen.filter((c) => ids.has(c.modifierId)).map((c) => c.modifierId))
      .size;
    if (count < group.min_select || count > group.max_select) return group;
  }
  return null;
}

/**
 * Ids of every modifier inside the groups revealed by `modifierId` (depth 1) —
 * the sheet clears these picks when the parent modifier is deselected.
 */
export function subtreeModifierIds(
  item: Pick<MenuItem, 'modifierGroups'>,
  modifierId: string,
): string[] {
  for (const g of item.modifierGroups) {
    const mod = g.modifiers.find((m) => m.id === modifierId);
    if (mod) return mod.reveals.flatMap((rg) => rg.modifiers.map((m) => m.id));
  }
  return [];
}

function newKey(itemId: string, variantId: string): string {
  return `${itemId}:${variantId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a basket line from a menu item + selections. Throws on unknown ids,
 * bad quantities, and modifiers outside the ACTIVE set (a pick from a group
 * that is not linked and not revealed by another pick — the server would
 * answer MODIFIER_INVALID).
 */
export function buildLine(
  item: MenuItem,
  variantId: string,
  qty: number,
  modifiers: readonly { modifierId: string; qty: number }[],
  notes: string | null,
): BasketLine {
  const variant = item.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`variant ${variantId} not on item ${item.id}`);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error(`invalid qty ${qty}`);

  const active = activeGroups(
    item,
    modifiers.map((m) => m.modifierId),
  );
  const allMods = new Map(active.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)));
  const lineMods: BasketModifier[] = modifiers.map(({ modifierId, qty: mqty }) => {
    const mod = allMods.get(modifierId);
    if (!mod) throw new Error(`modifier ${modifierId} not active on item ${item.id}`);
    if (!Number.isInteger(mqty) || mqty < 1 || mqty > 9) throw new Error(`invalid mod qty ${mqty}`);
    return {
      modifierId,
      qty: mqty,
      name_en: mod.name_en,
      name_ar: mod.name_ar,
      price_delta_iqd: mod.price_delta_iqd,
    };
  });

  const pct = item.discountPct ?? 0;
  return {
    key: newKey(item.id, variantId),
    itemId: item.id,
    variantId,
    qty,
    notes: notes && notes.trim() !== '' ? notes.trim() : null,
    modifiers: lineMods,
    item_name_en: item.name_en,
    item_name_ar: item.name_ar,
    variant_name_en: variant.name_en,
    variant_name_ar: variant.name_ar,
    list_unit_price_iqd: variant.price_iqd,
    discount_pct: pct,
    unit_price_iqd: applyPctDiscountIqd(variant.price_iqd, pct),
  };
}

/** p_items payload for app.create_guest_order (0015) — ids and quantities only, NO prices. */
export function toOrderPayload(lines: readonly BasketLine[]): unknown[] {
  return lines.map((l) => ({
    variant_id: l.variantId,
    qty: l.qty,
    ...(l.notes ? { notes: l.notes } : {}),
    modifiers: l.modifiers.map((m) => ({ modifier_id: m.modifierId, qty: m.qty })),
  }));
}

// ---------------------------------------------------------------------------
// Reconcile against a fresh menu (after a broadcast refresh or an RPC refusal)
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  lines: BasketLine[];
  /** keys of lines dropped: item gone / not orderable / variant or modifier vanished */
  removed: string[];
  /** keys of lines whose total changed after re-snapshotting prices/discount */
  repriced: string[];
}

/**
 * Drop lines the server would refuse and re-snapshot every price + discount
 * from the current menu (server wins). Names are refreshed too. Pure.
 */
export function reconcile(
  lines: readonly BasketLine[],
  menu: readonly MenuCategory[],
  settings?: CafeSettings,
): ReconcileResult {
  const items = itemsById(menu);
  const out: BasketLine[] = [];
  const removed: string[] = [];
  const repriced: string[] = [];

  for (const line of lines) {
    const item = items.get(line.itemId);
    const variant = item?.variants.find((v) => v.id === line.variantId);
    if (!item || !variant || !item.orderable || item.sold_out) {
      removed.push(line.key);
      continue;
    }
    const active = activeGroups(
      item,
      line.modifiers.map((m) => m.modifierId),
    );
    const mods = new Map(active.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)));
    if (line.modifiers.some((m) => !mods.has(m.modifierId))) {
      removed.push(line.key);
      continue;
    }
    const pct = settings ? featuredDiscountPct(item.id, settings) : (item.discountPct ?? 0);
    const next: BasketLine = {
      ...line,
      item_name_en: item.name_en,
      item_name_ar: item.name_ar,
      variant_name_en: variant.name_en,
      variant_name_ar: variant.name_ar,
      modifiers: line.modifiers.map((m) => {
        const mod = mods.get(m.modifierId)!;
        return {
          ...m,
          name_en: mod.name_en,
          name_ar: mod.name_ar,
          price_delta_iqd: mod.price_delta_iqd,
        };
      }),
      list_unit_price_iqd: variant.price_iqd,
      discount_pct: pct,
      unit_price_iqd: applyPctDiscountIqd(variant.price_iqd, pct),
    };
    if (lineTotal(next) !== lineTotal(line)) repriced.push(line.key);
    out.push(next);
  }
  return { lines: out, removed, repriced };
}

// ---------------------------------------------------------------------------
// localStorage draft persistence (per table, or 'walkin' before a QR bind)
// ---------------------------------------------------------------------------

const DRAFT_KEY_PREFIX = 'tp-basket-';
const DRAFT_VERSION = 2 as const;

export interface BasketDraft {
  lines: BasketLine[];
  /** order-level note for the waiter (≤ 200 chars) */
  note: string;
  /** idempotency key for the in-flight/next submit attempt; null until first send */
  idemKey: string | null;
}

export const EMPTY_DRAFT: Readonly<BasketDraft> = Object.freeze({
  lines: [],
  note: '',
  idemKey: null,
});

export function draftStorageKey(tableId: string | null | undefined): string {
  return DRAFT_KEY_PREFIX + (tableId ?? 'walkin');
}

function isLineLike(l: unknown): l is Record<string, unknown> {
  return (
    typeof l === 'object' &&
    l !== null &&
    typeof (l as BasketLine).variantId === 'string' &&
    typeof (l as BasketLine).itemId === 'string' &&
    Number.isInteger((l as BasketLine).qty) &&
    Array.isArray((l as BasketLine).modifiers)
  );
}

/** Accept a v1 line (no list/discount fields) or a v2 line; normalise to v2. */
function normaliseLine(raw: unknown): BasketLine | null {
  if (!isLineLike(raw)) return null;
  const l = raw as unknown as Partial<BasketLine> & { itemId: string; variantId: string; qty: number };
  const unit = typeof l.unit_price_iqd === 'number' ? l.unit_price_iqd : 0;
  const list = typeof l.list_unit_price_iqd === 'number' ? l.list_unit_price_iqd : unit;
  const pct =
    typeof l.discount_pct === 'number' && Number.isInteger(l.discount_pct) && l.discount_pct >= 0
      ? Math.min(l.discount_pct, 99)
      : 0;
  return {
    key: typeof l.key === 'string' ? l.key : newKey(l.itemId, l.variantId),
    itemId: l.itemId,
    variantId: l.variantId,
    qty: l.qty,
    notes: typeof l.notes === 'string' ? l.notes : null,
    modifiers: (l.modifiers ?? []).filter(
      (m): m is BasketModifier =>
        typeof m === 'object' &&
        m !== null &&
        typeof m.modifierId === 'string' &&
        Number.isInteger(m.qty),
    ),
    item_name_en: l.item_name_en ?? '',
    item_name_ar: l.item_name_ar ?? '',
    variant_name_en: l.variant_name_en ?? '',
    variant_name_ar: l.variant_name_ar ?? '',
    list_unit_price_iqd: list,
    discount_pct: pct,
    unit_price_iqd: applyPctDiscountIqd(list, pct),
  };
}

/** Pure parser (exported for tests): v1 `BasketLine[]` or v2 `{v:2,...}` → draft. */
export function parseDraft(raw: string | null | undefined): BasketDraft {
  if (!raw) return { ...EMPTY_DRAFT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_DRAFT };
  }
  const toLines = (arr: unknown): BasketLine[] =>
    Array.isArray(arr) ? arr.map(normaliseLine).filter((l): l is BasketLine => l !== null) : [];

  if (Array.isArray(parsed)) return { lines: toLines(parsed), note: '', idemKey: null }; // v1
  if (typeof parsed === 'object' && parsed !== null && (parsed as { v?: unknown }).v === 2) {
    const d = parsed as { lines?: unknown; note?: unknown; idemKey?: unknown };
    return {
      lines: toLines(d.lines),
      note: typeof d.note === 'string' ? d.note.slice(0, 200) : '',
      idemKey: typeof d.idemKey === 'string' && d.idemKey !== '' ? d.idemKey : null,
    };
  }
  return { ...EMPTY_DRAFT };
}

export function loadDraft(tableId: string | null | undefined): BasketDraft {
  try {
    return parseDraft(window.localStorage.getItem(draftStorageKey(tableId)));
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function saveDraft(tableId: string | null | undefined, draft: BasketDraft): void {
  try {
    const key = draftStorageKey(tableId);
    if (draft.lines.length === 0 && draft.note === '' && !draft.idemKey) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(
        key,
        JSON.stringify({ v: DRAFT_VERSION, lines: draft.lines, note: draft.note, idemKey: draft.idemKey }),
      );
    }
  } catch {
    // storage unavailable (private mode) — the draft just doesn't persist
  }
}

export function clearDraft(tableId: string | null | undefined): void {
  try {
    window.localStorage.removeItem(draftStorageKey(tableId));
  } catch {
    // ignore
  }
}

/**
 * On QR bind, fold the walk-in draft into the table draft: table lines first,
 * walk-in lines appended (deduped by key); the table's note/idemKey win when set.
 */
export function mergeDrafts(walkin: BasketDraft, table: BasketDraft): BasketDraft {
  const seen = new Set(table.lines.map((l) => l.key));
  return {
    lines: [...table.lines, ...walkin.lines.filter((l) => !seen.has(l.key))],
    note: table.note !== '' ? table.note : walkin.note,
    idemKey: table.idemKey ?? walkin.idemKey,
  };
}

/**
 * Fresh idempotency SALT. Combined with a basket fingerprint (below) to form
 * the key actually sent, so that retrying the same basket replays while a
 * changed basket is a genuinely new order.
 */
export function newIdemKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Deterministic fingerprint of everything that would actually be SENT for this
 * basket — ids and quantities, never display snapshots or prices (the server
 * re-snapshots those). Order-insensitive, so reordering the same lines is the
 * same basket.
 */
export function basketFingerprint(lines: readonly BasketLine[], note: string): string {
  const norm = lines
    .map((l) =>
      [
        l.variantId,
        l.qty,
        l.notes?.trim() ?? '',
        l.modifiers
          .map((m) => `${m.modifierId}x${m.qty}`)
          .sort()
          .join(','),
      ].join('|'),
    )
    .sort();
  return `${norm.join(';')}#${note.trim()}`;
}

/**
 * 32-bit FNV-1a, base36. Not cryptographic and not meant to be — it only has
 * to change when the basket changes, within one guest's own key namespace.
 */
export function fingerprintHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
