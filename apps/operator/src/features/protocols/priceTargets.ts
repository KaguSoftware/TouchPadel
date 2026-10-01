/**
 * What a price or promotion change may name (app.price_promo_targets,
 * build-contracts-2026-09-23 §2.13), read defensively, and the proposal a
 * start opens with when a screen links in with `?change=&item=|addon=|
 * promotion=|rule=` (§5.1, §5.5): the target's current figures, so the
 * person changes a number rather than typing every one.
 *
 * List prices, rules and discounts only: the targets carry no cost and no
 * sales (those are the numbers step's, price_promo_numbers, MGMT only).
 *
 * Coaching (0285, operator.md §5.14.2): `lesson_price` and `lesson_launch`
 * name a lesson type (`lessonTypes`), `coach_price` a coach and one of the
 * types they teach (`coaches`, each with its types nested). Those rows carry
 * exactly the keys of their COACHING_SHAPES entries (R81, X28), under the
 * same names; a figure the answer lacks is null, never a made-up zero.
 */
import { COACHING_SHAPES } from '@touch/core/coaching';
import type { PriceChangeKind } from '@touch/core/protocols';
import { countPhrase, formatIQD, formatNumber, type Locale, type MessageKey } from '@touch/i18n';
import { isObj, pickText } from './protocolLogic';
import type { Obj } from './formModel';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

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

export type LessonKindWord = 'private' | 'group' | 'course';

/** One `lesson_types[]` row (COACHING_SHAPES.price_promo_targets_lesson_types). */
export interface TargetLessonType {
  lesson_type_id: string;
  kind: string;
  name_en: string;
  name_ar: string;
  duration_min: number | null;
  /** A course's sessions; null otherwise. */
  sessions_count: number | null;
  max_places: number | null;
  price_iqd: number | null;
  court_share_iqd: number | null;
  is_active: boolean;
}

/** One type a coach teaches here (COACHING_SHAPES.price_promo_targets_coaches, `coaches[].lesson_types[]`). */
export interface TargetCoachType {
  lesson_type_id: string;
  name_en: string;
  name_ar: string;
  kind: string;
  sessions_count: number | null;
  /** The type's price. */
  type_price_iqd: number | null;
  /** The coach's own price for it, null when the type's applies. */
  coach_price_iqd: number | null;
}

/** One `coaches[]` row: a coach not retired at the venue, and the types they teach there. */
export interface TargetCoach {
  coach_id: string;
  display_name_en: string;
  display_name_ar: string;
  lesson_types: TargetCoachType[];
}

export interface Targets {
  items: TargetItem[];
  addons: TargetAddon[];
  promotions: TargetPromotion[];
  rules: TargetRule[];
  featured: { item_id: string | null; pct: number; hero_mode: string | null } | null;
  /**
   * Coaching (0285): the lesson types of a `lesson_price` / `lesson_launch`
   * change, and the coaches of a `coach_price` one. `readTargets` always sets
   * both; they are optional so an empty list built by hand stays a `Targets`.
   */
  lessonTypes?: TargetLessonType[];
  coaches?: TargetCoach[];
}

const EMPTY: Targets = { items: [], addons: [], promotions: [], rules: [], featured: null, lessonTypes: [], coaches: [] };

/** The X28 key lists the rows below carry (R81): the shapes file decides the names. */
const LESSON_TYPE_KEYS = COACHING_SHAPES.price_promo_targets_lesson_types.nested?.['lesson_types[]'] ?? [];
const COACH_KEYS = COACHING_SHAPES.price_promo_targets_coaches.nested?.['coaches[]'] ?? [];
const COACH_TYPE_KEYS = COACHING_SHAPES.price_promo_targets_coaches.nested?.['coaches[].lesson_types[]'] ?? [];

/** The text keys of a row; every other listed key is a figure (or `is_active`, a flag). */
const TEXT_KEYS = new Set(['lesson_type_id', 'coach_id', 'kind', 'name_en', 'name_ar', 'display_name_en', 'display_name_ar']);

/** A row with exactly `keys`: text as text ('' when missing), figures as numbers or null, flags as booleans. */
function pickRow(raw: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const k of keys) {
    if (k === 'lesson_types') continue;
    if (k === 'is_active') out[k] = raw[k] !== false;
    else if (TEXT_KEYS.has(k)) out[k] = str(raw[k]) ?? '';
    else out[k] = num(raw[k]);
  }
  return out;
}

function readLessonTypes(raw: unknown): TargetLessonType[] {
  return arr(raw)
    .filter(isObj)
    .map((t) => pickRow(t, LESSON_TYPE_KEYS) as unknown as TargetLessonType)
    .filter((t) => t.lesson_type_id !== '');
}

function readCoaches(raw: unknown): TargetCoach[] {
  return arr(raw)
    .filter(isObj)
    .map((c) => ({
      ...(pickRow(c, COACH_KEYS) as unknown as Omit<TargetCoach, 'lesson_types'>),
      lesson_types: arr(c.lesson_types)
        .filter(isObj)
        .map((t) => pickRow(t, COACH_TYPE_KEYS) as unknown as TargetCoachType)
        .filter((t) => t.lesson_type_id !== ''),
    }))
    .filter((c) => c.coach_id !== '');
}

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
  return { items, addons, promotions, rules, featured, lessonTypes: readLessonTypes(raw.lesson_types), coaches: readCoaches(raw.coaches) };
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
  /** A lesson type (`/protocols?…&lessonType=`, from /admin/coaches). */
  lessonType?: string;
  /** A `coach_price` change's coach (`&coach=`). */
  coach?: string;
}

/**
 * A lesson type's figures as the proposal opens with them. `lesson_price`
 * also keeps them as `before`, so the send drops a figure left as it is: the
 * server refuses a "change" to the stored figure (0285), and the client copy
 * of `before` is never sent (`finalizeRecord`; the server writes its own).
 */
function lessonFigures(change: 'lesson_price' | 'lesson_launch', t: TargetLessonType): Obj {
  const figures = { price_iqd: t.price_iqd, court_share_iqd: t.court_share_iqd };
  return change === 'lesson_price'
    ? { lesson_type_id: t.lesson_type_id, ...figures, before: { ...figures } }
    : { lesson_type_id: t.lesson_type_id, ...figures };
}

/** A coach's price for a type as a proposal opens with it: their own, else the type's. */
function coachFigure(t: TargetCoachType | undefined): number | null {
  return t ? (t.coach_price_iqd ?? t.type_price_iqd) : null;
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
    // Coaching (0285): the type's price and court share now (a draft's, for a
    // launch); a coach's own price, else the type's.
    case 'lesson_price':
    case 'lesson_launch': {
      const t = (targets.lessonTypes ?? []).find((x) => x.lesson_type_id === link.lessonType);
      return t ? { change, ...lessonFigures(change, t) } : { change };
    }
    case 'coach_price': {
      const coach = (targets.coaches ?? []).find((c) => c.coach_id === link.coach);
      if (!coach) return { change };
      const t = coach.lesson_types.find((x) => x.lesson_type_id === link.lessonType);
      return t
        ? { change, coach_id: coach.coach_id, lesson_type_id: t.lesson_type_id, price_iqd: coachFigure(t) }
        : { change, coach_id: coach.coach_id };
    }
  }
}

/**
 * What picking a target does to the proposal: an item brings its sizes, a
 * promotion or a rule its fields, a lesson type its figures. `field` names
 * the picker when a change has two (`coach_price`: the coach, then one of
 * their types; another coach keeps the type only when they teach it too).
 */
export function pickTarget(change: PriceChangeKind, targets: Targets, record: Obj, id: string, field?: string): Obj {
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
    case 'lesson_price':
    case 'lesson_launch': {
      const t = (targets.lessonTypes ?? []).find((x) => x.lesson_type_id === id);
      const { before: _drop, ...rest } = record;
      return t ? { ...rest, ...lessonFigures(change, t) } : { ...rest, lesson_type_id: id, price_iqd: null, court_share_iqd: null };
    }
    case 'coach_price': {
      if (field === 'coach_id') {
        const coach = (targets.coaches ?? []).find((c) => c.coach_id === id);
        const kept = coach?.lesson_types.find((x) => x.lesson_type_id === record.lesson_type_id);
        return kept
          ? { ...record, coach_id: id, price_iqd: coachFigure(kept) }
          : { ...record, coach_id: id, lesson_type_id: '', price_iqd: null };
      }
      const coach = (targets.coaches ?? []).find((c) => c.coach_id === record.coach_id);
      return { ...record, lesson_type_id: id, price_iqd: coachFigure(coach?.lesson_types.find((x) => x.lesson_type_id === id)) };
    }
    default:
      return record;
  }
}

/** The item a target list holds, by id; for labels. */
export function targetItemName(targets: Targets, id: unknown, locale: Locale): string {
  const item = targets.items.find((i) => i.menu_item_id === id);
  return item ? pickText(locale, item.name_en, item.name_ar) : '';
}

// ── Lesson targets in words (coaching 0285) ─────────────────────────────────

function kindWord(kind: string): LessonKindWord | null {
  return kind === 'private' || kind === 'group' || kind === 'course' ? kind : null;
}

/**
 * A lesson type as a picker lists it: "Beginners · Group 90 min", a course's
 * sessions after it, then "Draft" for a launch's draft or "off" for a type
 * switched off. A coach's types carry no length (X28), so theirs read
 * "Beginners · Group".
 */
export function lessonTypeLabel(
  t: Pick<TargetLessonType, 'name_en' | 'name_ar' | 'kind' | 'sessions_count'> & { duration_min?: number | null; is_active?: boolean },
  tr: Tr,
  locale: Locale,
  status: 'draft' | 'off' | null = null,
): string {
  const name = pickText(locale, t.name_en, t.name_ar);
  const kind = kindWord(t.kind);
  const kindText = kind ? tr(`ws.coaching.common.kindShort.${kind}`) : '';
  const length = typeof t.duration_min === 'number' ? tr('ws.coaching.common.minutes', { minutes: formatNumber(t.duration_min, locale) }) : '';
  const parts = [kind || length ? tr('ws.protocols.form.lessonType', { name, kind: kindText, length }).trim() : name];
  if (kind === 'course' && typeof t.sessions_count === 'number') parts.push(countPhrase('ws.coaching.count.sessions', t.sessions_count, locale));
  if (status === 'draft') parts.push(tr('ws.protocols.form.draft'));
  if (status === 'off') parts.push(tr('ws.protocols.form.off'));
  return parts.join(' · ');
}

/** A coach's name as a picker and a record read it. */
export function coachLabel(c: Pick<TargetCoach, 'display_name_en' | 'display_name_ar'>, locale: Locale): string {
  return pickText(locale, c.display_name_en, c.display_name_ar);
}

/**
 * The "Now: …" line under a lesson proposal's figures: a type's price and
 * court share today (a draft's, for a launch), or the coach's own price, else
 * the type's. Null until the target is picked. A figure the server did not
 * send reads "—".
 */
export function lessonNowLine(change: PriceChangeKind | null, targets: Targets | undefined, record: Obj, tr: Tr, locale: Locale): string | null {
  const money = (v: number | null) => (v === null ? '—' : formatIQD(v, locale));
  if (change === 'lesson_price' || change === 'lesson_launch') {
    const t = (targets?.lessonTypes ?? []).find((x) => x.lesson_type_id === record.lesson_type_id);
    return t ? tr('ws.protocols.form.lessonNow', { price: money(t.price_iqd), share: money(t.court_share_iqd) }) : null;
  }
  if (change === 'coach_price') {
    const coach = (targets?.coaches ?? []).find((c) => c.coach_id === record.coach_id);
    const t = coach?.lesson_types.find((x) => x.lesson_type_id === record.lesson_type_id);
    if (!t) return null;
    return t.coach_price_iqd !== null
      ? tr('ws.protocols.form.coachNow', { price: money(t.coach_price_iqd) })
      : tr('ws.protocols.form.coachNowType', { price: money(t.type_price_iqd) });
  }
  return null;
}

/**
 * Names a lesson change's ids by (RecordView): its types, its coaches, and
 * the types a coach teaches.
 */
export function lessonTargetNames(targets: Targets | undefined): Record<string, { en: string; ar: string }> {
  const out: Record<string, { en: string; ar: string }> = {};
  for (const t of targets?.lessonTypes ?? []) out[t.lesson_type_id] = { en: t.name_en, ar: t.name_ar };
  for (const c of targets?.coaches ?? []) {
    out[c.coach_id] = { en: c.display_name_en, ar: c.display_name_ar };
    for (const t of c.lesson_types) out[t.lesson_type_id] ??= { en: t.name_en, ar: t.name_ar };
  }
  return out;
}
