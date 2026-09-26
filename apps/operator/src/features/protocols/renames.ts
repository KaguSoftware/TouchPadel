/**
 * Size and add-on renames riding on a price change (wave5-addendum-2026-09-25
 * §2.2, #9). A manager can no longer rename a launched size, or a launched
 * paid option, directly (0195's lock, PRICE_VIA_PROTOCOL hint `name`); the
 * `price` and `addon_price` proposals carry `renames` instead, which the
 * owner's OK applies with the prices.
 *
 * The form keeps in the record only the rows whose names differ from today's
 * (the server refuses an unchanged one, RECORD_INVALID hint `renames`), so
 * what is on screen is exactly what is sent. A name is compared as the server
 * compares it: surrounding whitespace is not a rename, a case change is.
 *
 * Pure: records in, records out.
 */
import type { PriceChangeKind } from '@touch/core/protocols';
import { isObj } from './protocolLogic';
import type { Obj } from './formModel';

/** The member that names a rename's size (`price`) or add-on (`addon_price`). */
export type RenameKey = 'variant_id' | 'modifier_id';

export function renameKeyOf(change: PriceChangeKind | null): RenameKey | null {
  if (change === 'price') return 'variant_id';
  if (change === 'addon_price') return 'modifier_id';
  return null;
}

export interface RenameEntry {
  id: string;
  name_en: string;
  name_ar: string;
}

export interface CurrentNames {
  id: string;
  name_en: string;
  name_ar: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The renames a record holds, by the id its change names them with. */
export function renameEntries(record: Obj, key: RenameKey): RenameEntry[] {
  const list = Array.isArray(record.renames) ? record.renames : [];
  return list
    .filter(isObj)
    .filter((r) => typeof r[key] === 'string')
    .map((r) => ({ id: r[key] as string, name_en: text(r.name_en), name_ar: text(r.name_ar) }));
}

/** Both names as today's, whitespace aside: nothing to rename. */
export function isSameName(
  current: Pick<CurrentNames, 'name_en' | 'name_ar'>,
  en: string,
  ar: string,
): boolean {
  return en.trim() === current.name_en.trim() && ar.trim() === current.name_ar.trim();
}

/**
 * The record with one row's names typed: kept while they differ from today's,
 * dropped the moment they are today's again. Rows keep the order they were
 * first touched in, so an issue's index keeps pointing at the same row. A
 * language left empty keeps today's name, as on the phone and /tasks
 * (staff/protocols `completeRenames`).
 */
export function putRename(
  record: Obj,
  key: RenameKey,
  current: CurrentNames,
  typedEn: string,
  typedAr: string,
): Obj {
  const en = typedEn.trim() === '' ? current.name_en : typedEn;
  const ar = typedAr.trim() === '' ? current.name_ar : typedAr;
  const list = (Array.isArray(record.renames) ? record.renames : []).filter(isObj);
  const at = list.findIndex((r) => r[key] === current.id);
  const same = isSameName(current, en, ar);
  let next: Obj[];
  if (same) next = list.filter((_, i) => i !== at);
  else if (at >= 0)
    next = list.map((r, i) => (i === at ? { [key]: current.id, name_en: en, name_ar: ar } : r));
  else next = [...list, { [key]: current.id, name_en: en, name_ar: ar }];
  return { ...record, renames: next };
}

/** The record without one row's rename ("Keep the name"). */
export function dropRename(record: Obj, key: RenameKey, id: string): Obj {
  const list = (Array.isArray(record.renames) ? record.renames : []).filter(isObj);
  return { ...record, renames: list.filter((r) => r[key] !== id) };
}

/** The index a row's rename has in the record, for the issue the server or the check ties to it. */
export function renameIndex(record: Obj, key: RenameKey, id: string): number {
  const list = Array.isArray(record.renames) ? record.renames : [];
  return list.findIndex((r) => isObj(r) && r[key] === id);
}

/**
 * The renames as they are sent: names trimmed, the check's own `before_*`
 * copies left for the server to write again (a resubmission carries them),
 * and no `renames` key at all when nothing is renamed.
 */
export function finalizeRenames(record: Obj): Obj {
  if (!('renames' in record)) return record;
  const key = renameKeyOf((record.change as PriceChangeKind | undefined) ?? null);
  const list = Array.isArray(record.renames) ? record.renames.filter(isObj) : [];
  const out = { ...record };
  if (!key || list.length === 0) {
    delete out.renames;
    return out;
  }
  out.renames = list.map((r) => ({
    [key]: r[key],
    name_en: text(r.name_en).trim(),
    name_ar: text(r.name_ar).trim(),
  }));
  return out;
}

/** One rename the numbers step shows: "Small (4,000 IQD) → Large" (app.price_promo_numbers, 0195). */
export interface NumbersRename {
  target: 'size' | 'addon';
  id: string;
  from_en: string;
  from_ar: string;
  to_en: string;
  to_ar: string;
  /** What it sells at once applied: this change's figure, else today's price. */
  price_iqd: number | null;
}

export function readNumbersRenames(raw: unknown): NumbersRename[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .filter((r) => typeof r.id === 'string')
    .map((r) => ({
      target: r.target === 'addon' ? 'addon' : 'size',
      id: r.id as string,
      from_en: text(r.from_en),
      from_ar: text(r.from_ar),
      to_en: text(r.to_en),
      to_ar: text(r.to_ar),
      price_iqd:
        typeof r.price_iqd === 'number' && Number.isFinite(r.price_iqd) ? r.price_iqd : null,
    }));
}

/** A sent rename read back on the run sheet: from the check's `before_*`, else the names this screen knows. */
export function renameReadBack(
  el: Obj,
  key: RenameKey,
  known: Readonly<Record<string, { en: string; ar: string }>>,
): { from_en: string; from_ar: string; to_en: string; to_ar: string } | null {
  const id = el[key];
  if (typeof id !== 'string') return null;
  const k = known[id];
  const from_en = text(el.before_en) || k?.en || '';
  const from_ar = text(el.before_ar) || k?.ar || '';
  return { from_en, from_ar, to_en: text(el.name_en), to_ar: text(el.name_ar) };
}
