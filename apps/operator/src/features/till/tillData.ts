/**
 * Till data layer — row shapes, the shared menu query and the tab fetchers.
 *
 * Pulled out of TillScreen so the grid, the tab panel, the open-tabs board and
 * the drawer screen read from ONE set of fetchers and ONE set of query keys:
 *   ['menu']          the till menu (categories, items, groups, modifiers, availability)
 *   ['tabs']          every open tab on the floor (rail + open-tabs board)
 *   ['tab', id]       one tab's detail (six-level join)
 *   ['taxInclusive']  venue_settings.tax_inclusive
 * `queueResults` invalidates ['tab'] / ['tabs'] on mutation acks, so the key
 * shapes here are load-bearing — do not rename them.
 */
import { supabase } from '../../lib/supabase';
import { cachedQuery } from '../../lib/refCache';

// ---------------------------------------------------------------------------
// Row shapes (manual mirrors of the nested selects)
// ---------------------------------------------------------------------------
export interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
  is_active: boolean;
  tax_group: { rate_bp: number } | null;
}
export interface VariantRow {
  id: string;
  item_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}
export interface ModifierRow {
  id: string;
  group_id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  is_active: boolean;
}
export interface ModifierGroupRow {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
}
export interface ItemRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  /** Staff-marked (set_item_sold_out) — `available: false` in spec terms. */
  sold_out: boolean;
  /** Staff-marked for one business day (set_item_availability) — `available: false`. */
  unavailable_on: string | null;
  sort_order: number;
  menu_item_variants: VariantRow[];
  menu_item_modifier_groups: { group_id: string; sort_order: number }[];
}

export interface TillMenu {
  categories: CategoryRow[];
  items: ItemRow[];
  groups: ModifierGroupRow[];
  modifiers: ModifierRow[];
  /**
   * item id -> orderable, from the menu_item_availability view. A plain record,
   * not a Map: this query is persisted to localStorage for the warm start (B1)
   * and a Map round-trips through JSON as `{}` — the till then crashed on
   * `availability.get` at its first cold paint.
   */
  availability: Record<string, boolean>;
}

/**
 * The till menu — five selects, one key, shared by the grid AND the tax
 * computation (rate_bp rides on categories). staleTime 5 min with the `menu`
 * broadcast as the primary invalidation.
 */
export const TILL_MENU_QUERY = {
  queryKey: ['menu'] as const,
  staleTime: 300_000,
  refetchOnWindowFocus: false,
  queryFn: async (): Promise<TillMenu> => {
    // cachedQuery wraps only the serialisable half (SOW L671: the till keeps
    // trading from the cached menu + prices); the Map is rebuilt after.
    const raw = await cachedQuery('menu', async () => {
      const [cats, items, groups, mods, avail] = await Promise.all([
        supabase
          .from('menu_categories')
          .select('id, name_en, name_ar, sort_order, is_active, tax_group:tax_groups(rate_bp)')
          .order('sort_order'),
        supabase
          .from('menu_items')
          .select(
            'id, category_id, name_en, name_ar, is_active, sold_out, unavailable_on, sort_order, menu_item_variants(*), menu_item_modifier_groups(group_id, sort_order)',
          )
          .order('sort_order'),
        supabase.from('modifier_groups').select('*'),
        supabase.from('modifiers').select('*').order('sort_order'),
        supabase.from('menu_item_availability').select('item_id, orderable'),
      ]);
      for (const r of [cats, items, groups, mods, avail]) if (r.error) throw r.error;
      return {
        categories: (cats.data ?? []) as unknown as CategoryRow[],
        items: (items.data ?? []) as unknown as ItemRow[],
        groups: (groups.data ?? []) as unknown as ModifierGroupRow[],
        modifiers: (mods.data ?? []) as unknown as ModifierRow[],
        availabilityRows: (avail.data ?? []) as { item_id: string; orderable: boolean }[],
      };
    });
    return {
      categories: raw.categories,
      items: raw.items,
      groups: raw.groups,
      modifiers: raw.modifiers,
      availability: Object.fromEntries(raw.availabilityRows.map((a) => [a.item_id, a.orderable])),
    };
  },
};

// ---------------------------------------------------------------------------
// Open tabs (rail + 06.12 board)
// ---------------------------------------------------------------------------
export interface TabListRow {
  id: string;
  status: string;
  label: string | null;
  opened_at: string;
  /** Stamped by the server at settlement; null while the tab is open. */
  total_iqd: number | null;
  table: { table_number: string } | null;
  reservation: {
    guest_name: string | null;
    court: { name_en: string; name_ar: string } | null;
  } | null;
  orders: {
    source: string;
    status: string;
    order_items: { line_total_iqd: number; voided: boolean; menu_item: { category_id: string } | null }[];
  }[];
  tab_adjustments: { kind: string; amount_iqd: number }[];
  payments: { amount_iqd: number }[];
}

export const OPEN_TABS_QUERY = {
  queryKey: ['tabs'] as const,
  queryFn: (): Promise<TabListRow[]> =>
    cachedQuery('open_tabs', async () => {
      const { data, error } = await supabase
        .from('tabs')
        .select(
          `id, status, label, opened_at, total_iqd,
           table:cafe_tables(table_number),
           reservation:reservations(guest_name, court:courts(name_en, name_ar)),
           orders(source, status, order_items(line_total_iqd, voided, menu_item:menu_items(category_id))),
           tab_adjustments(kind, amount_iqd),
           payments(amount_iqd)`,
        )
        .in('status', ['open', 'awaiting_payment'])
        .is('merged_into_tab_id', null)
        .order('opened_at');
      if (error) throw error;
      return data as unknown as TabListRow[];
    }),
  // Safety net under the 'floor' broadcast. A missed realtime frame used to
  // leave the rail stale until someone navigated away and back.
  refetchInterval: 30_000,
};

/** True when any order on the tab arrived from the guest web menu. */
export function tabHasWebOrder(tab: Pick<TabListRow, 'orders'>): boolean {
  // `?? []` for the same reason computeTabTotals guards its arrays: a row out
  // of the persisted cache may predate this embed. See tabTotals.TotalsInput.
  return (tab.orders ?? []).some((o) => o.source === 'guest_web');
}

// ---------------------------------------------------------------------------
// One tab (06.13 detail)
// ---------------------------------------------------------------------------
export interface TabLineRow {
  id: string;
  qty: number;
  unit_price_iqd: number;
  line_total_iqd: number;
  voided: boolean;
  notes: string | null;
  menu_item: { name_en: string; name_ar: string; category_id: string } | null;
  variant: { name_en: string; name_ar: string } | null;
  order_item_modifiers: {
    qty: number;
    price_delta_iqd: number;
    modifier: { name_en: string; name_ar: string } | null;
  }[];
}

export interface TabOrderRow {
  id: string;
  status: string;
  source: string;
  placed_at: string;
  order_items: TabLineRow[];
}

export interface TabAdjustmentRow {
  id: string;
  kind: string;
  amount_iqd: number;
  /** 'promotion' marks a server-applied promotion (build plan §0); anything else is a manager action. */
  reason_code: string;
}

export interface TabDetail {
  id: string;
  status: string;
  label: string | null;
  subtotal_iqd: number | null;
  total_iqd: number | null;
  court_iqd: number;
  reservation_id: string | null;
  table: { table_number: string } | null;
  reservation: { guest_name: string | null; court: { name_en: string; name_ar: string } | null } | null;
  orders: TabOrderRow[];
  payments: { id: string; method: string; amount_iqd: number; change_iqd: number | null }[];
  tab_adjustments: TabAdjustmentRow[];
}

export async function fetchTabDetail(tabId: string): Promise<TabDetail> {
  const { data, error } = await supabase
    .from('tabs')
    .select(
      `id, status, label, subtotal_iqd, total_iqd, court_iqd, reservation_id,
       table:cafe_tables(table_number),
       reservation:reservations(guest_name, court:courts(name_en, name_ar)),
       orders (
         id, status, source, placed_at,
         order_items (
           id, qty, unit_price_iqd, line_total_iqd, voided, notes,
           menu_item:menu_items(name_en, name_ar, category_id),
           variant:menu_item_variants(name_en, name_ar),
           order_item_modifiers(qty, price_delta_iqd, modifier:modifiers(name_en, name_ar))
         )
       ),
       payments(id, method, amount_iqd, change_iqd),
       tab_adjustments(id, kind, amount_iqd, reason_code)`,
    )
    .eq('id', tabId)
    .single();
  if (error) throw error;
  return data as unknown as TabDetail;
}

export const tabDetailQuery = (tabId: string) => ({
  queryKey: ['tab', tabId] as const,
  queryFn: () => fetchTabDetail(tabId),
});

/** True when the server marked a promotion adjustment (0067: reason_code = 'promotion'). */
export function isPromotionAdjustment(a: Pick<TabAdjustmentRow, 'reason_code'>): boolean {
  return a.reason_code === 'promotion';
}

// ---------------------------------------------------------------------------
// Basket (unsent lines, priced from the cached menu for display only)
// ---------------------------------------------------------------------------
export interface BasketLine {
  key: string;
  variantId: string;
  itemName: string;
  variantName: string;
  qty: number;
  notes: string;
  unitPriceIqd: number; // display estimate only — server re-snapshots at send
  modifiers: { modifierId: string; name: string; qty: number; priceDeltaIqd: number }[];
}

/** Display estimate for one basket line (unit + modifier deltas) × qty. Never sent to the server. */
export function basketLineEstimate(l: BasketLine): number {
  return (l.unitPriceIqd + l.modifiers.reduce((s, m) => s + m.priceDeltaIqd * m.qty, 0)) * l.qty;
}

/** The label a tab is known by on the floor: table number, guest name or free label. */
export function tabAnchorLabel(
  tab: { table: { table_number: string } | null; reservation: { guest_name: string | null } | null; label: string | null },
  tableWord: string,
  reservationWord: string,
): string {
  if (tab.table) return `${tableWord} ${tab.table.table_number}`;
  if (tab.reservation) return tab.reservation.guest_name ?? reservationWord;
  return tab.label ?? '—';
}
