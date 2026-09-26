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
  /** On sale now or once: only such an option is renamed through a price change (wave 5 §2.2, #9). */
  launched: boolean;
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
        launched: a.launched === true,
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
    // New names (wave 5 §2.2, #9): the item's sizes, or the options on sale.
    'renames.variant_id': (item?.sizes ?? []).map((s) => ({ value: s.variantId, label: bilingual(locale, s.nameEn, s.nameAr) })),
    'renames.modifier_id': targets.addons
      .filter((a) => a.launched)
      .map((a) => ({
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

/** The member a change's `renames` rows name their size or option by, or null when it renames nothing. */
export function renameKeyOf(change: PriceChangeKind | null): 'variant_id' | 'modifier_id' | null {
  if (change === 'price') return 'variant_id';
  if (change === 'addon_price') return 'modifier_id';
  return null;
}

/**
 * Today's names of what a change may rename, by id: the picked item's sizes
 * for a price change, the options on sale for an add-on price change. What
 * `withoutUnchangedRenames` (formModel.ts) compares a typed name with.
 */
export function currentNames(change: PriceChangeKind | null, targets: Targets | null, draft: Draft): Map<string, { name_en: string; name_ar: string }> {
  const out = new Map<string, { name_en: string; name_ar: string }>();
  if (!targets) return out;
  if (change === 'price') {
    const item = targets.items.find((i) => i.id === draft.menu_item_id);
    for (const s of item?.sizes ?? []) out.set(s.variantId, { name_en: s.nameEn ?? '', name_ar: s.nameAr ?? '' });
  }
  if (change === 'addon_price') {
    for (const a of targets.addons) if (a.launched) out.set(a.id, { name_en: a.nameEn ?? '', name_ar: a.nameAr ?? '' });
  }
  return out;
}

/**
 * A rename row whose size or option was just picked opens on its names
 * today, so marketing changes a name rather than retyping both (wave 5 §2.2,
 * #9). A size or option already in a row before keeps whatever was typed,
 * wherever its row now sits (a row above it may have been removed).
 */
function prefillRenames(change: PriceChangeKind, prev: Draft, next: Draft, targets: Targets): Draft {
  const key = renameKeyOf(change);
  if (!key || !Array.isArray(next.renames)) return next;
  const before = new Set((Array.isArray(prev.renames) ? (prev.renames as Draft[]) : []).map((r) => r[key]));
  const names = currentNames(change, targets, next);
  let changed = false;
  const renames = (next.renames as Draft[]).map((row) => {
    const id = row[key];
    if (typeof id !== 'string' || id === '' || before.has(id)) return row;
    const now = names.get(id);
    if (!now) return row;
    changed = true;
    return { ...row, name_en: now.name_en, name_ar: now.name_ar };
  });
  return changed ? { ...next, renames } : next;
}

/**
 * What picking a target fills in, given the draft before and after a change.
 * An item's sizes come in at today's prices, an add-on at its current charge,
 * a promotion or a rate as it stands, a size or an option to rename at its
 * names today; anything already typed for the same target is left alone.
 * Another item drops the renames of the last one's sizes.
 */
export function deriveDraft(change: PriceChangeKind, prev: Draft, next: Draft, targets: Targets | null): Draft {
  if (!targets) return next;
  if ((change === 'price' || change === 'shop_launch') && next.menu_item_id !== prev.menu_item_id) {
    const item = targets.items.find((i) => i.id === next.menu_item_id);
    return {
      ...next,
      prices: (item?.sizes ?? []).map((s) => ({ variant_id: s.variantId, price_iqd: s.priceIqd })),
      ...(change === 'price' ? { renames: [] } : {}),
    };
  }
  if (change === 'addon_price') {
    if (!Array.isArray(next.addons)) return prefillRenames(change, prev, next, targets);
    const before = Array.isArray(prev.addons) ? (prev.addons as Draft[]) : [];
    const addons = (next.addons as Draft[]).map((row, i) => {
      if (row.modifier_id === before[i]?.modifier_id || row.price_delta_iqd !== null) return row;
      const addon = targets.addons.find((a) => a.id === row.modifier_id);
      return addon ? { ...row, price_delta_iqd: addon.priceDelta } : row;
    });
    return prefillRenames(change, prev, { ...next, addons }, targets);
  }
  if (change === 'price') return prefillRenames(change, prev, next, targets);
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
