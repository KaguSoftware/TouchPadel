import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@touch/db';
import { publicMediaUrl } from './media';

/**
 * Menu read model shared by the server-rendered cafe page and the client
 * refresh path. Reads only anon-visible rows: active categories/items/variants,
 * modifier groups, allergens, modifier reveals (0028), the
 * menu_item_availability view (ingredient-out + sold-out greying) and the
 * cafe_settings_public view (0029). Never `select *` — the column lists below
 * are the contract with the DB slice (0027–0032).
 */

export type MenuHighlight = 'none' | 'blue' | 'brown';

/**
 * Serve-temperature chip from the menu design (migration 0054): the red "حار"
 * and/or blue "بارد" pill beside a name. `both` paints both chips; `none`
 * paints neither (cakes, snacks — the question does not apply).
 */
export type ServeTemp = 'none' | 'hot' | 'cold' | 'both';

export interface MenuModifier {
  id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  sort_order: number;
  /**
   * Groups revealed when this modifier is chosen (modifier_reveals, depth 1):
   * the modifiers inside a revealed group never reveal further groups.
   */
  reveals: MenuModifierGroup[];
}

export interface MenuModifierGroup {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  /** link sort order on the item, or reveal sort order for a revealed group */
  sort_order: number;
  modifiers: MenuModifier[];
}

export interface MenuVariant {
  id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}

export interface MenuAllergen {
  code: string;
  label_en: string;
  label_ar: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  hook_en: string;
  hook_ar: string;
  description_en: string | null;
  description_ar: string | null;
  highlight: MenuHighlight;
  /** sticky manager flag (0027) — distinct from `orderable` (ingredient 86 / auto) */
  sold_out: boolean;
  /** hot/cold chips on the row (0054) */
  serve_temp: ServeTemp;
  photo_path: string | null;
  photo_url: string | null;
  photo_blur: string | null;
  sort_order: number;
  /** false when sold out OR an ingredient is 86'd (menu_item_availability) */
  orderable: boolean;
  /** featured promo percent from settings (decorateFeatured); 0 = list price */
  discountPct: number;
  variants: MenuVariant[];
  allergens: MenuAllergen[];
  modifierGroups: MenuModifierGroup[];
  /** addon_suggestions (0013): suggested item ids in sort order — "goes well with" chips. */
  suggestedItemIds: string[];
}

export interface MenuCategory {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
  /** hot/cold badge on the section heading (0054) */
  serve_temp: ServeTemp;
  photo_path: string | null;
  photo_url: string | null;
  photo_blur: string | null;
  items: MenuItem[];
}

// ---------------------------------------------------------------------------
// Cafe settings (cafe_settings_public, 0029) — typed fold with public defaults
// ---------------------------------------------------------------------------

export type HeroMode = 'none' | 'media' | 'featured';
export type HeroMediaKind = 'image' | 'video';

export interface CafeSettings {
  hero_mode: HeroMode;
  hero_media_path: string | null;
  hero_media_kind: HeroMediaKind;
  featured_item_id: string | null;
  featured_label_en: string;
  featured_label_ar: string;
  featured_badge_en: string;
  featured_badge_ar: string;
  featured_discount_pct: number;
  ticker_en: string[];
  ticker_ar: string[];
  bell_tutorial_enabled: boolean;
}

export const DEFAULT_CAFE_SETTINGS: Readonly<CafeSettings> = Object.freeze({
  hero_mode: 'none',
  hero_media_path: null,
  hero_media_kind: 'image',
  featured_item_id: null,
  featured_label_en: '',
  featured_label_ar: '',
  featured_badge_en: '',
  featured_badge_ar: '',
  featured_discount_pct: 0,
  ticker_en: [],
  ticker_ar: [],
  bell_tutorial_enabled: true,
});

const str = (v: Json | null | undefined, fallback: string): string =>
  typeof v === 'string' ? v : fallback;
const nullableStr = (v: Json | null | undefined): string | null =>
  typeof v === 'string' && v !== '' ? v : null;
const strArray = (v: Json | null | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Pure fold of `cafe_settings_public` rows → typed settings (unknown keys ignored). */
export function foldCafeSettings(
  rows: readonly { key: string | null; value: Json | null }[],
): CafeSettings {
  const s: CafeSettings = { ...DEFAULT_CAFE_SETTINGS, ticker_en: [], ticker_ar: [] };
  for (const { key, value } of rows) {
    switch (key) {
      case 'hero_mode':
        s.hero_mode = value === 'media' || value === 'featured' ? value : 'none';
        break;
      case 'hero_media_path':
        s.hero_media_path = nullableStr(value);
        break;
      case 'hero_media_kind':
        s.hero_media_kind = value === 'video' ? 'video' : 'image';
        break;
      case 'featured_item_id':
        s.featured_item_id = nullableStr(value);
        break;
      case 'featured_label_en':
      case 'featured_label_ar':
      case 'featured_badge_en':
      case 'featured_badge_ar':
        s[key] = str(value, '');
        break;
      case 'featured_discount_pct':
        s.featured_discount_pct =
          typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99
            ? value
            : 0;
        break;
      case 'ticker_en':
      case 'ticker_ar':
        s[key] = strArray(value);
        break;
      case 'bell_tutorial_enabled':
        s.bell_tutorial_enabled = typeof value === 'boolean' ? value : true;
        break;
      default:
        break;
    }
  }
  return s;
}

/** Public cafe settings; a failed read yields the defaults (never throws). */
export async function fetchCafeSettings(client: SupabaseClient<Database>): Promise<CafeSettings> {
  const { data, error } = await client.from('cafe_settings_public').select('key, value');
  if (error || !data) return { ...DEFAULT_CAFE_SETTINGS, ticker_en: [], ticker_ar: [] };
  return foldCafeSettings(data);
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; also used by basket.ts)
// ---------------------------------------------------------------------------

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

/** A modifier group as read from the DB, before reveals are attached. */
export interface RawModifierGroup {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  modifiers: Omit<MenuModifier, 'reveals'>[];
}

export interface RevealRow {
  modifier_id: string;
  group_id: string;
  sort_order: number;
}

/**
 * modifier id → revealed groups (depth 1, mirroring app.item_active_groups):
 * the modifiers of a revealed group carry `reveals: []`, so a cycle such as
 * A→B→A (or a self-reveal) can never produce an infinite structure. Reveals
 * pointing at the modifier's own group or an unknown group are dropped.
 */
export function resolveReveals(
  reveals: readonly RevealRow[],
  groups: readonly RawModifierGroup[],
): Map<string, MenuModifierGroup[]> {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const ownGroupOfModifier = new Map<string, string>();
  for (const g of groups) for (const m of g.modifiers) ownGroupOfModifier.set(m.id, g.id);

  const out = new Map<string, MenuModifierGroup[]>();
  const sorted = [...reveals].sort(bySort);
  for (const r of sorted) {
    const group = groupById.get(r.group_id);
    if (!group) continue;
    if (ownGroupOfModifier.get(r.modifier_id) === r.group_id) continue; // self-reveal
    const list = out.get(r.modifier_id) ?? [];
    if (list.some((g) => g.id === group.id)) continue;
    list.push({
      id: group.id,
      name_en: group.name_en,
      name_ar: group.name_ar,
      min_select: group.min_select,
      max_select: group.max_select,
      sort_order: r.sort_order,
      modifiers: [...group.modifiers].sort(bySort).map((m) => ({ ...m, reveals: [] })),
    });
    out.set(r.modifier_id, list);
  }
  return out;
}

/** True when the settings make `itemId` the featured item with a live discount. */
export function featuredDiscountPct(itemId: string, settings: CafeSettings): number {
  return settings.hero_mode === 'featured' &&
    settings.featured_item_id === itemId &&
    settings.featured_discount_pct > 0
    ? settings.featured_discount_pct
    : 0;
}

/** Stamp `discountPct` on every item from the featured promo settings (immutable). */
export function decorateFeatured(
  menu: readonly MenuCategory[],
  settings: CafeSettings,
): MenuCategory[] {
  return menu.map((c) => ({
    ...c,
    items: c.items.map((i) => ({ ...i, discountPct: featuredDiscountPct(i.id, settings) })),
  }));
}

/**
 * Groups currently in play for an item = linked groups ∪ groups revealed by
 * chosen modifiers that belong to a linked group (app.item_active_groups,
 * depth 1). Revealed groups follow their parent group; duplicates collapse.
 */
export function activeGroups(
  item: Pick<MenuItem, 'modifierGroups'>,
  chosenModifierIds: Iterable<string>,
): MenuModifierGroup[] {
  const chosen = new Set(chosenModifierIds);
  const out: MenuModifierGroup[] = [];
  const seen = new Set<string>();
  const push = (g: MenuModifierGroup) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    out.push(g);
  };
  for (const g of item.modifierGroups) {
    push(g);
    for (const m of g.modifiers) {
      if (!chosen.has(m.id)) continue;
      for (const revealed of m.reveals) push(revealed);
    }
  }
  return out;
}

/** Flat lookup of every item in a menu. */
export function itemsById(menu: readonly MenuCategory[]): Map<string, MenuItem> {
  const map = new Map<string, MenuItem>();
  for (const c of menu) for (const i of c.items) map.set(i.id, i);
  return map;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const asHighlight = (v: string): MenuHighlight => (v === 'blue' || v === 'brown' ? v : 'none');

const asServeTemp = (v: string | null | undefined): ServeTemp =>
  v === 'hot' || v === 'cold' || v === 'both' ? v : 'none';

export async function fetchMenu(client: SupabaseClient<Database>): Promise<MenuCategory[]> {
  const [categoriesRes, itemsRes, availabilityRes, suggestionsRes, revealsRes] = await Promise.all([
    client
      .from('menu_categories')
      .select('id, name_en, name_ar, sort_order, serve_temp, photo_path, photo_blur')
      .eq('is_active', true),
    client
      .from('menu_items')
      .select(
        `id, category_id, name_en, name_ar, hook_en, hook_ar, description_en, description_ar,
         highlight, sold_out, serve_temp, photo_path, photo_blur, sort_order,
         menu_item_variants ( id, name_en, name_ar, price_iqd, is_default, sort_order ),
         menu_item_allergens ( allergens ( code, label_en, label_ar ) ),
         menu_item_modifier_groups ( sort_order,
           modifier_groups ( id, name_en, name_ar, min_select, max_select,
             modifiers!modifiers_group_id_fkey ( id, name_en, name_ar, price_delta_iqd, sort_order, is_active ) ) )`,
      )
      .eq('is_active', true),
    client.from('menu_item_availability').select('item_id, orderable'),
    client
      .from('addon_suggestions')
      .select('item_id, suggested_item_id, sort_order')
      .order('sort_order'),
    // Fifth query: every reveal edge with its target group (+ modifiers), so a
    // revealed group need not be linked to the item itself (0028).
    client.from('modifier_reveals').select(
      `modifier_id, group_id, sort_order,
       modifier_groups ( id, name_en, name_ar, min_select, max_select,
         modifiers!modifiers_group_id_fkey ( id, name_en, name_ar, price_delta_iqd, sort_order, is_active ) )`,
    ),
  ]);

  if (categoriesRes.error) throw categoriesRes.error;
  if (itemsRes.error) throw itemsRes.error;
  // Availability is a progressive enhancement — a failed read greys nothing.
  const orderableById = new Map<string, boolean>();
  for (const row of availabilityRes.data ?? []) {
    if (row.item_id) orderableById.set(row.item_id, row.orderable ?? true);
  }
  // Suggestions are a progressive enhancement too — a failed read shows no chips.
  const suggestionsById = new Map<string, string[]>();
  for (const row of suggestionsRes.data ?? []) {
    const list = suggestionsById.get(row.item_id) ?? [];
    list.push(row.suggested_item_id);
    suggestionsById.set(row.item_id, list);
  }

  type RawModRow = {
    id: string;
    name_en: string;
    name_ar: string;
    price_delta_iqd: number;
    sort_order: number;
    is_active: boolean;
  };
  type RawGroupRow = {
    id: string;
    name_en: string;
    name_ar: string;
    min_select: number;
    max_select: number;
    modifiers: RawModRow[] | null;
  };
  const toRawGroup = (g: RawGroupRow): RawModifierGroup => ({
    id: g.id,
    name_en: g.name_en,
    name_ar: g.name_ar,
    min_select: g.min_select,
    max_select: g.max_select,
    modifiers: (g.modifiers ?? [])
      .filter((m) => m.is_active)
      .map((m) => ({
        id: m.id,
        name_en: m.name_en,
        name_ar: m.name_ar,
        price_delta_iqd: m.price_delta_iqd,
        sort_order: m.sort_order,
      }))
      .sort(bySort),
  });

  // Reveals are a progressive enhancement — a failed read hides revealed groups
  // (the server still validates, so the guest simply sees fewer choices).
  const revealRows: RevealRow[] = [];
  const rawGroups = new Map<string, RawModifierGroup>();
  for (const r of revealsRes.data ?? []) {
    revealRows.push({ modifier_id: r.modifier_id, group_id: r.group_id, sort_order: r.sort_order });
    if (r.modifier_groups && !rawGroups.has(r.modifier_groups.id)) {
      rawGroups.set(r.modifier_groups.id, toRawGroup(r.modifier_groups));
    }
  }
  for (const row of itemsRes.data ?? []) {
    for (const link of row.menu_item_modifier_groups ?? []) {
      const g = link.modifier_groups;
      if (g && !rawGroups.has(g.id)) rawGroups.set(g.id, toRawGroup(g));
    }
  }
  const revealsByModifier = resolveReveals(revealRows, [...rawGroups.values()]);

  const items: MenuItem[] = (itemsRes.data ?? []).map((row) => ({
    id: row.id,
    category_id: row.category_id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    hook_en: row.hook_en ?? '',
    hook_ar: row.hook_ar ?? '',
    description_en: row.description_en,
    description_ar: row.description_ar,
    highlight: asHighlight(row.highlight),
    sold_out: row.sold_out ?? false,
    serve_temp: asServeTemp(row.serve_temp),
    photo_path: row.photo_path,
    photo_url: publicMediaUrl(row.photo_path),
    photo_blur: row.photo_blur,
    sort_order: row.sort_order,
    orderable: (orderableById.get(row.id) ?? true) && !(row.sold_out ?? false),
    discountPct: 0,
    suggestedItemIds: suggestionsById.get(row.id) ?? [],
    variants: (row.menu_item_variants ?? [])
      .map((v) => ({
        id: v.id,
        name_en: v.name_en,
        name_ar: v.name_ar,
        price_iqd: v.price_iqd,
        is_default: v.is_default,
        sort_order: v.sort_order,
      }))
      .sort(bySort),
    allergens: (row.menu_item_allergens ?? [])
      .map((link) => link.allergens)
      .filter((a): a is NonNullable<typeof a> => a != null)
      .map((a) => ({ code: a.code, label_en: a.label_en, label_ar: a.label_ar })),
    modifierGroups: (row.menu_item_modifier_groups ?? [])
      .map((link) => {
        const group = link.modifier_groups;
        if (!group) return null;
        const raw = rawGroups.get(group.id) ?? toRawGroup(group);
        return {
          id: raw.id,
          name_en: raw.name_en,
          name_ar: raw.name_ar,
          min_select: raw.min_select,
          max_select: raw.max_select,
          sort_order: link.sort_order,
          modifiers: raw.modifiers.map((m) => ({
            ...m,
            reveals: revealsByModifier.get(m.id) ?? [],
          })),
        };
      })
      .filter((g): g is MenuModifierGroup => g !== null)
      .sort(bySort),
  }));

  return (categoriesRes.data ?? [])
    .map((c) => ({
      id: c.id,
      name_en: c.name_en,
      name_ar: c.name_ar,
      sort_order: c.sort_order,
      serve_temp: asServeTemp(c.serve_temp),
      photo_path: c.photo_path,
      photo_url: publicMediaUrl(c.photo_path),
      photo_blur: c.photo_blur,
      items: items.filter((i) => i.category_id === c.id).sort(bySort),
    }))
    .filter((c) => c.items.length > 0)
    .sort(bySort);
}

export interface VenueOpeningHours {
  venue_name: string;
  opening_hours: Record<string, [string, string][]>;
  closed_dates: string[];
  /** venue phone (0026 added the column to the public view); null = not set */
  phone: string | null;
}

/** Opening hours, venue name & phone from the anon-safe venue_settings_public view. */
export async function fetchVenuePublic(
  client: SupabaseClient<Database>,
): Promise<VenueOpeningHours | null> {
  const { data, error } = await client
    .from('venue_settings_public')
    .select('venue_name, opening_hours, closed_dates, phone')
    .maybeSingle();
  if (error || !data) return null;
  return {
    venue_name: data.venue_name ?? 'Touch Padel',
    opening_hours: (data.opening_hours ?? {}) as Record<string, [string, string][]>,
    closed_dates: data.closed_dates ?? [],
    phone: data.phone ?? null,
  };
}
