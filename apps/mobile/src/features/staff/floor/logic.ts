/**
 * Place an order (owner, 2026-09-28; migration 0251): the pure half of the
 * staff phone's order pages (app/staff-order*.tsx). The waiter picks a table,
 * then one of its open tabs or a new one, adds items from the café menu with
 * their size and options, and sends them to the kitchen.
 *
 *   * readFloor / readMenu read app.floor_tables / app.floor_menu defensively;
 *   * the option rules mirror the server's (add_order_items, 0028 reveals):
 *     the groups in play are the item's own plus those a chosen option
 *     reveals, one level deep, and each needs between min and max choices;
 *   * a draft is one table's order being built: which tab it goes to, an
 *     optional name for a new tab, and its lines. The same item with the same
 *     size, options and note is one line with a count.
 *
 * NO MONEY IS COMPUTED HERE (docs/PRODUCT.md principle 3; owner: "item prices
 * only"). A list price is shown as the server sent it; no line or order total.
 *
 * PURE (vitest).
 */
import type { StaffRole } from '@touch/core';

/** The roles of floor_tables, floor_menu and place_floor_order (0251). */
export const FLOOR_ROLES: readonly StaffRole[] = ['waiter', 'cashier', 'manager', 'owner'];

// ── What the server sends ───────────────────────────────────────────────────

export interface FloorLine {
  name_en: string;
  name_ar: string;
  size_en: string | null;
  size_ar: string | null;
  qty: number;
}

export interface FloorTab {
  id: string;
  label: string | null;
  opened_at: string;
  /** The caller opened it. */
  mine: boolean;
  lines: FloorLine[];
}

export interface FloorTable {
  id: string;
  table_number: string;
  zone: string | null;
  tabs: FloorTab[];
}

export interface Floor {
  /** False while the venue has no open day: nothing can be ordered. */
  day_open: boolean;
  tables: FloorTable[];
}

export interface MenuModifier {
  id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  /** Groups this option brings into play (one level: theirs reveal nothing). */
  reveals: MenuGroup[];
}

export interface MenuGroup {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: MenuModifier[];
}

export interface MenuVariant {
  id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
}

export interface MenuItem {
  id: string;
  name_en: string;
  name_ar: string;
  /** False when sold out, off today, or an ingredient is out. */
  orderable: boolean;
  variants: MenuVariant[];
  groups: MenuGroup[];
}

export interface MenuCategory {
  id: string;
  name_en: string;
  name_ar: string;
  items: MenuItem[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => isObject(x) && typeof x.id === 'string') : [];

function readLines(v: unknown): FloorLine[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObject).map((l) => ({
    name_en: str(l.name_en) ?? '',
    name_ar: str(l.name_ar) ?? str(l.name_en) ?? '',
    size_en: str(l.size_en),
    size_ar: str(l.size_ar),
    qty: num(l.qty, 1),
  }));
}

/** app.floor_tables as returned; anything else reads as a closed day with no tables. */
export function readFloor(payload: unknown): Floor {
  if (!isObject(payload)) return { day_open: false, tables: [] };
  return {
    day_open: payload.day_open === true,
    tables: list(payload.tables).map((t) => ({
      id: t.id as string,
      table_number: str(t.table_number) ?? '',
      zone: str(t.zone),
      tabs: list(t.tabs).map((tab) => ({
        id: tab.id as string,
        label: str(tab.label),
        opened_at: str(tab.opened_at) ?? '',
        mine: tab.mine === true,
        lines: readLines(tab.lines),
      })),
    })),
  };
}

function readGroup(g: Record<string, unknown>, depth: number): MenuGroup {
  return {
    id: g.id as string,
    name_en: str(g.name_en) ?? '',
    name_ar: str(g.name_ar) ?? str(g.name_en) ?? '',
    min_select: Math.max(0, num(g.min_select)),
    max_select: Math.max(1, num(g.max_select, 1)),
    modifiers: list(g.modifiers).map((m) => ({
      id: m.id as string,
      name_en: str(m.name_en) ?? '',
      name_ar: str(m.name_ar) ?? str(m.name_en) ?? '',
      price_delta_iqd: num(m.price_delta_iqd),
      // Depth 1, as the server: a revealed group's options reveal nothing.
      reveals: depth === 0 ? list(m.reveals).map((r) => readGroup(r, 1)) : [],
    })),
  };
}

/** app.floor_menu as returned; a category with no items, or an item with no size, is dropped. */
export function readMenu(payload: unknown): MenuCategory[] {
  if (!isObject(payload)) return [];
  return list(payload.categories)
    .map((c) => ({
      id: c.id as string,
      name_en: str(c.name_en) ?? '',
      name_ar: str(c.name_ar) ?? str(c.name_en) ?? '',
      items: list(c.items)
        .map((i) => ({
          id: i.id as string,
          name_en: str(i.name_en) ?? '',
          name_ar: str(i.name_ar) ?? str(i.name_en) ?? '',
          orderable: i.orderable !== false,
          variants: list(i.variants).map((v) => ({
            id: v.id as string,
            name_en: str(v.name_en) ?? '',
            name_ar: str(v.name_ar) ?? str(v.name_en) ?? '',
            price_iqd: num(v.price_iqd),
            is_default: v.is_default === true,
          })),
          groups: list(i.groups).map((g) => readGroup(g, 0)),
        }))
        .filter((i) => i.variants.length > 0),
    }))
    .filter((c) => c.items.length > 0);
}

export function localName(row: { name_en: string; name_ar: string }, locale: string): string {
  return locale === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar;
}

export function itemById(menu: readonly MenuCategory[], id: string): MenuItem | undefined {
  for (const c of menu) for (const i of c.items) if (i.id === id) return i;
  return undefined;
}

/** The size a new line starts on: the default, else the first. */
export function defaultVariant(item: MenuItem): MenuVariant {
  return item.variants.find((v) => v.is_default) ?? item.variants[0]!;
}

/** An item that needs the sheet (a size or an option to choose), rather than a one-tap add. */
export function needsChoices(item: MenuItem): boolean {
  return item.variants.length > 1 || item.groups.length > 0;
}

/** The price a menu row shows: the only size's, or the cheapest ("from"). */
export function rowPrice(item: MenuItem): { price: number; from: boolean } {
  const prices = item.variants.map((v) => v.price_iqd);
  return { price: Math.min(...prices), from: new Set(prices).size > 1 };
}

// ── Options ─────────────────────────────────────────────────────────────────

/**
 * The groups in play for an item: its own, each followed by the groups its
 * chosen options reveal (app.item_active_groups, depth 1). Duplicates collapse.
 */
export function activeGroups(item: Pick<MenuItem, 'groups'>, chosen: Iterable<string>): MenuGroup[] {
  const picked = new Set(chosen);
  const out: MenuGroup[] = [];
  const seen = new Set<string>();
  const push = (g: MenuGroup) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    out.push(g);
  };
  for (const g of item.groups) {
    push(g);
    for (const m of g.modifiers) if (picked.has(m.id)) for (const r of m.reveals) push(r);
  }
  return out;
}

/** Choices outside the groups now in play are dropped (un-picking "Iced" drops its ice level). */
export function pruneChoices(item: Pick<MenuItem, 'groups'>, chosen: readonly string[]): string[] {
  let current = [...chosen];
  // Twice at most: a pruned option can only un-reveal a group one level down.
  for (let pass = 0; pass < 2; pass++) {
    const live = new Set(activeGroups(item, current).flatMap((g) => g.modifiers.map((m) => m.id)));
    const next = current.filter((id) => live.has(id));
    if (next.length === current.length) return next;
    current = next;
  }
  return current;
}

/**
 * Tap an option. A one-choice group behaves like radio buttons (a tap on the
 * chosen one clears it unless the group needs one); a wider group toggles,
 * and refuses a choice past its max by leaving the choices as they were.
 */
export function toggleChoice(
  item: Pick<MenuItem, 'groups'>,
  group: MenuGroup,
  chosen: readonly string[],
  modifierId: string,
): string[] {
  const inGroup = new Set(group.modifiers.map((m) => m.id));
  const mine = chosen.filter((id) => inGroup.has(id));
  let next: string[];
  if (chosen.includes(modifierId)) {
    if (group.max_select === 1 && group.min_select >= 1) return [...chosen];
    next = chosen.filter((id) => id !== modifierId);
  } else if (group.max_select === 1) {
    next = [...chosen.filter((id) => !inGroup.has(id)), modifierId];
  } else {
    if (mine.length >= group.max_select) return [...chosen];
    next = [...chosen, modifierId];
  }
  return pruneChoices(item, next);
}

/** Groups in play that still need a choice (fewer than their min). */
export function missingGroups(item: Pick<MenuItem, 'groups'>, chosen: readonly string[]): MenuGroup[] {
  const picked = new Set(chosen);
  return activeGroups(item, chosen).filter(
    (g) => g.modifiers.filter((m) => picked.has(m.id)).length < g.min_select,
  );
}

/** The first choice a required one-option-only group starts on, so the common case needs no tap. */
export function initialChoices(item: Pick<MenuItem, 'groups'>): string[] {
  const out: string[] = [];
  for (const g of item.groups) {
    if (g.min_select >= 1 && g.modifiers.length === 1) out.push(g.modifiers[0]!.id);
  }
  return pruneChoices(item, out);
}

// ── The draft ───────────────────────────────────────────────────────────────

export interface DraftLine {
  /** Stable while the line lives; the merge key is `sameLine`. */
  key: string;
  itemId: string;
  variantId: string;
  qty: number;
  modifierIds: string[];
  note: string;
}

/** Where the order goes: one of the table's open tabs, or a new one. */
export type Target = { kind: 'tab'; tabId: string } | { kind: 'new' };

export interface Draft {
  tableId: string;
  target: Target | null;
  /** The name for a new tab (optional). */
  label: string;
  lines: DraftLine[];
}

export const MAX_QTY = 99;
export const NOTE_MAX = 200;
export const LABEL_MAX = 40;
/** place_floor_order takes at most 60 lines. */
export const MAX_LINES = 60;

export function emptyDraft(tableId: string, target: Target | null = null): Draft {
  return { tableId, target, label: '', lines: [] };
}

/**
 * The tab a table's order starts on: its only open tab (the guests ordering
 * more is the common case), a new tab when it has none, and nothing chosen
 * when it has several: the waiter says which.
 */
export function initialTarget(table: Pick<FloorTable, 'tabs'>): Target | null {
  if (table.tabs.length === 0) return { kind: 'new' };
  if (table.tabs.length === 1) return { kind: 'tab', tabId: table.tabs[0]!.id };
  return null;
}

/** A target that still exists on the table (a tab the till settled meanwhile does not). */
export function validTarget(target: Target | null, table: Pick<FloorTable, 'tabs'>): Target | null {
  if (!target) return null;
  if (target.kind === 'new') return target;
  return table.tabs.some((t) => t.id === target.tabId) ? target : null;
}

function sameChoices(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = [...b].sort();
  return [...a].sort().every((x, i) => x === sb[i]);
}

function sameLine(a: Omit<DraftLine, 'key' | 'qty'>, b: Omit<DraftLine, 'key' | 'qty'>): boolean {
  return a.variantId === b.variantId && sameChoices(a.modifierIds, b.modifierIds) && a.note.trim() === b.note.trim();
}

/** Add a line; the same item, size, options and note adds to that line's count (capped at 99). */
export function addLine(draft: Draft, line: Omit<DraftLine, 'key'>, key: string): Draft {
  const match = draft.lines.find((l) => sameLine(l, line));
  if (match) {
    return {
      ...draft,
      lines: draft.lines.map((l) => (l === match ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty) } : l)),
    };
  }
  if (draft.lines.length >= MAX_LINES) return draft;
  return { ...draft, lines: [...draft.lines, { ...line, note: line.note.trim(), key }] };
}

/** Set a line's count; 0 removes it. */
export function setQty(draft: Draft, key: string, qty: number): Draft {
  if (qty <= 0) return { ...draft, lines: draft.lines.filter((l) => l.key !== key) };
  return {
    ...draft,
    lines: draft.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, Math.floor(qty)) } : l)),
  };
}

/** How many of one item are in the draft, over its lines (the menu row's badge). */
export function itemCount(draft: Draft | null, itemId: string): number {
  return (draft?.lines ?? []).filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);
}

/** Every item in the draft, counted (the send bar's number). */
export function draftCount(draft: Draft | null): number {
  return (draft?.lines ?? []).reduce((n, l) => n + l.qty, 0);
}

export type SendIssue = 'target' | 'empty' | 'label' | null;

/**
 * Why the draft cannot be sent yet: no tab chosen; nothing to add to an
 * existing tab (a new tab may open empty); a name too long.
 */
export function sendIssue(draft: Draft): SendIssue {
  if (!draft.target) return 'target';
  if (draft.target.kind === 'tab' && draft.lines.length === 0) return 'empty';
  if (draft.target.kind === 'new' && [...draft.label.trim()].length > LABEL_MAX) return 'label';
  return null;
}

/** place_floor_order's p_items, in the till's shape; never a price. */
export interface SendItem {
  variant_id: string;
  qty: number;
  notes?: string;
  modifiers?: { modifier_id: string }[];
}

export function sendItems(draft: Draft): SendItem[] {
  return draft.lines.map((l) => ({
    variant_id: l.variantId,
    qty: l.qty,
    ...(l.note.trim() ? { notes: l.note.trim() } : {}),
    ...(l.modifierIds.length ? { modifiers: l.modifierIds.map((id) => ({ modifier_id: id })) } : {}),
  }));
}

export interface SendArgs {
  p_table_id: string;
  p_tab_id: string | null;
  p_label: string | null;
  p_items: SendItem[];
}

export function sendArgs(draft: Draft): SendArgs {
  const tab = draft.target?.kind === 'tab' ? draft.target.tabId : null;
  const label = draft.target?.kind === 'new' ? draft.label.trim() : '';
  return { p_table_id: draft.tableId, p_tab_id: tab, p_label: label || null, p_items: sendItems(draft) };
}

/**
 * One send's intent, for its idempotency key: the same draft retried is the
 * same intent; any change to where it goes or what is in it is a new one.
 */
export function sendIntent(draft: Draft): string {
  const a = sendArgs(draft);
  return `floor:${a.p_table_id}:${a.p_tab_id ?? 'new'}:${a.p_label ?? ''}:${JSON.stringify(a.p_items)}`;
}

// ── Showing a tab ───────────────────────────────────────────────────────────

/** A tab's name as the waiter reads it: its label, else its place on the table ("Tab 2"). */
export function tabName(tab: Pick<FloorTab, 'label'>, index: number): { label: string } | { n: number } {
  const label = tab.label?.trim();
  return label ? { label } : { n: index + 1 };
}

/** Items on a tab, counted. */
export function tabItemCount(tab: Pick<FloorTab, 'lines'>): number {
  return tab.lines.reduce((n, l) => n + l.qty, 0);
}

/** Menu search: items whose name (either language) holds every word typed. */
export function searchMenu(menu: readonly MenuCategory[], query: string): MenuItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return menu
    .flatMap((c) => c.items)
    .filter((i) => {
      const hay = `${i.name_en} ${i.name_ar}`.toLocaleLowerCase();
      return words.every((w) => hay.includes(w));
    });
}
