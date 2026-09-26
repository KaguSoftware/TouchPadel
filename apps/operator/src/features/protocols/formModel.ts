/**
 * One step form's working value, built from the field list both apps share
 * (`@touch/core/protocols` stepForm, build-contracts-2026-09-23 §7.2, plan
 * #38): the value a form opens with, the record it sends, and where a refusal
 * lands. The walker knows field TYPES only; which picker fills an id field is
 * the form's business (StepForm.tsx).
 *
 * A form holds numbers as numbers (or null while blank) and text as typed;
 * `cleanRecord` trims, and drops what was left blank, so the record the server
 * checks is the one the core validator checked (`validateStep`).
 */
import type { FieldDef, FieldIssue } from '@touch/core/protocols';
import { isObj } from './protocolLogic';

export type Obj = Record<string, unknown>;

/** The start value of an enum with an obvious default, by field name (a unit, a schedule). */
const ENUM_DEFAULTS: Record<string, string> = {
  when: 'now',
  recommendation: 'go',
  unit: 'g',
  type: 'percent',
};

export function blankValue(def: FieldDef, path: readonly string[] = [def.name]): unknown {
  switch (def.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'uuid':
    case 'date':
    case 'datetime':
    case 'time':
      return '';
    case 'enum': {
      const d = ENUM_DEFAULTS[def.name];
      // capacity.unit is players or pairs, a recipe line's unit is g, ml or pc.
      if (path.join('.') === 'capacity.unit') return 'players';
      return d && (def.options ?? []).includes(d) ? d : '';
    }
    case 'int':
    case 'iqd':
    case 'number':
      return null;
    case 'uuids':
    case 'ints':
      return [];
    case 'bool':
      return def.name === 'is_active';
    case 'priceMap':
      return {};
    case 'object':
      return blankObject(def.fields ?? [], path);
    case 'list':
      // A list that must hold a row starts with one to fill in.
      return (def.minItems ?? 0) > 0 ? [blankObject(def.fields ?? [], path)] : [];
  }
}

export function blankObject(fields: readonly FieldDef[], path: readonly string[] = []): Obj {
  const out: Obj = {};
  for (const f of fields) out[f.name] = blankValue(f, [...path, f.name]);
  return out;
}

/**
 * A form's start value: blanks for every field, overlaid with a prefill (the
 * record sent before, an idea, a target's current figures). A prefill key the
 * form does not have is kept, so a record read back sends what it held.
 */
export function initialValue(fields: readonly FieldDef[], prefill?: Obj | null): Obj {
  return mergeDeep(blankObject(fields), prefill ?? {}, fields);
}

function mergeDeep(base: Obj, over: Obj, fields: readonly FieldDef[]): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const def = fields.find((f) => f.name === k);
    if (def?.type === 'object' && isObj(v)) out[k] = mergeDeep(isObj(base[k]) ? (base[k] as Obj) : {}, v, def.fields ?? []);
    else if (def?.type === 'list' && Array.isArray(v)) {
      out[k] = v.map((el) => (isObj(el) ? mergeDeep(blankObject(def.fields ?? []), el, def.fields ?? []) : el));
    } else if (v === null && def && (def.type === 'text' || def.type === 'longText' || def.type === 'url' || def.type === 'uuid' || def.type === 'enum')) {
      out[k] = '';
    } else out[k] = v;
  }
  return out;
}

const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function allBlank(value: unknown): boolean {
  if (blank(value)) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isObj(value)) return Object.values(value).every((v) => (typeof v === 'boolean' ? true : allBlank(v)));
  return false;
}

/**
 * Whether a row or an optional object is untouched: every member blank, a
 * switch or a choice with a default not counting (a new recipe line's unit is
 * already `g`, an unticked "invoice" is not a sponsor).
 */
export function untouched(fields: readonly FieldDef[], value: Obj): boolean {
  return fields.every((f) => f.type === 'bool' || f.type === 'enum' || allBlank(value[f.name]));
}

function cleanField(def: FieldDef, value: unknown): unknown {
  switch (def.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'uuid':
    case 'enum':
    case 'date':
    case 'datetime':
    case 'time':
      return typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value ?? undefined;
    case 'int':
    case 'iqd':
    case 'number':
      return value === null || value === '' ? undefined : value;
    case 'uuids':
      return Array.isArray(value) && (value.length > 0 || def.required) ? value : undefined;
    case 'ints':
      return Array.isArray(value) ? value : undefined;
    case 'bool':
      return typeof value === 'boolean' ? value : undefined;
    case 'priceMap': {
      if (!isObj(value)) return undefined;
      const entries = Object.entries(value).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
      return entries.length === 0 && !def.required ? undefined : Object.fromEntries(entries);
    }
    case 'object': {
      if (!isObj(value)) return undefined;
      // An optional object left blank is not sent: an untouched sponsor or hero line.
      if (!def.required && untouched(def.fields ?? [], value)) return undefined;
      return cleanObject(def.fields ?? [], value);
    }
    case 'list': {
      if (!Array.isArray(value)) return undefined;
      const rows = value
        .filter((el) => !(isObj(el) && untouched(def.fields ?? [], el)))
        .map((el) => (isObj(el) ? cleanObject(def.fields ?? [], el) : el));
      return rows.length === 0 && !def.required ? undefined : rows;
    }
  }
}

function cleanObject(fields: readonly FieldDef[], value: Obj): Obj {
  const out: Obj = {};
  for (const f of fields) {
    const v = cleanField(f, value[f.name]);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

/**
 * The record a form sends: trimmed, blanks left out, an untouched optional
 * object or row dropped. Keys the form does not list are kept as they are
 * (a resubmission carries the run's fixed `change`, a check-added `before`).
 */
export function cleanRecord(fields: readonly FieldDef[], value: Obj): Obj {
  const listed = new Set(fields.map((f) => f.name));
  const out = cleanObject(fields, value);
  for (const [k, v] of Object.entries(value)) if (!listed.has(k) && v !== undefined) out[k] = v;
  return out;
}

// ── Paths ───────────────────────────────────────────────────────────────────

export function getAt(value: unknown, path: readonly (string | number)[]): unknown {
  let cur: unknown = value;
  for (const p of path) {
    if (typeof p === 'number') cur = Array.isArray(cur) ? cur[p] : undefined;
    else cur = isObj(cur) ? cur[p] : undefined;
  }
  return cur;
}

/** An immutable set at a path of object keys and list indexes. */
export function setAt(value: unknown, path: readonly (string | number)[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const list = Array.isArray(value) ? [...value] : [];
    list[head] = setAt(list[head], rest, next);
    return list;
  }
  const obj: Obj = isObj(value) ? { ...value } : {};
  obj[head as string] = setAt(obj[head as string], rest, next);
  return obj;
}

/**
 * The hint a refusal names for a control (§2.8, `validate.ts`): the top-level
 * name, `promotion.public_code` inside an object, and inside a list element the
 * list's own name with the element's index.
 */
export function hintOf(path: readonly (string | number)[]): { field: string; index?: number } {
  const listAt = path.findIndex((p) => typeof p === 'number');
  if (listAt === -1) return { field: path.join('.') };
  return { field: path.slice(0, listAt).join('.'), index: path[listAt] as number };
}

/** The issue a control shows, if any: a list row's issue marks the row, not each of its members. */
export function issueAt(issues: readonly FieldIssue[], path: readonly (string | number)[]): FieldIssue | null {
  const h = hintOf(path);
  return issues.find((i) => i.field === h.field && (h.index === undefined ? i.index === undefined : i.index === h.index)) ?? null;
}

/**
 * The catalog id of a field's label: its path without list indexes, joined
 * with `_` (`sponsor_contribution_iqd`, `lines_qty`). A label shared by every
 * form sits under the bare name (`notes`); `labelIds` lists both, most
 * specific first, and the form takes the first the catalog has.
 */
export function labelIds(path: readonly (string | number)[]): string[] {
  const names = path.filter((p): p is string => typeof p === 'string');
  const joined = names.join('_');
  const leaf = names[names.length - 1] ?? '';
  return joined === leaf ? [leaf] : [joined, leaf];
}

// ── Times ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO instant as a `datetime-local` value in this station's time. */
export function toLocalInput(iso: unknown): string {
  if (typeof iso !== 'string' || iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value back to an ISO instant; blank stays blank. */
export function fromLocalInput(v: string): string {
  if (v === '') return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** `HH:MM[:SS]` as `HH:MM`, the time input's own shape. */
export function toTimeInput(v: unknown): string {
  return typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : '';
}

/** An idempotency key for one form's life (§5.3): minted when it opens, reused on retry, replaced after success. */
export function mintKey(intent: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const id = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${intent}:${id}`;
}
