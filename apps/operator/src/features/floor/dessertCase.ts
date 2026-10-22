/**
 * The dessert case on the live floor's bar (owner request, 2026-10-22) — the
 * pure half: which menu items are desserts, what each one looks like in the
 * case, and whether it is on show.
 *
 * WHAT IT SHOWS: the cafe's desserts as the menu has them, each one on show
 * or not. "On show" is the server's own word for it, `orderable` from
 * `menu_item_availability` (sold out, 86'd for the day, or out of stock all
 * fold into it), so the case cannot disagree with the till about what can be
 * sold. One yes/no per dessert; nothing else crosses the wire for it.
 *
 * Desserts are the active items of the cafe's dessert category. The menu has
 * no dessert flag, so the category is found by its name, the way the guest
 * site finds the same section (`MenuStage/sectionArt.tsx`, "Desserts").
 */

export type DessertShape = 'donut' | 'cookie' | 'cheesecake' | 'basque' | 'mosaic' | 'tiramisu' | 'carrot' | 'cup' | 'tray' | 'bowl' | 'cake';

export interface RawDessertCategory {
  id: string;
  name_en: string;
  name_ar: string;
  kind: string;
  is_active: boolean;
}

export interface RawDessertItem {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

export interface RawOrderable {
  item_id: string | null;
  orderable: boolean | null;
}

export interface DessertListed {
  id: string;
  name_en: string;
  name_ar: string;
  shape: DessertShape;
}

export interface DessertOnShow extends DessertListed {
  available: boolean;
}

/** Places in the case: three levels of three. More desserts than this are listed in the tooltip, not drawn. */
export const DESSERT_CASE_SLOTS = 9;

/** The cafe's dessert section: active, not the shop, named "Desserts" (or "حلويات"). */
export function isDessertCategory(c: RawDessertCategory): boolean {
  if (!c.is_active || c.kind === 'shop') return false;
  return /dessert|sweet/i.test(c.name_en) || /حلو/.test(c.name_ar);
}

/**
 * What a dessert looks like in the case, from its English name. The venue's
 * eight (Donut, Cookies, Cheesecake, Mosaic Cake, San Sebastian, Brownies,
 * Tiramisu, Carrot Cake) each have their own; a few common others are
 * guessed, and anything unrecognised is a small round cake. Order matters:
 * "San Sebastian cheesecake", "carrot cake" and "cupcake" all contain words a
 * later rule would take.
 */
export function dessertShape(nameEn: string): DessertShape {
  const n = nameEn.toLowerCase();
  if (/donut|doughnut/.test(n)) return 'donut';
  if (/cookie|biscuit/.test(n)) return 'cookie';
  if (/san ?sebast|basque|burnt/.test(n)) return 'basque';
  if (/cheesecake/.test(n)) return 'cheesecake';
  if (/mosaic|log|roll/.test(n)) return 'mosaic';
  if (/tiramisu|opera|layer/.test(n)) return 'tiramisu';
  if (/carrot/.test(n)) return 'carrot';
  if (/cupcake|muffin/.test(n)) return 'cake';
  // The venue's brownie is served in a cup (the recipe's "Brownie (cup)").
  if (/brownie|pudding|mousse|trifle|cup/.test(n)) return 'cup';
  if (/kunaf|knafe|kunef|baklava|basbous|tray/.test(n)) return 'tray';
  if (/fruit|salad|ice ?cream|gelato|bowl/.test(n)) return 'bowl';
  return 'cake';
}

/** The desserts on the menu, in menu order: the case's places follow it. */
export function listDesserts(categories: readonly RawDessertCategory[], items: readonly RawDessertItem[]): DessertListed[] {
  const sections = new Set(categories.filter(isDessertCategory).map((c) => c.id));
  return items
    .filter((i) => sections.has(i.category_id))
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name_en.localeCompare(b.name_en))
    .map((i) => ({ id: i.id, name_en: i.name_en, name_ar: i.name_ar, shape: dessertShape(i.name_en) }));
}

/**
 * Each dessert with its yes/no. A dessert the view has no row for is not on
 * show: the view answers for every active item, so a missing row means the
 * read and the list disagree, and an empty place is the honest picture.
 */
export function withAvailability(list: readonly DessertListed[], rows: readonly RawOrderable[]): DessertOnShow[] {
  const on = new Map<string, boolean>();
  for (const r of rows) if (r.item_id) on.set(r.item_id, r.orderable === true);
  return list.map((d) => ({ ...d, available: on.get(d.id) ?? false }));
}
