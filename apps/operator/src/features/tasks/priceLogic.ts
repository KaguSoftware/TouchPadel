/**
 * A price or promotion change proposed from /tasks (build-contracts-2026-09-23
 * §2.8, §2.13): what `app.price_promo_targets` offers for each change kind,
 * and how picking a target fills the rest of the form, the way the phone's
 * start form does. Marketing proposes; the numbers and the owner's OK come
 * after, on management's screens.
 *
 * Pure: the targets payload in, drafts out. Every figure here is a list price
 * any staff session already reads (no cost, no sales, §2.13).
 */
import { PROMOTION_FIELDS, RATE_RULE_FIELDS, type PriceChangeKind } from '@touch/core/protocols';
import { bilingual, isObject, list, num, str } from '../roleExtras/roleExtrasLogic';
import { emptyDraft, fromRecord, type Draft } from './formModel';

export interface TargetSize {
  variantId: string;
  nameEn: string | null;
  nameAr: string | null;
  priceIqd: number;
}

export interface TargetItem {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  sizes: TargetSize[];
}

export interface TargetAddon {
  id: string;
  groupEn: string | null;
  groupAr: string | null;
  nameEn: string | null;
  nameAr: string | null;
  priceDelta: number;
}

export interface Targets {
  items: TargetItem[];
  addons: TargetAddon[];
  promotions: (Record<string, unknown> & { promotion_id: string; name_en: string | null; name_ar: string | null })[];
  rules: (Record<string, unknown> & { rule_id: string; name: string | null })[];
  featuredItemId: string | null;
  featuredPct: number | null;
}

/** The change kinds that pick a target from app.price_promo_targets; a new promotion picks none. */
export function needsTargets(change: PriceChangeKind): boolean {
  return change !== 'promotion';
}

export function readTargets(payload: unknown): Targets {
  const p = isObject(payload) ? payload : {};
  return {
    items: list(p.items)
      .filter((i) => typeof i.menu_item_id === 'string')
      .map((i) => ({
        id: i.menu_item_id as string,
        nameEn: str(i.name_en),
        nameAr: str(i.name_ar),
        sizes: list(i.sizes)
          .filter((s) => typeof s.variant_id === 'string')
          .map((s) => ({ variantId: s.variant_id as string, nameEn: str(s.name_en), nameAr: str(s.name_ar), priceIqd: num(s.price_iqd) ?? 0 })),
      })),
    addons: list(p.addons)
      .filter((a) => typeof a.modifier_id === 'string')
      .map((a) => ({
        id: a.modifier_id as string,
        groupEn: str(a.group_name_en),
        groupAr: str(a.group_name_ar),
        nameEn: str(a.name_en),
        nameAr: str(a.name_ar),
        priceDelta: num(a.price_delta_iqd) ?? 0,
      })),
    promotions: list(p.promotions)
      .filter((x) => typeof x.promotion_id === 'string')
      .map((x) => ({ ...x, promotion_id: x.promotion_id as string, name_en: str(x.name_en), name_ar: str(x.name_ar) })),
    rules: list(p.rules)
      .filter((x) => typeof x.rule_id === 'string')
      .map((x) => ({ ...x, rule_id: x.rule_id as string, name: str(x.name) })),
    featuredItemId: str(p.featured_item_id),
    featuredPct: num(p.featured_discount_pct),
  };
}

export interface Option {
  value: string;
  label: string;
}

/** The id choices a change kind's form offers, by the form's dotted paths. */
export function targetSources(targets: Targets, draft: Draft, locale: 'en' | 'ar'): Record<string, Option[]> {
  const item = targets.items.find((i) => i.id === draft.menu_item_id);
  return {
    menu_item_id: targets.items.map((i) => ({ value: i.id, label: bilingual(locale, i.nameEn, i.nameAr) })),
    'prices.variant_id': (item?.sizes ?? []).map((s) => ({ value: s.variantId, label: bilingual(locale, s.nameEn, s.nameAr) })),
    'addons.modifier_id': targets.addons.map((a) => ({
      value: a.id,
      label: `${bilingual(locale, a.groupEn, a.groupAr)} · ${bilingual(locale, a.nameEn, a.nameAr)}`,
    })),
    promotion_id: targets.promotions.map((x) => ({ value: x.promotion_id, label: bilingual(locale, x.name_en, x.name_ar) })),
    rule_id: targets.rules.map((x) => ({ value: x.rule_id, label: x.name ?? '—' })),
  };
}

/** The form a change kind opens on: reason and effect kept, the rest fresh, featured defaults filled. */
export function startDraft(change: PriceChangeKind, fields: Parameters<typeof emptyDraft>[0], keep: Draft, targets: Targets | null): Draft {
  const draft: Draft = { ...emptyDraft(fields), change, reason: keep.reason ?? '', expected_effect: keep.expected_effect ?? '' };
  if (change === 'featured_discount' && targets) {
    if (targets.featuredItemId) draft.menu_item_id = targets.featuredItemId;
    if (targets.featuredPct !== null) draft.discount_pct = targets.featuredPct;
  }
  if (change === 'rate') draft.rule = { ...emptyDraft(RATE_RULE_FIELDS), is_active: true };
  return draft;
}

/**
 * What picking a target fills in, given the draft before and after a change.
 * An item's sizes come in at today's prices, an add-on at its current charge,
 * a promotion or a rate as it stands; anything already typed for the same
 * target is left alone.
 */
export function deriveDraft(change: PriceChangeKind, prev: Draft, next: Draft, targets: Targets | null): Draft {
  if (!targets) return next;
  if ((change === 'price' || change === 'shop_launch') && next.menu_item_id !== prev.menu_item_id) {
    const item = targets.items.find((i) => i.id === next.menu_item_id);
    return { ...next, prices: (item?.sizes ?? []).map((s) => ({ variant_id: s.variantId, price_iqd: s.priceIqd })) };
  }
  if (change === 'addon_price' && Array.isArray(next.addons)) {
    const before = Array.isArray(prev.addons) ? (prev.addons as Draft[]) : [];
    const addons = (next.addons as Draft[]).map((row, i) => {
      if (row.modifier_id === before[i]?.modifier_id || row.price_delta_iqd !== null) return row;
      const addon = targets.addons.find((a) => a.id === row.modifier_id);
      return addon ? { ...row, price_delta_iqd: addon.priceDelta } : row;
    });
    return { ...next, addons };
  }
  if (change === 'promotion_edit' && next.promotion_id !== prev.promotion_id) {
    const target = targets.promotions.find((x) => x.promotion_id === next.promotion_id);
    return { ...next, promotion: target ? fromRecord(PROMOTION_FIELDS, target) : emptyDraft(PROMOTION_FIELDS) };
  }
  if (change === 'rate' && next.rule_id !== prev.rule_id) {
    const target = targets.rules.find((x) => x.rule_id === next.rule_id);
    return { ...next, rule: target ? fromRecord(RATE_RULE_FIELDS, target) : { ...emptyDraft(RATE_RULE_FIELDS), is_active: true } };
  }
  return next;
}
