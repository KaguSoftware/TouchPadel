/**
 * A lesson type as the Lesson types tab edits it (docs/design/coaching/
 * operator.md §5.13.2; app.upsert_lesson_type, 0279; C-5, C-17, R26, R46).
 * Pure; no React.
 *
 * - `lessonTypeDraftErrors` mirrors the §1.2 CHECKs on `lesson_types` and
 *   `lesson_types_cutoff` (R26: a group or course type with a minimum above 1
 *   needs a cut-off of at least 1 hour); a new group or course type starts at
 *   a 2-hour cut-off.
 * - `priceLock(type, caps)` is R46's table: a draft (never launched) is
 *   edited directly by a manager, price included (C-17); once launched, a
 *   manager's price and court share are read-only (Propose a price), and so is
 *   the shape that a price proposal snapshots (length, sessions, a private
 *   type's party size: Make a new lesson type…). The owner edits every field.
 *   Switching a launched type off and on is a direct write for both.
 * - `lessonTypePatch` sends only the keys that changed, never a locked one.
 */
import type { AdminLessonType, LessonKind } from '../../coaching/lessonPayloads';

/** The form as typed. Counts stay strings until they are checked. */
export interface LessonTypeDraft {
  kind: LessonKind;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  durationMin: number;
  /** Private: the largest party (1..4). Group and course: the places (2..16). */
  maxPlaces: string;
  /** Group and course: 1..max. Private: always 1. */
  minPlaces: string;
  /** Group and course: 0..168 (≥ 1 when the minimum is above 1). Private: always 0. */
  cutoffHours: string;
  /** Course only: 2..52. */
  sessions: string;
  /** Null: no price yet (a draft only). */
  price: number | null;
  /** Per session (C-6). */
  courtShare: number | null;
  /** The place among its kind's types on the app (the order arrows). */
  sortOrder: number;
}

export type LessonTypeField =
  | 'names'
  | 'descriptions'
  | 'durationMin'
  | 'maxPlaces'
  | 'minPlaces'
  | 'cutoffHours'
  | 'sessions'
  | 'price'
  | 'courtShare';

export type LessonTypeFieldError =
  'names' | 'range' | 'duration' | 'minAboveMax' | 'cutoffMin' | 'wholeNumber' | 'refused';

/** §1.2 bounds. */
export const LESSON_TYPE_LIMITS = {
  name: 60,
  description: 500,
  partySize: { min: 1, max: 4 },
  places: { min: 2, max: 16 },
  cutoff: { min: 0, max: 168 },
  sessions: { min: 2, max: 52 },
  duration: { min: 30, max: 240, step: 30 },
} as const;

/** 30..240 by 30 (§1.2 `duration_min`). */
export const DURATIONS: readonly number[] = Array.from({ length: 8 }, (_, i) => (i + 1) * 30);

/** R26: a new group or course type starts at a 2-hour cut-off. */
export const NEW_GROUP_CUTOFF_HOURS = 2;

const KIND_DEFAULTS: Record<
  LessonKind,
  Pick<LessonTypeDraft, 'maxPlaces' | 'minPlaces' | 'cutoffHours' | 'sessions'>
> = {
  private: { maxPlaces: '4', minPlaces: '1', cutoffHours: '0', sessions: '' },
  group: {
    maxPlaces: '8',
    minPlaces: '2',
    cutoffHours: String(NEW_GROUP_CUTOFF_HOURS),
    sessions: '',
  },
  course: {
    maxPlaces: '8',
    minPlaces: '2',
    cutoffHours: String(NEW_GROUP_CUTOFF_HOURS),
    sessions: '8',
  },
};

export function newLessonTypeDraft(kind: LessonKind = 'private'): LessonTypeDraft {
  return {
    kind,
    nameEn: '',
    nameAr: '',
    descEn: '',
    descAr: '',
    durationMin: 60,
    ...KIND_DEFAULTS[kind],
    price: null,
    courtShare: 0,
    sortOrder: 0,
  };
}

/** A new draft switched to another kind: what the kinds share stays, the places start over. */
export function withKind(d: LessonTypeDraft, kind: LessonKind): LessonTypeDraft {
  if (d.kind === kind) return d;
  return { ...d, kind, ...KIND_DEFAULTS[kind] };
}

const s = (n: number | null) => (n == null ? '' : String(n));

export function draftFromType(t: AdminLessonType): LessonTypeDraft {
  return {
    kind: t.kind,
    nameEn: t.name_en,
    nameAr: t.name_ar,
    descEn: t.description_en,
    descAr: t.description_ar,
    durationMin: t.duration_min ?? 60,
    maxPlaces: s(t.max_places),
    minPlaces: t.kind === 'private' ? '1' : s(t.min_places),
    cutoffHours: t.kind === 'private' ? '0' : s(t.cutoff_hours),
    sessions: t.kind === 'course' ? s(t.sessions_count) : '',
    price: t.price_iqd,
    courtShare: t.court_share_iqd,
    sortOrder: t.sort_order ?? 0,
  };
}

/** "Make a new lesson type…": a new draft prefilled from this one (R46). */
export function draftCopyOf(t: AdminLessonType): LessonTypeDraft {
  return draftFromType(t);
}

export function isLaunched(t: Pick<AdminLessonType, 'launched_at'> | null | undefined): boolean {
  return !!t?.launched_at;
}

export type LessonTypeState = 'draft' | 'onSale' | 'off';

export function typeState(t: Pick<AdminLessonType, 'launched_at' | 'is_active'>): LessonTypeState {
  if (!t.launched_at) return 'draft';
  return t.is_active ? 'onSale' : 'off';
}

const WHOLE = /^\d+$/;

function whole(v: string): number | null {
  const t = v.trim();
  return WHOLE.test(t) ? Number(t) : null;
}

export function lessonTypeDraftErrors(
  d: LessonTypeDraft,
): Partial<Record<LessonTypeField, LessonTypeFieldError>> {
  const L = LESSON_TYPE_LIMITS;
  const errors: Partial<Record<LessonTypeField, LessonTypeFieldError>> = {};
  const en = d.nameEn.trim();
  const ar = d.nameAr.trim();
  if (!en || !ar || en.length > L.name || ar.length > L.name) errors.names = 'names';
  if (d.descEn.length > L.description || d.descAr.length > L.description)
    errors.descriptions = 'range';
  if (!DURATIONS.includes(d.durationMin)) errors.durationMin = 'duration';

  const max = whole(d.maxPlaces);
  const bound = d.kind === 'private' ? L.partySize : L.places;
  if (max === null) errors.maxPlaces = 'wholeNumber';
  else if (max < bound.min || max > bound.max) errors.maxPlaces = 'range';

  if (d.kind !== 'private') {
    const min = whole(d.minPlaces);
    if (min === null) errors.minPlaces = 'wholeNumber';
    else if (min < 1) errors.minPlaces = 'range';
    else if (max !== null && min > max) errors.minPlaces = 'minAboveMax';

    const cutoff = whole(d.cutoffHours);
    if (cutoff === null) errors.cutoffHours = 'wholeNumber';
    else if (cutoff < L.cutoff.min || cutoff > L.cutoff.max) errors.cutoffHours = 'range';
    // R26: `lesson_types_cutoff (kind = 'private' or min_places = 1 or cutoff_hours >= 1)`.
    else if (min !== null && min > 1 && cutoff < 1) errors.cutoffHours = 'cutoffMin';
  }

  if (d.kind === 'course') {
    const n = whole(d.sessions);
    if (n === null) errors.sessions = 'wholeNumber';
    else if (n < L.sessions.min || n > L.sessions.max) errors.sessions = 'range';
  }
  if (d.price !== null && d.price < 0) errors.price = 'range';
  if (d.courtShare !== null && d.courtShare < 0) errors.courtShare = 'range';
  return errors;
}

/** The bounds a `range` error names, per field and kind. */
export function rangeOf(
  field: LessonTypeField,
  kind: LessonKind,
): { min: number; max: number } | null {
  const L = LESSON_TYPE_LIMITS;
  switch (field) {
    case 'maxPlaces':
      return kind === 'private' ? L.partySize : L.places;
    case 'minPlaces':
      return { min: 1, max: L.places.max };
    case 'cutoffHours':
      return L.cutoff;
    case 'sessions':
      return L.sessions;
    case 'descriptions':
      return { min: 0, max: L.description };
    default:
      return null;
  }
}

/** Who edits what on this type (R46). */
export interface PriceLock {
  /** The kind is fixed once the type has gone on sale (both roles). */
  kind: boolean;
  /** Price and court share are read-only (a manager on a launched type: Propose a price). */
  price: boolean;
  /** Length, sessions and a private type's party size are read-only (Make a new lesson type…). */
  shape: boolean;
  /** How a draft goes on sale: a direct write (owner), the protocol (manager); null once launched. */
  launch: 'direct' | 'protocol' | null;
  /** The Active switch: a launched type, switched off and on directly by both roles. */
  activeSwitch: boolean;
}

export interface LessonTypeCaps {
  editLaunchedPrices: boolean;
  launchDirectly: boolean;
}

export function priceLock(type: AdminLessonType | null, caps: LessonTypeCaps): PriceLock {
  if (!isLaunched(type)) {
    return {
      kind: false,
      price: false,
      shape: false,
      launch: caps.launchDirectly ? 'direct' : 'protocol',
      activeSwitch: false,
    };
  }
  const owner = caps.editLaunchedPrices;
  return { kind: true, price: !owner, shape: !owner, launch: null, activeSwitch: true };
}

/** Is a max-places field part of the locked shape? Only a private type's party size is (R46). */
export function maxPlacesLocked(kind: LessonKind, lock: PriceLock): boolean {
  return lock.shape && kind === 'private';
}

/** Why "Put on sale" cannot be pressed yet; null when it can. */
export function launchBlock(
  type: AdminLessonType | null,
  dirty: boolean,
): 'saveFirst' | 'setPriceFirst' | null {
  if (!type || dirty) return 'saveFirst';
  if (type.price_iqd == null) return 'setPriceFirst';
  return null;
}

/** The server's patch keys for every field the form holds, in the shape `upsert_lesson_type` reads. */
function fullPatch(d: LessonTypeDraft): Record<string, unknown> {
  const priv = d.kind === 'private';
  return {
    kind: d.kind,
    name_en: d.nameEn.trim(),
    name_ar: d.nameAr.trim(),
    description_en: d.descEn.trim(),
    description_ar: d.descAr.trim(),
    duration_min: d.durationMin,
    price_iqd: d.price,
    court_share_iqd: d.courtShare ?? 0,
    max_places: whole(d.maxPlaces),
    min_places: priv ? 1 : whole(d.minPlaces),
    cutoff_hours: priv ? 0 : whole(d.cutoffHours),
    sessions_count: d.kind === 'course' ? whole(d.sessions) : null,
    sort_order: d.sortOrder,
  };
}

/**
 * Only what changed, in the server's keys; every key for a new type. A locked
 * field (R46) is never sent, so a stale screen cannot re-send an old price.
 * Call it on a draft without errors.
 */
export function lessonTypePatch(
  saved: AdminLessonType | null,
  d: LessonTypeDraft,
  lock: PriceLock,
): Record<string, unknown> {
  const next = fullPatch(d);
  if (!saved) return next;
  const was = fullPatch(draftFromType(saved));
  const locked = new Set<string>();
  if (lock.kind) locked.add('kind');
  if (lock.price) {
    locked.add('price_iqd');
    locked.add('court_share_iqd');
  }
  if (lock.shape) {
    locked.add('duration_min');
    locked.add('sessions_count');
    if (saved.kind === 'private') locked.add('max_places');
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (locked.has(key)) continue;
    if (value !== was[key]) patch[key] = value;
  }
  return patch;
}

/** The server's patch key → the field a refusal lands on (INVALID_ARGUMENT detail). */
export const LESSON_TYPE_SERVER_FIELD: Record<string, LessonTypeField> = {
  name_en: 'names',
  name_ar: 'names',
  description_en: 'descriptions',
  description_ar: 'descriptions',
  duration_min: 'durationMin',
  price_iqd: 'price',
  court_share_iqd: 'courtShare',
  max_places: 'maxPlaces',
  min_places: 'minPlaces',
  cutoff_hours: 'cutoffHours',
  sessions_count: 'sessions',
};

export function lessonTypeFieldOf(details: string | null | undefined): LessonTypeField | null {
  return details ? (LESSON_TYPE_SERVER_FIELD[details.trim()] ?? null) : null;
}

/** The list's three groups, each in the screen's order (sort_order, then the English name). */
export function groupTypes(
  types: readonly AdminLessonType[],
): Record<LessonKind, AdminLessonType[]> {
  const out: Record<LessonKind, AdminLessonType[]> = { private: [], group: [], course: [] };
  for (const t of types) out[t.kind].push(t);
  for (const k of Object.keys(out) as LessonKind[]) {
    out[k].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name_en.localeCompare(b.name_en),
    );
  }
  return out;
}

/**
 * The order arrows: the `sort_order` that moves a type one place up (-1) or
 * down (+1) among the types of its kind (`sortOrder` is this type's draft
 * value), written to this type alone. Null at either end. A direct edit for a
 * manager too (R46).
 */
export function typeOrderAfterMove(
  types: readonly AdminLessonType[],
  typeId: string,
  kind: LessonKind,
  sortOrder: number,
  delta: -1 | 1,
): number | null {
  const list = groupTypes(
    types.map((t) => (t.lesson_type_id === typeId ? { ...t, sort_order: sortOrder } : t)),
  )[kind];
  const i = list.findIndex((t) => t.lesson_type_id === typeId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const neighbour = list[j]!.sort_order ?? 0;
  return delta < 0 ? neighbour - 1 : neighbour + 1;
}

/** The count of types on sale (the Setup card's "Lesson types on sale 4"). */
export function onSaleCount(types: readonly AdminLessonType[]): number {
  return types.filter((t) => typeState(t) === 'onSale').length;
}
