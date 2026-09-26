/**
 * The phone's store pages (wave5-addendum-2026-09-25 §2.8, §5.3): Add to
 * stock (log_stock), Move stock (transfer_stock) and Count the bakery
 * (submit_stock_count), as rules the screens read.
 *
 * Who may do what, and into which store, is @touch/core's `staff/stores`
 * (one copy for the operator and the phone): each role list there mirrors one
 * RPC guard, and this file re-exports them so the phone's pages and Today's
 * rows gate on exactly the server's lists. The server stays the wall; these
 * only shape the page, catch a bad line before the round trip, and put a
 * refusal back on the line it names.
 *
 * Nothing here carries a cost: a staff member never sees or types one (I12).
 *
 * PURE (vitest): no react-native, no supabase.
 */
import { localIsoDate, parseTypedDate, type StaffRole } from '@touch/core';
import {
  COUNT_ROLES,
  LOG_ROLES,
  MOVE_ROLES,
  STOCK_LOCATIONS,
  countStoresFor,
  homeStore,
  isStockLocation,
  logKindsFor,
  logStoresFor,
  otherStore,
  toBaseQty,
  type StockKind,
  type StockLocation,
} from '@touch/core/staff/stores';
import type { MessageKey } from '@touch/i18n';
import { errorMessageOf } from '../../../lib/network';
import { rpcErrorCode } from '../../booking/errors';
import { mapStaffError } from '../edge';
import { parseQty, type StockUnit } from '../supplies/production';

export {
  COUNT_ROLES,
  LOG_ROLES,
  MOVE_ROLES,
  STOCK_LOCATIONS,
  countStoresFor,
  homeStore,
  logKindsFor,
  logStoresFor,
  otherStore,
  toBaseQty,
  type StockKind,
  type StockLocation,
};

export type StorePurpose = 'log' | 'move' | 'count';

/** The server's caps (0201, 0202, 0203, 0204). */
export const STORE_CAPS = {
  /** Lines in one log or one move. */
  lines: 50,
  /** Lines in one phone count. */
  countLines: 300,
  /** Items in one pick list. */
  pick: 300,
} as const;

// ── What the server answers ──────────────────────────────────────────────────

/** One row of `stock_pick_list`: names and units, and for a move what the source holds. */
export interface PickItem {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: StockUnit;
  kind: StockKind;
  pack_size: number | null;
  /** Present for `move` only: what the source store holds, in the base unit. */
  on_hand?: number;
}

export interface PickList {
  purpose: StorePurpose;
  location: StockLocation;
  items: PickItem[];
}

export interface TodayLine {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: StockUnit;
  qty: number;
}

export interface TodayTransfer {
  transfer_id: string;
  from: StockLocation;
  to: StockLocation;
  moved_by_name: string | null;
  moved_at: string;
  lines: TodayLine[];
}

export interface TodayLog {
  delivery_id: string;
  location: StockLocation;
  source: 'goods_in' | 'staff_log';
  received_by_name: string | null;
  received_at: string;
  lines: (TodayLine & { expiry_date: string | null })[];
}

export interface TodayCountLine {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: StockUnit;
  counted_qty: number;
}

export interface TodayCount {
  count_id: string;
  location: StockLocation;
  status: 'waiting' | 'applied';
  counted_by_name: string | null;
  submitted_at: string;
  applied_at: string | null;
  lines: TodayCountLine[];
}

/** `stock_today`: each section is null for a role it is not for. */
export interface StockToday {
  business_date: string;
  transfers: TodayTransfer[] | null;
  logs: TodayLog[] | null;
  driver_deliveries_waiting: number | null;
  counts: TodayCount[] | null;
}

/** How many of the day's moves, additions or counts a page lists before "and N more". */
export const TODAY_SHOWN = 10;

/** The first `n` rows and how many were left out. */
export function firstOf<T>(
  rows: readonly T[] | null | undefined,
  n = TODAY_SHOWN,
): { shown: T[]; more: number } {
  const all = rows ?? [];
  return { shown: all.slice(0, n), more: Math.max(0, all.length - n) };
}

// ── Picking items ────────────────────────────────────────────────────────────

/** A short list is shown whole; a longer one waits for a few letters. */
export const SHOW_ALL_UP_TO = 12;
export const MATCHES_SHOWN = 8;

/**
 * The pick-list items to offer under the search field: the ones not already
 * on the form whose name (either language) holds the typed text, at most
 * `MATCHES_SHOWN`. With nothing typed, the whole list when it is short
 * (a desk's handful of shop products), else nothing: two hundred rows are
 * not a picker.
 */
export function pickMatches(
  items: readonly PickItem[],
  query: string,
  taken: ReadonlySet<string> = new Set(),
): PickItem[] {
  const free = items.filter((i) => !taken.has(i.ingredient_id));
  const q = query.trim().toLocaleLowerCase();
  if (!q) return free.length <= SHOW_ALL_UP_TO ? free : [];
  return free
    .filter((i) => i.name_en.toLocaleLowerCase().includes(q) || i.name_ar.includes(query.trim()))
    .slice(0, MATCHES_SHOWN);
}

/** Rows of a count sheet whose name holds the typed text (all of them for an empty search). */
export function filterPick(items: readonly PickItem[], query: string): PickItem[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...items];
  return items.filter(
    (i) => i.name_en.toLocaleLowerCase().includes(q) || i.name_ar.includes(query.trim()),
  );
}

/** The server stopped at its cap, so an item may be missing from the list. */
export function isCapped(list: PickList | undefined): boolean {
  return (list?.items.length ?? 0) >= STORE_CAPS.pick;
}

// ── Lines ────────────────────────────────────────────────────────────────────

/** A line is typed in the item's base unit (g, ml, pieces) or in packs. */
export type LineUnit = 'base' | 'pack';

export interface LineDraft {
  /** The item as it was picked: a line keeps its name and unit when the list changes. */
  item: PickItem;
  qty: string;
  unit: LineUnit;
  /** Typed use-by day (Add to stock only); blank means none. */
  expiry: string;
  /** The use-by field is open. */
  expiryOpen: boolean;
}

export function newLine(item: PickItem): LineDraft {
  return { item, qty: '', unit: 'base', expiry: '', expiryOpen: false };
}

/** The units a line may be typed in: packs only when the item has a pack size. */
export function unitChoices(item: Pick<PickItem, 'pack_size'>): LineUnit[] {
  return item.pack_size != null && item.pack_size > 0 ? ['base', 'pack'] : ['base'];
}

/** What a line comes to in the base unit, as the server will book it, or null. */
export function lineBaseQty(line: Pick<LineDraft, 'item' | 'qty' | 'unit'>): number | null {
  const typed = parseQty(line.qty);
  if (typed === null) return null;
  return toBaseQty(typed, line.unit === 'pack' ? 'pack' : line.item.unit, line.item);
}

export type LineField = 'lines' | 'qty' | 'expiry' | 'kind';
export type LineIssueCode =
  | 'required'
  | 'tooMany'
  | 'invalid'
  | 'past'
  /** Shop stock goes into the cafe store only (V14). */
  | 'cafeOnly'
  /** The line is more than the source store shows. */
  | 'short'
  /** The item is gone from the venue's stock (INGREDIENT_NOT_FOUND). */
  | 'gone';

export interface LineIssue {
  /** The line's ingredient; absent for the form's own issue (no lines, too many). */
  line?: string;
  field: LineField;
  code: LineIssueCode;
  /** For `short`: what the source store shows, in the base unit. */
  shows?: number;
}

/** Whether an edit to line `id` addresses this issue: the field being fixed stops showing its error. */
export function fixes(issue: LineIssue, id: string, patch: Partial<LineDraft>): boolean {
  if (issue.line !== id) return false;
  if (issue.field === 'qty') return 'qty' in patch || 'unit' in patch;
  if (issue.field === 'expiry') return 'expiry' in patch;
  return false;
}

function qtyIssue(line: LineDraft): LineIssue | null {
  if (!line.qty.trim()) return { line: line.item.ingredient_id, field: 'qty', code: 'required' };
  if (lineBaseQty(line) === null)
    return { line: line.item.ingredient_id, field: 'qty', code: 'invalid' };
  return null;
}

function countIssue(lines: readonly LineDraft[]): LineIssue | null {
  if (lines.length === 0) return { field: 'lines', code: 'required' };
  if (lines.length > STORE_CAPS.lines) return { field: 'lines', code: 'tooMany' };
  return null;
}

/**
 * Add to stock, before it is sent (log_stock's own checks, M6): at least one
 * line and at most 50, an amount above 0 in a unit the item has, a use-by day
 * that is a real day and not before today, and nothing the role may not log
 * into this store. `today` is `YYYY-MM-DD`.
 */
export function validateLog(
  lines: readonly LineDraft[],
  store: StockLocation,
  role: StaffRole,
  today: string = localIsoDate(new Date()),
): LineIssue[] {
  const issues: LineIssue[] = [];
  const form = countIssue(lines);
  if (form) issues.push(form);
  for (const line of lines) {
    const id = line.item.ingredient_id;
    if (!logStoresFor(role, line.item.kind).includes(store)) {
      issues.push({ line: id, field: 'kind', code: 'cafeOnly' });
    }
    const qty = qtyIssue(line);
    if (qty) issues.push(qty);
    if (line.expiry.trim()) {
      const day = parseTypedDate(line.expiry);
      if (!day) issues.push({ line: id, field: 'expiry', code: 'invalid' });
      else if (day < today) issues.push({ line: id, field: 'expiry', code: 'past' });
    }
  }
  return issues;
}

/**
 * Move stock, before it is sent (transfer_stock's checks): the log's line
 * rules, and no line larger than the source shows. `onHand` is the source's
 * pick list by ingredient; while it is still loading (null) the size check is
 * left to the server. An item the source no longer lists shows 0.
 */
export function validateMove(
  lines: readonly LineDraft[],
  onHand: ReadonlyMap<string, number> | null,
): LineIssue[] {
  const issues: LineIssue[] = [];
  const form = countIssue(lines);
  if (form) issues.push(form);
  for (const line of lines) {
    const qty = qtyIssue(line);
    if (qty) {
      issues.push(qty);
      continue;
    }
    if (!onHand) continue;
    const shows = onHand.get(line.item.ingredient_id) ?? 0;
    const base = lineBaseQty(line) ?? 0;
    if (base > shows)
      issues.push({ line: line.item.ingredient_id, field: 'qty', code: 'short', shows });
  }
  return issues;
}

/** The source store's on-hand by ingredient, from a `move` pick list. */
export function onHandMap(list: PickList | undefined): Map<string, number> | null {
  if (!list) return null;
  return new Map(list.items.map((i) => [i.ingredient_id, i.on_hand ?? 0]));
}

interface LineArg {
  ingredient_id: string;
  qty: number;
  unit?: 'pack';
  expiry_date?: string;
}

/** One line as the server takes it: the typed amount, `unit: 'pack'` when in packs (the server multiplies). */
function lineArg(line: LineDraft, withExpiry: boolean): LineArg {
  const day = withExpiry && line.expiry.trim() ? parseTypedDate(line.expiry) : null;
  return {
    ingredient_id: line.item.ingredient_id,
    qty: parseQty(line.qty) ?? 0,
    ...(line.unit === 'pack' ? { unit: 'pack' as const } : {}),
    ...(day ? { expiry_date: day } : {}),
  };
}

export interface LogArgs {
  p_location: StockLocation;
  p_lines: LineArg[];
  p_venue_id: string;
}

/** `log_stock`'s arguments for lines that validated (the key is added by the caller). */
export function logArgs(
  lines: readonly LineDraft[],
  store: StockLocation,
  venueId: string,
): LogArgs {
  return { p_location: store, p_lines: lines.map((l) => lineArg(l, true)), p_venue_id: venueId };
}

export interface MoveArgs {
  p_from: StockLocation;
  p_to: StockLocation;
  p_lines: LineArg[];
  p_venue_id: string;
}

/** `transfer_stock`'s arguments for lines that validated. */
export function moveArgs(
  lines: readonly LineDraft[],
  from: StockLocation,
  venueId: string,
): MoveArgs {
  return {
    p_from: from,
    p_to: otherStore(from),
    p_lines: lines.map((l) => lineArg(l, false)),
    p_venue_id: venueId,
  };
}

// ── The count sheet ──────────────────────────────────────────────────────────

/** One typed amount on the count sheet; an item with no entry was not counted. */
export interface CountEntry {
  qty: string;
  unit: LineUnit;
}

/**
 * A counted amount: 0 or more (an empty shelf is a count), in either digit
 * set, three places at most; or null when it is not one.
 */
export function parseCount(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/^[0٠]+([.٫][0٠]*)?$/.test(raw) || /^[.٫][0٠]+$/.test(raw)) return 0;
  return parseQty(raw);
}

/** The entries someone actually typed, in the sheet's order. */
export function typedEntries(
  items: readonly PickItem[],
  entries: Readonly<Record<string, CountEntry>>,
): { item: PickItem; entry: CountEntry }[] {
  return items
    .filter((i) => (entries[i.ingredient_id]?.qty.trim() ?? '') !== '')
    .map((i) => ({ item: i, entry: entries[i.ingredient_id]! }));
}

/** The sheet before it is sent: at least one amount, each one a number of 0 or more. */
export function validateCount(
  items: readonly PickItem[],
  entries: Readonly<Record<string, CountEntry>>,
): LineIssue[] {
  const typed = typedEntries(items, entries);
  if (typed.length === 0) return [{ field: 'lines', code: 'required' }];
  if (typed.length > STORE_CAPS.countLines) return [{ field: 'lines', code: 'tooMany' }];
  const issues: LineIssue[] = [];
  for (const { item, entry } of typed) {
    const n = parseCount(entry.qty);
    const packOk = entry.unit === 'base' || unitChoices(item).includes('pack');
    if (n === null || !packOk)
      issues.push({ line: item.ingredient_id, field: 'qty', code: 'invalid' });
  }
  return issues;
}

export interface CountArgs {
  p_location: StockLocation;
  p_lines: { ingredient_id: string; counted_qty: number; unit?: 'pack' }[];
  p_venue_id: string;
}

/** `submit_stock_count`'s arguments for a sheet that validated: only the typed amounts. */
export function countArgs(
  items: readonly PickItem[],
  entries: Readonly<Record<string, CountEntry>>,
  store: StockLocation,
  venueId: string,
): CountArgs {
  return {
    p_location: store,
    p_lines: typedEntries(items, entries).map(({ item, entry }) => ({
      ingredient_id: item.ingredient_id,
      counted_qty: parseCount(entry.qty) ?? 0,
      ...(entry.unit === 'pack' ? { unit: 'pack' as const } : {}),
    })),
    p_venue_id: venueId,
  };
}

/** The store a count page opens on: the bakery when the role counts it (the page is "Count the bakery"). */
export function defaultCountStore(role: StaffRole): StockLocation | null {
  const stores = countStoresFor(role);
  if (stores.length === 0) return null;
  return stores.includes('bakery') ? 'bakery' : stores[0]!;
}

/** A phone count of this store still waiting for a manager, which blocks the next one (COUNT_IN_PROGRESS). */
export function waitingCount(
  today: StockToday | undefined,
  store: StockLocation,
): TodayCount | null {
  return today?.counts?.find((c) => c.location === store && c.status === 'waiting') ?? null;
}

// ── Stores, keys and refusals ────────────────────────────────────────────────

/** The store a log page opens on: the role's home store when it may log there (the desk: the cafe). */
export function defaultLogStore(role: StaffRole): StockLocation | null {
  return logStoresFor(role)[0] ?? null;
}

/**
 * The intent a store write's idempotency key is kept under (§5.3): the page,
 * its store and what is sent, `log:<store>:<args>`, `move:<from>:<args>`,
 * `count:<store>:<args>`. Minted when the form is sent, reused by every retry
 * of the same lines, cleared once the write succeeds.
 *
 * What is sent is part of it because `app.claim_replay` compares no payload:
 * a key kept per store alone, after a lost response, would replay the first
 * write's answer for the next, different one and record nothing.
 */
export function storeIntent(purpose: StorePurpose, store: StockLocation, args: unknown): string {
  return `${purpose}:${store}:${JSON.stringify(args)}`;
}

/** A value read back from the server, narrowed to a store. */
export function asStore(value: unknown, fallback: StockLocation): StockLocation {
  return isStockLocation(value) ? value : fallback;
}

function field(err: unknown, name: 'hint' | 'details'): string | null {
  if (err && typeof err === 'object' && name in err) {
    const v = (err as Record<string, unknown>)[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * TRANSFER_SHORT's line and figure (§3: hint = the ingredient, detail = what
 * the source shows), or null for any other failure.
 */
export function shortDetail(err: unknown): { ingredientId: string; shows: number } | null {
  if (rpcErrorCode(errorMessageOf(err)) !== 'TRANSFER_SHORT') return null;
  const id = field(err, 'hint');
  const shows = Number(field(err, 'details'));
  if (!id || !Number.isFinite(shows)) return null;
  return { ingredientId: id, shows };
}

/**
 * A refused store write: the sentence for the form, and the line issue when
 * the server named a line (the source short of it, shop stock at the bakery,
 * an item gone), so the refusal shows where it can be fixed.
 */
export function storeRefusal(err: unknown): { key: MessageKey; issue: LineIssue | null } {
  const key = mapStaffError(err);
  const code = rpcErrorCode(errorMessageOf(err));
  const short = shortDetail(err);
  if (short)
    return {
      key,
      issue: { line: short.ingredientId, field: 'qty', code: 'short', shows: short.shows },
    };
  const detail = field(err, 'details');
  if (code === 'INVALID_ARGUMENT' && field(err, 'hint') === 'kind' && detail) {
    return {
      key: 'staff.stores.errors.cafeOnly',
      issue: { line: detail, field: 'kind', code: 'cafeOnly' },
    };
  }
  if (code === 'INGREDIENT_NOT_FOUND' && detail) {
    return { key: 'staff.stores.errors.gone', issue: { line: detail, field: 'qty', code: 'gone' } };
  }
  return { key, issue: null };
}
