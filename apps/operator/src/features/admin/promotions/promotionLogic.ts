/**
 * Pure helpers for the promotion list and editor (spec 06.26 / 06.27):
 * row ↔ draft mapping, validation, the lifecycle label (scheduled / live /
 * expired / off), and the plain-language summaries both screens print. The
 * server applies promotions; nothing here prices a bill.
 */
import { formatDate, formatIQD, formatNumber, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import type { PromotionLimits, PromotionRow, PromotionScope, PromotionType } from './promotionsApi';

/** The `tr` a screen gets from useLocale(), or makeT(locale) in a test. */
export type Translate = (key: MessageKey, params?: TParams) => string;

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

/** Today as YYYY-MM-DD on the station's own calendar, to match isoToDateInput. */
export function todayInput(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The earliest start the picker offers: today, so a new promotion cannot be
 * backdated. A promotion that already began keeps its own start as the floor —
 * that date is history, not a mistake, and flooring it at today would leave the
 * saved value out of range and the native picker unable to reopen on it.
 */
export function minStartOn(savedStartsOn: string, now = new Date()): string {
  const today = todayInput(now);
  return savedStartsOn && savedStartsOn < today ? savedStartsOn : today;
}

/**
 * The earliest end the picker offers: today, or the start once that is later —
 * an end before the start is meaningless. A promotion that already ended keeps
 * its own end as the floor, for the same reason a started one keeps its start.
 */
export function minEndOn(savedEndsOn: string, startsOn: string, now = new Date()): string {
  const today = todayInput(now);
  if (savedEndsOn && savedEndsOn < today) return savedEndsOn;
  return startsOn && startsOn > today ? startsOn : today;
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

export type DraftError = 'name' | 'value' | 'percent' | 'startsPast' | 'endsPast' | 'dates' | 'hours';

export function validateDraft(d: PromotionDraft, savedStartsOn = '', savedEndsOn = '', now = new Date()): DraftError[] {
  const errors: DraftError[] = [];
  if (d.name.en.trim() === '' || d.name.ar.trim() === '') errors.push('name');
  if (!(d.value > 0)) errors.push('value');
  else if (d.type === 'percent' && (d.value < 1 || d.value > 99)) errors.push('percent');
  // The input's `min` already stops the picker; this catches a typed-in date,
  // which the browser accepts out of range.
  if (d.startsOn && d.startsOn < minStartOn(savedStartsOn, now)) errors.push('startsPast');
  if (d.endsOn && d.endsOn < todayInput(now) && !(savedEndsOn && d.endsOn === savedEndsOn)) errors.push('endsPast');
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) errors.push('dates');
  // Mirrors upsert_promotion (0067): both hours or neither, and not the same
  // time twice. An end earlier than the start is valid — it runs past
  // midnight (22:00–02:00) — so it is not an error here either.
  if (Boolean(d.hourFrom) !== Boolean(d.hourTo) || (d.hourFrom && d.hourFrom === d.hourTo)) errors.push('hours');
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

// ---------------------------------------------------------------------------
// The list: order, filter, and what each row says
// ---------------------------------------------------------------------------

/** Live first, then those starting later, then off, then ended. */
const LIFECYCLE_ORDER: Record<PromotionLifecycle, number> = { live: 0, scheduled: 1, disabled: 2, expired: 3 };

export const LIFECYCLES = ['live', 'scheduled', 'disabled', 'expired'] as const satisfies readonly PromotionLifecycle[];

export type PromotionFilter = 'all' | PromotionLifecycle;

export function isPromotionFilter(v: unknown): v is PromotionFilter {
  return v === 'all' || (LIFECYCLES as readonly unknown[]).includes(v);
}

type Named = Pick<PromotionRow, 'name_en' | 'name_ar' | 'enabled' | 'starts_at' | 'ends_at'>;

/** Rows in the order a manager reads them: what is running now first, then by name. */
export function sortPromotions<T extends Named>(rows: readonly T[], locale: Locale, now = new Date()): T[] {
  const name = (r: T) => (locale === 'ar' ? r.name_ar || r.name_en : r.name_en || r.name_ar);
  return [...rows].sort(
    (a, b) =>
      LIFECYCLE_ORDER[lifecycle(a, now)] - LIFECYCLE_ORDER[lifecycle(b, now)] ||
      name(a).localeCompare(name(b), locale, { numeric: true, sensitivity: 'base' }),
  );
}

export function countByLifecycle(rows: readonly Pick<PromotionRow, 'enabled' | 'starts_at' | 'ends_at'>[], now = new Date()): Record<PromotionFilter, number> {
  const counts: Record<PromotionFilter, number> = { all: rows.length, live: 0, scheduled: 0, disabled: 0, expired: 0 };
  for (const r of rows) counts[lifecycle(r, now)] += 1;
  return counts;
}

/** Filter by lifecycle, then by a name or code the manager typed. */
export function filterPromotions<T extends Named & Pick<PromotionRow, 'public_code'>>(
  rows: readonly T[],
  filter: PromotionFilter,
  query: string,
  now = new Date(),
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (filter === 'all' || lifecycle(r, now) === filter) &&
      (q === '' || [r.name_en, r.name_ar, r.public_code ?? ''].some((s) => s.toLowerCase().includes(q))),
  );
}

/**
 * The one status word the list prints beside the switch: "Live",
 * "Starts 12 Sep 2026", "Ended 3 Sep 2026" or "Off". Never colour alone.
 */
export function statusText(row: Pick<PromotionRow, 'enabled' | 'starts_at' | 'ends_at'>, tr: Translate, locale: Locale, now = new Date()): string {
  const lc = lifecycle(row, now);
  if (lc === 'scheduled' && row.starts_at) return tr('ws.manager.promotions.startsOn', { date: formatDate(new Date(row.starts_at), locale) });
  if (lc === 'expired' && row.ends_at) return tr('ws.manager.promotions.endedOn', { date: formatDate(new Date(row.ends_at), locale) });
  return tr(lc === 'live' ? 'ws.manager.promotions.live' : 'ws.manager.promotions.disabled');
}

/**
 * How the promotion reaches a bill. `missing` is the trap the server allows:
 * a promotion that is not automatic applies only with its code (0067
 * eligibility), so without a code it can never apply.
 */
export type HowItApplies = { kind: 'auto' } | { kind: 'code'; code: string; singleUse: boolean } | { kind: 'missing' };

export function howItApplies(d: Pick<PromotionDraft, 'auto' | 'publicCode' | 'codeSingleUse'>): HowItApplies {
  if (d.auto) return { kind: 'auto' };
  if (d.publicCode) return { kind: 'code', code: d.publicCode, singleUse: d.codeSingleUse };
  return { kind: 'missing' };
}

export function howText(d: Pick<PromotionDraft, 'auto' | 'publicCode' | 'codeSingleUse'>, tr: Translate): string {
  const how = howItApplies(d);
  // Needing no code is the default and says nothing a manager acts on, so it
  // stays silent; only a code, or a missing one, is worth a line.
  if (how.kind === 'auto') return '';
  if (how.kind === 'missing') return tr('ws.manager.promotions.codeMissing');
  const code = tr('ws.manager.promotions.code', { code: how.code });
  return how.singleUse ? `${code} · ${tr('ws.manager.promotions.singleUse')}` : code;
}

/** What it covers: "All cafe items", or label + number per narrowed list (no plurals needed). */
export function scopeText(scope: PromotionScope, tr: Translate, locale: Locale): string {
  if (!hasScope(scope)) return tr('ws.manager.promotions.allCafe');
  const parts: string[] = [];
  if (scope.courtIds.length) parts.push(tr('ws.manager.promotions.scopeCourts', { n: formatNumber(scope.courtIds.length, locale) }));
  if (scope.categoryIds.length) parts.push(tr('ws.manager.promotions.scopeCategories', { n: formatNumber(scope.categoryIds.length, locale) }));
  if (scope.itemIds.length) parts.push(tr('ws.manager.promotions.scopeItems', { n: formatNumber(scope.itemIds.length, locale) }));
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// When it applies: dates, weekdays and hours in one line
// ---------------------------------------------------------------------------

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Chosen weekdays as short names, with three or more days in a row folded to
 * a range: [0,1,2,3,4] → "Sun–Thu", [5,6] → "Fri, Sat", [4,5,6,0] → "Thu–Sun".
 * The week wraps, so a run can cross Saturday into Sunday. None or all seven
 * mean every day, which is `null` (nothing to say).
 */
export function weekdaysText(weekdays: readonly number[], tr: Translate): string | null {
  const set = new Set(weekdays.filter((d) => d >= 0 && d <= 6));
  if (set.size === 0 || set.size === 7) return null;
  const day = (d: number) => tr(`op.days.${DAY_KEYS[d]!}`);
  // Start just after a day that is NOT chosen, so no run is split in two.
  let start = 0;
  while (set.has(start)) start += 1;
  const runs: number[][] = [];
  for (let i = 1; i <= 7; i += 1) {
    const d = (start + i) % 7;
    if (!set.has(d)) continue;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === (d + 6) % 7) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? tr('ws.manager.promotions.dayRange', { from: day(run[0]!), to: day(run[run.length - 1]!) })
        : run.map(day).join(tr('ws.manager.promotions.listSep')),
    )
    .join(tr('ws.manager.promotions.listSep'));
}

/** "16:00–19:00", or "22:00–02:00 (overnight)" when the end is earlier than the start. */
export function hoursText(hourFrom: string, hourTo: string, tr: Translate): string | null {
  if (!hourFrom || !hourTo) return null;
  return tr(hourTo < hourFrom ? 'ws.manager.promotions.hoursOvernight' : 'ws.manager.promotions.hoursRange', { from: hourFrom, to: hourTo });
}

/** A YYYY-MM-DD calendar day, formatted. Noon, so no timezone can move it to a neighbouring day. */
function dayLabel(ymd: string, locale: Locale): string {
  return formatDate(new Date(`${ymd}T12:00:00`), locale);
}

export function datesText(startsOn: string, endsOn: string, tr: Translate, locale: Locale): string | null {
  if (startsOn && endsOn) return tr('ws.manager.promotions.dateRange', { from: dayLabel(startsOn, locale), to: dayLabel(endsOn, locale) });
  if (startsOn) return tr('ws.manager.promotions.from', { date: dayLabel(startsOn, locale) });
  if (endsOn) return tr('ws.manager.promotions.until', { date: dayLabel(endsOn, locale) });
  return null;
}

type Schedule = Pick<PromotionDraft, 'startsOn' | 'endsOn' | 'weekdays' | 'hourFrom' | 'hourTo'>;

/** Dates · weekdays · hours, or "Any day, any time". */
export function scheduleText(d: Schedule, tr: Translate, locale: Locale): string {
  const parts = [datesText(d.startsOn, d.endsOn, tr, locale), weekdaysText(d.weekdays, tr), hoursText(d.hourFrom, d.hourTo, tr)].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? parts.join(' · ') : tr('ws.manager.promotions.anyTime');
}

// ---------------------------------------------------------------------------
// The editor's one-line summary
// ---------------------------------------------------------------------------

/**
 * What the promotion does, in one line built from the draft as it stands:
 * "10% off everything from the cafe · Fri, Sat · 16:00–19:00".
 *
 * Wording follows what the server really does (0067): with no category or
 * item chosen the discount is on the cafe goods, never the court fee; courts
 * only decide which bills qualify; a minimum spend counts the whole bill.
 */
export function describePromotion(d: PromotionDraft, tr: Translate, locale: Locale): string {
  const off =
    d.type === 'percent'
      ? tr('ws.manager.promotions.summary.percentOff', { value: formatNumber(d.value, locale) })
      : tr('ws.manager.promotions.summary.amountOff', { amount: formatIQD(Math.max(0, Math.round(d.value)), locale) });
  const cats = d.scope.categoryIds.length > 0;
  const items = d.scope.itemIds.length > 0;
  const what = tr(
    cats && items
      ? 'ws.manager.promotions.summary.categoriesAndItems'
      : cats
        ? 'ws.manager.promotions.summary.categories'
        : items
          ? 'ws.manager.promotions.summary.items'
          : 'ws.manager.promotions.summary.allCafe',
  );
  const parts = [tr('ws.manager.promotions.summary.offWhat', { off, what })];
  if (d.scope.courtIds.length > 0) parts.push(tr('ws.manager.promotions.summary.courts'));
  parts.push(scheduleText(d, tr, locale));
  if (d.limits.minSpendIqd !== null && d.limits.minSpendIqd > 0) {
    parts.push(tr('ws.manager.promotions.summary.minSpend', { amount: formatIQD(d.limits.minSpendIqd, locale) }));
  }
  if (d.limits.total !== null) parts.push(tr('ws.manager.promotions.summary.total', { n: formatNumber(d.limits.total, locale) }));
  if (d.limits.perCustomer !== null) parts.push(tr('ws.manager.promotions.summary.perCustomer', { n: formatNumber(d.limits.perCustomer, locale) }));
  const how = howText(d, tr);
  if (how) parts.push(how);
  return parts.join(' · ');
}

/** The single reason Save is unavailable, in the order the form reads. */
export function saveBlocker(errors: readonly DraftError[]): DraftError | null {
  const order: DraftError[] = ['name', 'value', 'percent', 'startsPast', 'endsPast', 'dates', 'hours'];
  return order.find((e) => errors.includes(e)) ?? null;
}
