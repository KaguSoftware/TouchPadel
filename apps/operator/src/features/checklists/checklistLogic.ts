/**
 * Checklists on the operator (build-contracts-2026-09-23 §2.14, §5.5;
 * scheduled-checklists-2026-10-08 §4): the payloads of app.checklist_board
 * and app.checklist_day_state, and the owner's draft of one list with what
 * app.save_checklist accepts.
 *
 * A list is for a role (one shared copy, or everyone their own) or for named
 * people, repeats on chosen weekdays or dates of the month, and is due before
 * opening, before closing or by a set time (0323). A line may need a photo
 * (checklist_photos, §2.24.8): the phone ticks it only with one, and the
 * board carries the photo's path.
 * Pure: no supabase, no react.
 *
 * The readers never trust the payload's shape. Day close and the protocols
 * page both mount these reads, and a payload that is not what this file
 * expects must read as "nothing to show" rather than break either screen. A
 * field the server does not send yet (an operator ahead of its database)
 * reads as the 0165 shape: a shared role list, every day, no due time.
 */
import { formatDate, formatNumber, formatTime, formatWeekdayShort, type MessageKey, type TParams } from '@touch/i18n';
import { HIREABLE_ROLES, type StaffRole } from '@touch/core/staff/roles';

type Tr = (key: MessageKey, params?: TParams) => string;
type Locale = 'en' | 'ar';

export type ChecklistSlot = 'open' | 'close';
export const CHECKLIST_SLOTS: readonly ChecklistSlot[] = ['open', 'close'];

export type Audience = 'role' | 'people';
export type CopyMode = 'shared' | 'each';
export type RepeatKind = 'weekdays' | 'monthdays';
/** The editor's Repeats presets; they only drive the weekdays and month_days fields (§1.1). */
export type RepeatPreset = 'daily' | 'weekdays' | 'monthly' | 'twiceMonthly';
export const REPEAT_PRESETS: readonly RepeatPreset[] = ['daily', 'weekdays', 'monthly', 'twiceMonthly'];
/** The editor's Due choices: the branch's opening or closing time, or a time the owner types. */
export type DueKind = 'open' | 'close' | 'time';
export const DUE_KINDS: readonly DueKind[] = ['open', 'close', 'time'];

/** 0 = Sunday, the coach_hours convention (§1.1). */
export const WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
/** A month date past the month's end means its last day, so 31 is "Last day". */
export const LAST_DAY = 31;
/** The dates the editor offers: 1..28 (every month has them) plus Last day. */
export const MONTH_DAY_CHOICES: readonly number[] = [...Array.from({ length: 28 }, (_, i) => i + 1), LAST_DAY];

/**
 * The roles a list can be written for, in the Staff page's order, then the
 * owner (0323 §1.3: owner and manager may be a list's role). The server
 * refuses only prep (INVALID_ROLE, soft-retired), which HIREABLE_ROLES never
 * holds.
 */
export const CHECKLIST_ROLES: readonly StaffRole[] = [...HIREABLE_ROLES.filter((r) => r !== 'owner'), 'owner'];

/** save_checklist's limits (0165 §9, 0323 §3). */
export const MAX_LINES = 30;
export const MAX_LINE_LENGTH = 200;
export const MAX_NAME_LENGTH = 120;
export const MAX_PEOPLE = 50;

/** Feature-private keys, under the ['checklists'] root QK.checklistDayState shares. */
export const CK = {
  board: (date: string) => ['checklists', 'board', date] as const,
  staff: ['checklists', 'staff'] as const,
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSlot = (v: unknown): v is ChecklistSlot => v === 'open' || v === 'close';
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const roleOf = (v: unknown): StaffRole | null => (typeof v === 'string' && v !== '' ? (v as StaffRole) : null);

/** Distinct whole numbers within [min, max], ascending. */
function intSet(v: unknown, min: number, max: number): number[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const x of v) {
    const n = typeof x === 'number' ? x : Number(x);
    if (Number.isInteger(n) && n >= min && n <= max) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function texts(v: unknown): { text_en: string; text_ar: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObject).map((t) => ({ text_en: str(t.text_en), text_ar: str(t.text_ar) }));
}

/** An "HH:MM" (or "HH:MM:SS") wall-clock time, else null. */
export function clockOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(v.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

// ---------------------------------------------------------------------------
// app.checklist_day_state: how far each copy got (day close, the card)
// ---------------------------------------------------------------------------

export interface DayStateList {
  /** Null on a list for named people. */
  role: StaffRole | null;
  slot: ChecklistSlot;
  name_en: string;
  name_ar: string;
  total: number;
  done: number;
  open_items: { text_en: string; text_ar: string }[];
  /** 0323 additions; null when the server sends the 0188 shape. */
  template_id: string | null;
  /** The person this copy is for; null on a shared copy. */
  assignee_name: string | null;
  due_at: string | null;
  overdue: boolean;
  period_start: string | null;
  period_end: string | null;
  /** The person's id and the copy's run id (0323 review); null on a shared copy, a list with no copy yet, or an older server. */
  assignee_id: string | null;
  run_id: string | null;
}

export interface DayState {
  business_date: string | null;
  lists: DayStateList[];
}

export function readDayState(payload: unknown): DayState {
  if (!isObject(payload)) return { business_date: null, lists: [] };
  const lists = Array.isArray(payload.lists) ? payload.lists : [];
  return {
    business_date: typeof payload.business_date === 'string' ? payload.business_date : null,
    lists: lists
      // A list has a role, or (0323) is a people list known by its template.
      .filter((l): l is Record<string, unknown> => isObject(l) && isSlot(l.slot) && (typeof l.role === 'string' || (l.role == null && typeof l.template_id === 'string')))
      .map((l) => ({
        role: roleOf(l.role),
        slot: l.slot as ChecklistSlot,
        name_en: str(l.name_en),
        name_ar: str(l.name_ar),
        total: num(l.total),
        done: num(l.done),
        open_items: texts(l.open_items),
        template_id: nullableStr(l.template_id),
        assignee_name: nonBlank(l.assignee_name),
        due_at: nonBlank(l.due_at),
        overdue: l.overdue === true,
        period_start: nullableStr(l.period_start),
        period_end: nullableStr(l.period_end),
        assignee_id: nonBlank(l.assignee_id),
        run_id: nonBlank(l.run_id),
      })),
  };
}

/** A copy with a line nobody ticked. A list with no lines never reaches here (the server drops it). */
export const isUnfinished = (l: Pick<DayStateList, 'done' | 'total'>): boolean => l.done < l.total;

/** Past its due time with a line still open. The server decides; a finished copy is never overdue. */
export const isOverdue = (l: Pick<DayStateList, 'done' | 'total' | 'overdue'>): boolean => l.overdue && isUnfinished(l);

/**
 * One copy's key: its run (two people with one name are two copies), else
 * its list and its person's id or name (a shared copy, or a list with no copy
 * yet, has none); the 0188 shape keys by role and slot.
 */
export const dayListKey = (l: Pick<DayStateList, 'template_id' | 'assignee_name' | 'role' | 'slot'> & Partial<Pick<DayStateList, 'assignee_id' | 'run_id'>>): string =>
  l.template_id
    ? l.run_id
      ? `${l.template_id}:${l.run_id}`
      : `${l.template_id}:${l.assignee_id ?? l.assignee_name ?? ''}`
    : `${l.role ?? ''}:${l.slot}`;

/** The card's headline: copies finished out of copies current today. */
export function daySummary(state: DayState): { finished: number; total: number } {
  return { finished: state.lists.filter((l) => !isUnfinished(l)).length, total: state.lists.length };
}

/**
 * The card's rows: overdue copies first, then the other unfinished ones
 * (least done first), then the finished ones, each group in the server's
 * order.
 */
export function cardRows(state: DayState): DayStateList[] {
  const ratio = (l: DayStateList) => (l.total === 0 ? 1 : l.done / l.total);
  const rank = (l: DayStateList) => (isOverdue(l) ? 0 : isUnfinished(l) ? 1 : 2);
  return state.lists
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || (rank(a.l) < 2 ? ratio(a.l) - ratio(b.l) : 0) || a.i - b.i)
    .map((x) => x.l);
}

// ---------------------------------------------------------------------------
// app.checklist_board: every live list and its current copies (the sheet)
// ---------------------------------------------------------------------------

export interface BoardItem {
  text_en: string;
  text_ar: string;
  done_by_name: string | null;
  done_at: string | null;
  note: string | null;
  /** Ticked only with a photo, taken on the phone. */
  photo_required: boolean;
  /** The photo sent with the tick (a staff-media path), on any line that has one. */
  photo_path: string | null;
}

export interface TemplateLine {
  position: number;
  text_en: string;
  text_ar: string;
  photo_required: boolean;
}

export interface Person {
  id: string;
  display_name: string;
  role: StaffRole | null;
  /** Named on a saved list but no longer at the branch (not in checklist_staff_options): the save would be refused. */
  away?: boolean;
}

/** One current copy of a list: shared (no assignee) or one person's. */
export interface BoardRun {
  run_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  period_start: string | null;
  period_end: string | null;
  due_at: string | null;
  overdue: boolean;
  done: number;
  total: number;
  items: BoardItem[];
}

export interface Schedule {
  audience: Audience;
  copy_mode: CopyMode;
  repeat_kind: RepeatKind;
  weekdays: number[];
  month_days: number[];
  slot: ChecklistSlot;
  /** 'HH:MM', or null: due at the branch's opening or closing time. */
  due_time: string | null;
}

export interface BoardTemplate extends Schedule {
  template_id: string;
  /** Null on a list for named people. */
  role: StaffRole | null;
  name_en: string;
  name_ar: string;
  version: number;
  items: TemplateLine[];
  assignees: Person[];
  /** The copies current on the day asked, overdue first. */
  runs: BoardRun[];
}

export interface Board {
  business_date: string | null;
  templates: BoardTemplate[];
}

function readItems(v: unknown): BoardItem[] {
  return (Array.isArray(v) ? v : []).filter(isObject).map((i) => ({
    text_en: str(i.text_en),
    text_ar: str(i.text_ar),
    done_by_name: nullableStr(i.done_by_name),
    done_at: nullableStr(i.done_at),
    note: nullableStr(i.note),
    photo_required: i.photo_required === true,
    photo_path: nonBlank(i.photo_path),
  }));
}

function readRun(r: Record<string, unknown>): BoardRun {
  const items = readItems(r.items);
  return {
    run_id: str(r.run_id),
    assignee_id: nonBlank(r.assignee_id),
    assignee_name: nonBlank(r.assignee_name),
    period_start: nullableStr(r.period_start),
    period_end: nullableStr(r.period_end),
    due_at: nonBlank(r.due_at),
    overdue: r.overdue === true,
    done: r.done === undefined ? items.filter((i) => i.done_at !== null).length : num(r.done),
    total: r.total === undefined ? items.length : num(r.total),
    items,
  };
}

function readPeople(v: unknown): Person[] {
  return (Array.isArray(v) ? v : [])
    .filter((p): p is Record<string, unknown> => isObject(p) && typeof p.id === 'string')
    .map((p) => ({ id: p.id as string, display_name: str(p.display_name), role: roleOf(p.role) }));
}

/** app.checklist_staff_options: the people a list can be for. */
export const readStaffOptions = (payload: unknown): Person[] => readPeople(payload);

export function readBoard(payload: unknown): Board {
  if (!isObject(payload)) return { business_date: null, templates: [] };
  const rows = Array.isArray(payload.templates) ? payload.templates : [];
  return {
    business_date: typeof payload.business_date === 'string' ? payload.business_date : null,
    templates: rows
      .filter(
        (t): t is Record<string, unknown> =>
          isObject(t) && typeof t.template_id === 'string' && isSlot(t.slot) && (typeof t.role === 'string' || (t.role == null && t.audience === 'people')),
      )
      .map((t) => {
        const audience: Audience = t.audience === 'people' ? 'people' : 'role';
        const repeatKind: RepeatKind = t.repeat_kind === 'monthdays' ? 'monthdays' : 'weekdays';
        const weekdays = intSet(t.weekdays, 0, 6);
        // A 0184 board has no runs, only `today`: read it as the one shared copy.
        const runs = Array.isArray(t.runs)
          ? t.runs.filter(isObject).map(readRun)
          : isObject(t.today)
            ? [readRun(t.today)]
            : [];
        return {
          template_id: t.template_id as string,
          role: audience === 'people' ? null : roleOf(t.role),
          slot: t.slot as ChecklistSlot,
          name_en: str(t.name_en),
          name_ar: str(t.name_ar),
          version: num(t.version),
          items: (Array.isArray(t.items) ? t.items : [])
            .filter(isObject)
            .map((i) => ({ position: num(i.position), text_en: str(i.text_en), text_ar: str(i.text_ar), photo_required: i.photo_required === true }))
            .sort((a, b) => a.position - b.position),
          audience,
          copy_mode: audience === 'people' || t.copy_mode === 'each' ? 'each' : 'shared',
          repeat_kind: repeatKind,
          weekdays: repeatKind === 'weekdays' && weekdays.length === 0 ? [...WEEKDAYS] : weekdays,
          month_days: intSet(t.month_days, 1, 31),
          due_time: clockOf(t.due_time),
          assignees: readPeople(t.assignees),
          runs,
        };
      }),
  };
}

export function findTemplate(board: Board, templateId: string | null): BoardTemplate | null {
  if (!templateId) return null;
  return board.templates.find((t) => t.template_id === templateId) ?? null;
}

/**
 * The lines a list shows when it has no current copy: the template's lines
 * with nothing ticked. A copy is a snapshot, so an owner edit made after it
 * was created shows from the next one, as on the phone.
 */
export function templateLines(t: BoardTemplate): BoardItem[] {
  return t.items.map((i) => ({ text_en: i.text_en, text_ar: i.text_ar, done_by_name: null, done_at: null, note: null, photo_required: i.photo_required, photo_path: null }));
}

/** Lists in the server's order (role lists by role and slot, then people lists), a role outside CHECKLIST_ROLES after the known ones. */
export function sortTemplates(templates: readonly BoardTemplate[]): BoardTemplate[] {
  const rank = (r: StaffRole | null) => {
    if (r === null) return CHECKLIST_ROLES.length + 1;
    const i = CHECKLIST_ROLES.indexOf(r);
    return i === -1 ? CHECKLIST_ROLES.length : i;
  };
  return [...templates].sort((a, b) => rank(a.role) - rank(b.role) || CHECKLIST_SLOTS.indexOf(a.slot) - CHECKLIST_SLOTS.indexOf(b.slot));
}

// ---------------------------------------------------------------------------
// Plain-language labels: who, repeats, due
// ---------------------------------------------------------------------------

const listSep = (locale: Locale) => (locale === 'ar' ? '، ' : ', ');

/** "A, B and C" in the reader's language. */
export function joinAnd(parts: readonly string[], tr: Tr, locale: Locale): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return tr('ws.supplies.checklists.and', { a: parts.slice(0, -1).join(listSep(locale)), b: parts[parts.length - 1]! });
}

/** "Bareq, Maha +2": at most `max` names, the rest counted. */
export function peopleNames(names: readonly string[], tr: Tr, locale: Locale, max = 3): string {
  const shown = names.slice(0, max).join(listSep(locale));
  const more = names.length - Math.min(names.length, max);
  return more > 0 ? `${shown} ${tr('ws.supplies.checklists.morePeople', { count: formatNumber(more, locale) })}` : shown;
}

const ordinalEn = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** One date of the month as the summary says it: "the 15th" / "the last day". */
export function monthDayText(day: number, tr: Tr, locale: Locale): string {
  if (day >= LAST_DAY) return tr('ws.supplies.checklists.repeat.lastDay');
  return tr('ws.supplies.checklists.repeat.nth', { nth: locale === 'ar' ? formatNumber(day, locale) : ordinalEn(day) });
}

/** "Every day", "Every Sunday and Wednesday", "Every month on the 1st and the 15th". */
export function repeatSummary(s: Pick<Schedule, 'repeat_kind' | 'weekdays' | 'month_days'>, tr: Tr, locale: Locale): string {
  if (s.repeat_kind === 'monthdays') {
    const days = [...s.month_days].sort((a, b) => a - b);
    if (days.length === 0) return tr('ws.supplies.checklists.repeat.monthlyNone');
    return tr('ws.supplies.checklists.repeat.monthly', { days: joinAnd(days.map((d) => monthDayText(d, tr, locale)), tr, locale) });
  }
  const days = WEEKDAYS.filter((d) => s.weekdays.includes(d));
  if (days.length === 0 || days.length === 7) return tr('ws.supplies.checklists.repeat.daily');
  const names = days.map((d) => tr(`ws.supplies.checklists.weekday.${DAY_KEYS[d]!}`));
  return tr(days.length === 1 ? 'ws.supplies.checklists.repeat.weeklyOne' : 'ws.supplies.checklists.repeat.weekly', { days: joinAnd(names, tr, locale) });
}

/** A wall-clock "HH:MM" in the reader's format ("2:30 PM"). */
export function clockText(hhmm: string, locale: Locale): string {
  const c = clockOf(hhmm);
  if (!c) return hhmm;
  const [h, m] = c.split(':').map(Number) as [number, number];
  return formatTime(new Date(Date.UTC(2000, 0, 1, h, m)), locale, 'UTC');
}

export const dueKindOf = (s: Pick<Schedule, 'slot' | 'due_time'>): DueKind => (s.due_time ? 'time' : s.slot);

/** The due rule as the summary says it: "before opening", "before closing", "by 2:30 PM". */
export function dueRule(s: Pick<Schedule, 'slot' | 'due_time'>, tr: Tr, locale: Locale): string {
  if (s.due_time) return tr('ws.supplies.checklists.dueRule.time', { time: clockText(s.due_time, locale) });
  return tr(s.slot === 'close' ? 'ws.supplies.checklists.dueRule.close' : 'ws.supplies.checklists.dueRule.open');
}

/**
 * Who a list is for: "Baristas, one shared list", "Every barista, their own
 * copy", or the people's names.
 */
export function whoSummary(s: { audience: Audience; role: StaffRole | null; copy_mode: CopyMode }, names: readonly string[], tr: Tr, locale: Locale): string {
  if (s.audience === 'people') return names.length ? peopleNames(names, tr, locale) : tr('ws.supplies.checklists.who.nobody');
  if (!s.role) return '';
  return tr(s.copy_mode === 'each' ? 'ws.supplies.checklists.who.each' : 'ws.supplies.checklists.who.shared', { role: tr(`op.roles.${s.role}`) });
}

/** The one-line summary: "Every Sunday, before opening · Bareq, Maha". */
export function planSummary(
  s: Pick<Schedule, 'repeat_kind' | 'weekdays' | 'month_days' | 'slot' | 'due_time'> & { audience: Audience; role: StaffRole | null; copy_mode: CopyMode },
  names: readonly string[],
  tr: Tr,
  locale: Locale,
): string {
  const when = tr('ws.supplies.checklists.when', { repeat: repeatSummary(s, tr, locale), due: dueRule(s, tr, locale) });
  const who = whoSummary(s, names, tr, locale);
  return who ? `${when} · ${who}` : when;
}

const DAY_MS = 86_400_000;
const venueDay = (d: Date) => formatDate(d, 'en');

/**
 * A copy's due time: "Due 9:00 AM" when it falls on the same day as `now`,
 * "Due Sun 9:00 AM" within the week around it, else with the date. Null when
 * the server sent none.
 */
export function dueLabel(dueAt: string | null, now: Date, tr: Tr, locale: Locale): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const time = formatTime(d, locale);
  if (venueDay(d) === venueDay(now)) return tr('ws.supplies.checklists.due', { time });
  const day = Math.abs(d.getTime() - now.getTime()) < 6 * DAY_MS ? formatWeekdayShort(d, locale) : formatDate(d, locale);
  return tr('ws.supplies.checklists.dueOn', { day, time });
}

// ---------------------------------------------------------------------------
// The owner's draft of one list
// ---------------------------------------------------------------------------

export interface DraftLine {
  key: string;
  text_en: string;
  text_ar: string;
  /** "Needs a photo": the phone ticks this line only with one. */
  photo_required: boolean;
}

export interface ChecklistDraft {
  name_en: string;
  name_ar: string;
  lines: DraftLine[];
  audience: Audience;
  /** The role of a role list; '' until one is chosen. */
  role: StaffRole | '';
  /** A role list's copies; a people list is always one copy each. */
  copy_mode: CopyMode;
  staff_ids: string[];
  repeat: RepeatPreset;
  /** The chosen weekdays (used by 'weekdays'). */
  weekdays: number[];
  /** The chosen dates (the first one used by 'monthly', the first two by 'twiceMonthly'). */
  month_days: number[];
  due: DueKind;
  /** 'HH:MM' for 'time', else ignored. */
  due_time: string;
}

export const DEFAULT_MONTH_DAYS: readonly number[] = [1, 15];

/** A new list: a shared role list, every day, before opening, one blank line to fill. */
export function blankDraft(lineKey: () => string): ChecklistDraft {
  return {
    name_en: '',
    name_ar: '',
    lines: [{ key: lineKey(), text_en: '', text_ar: '', photo_required: false }],
    audience: 'role',
    role: '',
    copy_mode: 'shared',
    staff_ids: [],
    repeat: 'daily',
    weekdays: [...WEEKDAYS],
    month_days: [DEFAULT_MONTH_DAYS[0]!],
    due: 'open',
    due_time: '',
  };
}

/** The editor's preset for a saved schedule. */
export function presetOf(s: Pick<Schedule, 'repeat_kind' | 'weekdays' | 'month_days'>): RepeatPreset {
  if (s.repeat_kind === 'monthdays') return s.month_days.length >= 2 ? 'twiceMonthly' : 'monthly';
  return s.weekdays.length === 7 || s.weekdays.length === 0 ? 'daily' : 'weekdays';
}

/** A saved list as a draft. */
export function draftFromTemplate(t: BoardTemplate, lineKey: () => string): ChecklistDraft {
  const repeat = presetOf(t);
  return {
    name_en: t.name_en,
    name_ar: t.name_ar,
    lines: t.items.map((i) => ({ key: lineKey(), text_en: i.text_en, text_ar: i.text_ar, photo_required: i.photo_required })),
    audience: t.audience,
    role: t.role ?? '',
    copy_mode: t.copy_mode,
    staff_ids: t.assignees.map((p) => p.id),
    repeat,
    weekdays: repeat === 'daily' ? [...WEEKDAYS] : [...t.weekdays],
    month_days: t.repeat_kind === 'monthdays' && t.month_days.length > 0 ? [...t.month_days] : [DEFAULT_MONTH_DAYS[0]!],
    due: dueKindOf(t),
    due_time: t.due_time ?? '',
  };
}

/**
 * Switch the Repeats preset. The weekdays and dates already chosen are kept,
 * so switching away and back loses nothing; twice a month gets a second date.
 */
export function withPreset(draft: ChecklistDraft, preset: RepeatPreset): ChecklistDraft {
  let monthDays = draft.month_days.length > 0 ? draft.month_days : [DEFAULT_MONTH_DAYS[0]!];
  if (preset === 'twiceMonthly' && monthDays.length < 2) {
    const second = DEFAULT_MONTH_DAYS.find((d) => d !== monthDays[0]) ?? LAST_DAY;
    monthDays = [monthDays[0]!, second];
  }
  // A weekdays pick that is every day would read back as "Every day": start it empty-handed only from daily.
  const weekdays = preset === 'weekdays' && draft.weekdays.length === 7 ? [] : draft.weekdays;
  return { ...draft, repeat: preset, month_days: monthDays, weekdays: preset === 'daily' ? [...WEEKDAYS] : weekdays };
}

export function toggleWeekday(days: readonly number[], day: number): number[] {
  return (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]).sort((a, b) => a - b);
}

/** What the draft's schedule saves as (§1.1). */
export function draftSchedule(draft: ChecklistDraft): { repeat_kind: RepeatKind; weekdays: number[]; month_days: number[] } {
  switch (draft.repeat) {
    case 'daily':
      return { repeat_kind: 'weekdays', weekdays: [...WEEKDAYS], month_days: [] };
    case 'weekdays':
      return { repeat_kind: 'weekdays', weekdays: [...new Set(draft.weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b), month_days: [] };
    case 'monthly':
      return { repeat_kind: 'monthdays', weekdays: [], month_days: draft.month_days.slice(0, 1) };
    case 'twiceMonthly':
      // A list saved with more dates (through the API) keeps them.
      return { repeat_kind: 'monthdays', weekdays: [], month_days: draft.month_days.length > 2 ? [...draft.month_days] : draft.month_days.slice(0, 2) };
  }
}

export type TextProblem = 'both' | 'tooLong' | null;

/** One bilingual pair: both languages, each within the limit. */
export function textProblem(en: string, ar: string, max: number): TextProblem {
  if (en.trim() === '' || ar.trim() === '') return 'both';
  if (en.trim().length > max || ar.trim().length > max) return 'tooLong';
  return null;
}

const blankLine = (l: DraftLine) => l.text_en.trim() === '' && l.text_ar.trim() === '';

export interface DraftProblems {
  name: TextProblem;
  lines: Map<string, TextProblem>;
  tooMany: boolean;
  /**
   * No role chosen, no person chosen, more people than the server takes, or
   * someone chosen who no longer works at the branch (ASSIGNEE_NOT_AT_BRANCH).
   */
  who: 'role' | 'people' | 'tooManyPeople' | 'away' | null;
  /** No weekday chosen, or the same date twice. */
  repeat: 'weekdays' | 'sameDate' | null;
  /** "By a set time" with no time. */
  due: 'time' | null;
}

/**
 * What stops the save, box by box. A line left blank in both languages is
 * dropped on save rather than refused, the way Goods in drops an untouched
 * line; a line with one language is refused (TEXT_BOTH_LANGUAGES_REQUIRED).
 */
export function draftProblems(draft: ChecklistDraft, away: ReadonlySet<string> = new Set()): DraftProblems {
  const lines = new Map<string, TextProblem>();
  for (const l of draft.lines) {
    if (blankLine(l)) continue;
    const p = textProblem(l.text_en, l.text_ar, MAX_LINE_LENGTH);
    if (p) lines.set(l.key, p);
  }
  const schedule = draftSchedule(draft);
  return {
    name: textProblem(draft.name_en, draft.name_ar, MAX_NAME_LENGTH),
    lines,
    tooMany: draft.lines.filter((l) => !blankLine(l)).length > MAX_LINES,
    who:
      draft.audience === 'role'
        ? draft.role === ''
          ? 'role'
          : null
        : draft.staff_ids.length === 0
          ? 'people'
          : draft.staff_ids.length > MAX_PEOPLE
            ? 'tooManyPeople'
            : draft.staff_ids.some((id) => away.has(id))
              ? 'away'
              : null,
    repeat:
      schedule.repeat_kind === 'weekdays'
        ? schedule.weekdays.length === 0
          ? 'weekdays'
          : null
        : new Set(schedule.month_days).size !== schedule.month_days.length
          ? 'sameDate'
          : null,
    due: draft.due === 'time' && clockOf(draft.due_time) === null ? 'time' : null,
  };
}

/** The people a picker lists who no longer work at the branch (`Person.away`). */
export const awayIds = (people: readonly Person[]): Set<string> => new Set(people.filter((p) => p.away).map((p) => p.id));

export function draftIsValid(draft: ChecklistDraft, away?: ReadonlySet<string>): boolean {
  const p = draftProblems(draft, away);
  return p.name === null && p.lines.size === 0 && !p.tooMany && p.who === null && p.repeat === null && p.due === null;
}

export interface SaveItem {
  text_en: string;
  text_ar: string;
  photo_required: boolean;
}

/** The lines the save sends: blank lines dropped, both languages trimmed. */
export function savePayloadItems(draft: Pick<ChecklistDraft, 'lines'>): SaveItem[] {
  return draft.lines
    .filter((l) => !blankLine(l))
    .map((l) => ({ text_en: l.text_en.trim(), text_ar: l.text_ar.trim(), photo_required: l.photo_required }));
}

export interface ChecklistSpec {
  name_en: string;
  name_ar: string;
  audience: Audience;
  role?: StaffRole;
  copy_mode: CopyMode;
  staff_ids?: string[];
  repeat_kind: RepeatKind;
  weekdays?: number[];
  month_days?: number[];
  slot: DueKind;
  due_time?: string;
  items: SaveItem[];
}

/** app.save_checklist's p_spec (0323 §3): only the fields the list's kind uses. */
export function specFromDraft(draft: ChecklistDraft): ChecklistSpec {
  const schedule = draftSchedule(draft);
  const time = draft.due === 'time' ? clockOf(draft.due_time) : null;
  return {
    name_en: draft.name_en.trim(),
    name_ar: draft.name_ar.trim(),
    audience: draft.audience,
    ...(draft.audience === 'role' && draft.role !== '' ? { role: draft.role } : {}),
    copy_mode: draft.audience === 'people' ? 'each' : draft.copy_mode,
    ...(draft.audience === 'people' ? { staff_ids: [...new Set(draft.staff_ids)] } : {}),
    repeat_kind: schedule.repeat_kind,
    ...(schedule.repeat_kind === 'weekdays' ? { weekdays: schedule.weekdays } : { month_days: schedule.month_days }),
    slot: draft.due,
    ...(time ? { due_time: time } : {}),
    items: savePayloadItems(draft),
  };
}

/** Has anything the save would send changed since the draft was opened? */
export function draftChanged(draft: ChecklistDraft, saved: ChecklistDraft): boolean {
  const a = specFromDraft(draft);
  const b = specFromDraft(saved);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const sorted = (v: readonly string[] | undefined) => [...(v ?? [])].sort();
  return (
    a.name_en !== b.name_en ||
    a.name_ar !== b.name_ar ||
    a.audience !== b.audience ||
    a.role !== b.role ||
    a.copy_mode !== b.copy_mode ||
    !same(sorted(a.staff_ids), sorted(b.staff_ids)) ||
    a.repeat_kind !== b.repeat_kind ||
    !same(a.weekdays, b.weekdays) ||
    !same([...(a.month_days ?? [])].sort((x, y) => x - y), [...(b.month_days ?? [])].sort((x, y) => x - y)) ||
    a.slot !== b.slot ||
    a.due_time !== b.due_time ||
    !same(a.items, b.items)
  );
}

/** How many lines the save would send with "Needs a photo" on. */
export const photoLineCount = (draft: Pick<ChecklistDraft, 'lines'>): number => savePayloadItems(draft).filter((i) => i.photo_required).length;

/** The draft's summary line, as the saved list would read it. */
export function draftSummary(draft: ChecklistDraft, people: readonly Person[], tr: Tr, locale: Locale): string {
  const schedule = draftSchedule(draft);
  const byId = new Map(people.map((p) => [p.id, p.display_name]));
  const time = draft.due === 'time' ? clockOf(draft.due_time) : null;
  return planSummary(
    {
      ...schedule,
      slot: draft.due === 'close' ? 'close' : 'open',
      due_time: time,
      audience: draft.audience,
      role: draft.role === '' ? null : draft.role,
      copy_mode: draft.copy_mode,
    },
    draft.staff_ids.map((id) => byId.get(id) ?? '').filter((n) => n !== ''),
    tr,
    locale,
  );
}

export function moveLine<T>(list: readonly T[], index: number, dir: 'up' | 'down'): T[] {
  const to = dir === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
