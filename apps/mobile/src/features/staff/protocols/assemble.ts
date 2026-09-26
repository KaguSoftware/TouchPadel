/**
 * Protocol forms on the phone: a form's typed-in draft, and the record the
 * engine takes (build-contracts-2026-09-23 §2.8, §7.2).
 *
 * Every step form is described by `@touch/core`'s field list for its step key,
 * the same list the operator renders, so the two apps cannot ask for different
 * things. A draft mirrors the record field for field, but holds what the
 * person typed: text for every number, date and time, so a half-typed "12,5"
 * never jumps back to "12.5" under their thumb. `recordFromDraft` turns it into
 * the record, and core's `validateStep` marks what is wrong with the server's
 * own hint names before the round trip.
 *
 * A value that does not parse is sent to the validator as NaN, never dropped:
 * NaN is not blank, so an optional field typed wrong is marked invalid rather
 * than silently left out, and it fails every number, date and time check.
 *
 * PURE (vitest).
 */
import { parseTypedDate, westernDigits, type FieldDef } from '@touch/core';

export type DraftValue = string | boolean | string[] | Draft | Draft[];
export interface Draft {
  [name: string]: DraftValue;
}

/** One `priceMap` entry as typed: `{minutes, price}`. */
export const PRICE_MAP_MEMBERS = ['minutes', 'price'] as const;

/**
 * The venue's offset from UTC. Iraq has kept +03:00 all year since 2008, so a
 * typed venue time is written with a fixed offset (`formatting.ts` VENUE_TZ is
 * Asia/Baghdad): the phone's own zone never moves a tournament by an hour.
 */
export const VENUE_OFFSET_MINUTES = 180;

// ── Empty drafts ────────────────────────────────────────────────────────────

export function emptyValue(def: FieldDef): DraftValue {
  switch (def.type) {
    case 'bool':
      return false;
    case 'uuids':
    case 'ints':
      return [];
    case 'list':
      // A list the form needs at least one of starts with one row to fill.
      return (def.minItems ?? 0) > 0 ? [emptyDraft(def.fields ?? [])] : [];
    case 'object':
      return emptyDraft(def.fields ?? []);
    case 'priceMap':
      return (def.minItems ?? 0) > 0 ? [{ minutes: '', price: '' }] : [];
    default:
      return '';
  }
}

export function emptyDraft(fields: readonly FieldDef[]): Draft {
  const draft: Draft = {};
  for (const def of fields) draft[def.name] = emptyValue(def);
  return draft;
}

// ── Parsing what was typed ──────────────────────────────────────────────────

/**
 * A typed number: Arabic-Indic digits read as Western, thousands separators
 * (`,`, the Arabic `٬`, spaces) dropped, the Arabic decimal comma `٫` read as a
 * point. Whole numbers only when `integer`. NaN when it does not parse.
 */
export function parseTypedNumber(text: string, integer: boolean): number {
  const clean = westernDigits(text)
    .trim()
    .replace(/[,\s٬]/g, '')
    .replace('٫', '.');
  const pattern = integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
  if (!pattern.test(clean)) return Number.NaN;
  return Number(clean);
}

/** A typed `HH:MM` as `HH:MM`, or null. */
export function parseTypedTime(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(westernDigits(text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * A typed venue date and time, `YYYY-MM-DD HH:MM` (any of `-/.` between the
 * date parts, a space or a `T` before the time), as an ISO instant carrying
 * the venue's offset. Null when it does not parse.
 */
export function parseVenueDateTime(text: string): string | null {
  const m = /^(\S+)[\sT]+(\S+)$/.exec(westernDigits(text).trim());
  if (!m) return null;
  const day = parseTypedDate(m[1]!);
  const time = parseTypedTime(m[2]!);
  if (!day || !time) return null;
  return `${day}T${time}:00${offsetSuffix(VENUE_OFFSET_MINUTES)}`;
}

function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** An instant as the venue's `YYYY-MM-DD HH:MM`, for a form showing a stored time. */
export function venueDateTimeText(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + VENUE_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The venue's calendar day `days` after `nowMs`, `YYYY-MM-DD`: the example under a date field. */
export function exampleVenueDay(nowMs: number, days = 1): string {
  return venueDateTimeText(new Date(nowMs + days * 24 * 3600_000).toISOString()).slice(0, 10);
}

// ── Draft → record ──────────────────────────────────────────────────────────

export interface AssembleOptions {
  /**
   * Lists whose rows are set by the context (one row per size, per add-on),
   * by template path, with the member that names the row. A row whose other
   * members are all blank is left out: that size is not being changed.
   */
  fixedKeys?: Readonly<Record<string, string>>;
}

function isBlankDraft(value: DraftValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).every(isBlankDraft);
}

/** Every member but `except` is blank (a false switch counts as blank here). */
function rowIsBlank(row: Draft, except: string | null): boolean {
  return Object.entries(row).every(
    ([name, value]) => name === except || value === false || isBlankDraft(value),
  );
}

function childPath(path: string, name: string): string {
  return path === '' ? name : `${path}.${name}`;
}

function scalarFrom(def: FieldDef, text: string): unknown {
  const v = text.trim();
  if (v === '') return undefined;
  switch (def.type) {
    case 'int':
    case 'iqd':
      return parseTypedNumber(v, true);
    case 'number':
      return parseTypedNumber(v, false);
    case 'date':
      return parseTypedDate(v) ?? Number.NaN;
    case 'time':
      return parseTypedTime(v) ?? Number.NaN;
    case 'datetime':
      return parseVenueDateTime(v) ?? Number.NaN;
    default:
      return v;
  }
}

/** One field's record value; undefined leaves the key out. */
export function valueFrom(def: FieldDef, value: DraftValue | undefined, path: string, opts: AssembleOptions): unknown {
  if (value === undefined) return undefined;
  switch (def.type) {
    case 'bool':
      return typeof value === 'boolean' ? value : undefined;
    case 'uuids': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      return ids.length === 0 && !def.required ? undefined : ids;
    }
    case 'ints': {
      const nums = Array.isArray(value) ? (value as string[]).map((s) => parseTypedNumber(s, true)) : [];
      return nums.length === 0 && !def.required ? undefined : nums;
    }
    case 'list': {
      const rows = Array.isArray(value) ? (value as Draft[]) : [];
      const key = opts.fixedKeys?.[path] ?? null;
      const kept = rows
        .filter((row) => !rowIsBlank(row, key))
        .map((row) => recordFrom(def.fields ?? [], row, path, opts));
      return kept.length === 0 && !def.required ? undefined : kept;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return undefined;
      const obj = recordFrom(def.fields ?? [], value as Draft, path, opts);
      // An optional object holding nothing but switches left off was never
      // filled in: a tournament's untouched sponsor is not `{invoice: false}`.
      const untouched = Object.values(obj).every((v) => v === false);
      return untouched && !def.required ? undefined : obj;
    }
    case 'priceMap': {
      const rows = Array.isArray(value) ? (value as Draft[]) : [];
      const map: Record<string, unknown> = {};
      for (const row of rows) {
        const minutes = westernDigits(String(row.minutes ?? '')).trim();
        const price = String(row.price ?? '').trim();
        if (minutes === '' && price === '') continue;
        // A price that does not parse stays NaN, so the map is marked invalid.
        map[minutes === '' ? '?' : minutes] = parseTypedNumber(price, true);
      }
      return Object.keys(map).length === 0 && !def.required ? undefined : map;
    }
    default:
      return typeof value === 'string' ? scalarFrom(def, value) : undefined;
  }
}

function recordFrom(fields: readonly FieldDef[], draft: Draft, path: string, opts: AssembleOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of fields) {
    const v = valueFrom(def, draft[def.name], childPath(path, def.name), opts);
    if (v !== undefined) out[def.name] = v;
  }
  return out;
}

/**
 * The record a draft stands for. Blank optional fields are left out, blank
 * list rows are dropped, and an optional object with nothing in it is left
 * out whole (a tournament with no prize sends no `prize`).
 */
export function recordFromDraft(
  fields: readonly FieldDef[],
  draft: Draft,
  opts: AssembleOptions = {},
): Record<string, unknown> {
  return recordFrom(fields, draft, '', opts);
}

// ── Record → draft ──────────────────────────────────────────────────────────

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

export function draftValueOf(def: FieldDef, value: unknown): DraftValue {
  if (value === null || value === undefined) return emptyValue(def);
  switch (def.type) {
    case 'bool':
      return value === true;
    case 'uuids':
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    case 'ints':
      return Array.isArray(value) ? value.map((v) => String(v)) : [];
    case 'list':
      return Array.isArray(value)
        ? value.map((row) => draftFromRecord(def.fields ?? [], row && typeof row === 'object' ? (row as Record<string, unknown>) : {}))
        : [];
    case 'object':
      return draftFromRecord(def.fields ?? [], typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
    case 'priceMap':
      return typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).map(([minutes, price]) => ({ minutes, price: textOf(price) }))
        : [];
    case 'datetime':
      return typeof value === 'string' ? venueDateTimeText(value) : '';
    case 'time':
      return typeof value === 'string' ? (parseTypedTime(value) ?? value) : '';
    default:
      return textOf(value);
  }
}

/** The draft of a stored record: a resubmission, or an idea the head starts from. */
export function draftFromRecord(fields: readonly FieldDef[], record: Record<string, unknown> | null | undefined): Draft {
  const draft: Draft = {};
  for (const def of fields) draft[def.name] = draftValueOf(def, record?.[def.name]);
  return draft;
}

// ── Editing a draft ─────────────────────────────────────────────────────────

export type DraftPath = readonly (string | number)[];

/** The value at a path, or undefined. */
export function getAt(draft: Draft, path: DraftPath): DraftValue | undefined {
  let node: unknown = draft;
  for (const part of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[part];
  }
  return node as DraftValue | undefined;
}

/** A copy of the draft with one value replaced; every level on the path is copied, nothing else. */
export function setAt(draft: Draft, path: DraftPath, value: DraftValue): Draft {
  if (path.length === 0) return value as Draft;
  const [head, ...rest] = path;
  const copy: Record<string | number, unknown> | unknown[] = Array.isArray(draft) ? [...draft] : { ...draft };
  const current = (draft as unknown as Record<string | number, unknown>)[head!];
  (copy as Record<string | number, unknown>)[head!] =
    rest.length === 0 ? value : setAt((current ?? {}) as Draft, rest, value);
  return copy as Draft;
}

/** The dotted template path of a concrete path: list indices dropped (`lines.0.qty` → `lines.qty`). */
export function templatePath(path: DraftPath): string {
  return path.filter((p) => typeof p === 'string').join('.');
}

/** The dotted concrete path, indices kept, for test ids (`lines.0.qty`). */
export function concretePath(path: DraftPath): string {
  return path.join('.');
}
