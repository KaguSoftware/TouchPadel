/**
 * Pure helpers for the promotion list and editor (spec 06.26 / 06.27):
 * row ↔ draft mapping, validation, and the lifecycle label (scheduled / live /
 * expired / off). The server applies promotions; nothing here prices a bill.
 */
import type { PromotionLimits, PromotionRow, PromotionScope, PromotionType } from './promotionsApi';

export interface PromotionDraft {
  name: { en: string; ar: string };
  type: PromotionType;
  value: number;
  /** YYYY-MM-DD or '' */
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  /** HH:MM or '' */
  hourFrom: string;
  hourTo: string;
  scope: PromotionScope;
  limits: PromotionLimits;
  auto: boolean;
  publicCode: string | null;
  codeSingleUse: boolean;
  enabled: boolean;
}

export const EMPTY_DRAFT: PromotionDraft = {
  name: { en: '', ar: '' },
  type: 'percent',
  value: 10,
  startsOn: '',
  endsOn: '',
  weekdays: [],
  hourFrom: '',
  hourTo: '',
  scope: { courtIds: [], categoryIds: [], itemIds: [] },
  limits: { total: null, perCustomer: null, minSpendIqd: null },
  auto: true,
  publicCode: null,
  codeSingleUse: false,
  enabled: true,
};

/** ISO timestamp → YYYY-MM-DD (station-local calendar day), '' for null. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'HH:MM:SS' | 'HH:MM' → 'HH:MM', '' for null. */
export function timeToInput(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

export function fromRow(row: PromotionRow): PromotionDraft {
  return {
    name: { en: row.name_en, ar: row.name_ar },
    type: row.type,
    value: row.value,
    startsOn: isoToDateInput(row.starts_at),
    endsOn: isoToDateInput(row.ends_at),
    weekdays: [...(row.weekdays ?? [])].sort((a, b) => a - b),
    hourFrom: timeToInput(row.hour_from),
    hourTo: timeToInput(row.hour_to),
    scope: {
      courtIds: row.scope?.courtIds ?? [],
      categoryIds: row.scope?.categoryIds ?? [],
      itemIds: row.scope?.itemIds ?? [],
    },
    limits: {
      total: row.limits?.total ?? null,
      perCustomer: row.limits?.perCustomer ?? null,
      minSpendIqd: row.limits?.minSpendIqd ?? null,
    },
    auto: row.auto,
    publicCode: row.public_code,
    codeSingleUse: row.code_single_use,
    enabled: row.enabled,
  };
}

/**
 * Arguments for `app.upsert_promotion` — `p_` + the 0067 column names. Dates
 * are sent as the start of the start day and the END of the end day in the
 * station's local time so "ends 12 Sep" includes the 12th.
 */
export function toRpcArgs(draft: PromotionDraft, id: string | null): Record<string, unknown> {
  return {
    p_id: id,
    p_name_en: draft.name.en.trim(),
    p_name_ar: draft.name.ar.trim(),
    p_type: draft.type,
    p_value: draft.value,
    p_starts_at: draft.startsOn ? new Date(`${draft.startsOn}T00:00:00`).toISOString() : null,
    p_ends_at: draft.endsOn ? new Date(`${draft.endsOn}T23:59:59.999`).toISOString() : null,
    p_weekdays: [...draft.weekdays].sort((a, b) => a - b),
    p_hour_from: draft.hourFrom || null,
    p_hour_to: draft.hourTo || null,
    p_scope: {
      courtIds: draft.scope.courtIds,
      categoryIds: draft.scope.categoryIds,
      itemIds: draft.scope.itemIds,
    },
    p_limits: {
      total: draft.limits.total,
      perCustomer: draft.limits.perCustomer,
      minSpendIqd: draft.limits.minSpendIqd,
    },
    p_auto: draft.auto,
    p_public_code: draft.publicCode,
    p_code_single_use: draft.codeSingleUse,
    p_enabled: draft.enabled,
  };
}

export type DraftError = 'name' | 'value' | 'percent' | 'dates' | 'hours';

export function validateDraft(d: PromotionDraft): DraftError[] {
  const errors: DraftError[] = [];
  if (d.name.en.trim() === '' || d.name.ar.trim() === '') errors.push('name');
  if (!(d.value > 0)) errors.push('value');
  else if (d.type === 'percent' && (d.value < 1 || d.value > 99)) errors.push('percent');
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) errors.push('dates');
  if (d.hourFrom && d.hourTo && d.hourTo <= d.hourFrom) errors.push('hours');
  return errors;
}

export function isDirty(a: PromotionDraft, b: PromotionDraft): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export type PromotionLifecycle = 'disabled' | 'scheduled' | 'live' | 'expired';

/** Lifecycle from the row's own dates against the station clock — a label, not a pricing decision. */
export function lifecycle(row: Pick<PromotionRow, 'enabled' | 'starts_at' | 'ends_at'>, now = new Date()): PromotionLifecycle {
  if (row.ends_at && new Date(row.ends_at).getTime() < now.getTime()) return 'expired';
  if (!row.enabled) return 'disabled';
  if (row.starts_at && new Date(row.starts_at).getTime() > now.getTime()) return 'scheduled';
  return 'live';
}

/** Whether the scope narrows the promotion below "the whole bill". */
export function hasScope(scope: PromotionScope): boolean {
  return scope.courtIds.length + scope.categoryIds.length + scope.itemIds.length > 0;
}

export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function toggleWeekday(list: readonly number[], day: number): number[] {
  return (list.includes(day) ? list.filter((d) => d !== day) : [...list, day]).sort((a, b) => a - b);
}
