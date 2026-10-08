/**
 * Today's checklists on the staff phone (build-contracts-2026-09-23 §2.14,
 * §2.24.8, §6.1): the shapes `my_checklists_today` and `mark_checklist_item`
 * return, and the rules the screen follows before it sends a tick.
 *
 * THE PHOTO RULE (#69). A line the owner marked "Needs a photo" is ticked
 * only with one: the photo just taken, or one the line already carries. The
 * server refuses a bare tick (RECORD_INVALID, hint photo_path); `markArgs`
 * never builds one, so the phone never sends it.
 *
 * SCHEDULED LISTS (0323, docs/design/checklists/scheduled-checklists-2026-10-08.md
 * §5). A list now repeats (every day, chosen weekdays, or chosen dates of the
 * month), has a due time, and is either shared by a role or one person's own
 * copy. Every field it added is optional here, so a payload from before 0323
 * still parses and reads as it did.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import { errorCode, formatTime, makeT, type Locale, type MessageKey } from '@touch/i18n';

export type ChecklistSlot = 'open' | 'close';
export type ChecklistAudience = 'role' | 'people';
export type ChecklistCopyMode = 'shared' | 'each';
export type ChecklistRepeatKind = 'weekdays' | 'monthdays';

/** One line of a day's list, as `my_checklists_today` and `mark_checklist_item` return it. */
export interface ChecklistItem {
  id: string;
  position: number;
  text_en: string;
  text_ar: string;
  done_by_name: string | null;
  done_at: string | null;
  note: string | null;
  photo_required: boolean;
  photo_path: string | null;
}

export interface ChecklistList {
  run_id: string;
  /** Null on a list for named people (0323). */
  role: string | null;
  slot: ChecklistSlot;
  name_en: string;
  name_ar: string;
  done: number;
  total: number;
  items: ChecklistItem[];
  // 0323: the schedule. Optional, so a payload from before it still parses.
  template_id?: string;
  audience?: ChecklistAudience;
  copy_mode?: ChecklistCopyMode;
  repeat_kind?: ChecklistRepeatKind;
  /** 0 = Sunday. */
  weekdays?: number[];
  /** 1..31; 31 (or a day past the month's end) is the month's last day. */
  month_days?: number[] | null;
  period_start?: string;
  period_end?: string;
  due_at?: string | null;
  overdue?: boolean;
  /** Set on a person's own copy; null on a list the whole role shares. */
  assignee_id?: string | null;
  /**
   * A typed due time, "HH:MM" (0323 review); null when the list is due at the
   * branch's opening or closing. Its slot is then only derived from the time.
   */
  due_time?: string | null;
}

export interface ChecklistsToday {
  business_date: string;
  lists: ChecklistList[];
}

export function isTicked(item: Pick<ChecklistItem, 'done_at'>): boolean {
  return item.done_at !== null;
}

/**
 * The lists in the order the screen shows them: the one a push or Today named
 * first, then the server's order (opening before closing).
 */
export function orderLists(lists: readonly ChecklistList[], focusRunId?: string | null): ChecklistList[] {
  if (!focusRunId) return [...lists];
  const first = lists.filter((l) => l.run_id === focusRunId);
  return [...first, ...lists.filter((l) => l.run_id !== focusRunId)];
}

/** Why a tick cannot be sent yet: only a missing photo on a line that needs one. */
export function tickBlock(
  item: Pick<ChecklistItem, 'photo_required' | 'photo_path'>,
  photoPath: string | null | undefined,
): 'needs-photo' | null {
  return item.photo_required && !photoPath && !item.photo_path ? 'needs-photo' : null;
}

export interface MarkArgs {
  p_item_id: string;
  p_done: boolean;
  p_photo_path?: string;
}

/**
 * The `mark_checklist_item` arguments for a tick or an untick, or null when the
 * tick would be refused for want of a photo. An untick sends no photo (the
 * server clears the line's). A tick sends the new photo when there is one; a
 * line that already carries its photo is ticked without resending it.
 */
export function markArgs(
  item: Pick<ChecklistItem, 'id' | 'photo_required' | 'photo_path'>,
  done: boolean,
  photoPath?: string | null,
): MarkArgs | null {
  if (!done) return { p_item_id: item.id, p_done: false };
  if (tickBlock(item, photoPath)) return null;
  return photoPath
    ? { p_item_id: item.id, p_done: true, p_photo_path: photoPath }
    : { p_item_id: item.id, p_done: true };
}

/**
 * Today's lists with one line replaced by what `mark_checklist_item` returned,
 * and that list's count recomputed, so the screen shows the tick before the
 * refetch lands.
 */
export function applyMark(data: ChecklistsToday, updated: ChecklistItem): ChecklistsToday {
  return {
    ...data,
    lists: data.lists.map((list) => {
      if (!list.items.some((i) => i.id === updated.id)) return list;
      const items = list.items.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
      return { ...list, items, done: items.filter(isTicked).length, total: items.length };
    }),
  };
}

/** One unfinished list for Today's To do: checklists sit at its top for every role (§6.1). */
export interface ChecklistTodo {
  runId: string;
  slot: ChecklistSlot;
  name_en: string;
  name_ar: string;
  done: number;
  total: number;
  /** 0323; null on a list from before it, or one with no due time. */
  due_at: string | null;
  period_start: string | null;
  overdue: boolean;
}

/**
 * The lists still to finish, overdue first (`sortForToday`). Today renders one
 * row per list (`staff.checklist.<runId>`) that opens `/staff-checklist?id=<runId>`.
 */
export function checklistTodos(
  data: ChecklistsToday | null | undefined,
  now: Date = new Date(),
): ChecklistTodo[] {
  if (!data) return [];
  return sortForToday(
    data.lists.filter((l) => l.total > 0 && l.done < l.total),
    now,
  ).map((l) => ({
    runId: l.run_id,
    slot: l.slot,
    name_en: l.name_en,
    name_ar: l.name_ar,
    done: l.done,
    total: l.total,
    due_at: l.due_at ?? null,
    period_start: l.period_start ?? null,
    overdue: isOverdue(l, now),
  }));
}

/** What the due line reads from a list (a `ChecklistList` or a `ChecklistTodo`). */
export interface DueFields {
  done: number;
  total: number;
  due_at?: string | null;
  overdue?: boolean;
  period_start?: string | null;
}

function finished(list: Pick<DueFields, 'done' | 'total'>): boolean {
  return list.total > 0 && list.done >= list.total;
}

/**
 * Past its due time and not finished. The server's `overdue` is read as it
 * stands; the phone's clock only adds the case of a list that fell due while
 * the page was open. A tick that finishes the list clears it at once. A list
 * with no due time is never overdue.
 */
export function isOverdue(list: DueFields, now: Date): boolean {
  if (finished(list)) return false;
  if (list.overdue) return true;
  if (!list.due_at) return false;
  const due = Date.parse(list.due_at);
  return Number.isFinite(due) && now.getTime() >= due;
}

/**
 * Today's order, as `my_checklists_today` gives it (§3): unfinished overdue
 * lists first, then unfinished ones by due time (no due time last), then the
 * finished ones. Stable, so equal lists keep the server's order.
 */
export function sortForToday<T extends DueFields>(lists: readonly T[], now: Date): T[] {
  const rank = (l: T) => (finished(l) ? 2 : isOverdue(l, now) ? 0 : 1);
  const dueMs = (l: T) => {
    const ms = l.due_at ? Date.parse(l.due_at) : NaN;
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  };
  return lists
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const r = rank(a.l) - rank(b.l);
      if (r !== 0) return r;
      if (rank(a.l) < 2) {
        const da = dueMs(a.l);
        const db = dueMs(b.l);
        if (da !== db) return da < db ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map(({ l }) => l);
}

/** Catalog keys of the weekday names, 0 = Sunday (the 0323 convention). */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function dayName(day: number, locale: Locale): string {
  const key = DAY_KEYS[day];
  return key ? makeT(locale)(`staff.checklists.days.${key}` as MessageKey) : '';
}

/** The weekday of a `YYYY-MM-DD` date, 0 = Sunday, or null for anything else. */
function weekdayOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/**
 * The list's due line, or null when there is nothing to say (no due time, an
 * old payload, or the list is finished):
 * - "Due 9:00 AM" while it is not yet due;
 * - "Overdue since 9:00 AM" once it is;
 * - with the occurrence's first day in place of the time when that day is not
 *   today's business day ("Overdue since Sunday" on a weekly list on Tuesday).
 *
 * The time is the venue's clock (`formatTime`). `businessDate` is the
 * payload's `business_date`; without it the time is always shown.
 */
export function dueText(
  list: DueFields,
  now: Date,
  locale: Locale,
  businessDate?: string | null,
): string | null {
  if (!list.due_at || finished(list)) return null;
  const at = new Date(list.due_at);
  if (Number.isNaN(at.getTime())) return null;
  const t = makeT(locale);
  const overdue = isOverdue(list, now);
  const otherDay =
    businessDate && list.period_start && list.period_start !== businessDate
      ? weekdayOf(list.period_start)
      : null;
  if (otherDay !== null) {
    const day = dayName(otherDay, locale);
    return overdue
      ? t('staff.checklists.overdueSinceDay', { day })
      : t('staff.checklists.dueOn', { day });
  }
  const time = formatTime(at, locale);
  return overdue ? t('staff.checklists.overdueSince', { time }) : t('staff.checklists.due', { time });
}

function joinList(parts: string[], locale: Locale): string {
  const t = makeT(locale);
  if (parts.length <= 1) return parts[0] ?? '';
  const and = t('staff.checklists.repeat.and');
  const comma = t('staff.checklists.repeat.comma');
  return `${parts.slice(0, -1).join(comma)}${and}${parts[parts.length - 1]}`;
}

/** "1st", "2nd", "3rd", "11th", "22nd": English ordinals; Arabic reads the bare number. */
function ordinal(n: number, locale: Locale): string {
  if (locale !== 'en') return String(n);
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/**
 * How the list repeats, in a few words: "Every day", "Every Sunday", "Every
 * Sunday and Thursday", "On the 1st and the 15th of each month", "On the last
 * day of each month". Null for a payload from before 0323 or a malformed rule.
 */
export function repeatText(
  list: Pick<ChecklistList, 'repeat_kind' | 'weekdays' | 'month_days'>,
  locale: Locale,
): string | null {
  const t = makeT(locale);
  if (list.repeat_kind === 'weekdays') {
    const days = [...new Set(list.weekdays ?? [])]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    if (days.length === 0) return null;
    if (days.length === 7) return t('staff.checklists.repeat.daily');
    const names = days.map((d) => dayName(d, locale));
    return days.length === 1
      ? t('staff.checklists.repeat.weekly', { day: names[0]! })
      : t('staff.checklists.repeat.days', { days: joinList(names, locale) });
  }
  if (list.repeat_kind === 'monthdays') {
    const dates = [...new Set((list.month_days ?? []).map((d) => Math.min(d, 31)))]
      .filter((d) => Number.isInteger(d) && d >= 1)
      .sort((a, b) => a - b);
    if (dates.length === 0) return null;
    const parts = dates.map((d) =>
      d === 31
        ? t('staff.checklists.repeat.lastDay')
        : t('staff.checklists.repeat.date', { n: ordinal(d, locale) }),
    );
    return t('staff.checklists.repeat.monthly', { dates: joinList(parts, locale) });
  }
  return null;
}

/**
 * The tick was refused because the list's occurrence has ended
 * (`CHECKLIST_CLOSED`, 0323): the next one has started, so the screen says so
 * and reads the lists again.
 */
export function isClosedError(err: unknown): boolean {
  return errorCode(err) === 'CHECKLIST_CLOSED';
}

/** The name to show for a bilingual row: the reader's language, falling back to the other. */
/**
 * Whether the list is labelled "Opening" or "Closing" above its name. A list
 * due by a typed time carries a slot derived from that time alone (before
 * 14:00 is "open"), so it is told by its due line instead. A payload from
 * before the field keeps its label.
 */
export function showsSlotLabel(list: Pick<ChecklistList, 'due_time'>): boolean {
  return typeof list.due_time !== 'string' || list.due_time.trim() === '';
}

export function localName(row: { name_en: string; name_ar: string }, locale: 'en' | 'ar'): string {
  const mine = locale === 'ar' ? row.name_ar : row.name_en;
  const other = locale === 'ar' ? row.name_en : row.name_ar;
  return mine?.trim() ? mine : other;
}

/** A line's text in the reader's language, falling back to the other. */
export function localText(row: { text_en: string; text_ar: string }, locale: 'en' | 'ar'): string {
  return localName({ name_en: row.text_en, name_ar: row.text_ar }, locale);
}
