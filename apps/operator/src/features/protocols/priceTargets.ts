/**
 * What a price or promotion change may name (app.price_promo_targets,
 * build-contracts-2026-09-23 §2.13), read defensively, and the proposal a
 * start opens with when a screen links in with `?change=&item=|addon=|
 * promotion=|rule=` (§5.1, §5.5): the target's current figures, so the
 * person changes a number rather than typing every one.
 *
 * List prices, rules and discounts only: the targets carry no cost and no
 * sales (those are the numbers step's, price_promo_numbers, MGMT only).
 */
import type { PriceChangeKind } from '@touch/core/protocols';
import type { Locale } from '@touch/i18n';
import { isObj, pickText } from './protocolLogic';
import type { Obj } from './formModel';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface TargetSize {
  variant_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
}

export interface TargetItem {
  menu_item_id: string;
  name_en: string;
  name_ar: string;
  category_kind: 'cafe' | 'shop' | string;
  is_active: boolean;
  sizes: TargetSize[];
}

export interface TargetAddon {
  modifier_id: string;
  group_name_en: string;
  group_name_ar: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  is_active: boolean;
  launched: boolean;
}

export interface TargetPromotion {
  promotion_id: string;
  name_en: string;
  name_ar: string;
  enabled: boolean;
  fields: Obj;
}

export interface TargetRule {
  rule_id: string;
  name: string;
  court_name_en: string | null;
  court_name_ar: string | null;
  is_active: boolean;
  fields: Obj;
}

export interface Targets {
  items: TargetItem[];
  addons: TargetAddon[];
  promotions: TargetPromotion[];
  rules: TargetRule[];
  featured: { item_id: string | null; pct: number; hero_mode: string | null } | null;
}

const EMPTY: Targets = { items: [], addons: [], promotions: [], rules: [], featured: null };

function readSize(raw: unknown): TargetSize | null {
  if (!isObj(raw) || typeof raw.variant_id !== 'string') return null;
  return { variant_id: raw.variant_id, name_en: str(raw.name_en) ?? '', name_ar: str(raw.name_ar) ?? '', price_iqd: num(raw.price_iqd) ?? 0 };
}

/** The promotion fields of a target, in the `upsert_promotion` shape the proposal sends (§2.8). */
function promotionFields(p: Obj): Obj {
  const scope = isObj(p.scope) ? p.scope : {};
  const limits = isObj(p.limits) ? p.limits : null;
  return {
    name_en: str(p.name_en) ?? '',
    name_ar: str(p.name_ar) ?? '',
    type: p.type === 'amount' ? 'amount' : 'percent',
    value: num(p.value),
    starts_at: str(p.starts_at) ?? '',
    ends_at: str(p.ends_at) ?? '',
    weekdays: arr(p.weekdays).filter((d): d is number => typeof d === 'number'),
    hour_from: str(p.hour_from) ?? '',
    hour_to: str(p.hour_to) ?? '',
    scope: {
      courtIds: arr(scope.courtIds).filter((x): x is string => typeof x === 'string'),
      categoryIds: arr(scope.categoryIds).filter((x): x is string => typeof x === 'string'),
      itemIds: arr(scope.itemIds).filter((x): x is string => typeof x === 'string'),
    },
    limits: {
      total: num(limits?.total),
      perCustomer: num(limits?.perCustomer),
      minSpendIqd: num(limits?.minSpendIqd),
    },
    auto: p.auto === true,
    public_code: str(p.public_code) ?? '',
    code_single_use: p.code_single_use === true,
  };
}

/** A rule's fields in the `upsert_rate_rule` shape (§2.8 `rate`). */
function ruleFields(r: Obj): Obj {
  const prices: Record<string, number> = {};
  if (isObj(r.prices)) for (const [k, v] of Object.entries(r.prices)) if (typeof v === 'number') prices[k] = v;
  return {
    name: str(r.name) ?? '',
    court_id: str(r.court_id) ?? '',
    days_of_week: arr(r.days_of_week).filter((d): d is number => typeof d === 'number'),
    start_time: str(r.start_time) ?? '',
    end_time: str(r.end_time) ?? '',
    prices,
    priority: num(r.priority),
    valid_from: str(r.valid_from) ?? '',
    valid_to: str(r.valid_to) ?? '',
    is_active: r.is_active !== false,
  };
}

export function readTargets(raw: unknown): Targets {
  if (!isObj(raw)) return { ...EMPTY };
  const items = arr(raw.items)
    .filter(isObj)
    .map((i) => ({
      menu_item_id: str(i.menu_item_id) ?? '',
      name_en: str(i.name_en) ?? '',
      name_ar: str(i.name_ar) ?? '',
      category_kind: str(i.category_kind) ?? 'cafe',
      is_active: i.is_active !== false,
      sizes: arr(i.sizes).map(readSize).filter((s): s is TargetSize => s !== null),
    }))
    .filter((i) => i.menu_item_id !== '');
  const addons = arr(raw.addons)
    .filter(isObj)
    .map((a) => ({
      modifier_id: str(a.modifier_id) ?? '',
      group_name_en: str(a.group_name_en) ?? '',
      group_name_ar: str(a.group_name_ar) ?? '',
      name_en: str(a.name_en) ?? '',
      name_ar: str(a.name_ar) ?? '',
      price_delta_iqd: num(a.price_delta_iqd) ?? 0,
      is_active: a.is_active === true,
      launched: a.launched === true,
    }))
    .filter((a) => a.modifier_id !== '');
  const promotions = arr(raw.promotions)
    .filter(isObj)
    .map((p) => ({
      promotion_id: str(p.promotion_id) ?? '',
      name_en: str(p.name_en) ?? '',
      name_ar: str(p.name_ar) ?? '',
      enabled: p.enabled === true,
      fields: promotionFields(p),
    }))
    .filter((p) => p.promotion_id !== '');
  const rules = arr(raw.rules)
    .filter(isObj)
    .map((r) => ({
      rule_id: str(r.rule_id) ?? '',
      name: str(r.name) ?? '',
      court_name_en: str(r.court_name_en),
      court_name_ar: str(r.court_name_ar),
      is_active: r.is_active !== false,
      fields: ruleFields(r),
    }))
    .filter((r) => r.rule_id !== '');
  const featured =
    'featured_discount_pct' in raw || 'featured_item_id' in raw
      ? {
          item_id: str(raw.featured_item_id),
          pct: Number(raw.featured_discount_pct) || 0,
          hero_mode: str(raw.hero_mode),
        }
      : null;
  return { items, addons, promotions, rules, featured };
}

/** A new court rate as the form starts it: every day, no prices yet, switched on. */
export const NEW_RULE: Obj = {
  name: '',
  court_id: '',
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  start_time: '',
  end_time: '',
  prices: {},
  priority: null,
  valid_from: '',
  valid_to: '',
  is_active: true,
};

/** The sizes of an item as the `prices` list, at today's prices. */
export function sizePrices(item: TargetItem | undefined): { variant_id: string; price_iqd: number }[] {
  return (item?.sizes ?? []).map((s) => ({ variant_id: s.variant_id, price_iqd: s.price_iqd }));
}

export interface TargetLink {
  item?: string;
  addon?: string;
  promotion?: string;
  rule?: string;
}

/**
 * The proposal a price or promo start opens with: the change, and for a link
 * from another screen, the target it named with its current figures. A target
 * the list does not hold (switched on since, another venue's) is left out, and
 * the form asks for one.
 */
export function priceProposalPrefill(change: PriceChangeKind, targets: Targets, link: TargetLink): Obj {
  switch (change) {
    case 'price':
    case 'shop_launch': {
      const item = targets.items.find((i) => i.menu_item_id === link.item);
      return item ? { change, menu_item_id: item.menu_item_id, prices: sizePrices(item) } : { change, prices: [] };
    }
    case 'addon_price': {
      const addon = targets.addons.find((a) => a.modifier_id === link.addon);
      return { change, addons: addon ? [{ modifier_id: addon.modifier_id, price_delta_iqd: addon.price_delta_iqd }] : [] };
    }
    case 'promotion':
      return { change };
    case 'promotion_edit': {
      const p = targets.promotions.find((x) => x.promotion_id === link.promotion);
      return p ? { change, promotion_id: p.promotion_id, promotion: p.fields } : { change };
    }
    case 'promotion_enable': {
      const p = targets.promotions.find((x) => x.promotion_id === link.promotion);
      return p ? { change, promotion_id: p.promotion_id } : { change };
    }
    case 'rate': {
      const r = targets.rules.find((x) => x.rule_id === link.rule);
      return r ? { change, rule_id: r.rule_id, rule: r.fields } : { change, rule: NEW_RULE };
    }
    case 'featured_discount': {
      const f = targets.featured;
      const on = f?.item_id && targets.items.some((i) => i.menu_item_id === f.item_id) ? f.item_id : '';
      return { change, menu_item_id: on ?? '', discount_pct: f ? f.pct : null };
    }
  }
}

/** What picking a target does to the proposal: an item brings its sizes, a promotion or a rule its fields. */
export function pickTarget(change: PriceChangeKind, targets: Targets, record: Obj, id: string): Obj {
  switch (change) {
    case 'price':
    case 'shop_launch': {
      const item = targets.items.find((i) => i.menu_item_id === id);
      // Another item's sizes: its prices at today's, and no new size or new name carried over.
      return { ...record, menu_item_id: id, prices: sizePrices(item), new_sizes: [], renames: [] };
    }
    case 'promotion_edit': {
      const p = targets.promotions.find((x) => x.promotion_id === id);
      return { ...record, promotion_id: id, promotion: p?.fields ?? record.promotion };
    }
    case 'promotion_enable':
      return { ...record, promotion_id: id };
    case 'rate': {
      if (id === '') return { ...record, rule_id: '', rule: NEW_RULE };
      const r = targets.rules.find((x) => x.rule_id === id);
      return { ...record, rule_id: id, rule: r?.fields ?? record.rule };
    }
    case 'featured_discount':
      return { ...record, menu_item_id: id };
    default:
      return record;
  }
}

/** The item a target list holds, by id; for labels. */
export function targetItemName(targets: Targets, id: unknown, locale: Locale): string {
  const item = targets.items.find((i) => i.menu_item_id === id);
  return item ? pickText(locale, item.name_en, item.name_ar) : '';
}
