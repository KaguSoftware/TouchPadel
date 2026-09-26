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
 * PURE (vitest): no react-native, no supabase.
 */

export type ChecklistSlot = 'open' | 'close';

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
  role: string;
  slot: ChecklistSlot;
  name_en: string;
  name_ar: string;
  done: number;
  total: number;
  items: ChecklistItem[];
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
}

/**
 * The lists still to finish, in the server's order. Today renders one row per
 * list (`staff.checklist.<runId>`) that opens `/staff-checklist?id=<runId>`.
 */
export function checklistTodos(data: ChecklistsToday | null | undefined): ChecklistTodo[] {
  if (!data) return [];
  return data.lists
    .filter((l) => l.total > 0 && l.done < l.total)
    .map((l) => ({
      runId: l.run_id,
      slot: l.slot,
      name_en: l.name_en,
      name_ar: l.name_ar,
      done: l.done,
      total: l.total,
    }));
}

/** The name to show for a bilingual row: the reader's language, falling back to the other. */
export function localName(row: { name_en: string; name_ar: string }, locale: 'en' | 'ar'): string {
  const mine = locale === 'ar' ? row.name_ar : row.name_en;
  const other = locale === 'ar' ? row.name_en : row.name_ar;
  return mine?.trim() ? mine : other;
}

/** A line's text in the reader's language, falling back to the other. */
export function localText(row: { text_en: string; text_ar: string }, locale: 'en' | 'ar'): string {
  return localName({ name_en: row.text_en, name_ar: row.text_ar }, locale);
}
