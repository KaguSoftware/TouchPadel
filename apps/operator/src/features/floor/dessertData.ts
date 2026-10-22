/**
 * The dessert case — the reads (see dessertCase.ts for what it shows).
 *
 * Two small queries, so the part that changes often stays tiny:
 *  - the LIST (which desserts the menu has, their names and places), read
 *    once and again only when the menu changes;
 *  - the YES/NO per dessert, `orderable` from `menu_item_availability` for
 *    just those ids. This is the live part.
 *
 * Live through the existing public 'menu' websocket topic: every menu edit,
 * sold-out switch and 86 already sends `menu_changed` (0022, 0033), a bare
 * "something changed" with no row in it. It busts both queries and the case
 * re-reads its few booleans. A dessert that runs out of STOCK sends nothing
 * (stock moves on every sale; a broadcast per sale would be the heavy thing
 * this avoids), so the yes/no is also re-read every 30 s, the same beat the
 * rest of the floor keeps.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useBroadcast } from '../../lib/realtime';
import { isDessertCategory, listDesserts, withAvailability, type DessertListed, type DessertOnShow, type RawDessertCategory, type RawDessertItem, type RawOrderable } from './dessertCase';

/** Not under ['liveFloor']: the floor's own broadcasts invalidate that prefix, and they say nothing about the menu. */
export const DESSERT_KEY = ['floorDesserts'] as const;
const LIST_KEY = [...DESSERT_KEY, 'list'] as const;
const ON_KEY = [...DESSERT_KEY, 'on'] as const;
export const DESSERT_REFETCH_MS = 30_000;

function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data as T;
}

export async function fetchDessertList(): Promise<DessertListed[]> {
  const categories = await supabase.from('menu_categories').select('id, name_en, name_ar, kind, is_active').then(unwrap<RawDessertCategory[]>);
  // Only the dessert section's items are read, not the whole menu.
  const ids = categories.filter(isDessertCategory).map((c) => c.id);
  if (ids.length === 0) return [];
  const items = await supabase
    .from('menu_items')
    .select('id, category_id, name_en, name_ar, sort_order')
    .eq('is_active', true)
    .in('category_id', ids)
    .then(unwrap<RawDessertItem[]>);
  return listDesserts(categories, items);
}

export async function fetchDessertsOn(ids: readonly string[]): Promise<RawOrderable[]> {
  if (ids.length === 0) return [];
  return supabase.from('menu_item_availability').select('item_id, orderable').in('item_id', [...ids]).then(unwrap<RawOrderable[]>);
}

export interface DessertCaseState {
  /** Null until the first read lands. */
  list: DessertOnShow[] | null;
  status: 'loading' | 'error' | 'ready';
}

export function useDessertCase(): DessertCaseState {
  const listQ = useQuery({ queryKey: LIST_KEY, queryFn: fetchDessertList, staleTime: 5 * 60_000 });
  const ids = useMemo(() => (listQ.data ?? []).map((d) => d.id), [listQ.data]);
  const onQ = useQuery({
    queryKey: [...ON_KEY, ids.join(',')],
    queryFn: () => fetchDessertsOn(ids),
    enabled: listQ.data !== undefined,
    refetchInterval: DESSERT_REFETCH_MS,
  });
  useBroadcast({ topic: 'menu', isPrivate: false, events: ['menu_changed'], invalidateKeys: [DESSERT_KEY] });

  const list = useMemo(() => (listQ.data && onQ.data ? withAvailability(listQ.data, onQ.data) : null), [listQ.data, onQ.data]);
  const failed = (listQ.isError && listQ.data === undefined) || (onQ.isError && onQ.data === undefined);
  return { list, status: failed ? 'error' : list ? 'ready' : 'loading' };
}
