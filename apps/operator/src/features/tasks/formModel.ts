/**
 * The draft behind a protocol form on /tasks (build-contracts-2026-09-23
 * §5.4, §7.2). Every form renders from `@touch/core/protocols`' field lists,
 * so the operator asks for exactly what the phone asks for; this module turns
 * a field list into an empty draft, a draft into the record the server takes,
 * and a record (a sent-back submission, an idea, a price target) back into a
 * draft.
 *
 * A draft mirrors the record's shape with the control's own value at each
 * leaf: text as typed (''), numbers as number | null, an optional group as
 * null until it is added, a price map as a list of rows, and a date-time as
 * the `YYYY-MM-DDTHH:mm` a datetime-local box holds, read in the venue's time
 * zone. Nothing here decides what is valid: `validateStep` does that, with the
 * server's hint names, and the server has the last word.
 */
import { wallTimeToUtc } from '@touch/core';
import type { FieldDef } from '@touch/core/protocols';
import { VENUE_TZ } from '@touch/i18n';

export type Draft = Record<string, unknown>;

export interface PriceMapRow {
  duration: number | null;
  price: number | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ── Empty ───────────────────────────────────────────────────────────────────

/** What an untouched control holds for one field. */
export function emptyValue(def: FieldDef): unknown {
  switch (def.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'uuid':
    case 'date':
    case 'datetime':
    case 'time':
      return '';
    // A required choice starts on its first option only when the form offers
    // no sensible "none yet"; everything else waits for a pick.
    case 'enum':
      return '';
    case 'int':
    case 'iqd':
    case 'number':
      return null;
    case 'uuids':
    case 'ints':
      return [];
    case 'bool':
      return def.required ? true : null;
    case 'priceMap':
      return def.required ? [{ duration: null, price: null }] : [];
    case 'list':
      return Array.from({ length: def.required ? Math.max(1, def.minItems ?? 1) : 0 }, () => emptyDraft(def.fields ?? []));
    case 'object':
      return def.required ? emptyDraft(def.fields ?? []) : null;
  }
}

export function emptyDraft(fields: readonly FieldDef[]): Draft {
  const out: Draft = {};
  for (const f of fields) out[f.name] = emptyValue(f);
  return out;
}

// ── Draft → record ──────────────────────────────────────────────────────────

/** `YYYY-MM-DDTHH:mm` in the venue's zone → an ISO instant, or null. */
export function localToIso(local: string, tz: string = VENUE_TZ): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return wallTimeToUtc(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz).toISOString();
}

/** An ISO instant → the `YYYY-MM-DDTHH:mm` a datetime-local box shows, in the venue's zone. */
export function isoToLocal(iso: string, tz: string = VENUE_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Is this draft value what an untouched control holds? */
export function isEmptyValue(def: FieldDef, value: unknown): boolean {
  switch (def.type) {
    case 'list':
      return !Array.isArray(value) || value.every((e) => isObject(e) && isEmptyDraft(def.fields ?? [], e));
    case 'object':
      return value === null || value === undefined || (isObject(value) && isEmptyDraft(def.fields ?? [], value));
    case 'priceMap':
      return !Array.isArray(value) || value.every((r) => isObject(r) && r.duration == null && r.price == null);
    case 'uuids':
    case 'ints':
      return !Array.isArray(value) || value.length === 0;
    case 'bool':
      return value === null || value === undefined;
    default:
      return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  }
}

function isEmptyDraft(fields: readonly FieldDef[], draft: Record<string, unknown>): boolean {
  return fields.every((f) => f.type === 'bool' || isEmptyValue(f, draft[f.name]));
}

function leafToRecord(def: FieldDef, value: unknown, tz: string): unknown {
  switch (def.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'uuid':
    case 'date':
    case 'enum':
      return typeof value === 'string' ? value.trim() : value;
    case 'time':
      return typeof value === 'string' ? value.trim() : value;
    case 'datetime':
      return typeof value === 'string' ? (localToIso(value.trim(), tz) ?? value.trim()) : value;
    case 'priceMap': {
      const out: Record<string, number> = {};
      for (const row of Array.isArray(value) ? value : []) {
        if (!isObject(row) || row.duration == null) continue;
        out[String(row.duration)] = typeof row.price === 'number' ? row.price : Number.NaN;
      }
      return out;
    }
    default:
      return value;
  }
}

/**
 * The record a draft stands for. A field left empty is left out (the server
 * reads a missing optional as "none"; a missing required one comes back as
 * RECORD_INVALID with its hint), a list drops the rows nobody filled in, and
 * an optional group that was never added is left out whole.
 */
export function toRecord(fields: readonly FieldDef[], draft: Draft, tz: string = VENUE_TZ): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of fields) {
    const value = draft[def.name];
    if (def.type === 'list') {
      const rows = (Array.isArray(value) ? value : [])
        .filter((e): e is Record<string, unknown> => isObject(e) && !isEmptyDraft(def.fields ?? [], e))
        .map((e) => toRecord(def.fields ?? [], e, tz));
      if (rows.length > 0 || def.required) out[def.name] = rows;
      continue;
    }
    if (def.type === 'object') {
      if (!isObject(value)) continue;
      if (!def.required && isEmptyDraft(def.fields ?? [], value)) continue;
      out[def.name] = toRecord(def.fields ?? [], value, tz);
      continue;
    }
    if (isEmptyValue(def, value)) {
      if (def.required && (def.type === 'uuids' || def.type === 'ints')) out[def.name] = [];
      continue;
    }
    out[def.name] = leafToRecord(def, value, tz);
  }
  return out;
}

// ── Record → draft ──────────────────────────────────────────────────────────

function leafToDraft(def: FieldDef, value: unknown, tz: string): unknown {
  if (value === null || value === undefined) return emptyValue(def);
  switch (def.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'uuid':
    case 'date':
    case 'enum':
      return typeof value === 'string' ? value : String(value);
    case 'time':
      // The server stores HH:MM:SS; a time box shows HH:MM.
      return typeof value === 'string' ? value.slice(0, 5) : '';
    case 'datetime':
      return typeof value === 'string' ? isoToLocal(value, tz) : '';
    case 'int':
    case 'iqd':
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'uuids':
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    case 'ints':
      return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
    case 'bool':
      return typeof value === 'boolean' ? value : null;
    case 'priceMap':
      return isObject(value)
        ? Object.entries(value)
            .map(([k, v]): PriceMapRow => ({ duration: Number(k), price: typeof v === 'number' ? v : Number(v) }))
            .sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0))
        : emptyValue(def);
    default:
      return value;
  }
}

/**
 * A draft prefilled from a record: a sent-back submission, an idea, a price
 * target. Keys the form does not ask for are dropped; a missing key starts
 * empty.
 */
export function fromRecord(fields: readonly FieldDef[], record: unknown, tz: string = VENUE_TZ): Draft {
  const src = isObject(record) ? record : {};
  const out: Draft = {};
  for (const def of fields) {
    const value = src[def.name];
    if (def.type === 'list') {
      const rows = Array.isArray(value) ? value.filter(isObject).map((e) => fromRecord(def.fields ?? [], e, tz)) : [];
      out[def.name] = rows.length > 0 ? rows : emptyValue(def);
    } else if (def.type === 'object') {
      out[def.name] = isObject(value) ? fromRecord(def.fields ?? [], value, tz) : emptyValue(def);
    } else {
      out[def.name] = leafToDraft(def, value, tz);
    }
  }
  return out;
}

// ── Paths ───────────────────────────────────────────────────────────────────

/** Replace the value at `path` (names and list indexes) inside a draft, immutably. */
export function setIn(draft: unknown, path: readonly (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const arr = Array.isArray(draft) ? [...draft] : [];
    arr[head] = setIn(arr[head], rest, value);
    return arr;
  }
  const obj = isObject(draft) ? { ...draft } : {};
  obj[head!] = setIn(obj[head!], rest, value);
  return obj;
}

export function getIn(draft: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = draft;
  for (const key of path) {
    if (typeof key === 'number') cur = Array.isArray(cur) ? cur[key] : undefined;
    else cur = isObject(cur) ? cur[key] : undefined;
  }
  return cur;
}

/**
 * The server's hint for a control (§7.2): an object member is `a.b`, and
 * anything inside a list element is the list's own name, with the element's
 * index beside it. So `ranges[2].from` is hint `ranges`, index 2.
 */
export function hintFor(path: readonly (string | number)[]): { field: string; index?: number } {
  const names: string[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const key = path[i]!;
    if (typeof key === 'number') return { field: names.join('.'), index: key };
    names.push(key);
  }
  return { field: names.join('.') };
}
