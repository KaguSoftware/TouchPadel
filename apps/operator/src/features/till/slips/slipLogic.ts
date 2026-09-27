/**
 * The pure half of the till's "Scanned orders" (ScannedSlipsPanel.tsx,
 * SlipReview.tsx; 0238/0239): the payloads of app.slips_to_send and
 * app.slip_detail read defensively, a read line turned into a till line on the
 * menu (the matched size, the quantity written or 1, the waiter's note), which
 * required option a line still lacks, the tab a table's slip goes to, and the
 * send payload. No React here, so the node test beside it covers every branch.
 */
import type { BasketLine, ItemRow, ModifierGroupRow, ModifierRow, TabListRow, TillMenu } from '../tillData';

export type SlipStatus = 'uploaded' | 'reading' | 'read' | 'failed' | 'sent' | 'rejected';
export type SlipMatch = 'alias' | 'trigram' | 'manual' | 'none';
export type SlipFlag = 'UNCLEAR' | 'NO_QTY' | 'TRUNCATED';

export interface SlipSummary {
  id: string;
  status: SlipStatus;
  error_code: string | null;
  storage_path: string;
  uploaded_by_name: string | null;
  created_at: string;
  table_number_read: string | null;
  table_id: string | null;
  table_number: string | null;
  line_count: number;
  matched_count: number;
  order_id: string | null;
  sent_by_name: string | null;
  sent_at: string | null;
}

export interface SlipLine {
  id: string;
  line_no: number;
  text_read: string;
  qty_read: number | null;
  notes_read: string | null;
  flags: SlipFlag[];
  variant_id: string | null;
  match_source: SlipMatch;
  confidence: number | null;
}

export interface SlipDetail {
  id: string;
  status: SlipStatus;
  error_code: string | null;
  storage_path: string;
  created_at: string;
  read_at: string | null;
  /** When the current or last reading started (0240), and the database clock then. */
  reading_started_at: string | null;
  server_now: string | null;
  table_number_read: string | null;
  table_id: string | null;
  table_number: string | null;
  order_id: string | null;
  lines: SlipLine[];
}

const STATUSES: readonly SlipStatus[] = ['uploaded', 'reading', 'read', 'failed', 'sent', 'rejected'];
const MATCHES: readonly SlipMatch[] = ['alias', 'trigram', 'manual', 'none'];
const FLAGS: readonly SlipFlag[] = ['UNCLEAR', 'NO_QTY', 'TRUNCATED'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : dflt;

/** Still the till's to act on. */
export const isWaiting = (s: SlipStatus) => s === 'uploaded' || s === 'reading' || s === 'read' || s === 'failed';

/** app.slips_to_send as returned; anything else reads as none. */
export function readSlips(payload: unknown): SlipSummary[] {
  if (!isObject(payload) || !Array.isArray(payload.slips)) return [];
  return payload.slips
    .filter((s): s is Record<string, unknown> => isObject(s) && typeof s.id === 'string')
    .map((s) => ({
      id: s.id as string,
      status: oneOf(s.status, STATUSES, 'uploaded'),
      error_code: str(s.error_code),
      storage_path: str(s.storage_path) ?? '',
      uploaded_by_name: str(s.uploaded_by_name),
      created_at: str(s.created_at) ?? '',
      table_number_read: str(s.table_number_read),
      table_id: str(s.table_id),
      table_number: str(s.table_number),
      line_count: num(s.line_count) ?? 0,
      matched_count: num(s.matched_count) ?? 0,
      order_id: str(s.order_id),
      sent_by_name: str(s.sent_by_name),
      sent_at: str(s.sent_at),
    }));
}

/** app.slip_detail as returned; null when it is not one. */
export function readSlipDetail(payload: unknown): SlipDetail | null {
  if (!isObject(payload) || typeof payload.id !== 'string') return null;
  return {
    id: payload.id,
    status: oneOf(payload.status, STATUSES, 'uploaded'),
    error_code: str(payload.error_code),
    storage_path: str(payload.storage_path) ?? '',
    created_at: str(payload.created_at) ?? '',
    read_at: str(payload.read_at),
    reading_started_at: str(payload.reading_started_at),
    server_now: str(payload.server_now),
    table_number_read: str(payload.table_number_read),
    table_id: str(payload.table_id),
    table_number: str(payload.table_number),
    order_id: str(payload.order_id),
    lines: (Array.isArray(payload.lines) ? payload.lines : [])
      .filter((l): l is Record<string, unknown> => isObject(l) && typeof l.id === 'string')
      .map((l) => ({
        id: l.id as string,
        line_no: num(l.line_no) ?? 0,
        text_read: str(l.text_read) ?? '',
        qty_read: num(l.qty_read),
        notes_read: str(l.notes_read),
        flags: (Array.isArray(l.flags) ? l.flags : []).filter((f): f is SlipFlag => FLAGS.includes(f as SlipFlag)),
        variant_id: str(l.variant_id),
        match_source: oneOf(l.match_source, MATCHES, 'none'),
        confidence: num(l.confidence),
      }))
      .sort((a, b) => a.line_no - b.line_no),
  };
}

// ---------------------------------------------------------------------------
// Drafts: one till line per slip line, edited by the cashier
// ---------------------------------------------------------------------------

export interface SlipDraft {
  key: string;
  /** The slip line it came from; null for a line the cashier added. */
  lineId: string | null;
  itemId: string;
  variantId: string;
  qty: number;
  notes: string;
  modifiers: BasketLine['modifiers'];
}

/** The café items a slip can name: active, in an active café section. */
export function slipItems(menu: TillMenu | undefined): ItemRow[] {
  if (!menu) return [];
  const cafe = new Set(menu.categories.filter((c) => c.is_active && c.kind !== 'shop').map((c) => c.id));
  return menu.items.filter((i) => i.is_active && cafe.has(i.category_id));
}

export function itemOfVariant(menu: TillMenu | undefined, variantId: string | null): ItemRow | null {
  if (!menu || !variantId) return null;
  return menu.items.find((i) => i.menu_item_variants.some((v) => v.id === variantId)) ?? null;
}

export function defaultVariantId(item: ItemRow): string {
  const vs = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
  return (vs.find((v) => v.is_default) ?? vs[0])?.id ?? '';
}

export function draftFromLine(line: SlipLine, menu: TillMenu | undefined): SlipDraft {
  const item = itemOfVariant(menu, line.variant_id);
  return {
    key: line.id,
    lineId: line.id,
    itemId: item?.id ?? '',
    variantId: item ? (line.variant_id ?? defaultVariantId(item)) : '',
    qty: line.qty_read !== null && line.qty_read >= 1 && line.qty_read <= 99 ? line.qty_read : 1,
    notes: line.notes_read ?? '',
    modifiers: [],
  };
}

/** The draft for a picked item: its default size, options cleared (they belonged to the old item). */
export function withItem(d: SlipDraft, item: ItemRow): SlipDraft {
  return { ...d, itemId: item.id, variantId: defaultVariantId(item), modifiers: [] };
}

/** The draft as the item sheet returned it: size, quantity, note and options. */
export function withSheetLine(d: SlipDraft, line: BasketLine): SlipDraft {
  return { ...d, variantId: line.variantId, qty: line.qty, notes: line.notes, modifiers: line.modifiers };
}

/**
 * The first option group of the line's item whose minimum is not met, or null.
 * The server refuses the whole order on it (MODIFIER_SELECTION); the till says
 * which line and which group before the press.
 */
export function missingGroup(
  d: SlipDraft,
  item: ItemRow | null,
  groups: readonly ModifierGroupRow[],
  modifiers: readonly ModifierRow[],
): ModifierGroupRow | null {
  if (!item) return null;
  for (const link of item.menu_item_modifier_groups) {
    const g = groups.find((x) => x.id === link.group_id);
    if (!g || g.min_select <= 0) continue;
    const inGroup = new Set(modifiers.filter((m) => m.group_id === g.id).map((m) => m.id));
    const picked = d.modifiers.filter((m) => inGroup.has(m.modifierId)).reduce((s, m) => s + m.qty, 0);
    if (picked < g.min_select) return g;
  }
  return null;
}

export type DraftProblem = 'item' | 'qty' | 'options' | null;

export function draftProblem(d: SlipDraft, item: ItemRow | null, menu: TillMenu | undefined): DraftProblem {
  if (!d.itemId || !d.variantId || !item) return 'item';
  if (!Number.isInteger(d.qty) || d.qty < 1 || d.qty > 99) return 'qty';
  if (menu && missingGroup(d, item, menu.groups, menu.modifiers)) return 'options';
  return null;
}

/** app.send_order_slip's p_items. */
export function sendItems(drafts: readonly SlipDraft[]) {
  return drafts.map((d) => ({
    line_id: d.lineId,
    variant_id: d.variantId,
    qty: d.qty,
    notes: d.notes.trim() || null,
    modifiers: d.modifiers.map((m) => ({ modifier_id: m.modifierId, qty: m.qty })),
  }));
}

/** The open tabs on a table (by its number, as the tabs list carries it). */
export function tableTabs(tabs: readonly TabListRow[] | undefined, tableNumber: string | null): TabListRow[] {
  if (!tabs || !tableNumber) return [];
  return tabs.filter((t) => t.status === 'open' && t.table?.table_number === tableNumber);
}

/**
 * Where the order goes: the tab the cashier picked; else the table's only open
 * tab; else a new tab on the table (the server opens it). With several open
 * tabs and none picked, the cashier must choose.
 */
export function sendTarget(
  tableId: string | null,
  tabsOnTable: readonly TabListRow[],
  pickedTabId: string | null,
): { p_tab_id: string | null; p_table_id: string | null } | 'choose_tab' | 'choose_table' {
  if (pickedTabId && tabsOnTable.some((t) => t.id === pickedTabId)) return { p_tab_id: pickedTabId, p_table_id: tableId };
  if (!tableId) return 'choose_table';
  if (tabsOnTable.length > 1) return 'choose_tab';
  return { p_tab_id: tabsOnTable[0]?.id ?? null, p_table_id: tableId };
}
