/**
 * Persist an uploaded photo path through its dedicated setter RPC. On success
 * the previous object is removed best-effort; on failure the freshly uploaded
 * object is removed instead so a rejected path never leaks storage.
 */
import { appRpc } from '../../../lib/appRpc';
import { removeMedia } from '../../../lib/storage';
import type { ItemRow, CategoryRow } from './useAdminMenu';

export type PhotoKind = 'item' | 'category';

export async function savePhoto(
  kind: PhotoKind,
  id: string,
  nextPath: string | null,
  previousPath: string | null,
): Promise<void> {
  try {
    if (kind === 'item') {
      await appRpc('set_item_photo', { p_item_id: id, p_photo_path: nextPath });
    } else {
      await appRpc('set_category_photo', { p_category_id: id, p_photo_path: nextPath });
    }
  } catch (error) {
    if (nextPath && nextPath !== previousPath) void removeMedia(nextPath);
    throw error;
  }
  if (previousPath && previousPath !== nextPath) void removeMedia(previousPath);
}

/** Full `upsert_menu_item` payload from a cached row (sort swaps re-send everything). */
export function itemUpsertArgs(row: ItemRow, overrides: Partial<ItemRow> = {}) {
  const r = { ...row, ...overrides };
  return {
    p_id: r.id,
    p_category_id: r.category_id,
    p_name_en: r.name_en,
    p_name_ar: r.name_ar,
    p_description_en: r.description_en,
    p_description_ar: r.description_ar,
    p_sort_order: r.sort_order,
    p_is_active: r.is_active,
    p_hook_en: r.hook_en,
    p_hook_ar: r.hook_ar,
    p_highlight: r.highlight,
  };
}

export function categoryUpsertArgs(row: CategoryRow, overrides: Partial<CategoryRow> = {}) {
  const r = { ...row, ...overrides };
  return {
    p_id: r.id,
    p_name_en: r.name_en,
    p_name_ar: r.name_ar,
    p_tax_group_id: r.tax_group_id,
    p_sort_order: r.sort_order,
    p_is_active: r.is_active,
  };
}
