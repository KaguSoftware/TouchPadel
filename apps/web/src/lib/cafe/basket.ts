import { addIqd, mulIqd, sumIqd } from '@touch/core';
import type { MenuItem, MenuModifierGroup } from '../menu';

/**
 * Guest basket — CLIENT STATE ONLY. Drafts never hit the server (0015 folds
 * send into order creation); prices here are display-only previews mirrored
 * from the menu read model. The server re-snapshots every price at send time
 * (app.add_order_items) — nothing in this file is trusted.
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
  unit_price_iqd: number;
}

/** (unit + Σ modifier deltas × mqty) × qty — mirrors app.add_order_items exactly. */
export function lineTotal(line: BasketLine): number {
  const mods = sumIqd(line.modifiers.map((m) => mulIqd(m.price_delta_iqd, m.qty)));
  return mulIqd(addIqd(line.unit_price_iqd, mods), line.qty);
}

export function basketTotal(lines: readonly BasketLine[]): number {
  return sumIqd(lines.map(lineTotal));
}

export function basketCount(lines: readonly BasketLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

/**
 * Per-group min/max check (distinct choices count — a doubled modifier is one
 * choice, matching the SQL). Returns the first violated group or null.
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

/** Build a basket line from a menu item + selections (throws on unknown ids). */
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

  const allMods = new Map(item.modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m])));
  const lineMods: BasketModifier[] = modifiers.map(({ modifierId, qty: mqty }) => {
    const mod = allMods.get(modifierId);
    if (!mod) throw new Error(`modifier ${modifierId} not on item ${item.id}`);
    if (!Number.isInteger(mqty) || mqty < 1 || mqty > 9) throw new Error(`invalid mod qty ${mqty}`);
    return {
      modifierId,
      qty: mqty,
      name_en: mod.name_en,
      name_ar: mod.name_ar,
      price_delta_iqd: mod.price_delta_iqd,
    };
  });

  return {
    key: `${item.id}:${variantId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    itemId: item.id,
    variantId,
    qty,
    notes: notes && notes.trim() !== '' ? notes.trim() : null,
    modifiers: lineMods,
    item_name_en: item.name_en,
    item_name_ar: item.name_ar,
    variant_name_en: variant.name_en,
    variant_name_ar: variant.name_ar,
    unit_price_iqd: variant.price_iqd,
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
// localStorage draft persistence (per table; browser-only conveniences)
// ---------------------------------------------------------------------------

const DRAFT_KEY_PREFIX = 'tp-basket-';

export function loadDraft(tableId: string): BasketLine[] {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + tableId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is BasketLine =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as BasketLine).variantId === 'string' &&
        Number.isInteger((l as BasketLine).qty) &&
        Array.isArray((l as BasketLine).modifiers),
    );
  } catch {
    return [];
  }
}

export function saveDraft(tableId: string, lines: readonly BasketLine[]): void {
  try {
    if (lines.length === 0) window.localStorage.removeItem(DRAFT_KEY_PREFIX + tableId);
    else window.localStorage.setItem(DRAFT_KEY_PREFIX + tableId, JSON.stringify(lines));
  } catch {
    // storage unavailable (private mode) — the draft just doesn't persist
  }
}
